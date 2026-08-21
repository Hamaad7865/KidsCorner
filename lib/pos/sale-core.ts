import { z } from "zod"

import { isAdminRole } from "@/lib/auth/roles"
import { isRole } from "@/lib/db-enums"
import {
  checkEligibility,
  discountAmountFor,
  discountBaseFor,
  type DiscountRule,
} from "@/lib/discounts/rules"
import { round2, formatRs, shopToday } from "@/lib/format"
import { deviceVerifierMatches, mintDeviceVerifier } from "@/lib/pos/device-verifier"
import { PIN_PATTERN, verifyPin } from "@/lib/pos/pin"
import type { Database, Json } from "@/lib/supabase/database.types"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Everything a sale needs to know about money, with no transport attached.
 *
 * This used to live inside the `"use server"` action, reachable only through a
 * cookie session. The Android till cannot send cookies — it authenticates with
 * a bearer token — and the obvious alternative, letting it call Supabase
 * directly, is not available: `complete_sale_keyed_at_policy` takes `unit_price` per line
 * and trusts it. The re-pricing, the discount settlement and the manager check
 * are *here*, in TypeScript, so a client that skips this layer skips all three.
 *
 * So the rule for every till, web or native, is the same: post variant ids and
 * quantities, and let this decide what they cost.
 */

export type TillClient = SupabaseClient<Database>

/**
 * "Rs 1,075.50" for an audit summary, and for the sentence a cashier reads when
 * an account is over its limit.
 *
 * Delegates to `formatRs` rather than doing its own `toFixed(2)`, which is what
 * it used to do. That produced "Rs 1000.00" while every screen in the shop
 * writes "Rs 1,000.00" — tolerable in an audit line, but this now also renders
 * a refusal at the counter, and a figure punctuated differently from the one on
 * the till beside it invites a cashier to wonder whether it is the same number.
 * `lib/format` is pure formatting, not UI, so nothing about the boundary this
 * module keeps is given up by using it.
 */
const formatMoney = (value: number) => formatRs(value)

/** The signed-in device/user a sale is committed on behalf of. */
export type TillUser = { id: string; name: string }

export type Cashier = {
  id: string
  fullName: string
  role: string
  hasPin: boolean
}

export type SaleItemInput = {
  /** Null for a custom line: gift wrap, an alteration, unlabelled stock. */
  variantId: number | null
  qty: number
  /** Read but not trusted — clamped to the line's own value. */
  discount: number
  /** Set only on a custom line, and then it is what the receipt says. */
  description?: string | null
  /**
   * Only ever read for a custom line, where there is nothing to look a price
   * up from. A catalogue line's price is reloaded and this is ignored.
   */
  unitPrice?: number
}

export type AppliedDiscountInput = {
  discountId: number | null
  label: string
  kind: "percent" | "amount"
  value: number
  amount: number
  approvedBy: string | null
}

export type PaymentInput = {
  method: string
  amount: number
  tendered: number | null
}

export type CompleteSaleResult =
  | { ok: true; saleId: number }
  /**
   * `needsApproval` is what a till keys its manager prompt off. Separate from
   * the message so the UI does not have to match on error text.
   *
   * `uncertain` means the sale may have committed without the till hearing so.
   * Retrying is safe — the idempotency key replays it — but only if the basket
   * has not changed, so the till freezes it rather than letting the cashier
   * edit and resubmit under the same key.
   */
  | { ok: false; error: string; needsApproval?: boolean; uncertain?: boolean }

// ------------------------------------------------------------------- PINs

/**
 * Phrased for somebody standing at a till with a customer waiting, not for a
 * log: it says how long, in units a person counts in.
 */
export function waitMessage(seconds: number): string {
  if (seconds < 60) return `Too many tries. Wait ${seconds} seconds.`
  const minutes = Math.ceil(seconds / 60)
  return `Too many tries. Wait ${minutes} minute${minutes === 1 ? "" : "s"}.`
}

/** Seconds a profile must wait before it may try a PIN again. 0 means now. */
export async function pinLockSeconds(
  supabase: TillClient,
  profileId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("pin_lock_state", {
    p_profile_id: profileId,
  })
  return !error && typeof data === "number" ? data : 0
}

/**
 * Verifies a 4-digit PIN. The hash never leaves this process.
 *
 * On the Android till this is the front door, not a name badge: the device
 * stays signed in and the PIN is the only thing in the way. Four digits is
 * 10,000 guesses, so the attempt counter in migration 010 — kept in the
 * database, where reinstalling the app cannot reset it — is what makes grinding
 * that space impractical. Three misses are free; after that the wait doubles.
 */
export async function authenticateCashier(
  supabase: TillClient,
  profileId: string,
  pin: string,
  // Which till the keypad was on, for the audit trail. Optional because a
  // caller that genuinely does not know must say so with a null, not invent one.
  deviceId?: number | null,
): Promise<
  | { ok: true; cashier: Cashier }
  /**
   * `wrongPin` is set ONLY when the four digits themselves did not match —
   * not when the account is locked out, deactivated, or has no PIN at all.
   *
   * The tablet needs that distinction and cannot infer it: after a miss that
   * trips the lockout, `lockedFor` is above zero for a wrong PIN and for a
   * right one alike. It drops its offline verifier when the server rejects a
   * PIN the verifier accepts — that is how a PIN changed in the back office
   * stops opening tills — and doing that on a lockout would throw away a
   * perfectly good verifier for a PIN that was correct.
   */
  | { ok: false; error: string; lockedFor?: number; wrongPin?: boolean }
> {
  if (!PIN_PATTERN.test(pin)) return { ok: false, error: "Enter a 4-digit PIN." }

  // Checked before the hash is computed: a locked-out profile should cost an
  // attacker the wait, not a burst of free PBKDF2 work on the server.
  const locked = await pinLockSeconds(supabase, profileId)
  if (locked > 0) {
    return { ok: false, error: waitMessage(locked), lockedFor: locked }
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, pin_code, is_active, pin_device_verifier")
    .eq("id", profileId)
    .maybeSingle()

  if (error || !data) return { ok: false, error: "That staff member was not found." }
  if (!data.is_active) return { ok: false, error: "That account is deactivated." }
  if (!data.pin_code) {
    return {
      ok: false,
      error: "No PIN is set for them yet — an owner sets it in Settings.",
    }
  }

  const ok = await verifyPin(pin, data.pin_code)

  // Recorded either way: a success clears the counter, a failure advances it.
  const { data: wait } = await supabase.rpc("register_pin_attempt", {
    p_profile_id: profileId,
    p_ok: ok,
  })

  if (!ok) {
    const seconds = typeof wait === "number" ? wait : 0
    return {
      ok: false,
      error: seconds > 0 ? waitMessage(seconds) : "Wrong PIN.",
      lockedFor: seconds,
      wrongPin: true,
    }
  }

  /**
   * The PIN is proven correct and briefly in hand, which is the only moment
   * the tills' offline verifier can be minted. Backfills everyone whose PIN
   * predates migration 038, and repairs a verifier that a PIN change dropped.
   *
   * Best-effort, like the audit line below it: a shop must never be unable to
   * open its till because a column could not be written. The cost of skipping
   * is that offline sign-in waits for the next successful one.
   */
  if (!(await deviceVerifierMatches(pin, data.pin_device_verifier))) {
    await supabase
      .from("profiles")
      .update({ pin_device_verifier: await mintDeviceVerifier(pin) })
      .eq("id", profileId)
      .then(() => undefined, () => undefined)
  }

  // The operator event Carfectionist's traceability shows. Recorded after the
  // check passes and never allowed to fail it — a sign-in must not bounce
  // because the audit write hiccupped, so the error is deliberately dropped.
  await supabase
    .rpc("log_audit" as never, {
      p_event_type: "operator_signed_in",
      p_ref_type: "profile",
      p_ref_id: data.id,
      p_summary: `${data.full_name} signed in at the till`,
      p_detail: {},
      p_device_id: deviceId ?? null,
    } as never)
    .then(() => undefined, () => undefined)

  return {
    ok: true,
    cashier: { id: data.id, fullName: data.full_name, role: data.role, hasPin: true },
  }
}

/**
 * Staff who can be switched to at the till.
 *
 * `pin_code` is selected only to derive `hasPin` — the hash itself never
 * crosses to a client, so a stored PIN can't be attacked offline from a
 * browser bundle or a decompiled APK.
 */
export async function listCashiers(supabase: TillClient): Promise<Cashier[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, pin_code")
    .eq("is_active", true)
    .order("full_name")

  if (error) return []
  return (data ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    role: row.role,
    hasPin: Boolean(row.pin_code),
  }))
}

/** A cashier plus the hash a till may keep, so its keypad works with no line. */
export type DeviceCashier = Cashier & {
  /**
   * Null when this person cannot yet be admitted offline: no PIN, or a PIN
   * older than migration 038 that has not been used online since. The till
   * says so on the tile rather than failing at the keypad.
   */
  verifier: string | null
}

/**
 * The same roster, for a device that has to survive an outage.
 *
 * Split from [listCashiers] rather than adding a field to it, because
 * `listCashiers` also feeds web pages — the till's return screen renders a
 * manager list from it — and a browser has no use for a verifier it cannot
 * go offline with. Sending one there would put a hash of every manager's PIN
 * into a page's HTML for no benefit at all.
 *
 * So this one exists to be called from exactly one place: /api/till/bootstrap,
 * which is behind the device's bearer token.
 */
export async function listCashiersForDevice(
  supabase: TillClient,
): Promise<DeviceCashier[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, pin_code, pin_device_verifier")
    .eq("is_active", true)
    .order("full_name")

  if (error) return []
  return (data ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    role: row.role,
    hasPin: Boolean(row.pin_code),
    // Belt and braces with migration 038's trigger: a verifier with no PIN
    // behind it would unlock a till offline that the online path refuses,
    // because offline there is nothing else to check.
    verifier: row.pin_code ? row.pin_device_verifier : null,
  }))
}

/**
 * Verifies a manager's PIN for a discount override.
 *
 * Reuses the same lockout as the cashier switcher — a four-digit PIN guarding
 * money off a sale is worth no less protection than one guarding the till, and
 * without a shared counter this would be the soft way in.
 */
/**
 * Checks a manager's PIN, and says who it belonged to.
 *
 * Exported so the refund path uses this and not a second implementation of the
 * same idea — one that might forget the lockout, or check the PIN before the
 * role and let a cashier's own PIN through.
 *
 * `what` only names the act in the messages a person reads. Everything the
 * function actually enforces is identical either way.
 */
export async function verifyApproval(
  supabase: TillClient,
  approval: { managerId: string; pin: string } | null | undefined,
  what: "discount" | "return" = "discount",
): Promise<{ managerId: string } | { error: string }> {
  if (!approval) {
    return { error: `A manager needs to approve this ${what}.` }
  }
  if (!PIN_PATTERN.test(approval.pin)) {
    return { error: "Enter the manager's 4-digit PIN." }
  }

  const locked = await pinLockSeconds(supabase, approval.managerId)
  if (locked > 0) return { error: waitMessage(locked) }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, is_active, pin_code")
    .eq("id", approval.managerId)
    .maybeSingle()

  if (error || !profile) return { error: "That manager was not found." }
  if (!profile.is_active) return { error: "That account is deactivated." }
  // Checked before the PIN so a cashier's own PIN cannot approve their own
  // discount even when it is typed correctly. `role` is TEXT + CHECK in the
  // schema, so the generator widens it to string — narrowed here rather than
  // cast, so an unrecognised value fails closed.
  if (!isRole(profile.role) || !isAdminRole(profile.role)) {
    return { error: `Only an owner or manager can approve a ${what}.` }
  }
  if (!profile.pin_code) {
    return { error: "That manager has no PIN set — an owner sets it in Settings." }
  }

  const ok = await verifyPin(approval.pin, profile.pin_code)
  const { data: wait } = await supabase.rpc("register_pin_attempt", {
    p_profile_id: approval.managerId,
    p_ok: ok,
  })

  if (!ok) {
    const seconds = typeof wait === "number" ? wait : 0
    return { error: seconds > 0 ? waitMessage(seconds) : "Wrong PIN." }
  }

  return { managerId: profile.id }
}

// ---------------------------------------------------------------- pricing

type PricedLine = {
  /** Null on a custom line. */
  variantId: number | null
  /** Set only on a custom line — what the receipt calls it. */
  description?: string
  qty: number
  unitPrice: number
  discount: number
  lineTotal: number
  /**
   * The product's category, carried through so a category-scoped rule can be
   * settled against its own lines rather than the whole basket.
   *
   * `products.category_id` is NOT NULL in migration 001, so every line has one.
   */
  categoryId: number
}

/**
 * Rebuilds every line from `product_variants`, ignoring any posted price.
 *
 * A line discount is kept — a cashier knocking money off one item is a real
 * thing — but clamped to that line's own value, so it can reduce a line to zero
 * and no further.
 *
 * Stock is checked here for the message only. The guarantee is the
 * `qty_on_hand >= 0` constraint from migration 009, which is what actually holds
 * when two tills sell the last unit at the same moment.
 */
async function priceItems(
  supabase: TillClient,
  items: SaleItemInput[],
): Promise<{ lines: PricedLine[] } | { error: string }> {
  // A custom line has no catalogue row to load, so it is left out of the
  // lookup entirely and priced from what was posted, below.
  const ids = [...new Set(items.map((i) => i.variantId).filter((id): id is number => id !== null))]

  const { data, error } = await supabase
    .from("product_variants")
    .select("id, selling_price, qty_on_hand, is_active, products ( name, category_id )")
    .in("id", ids)

  if (error) return { error: error.message }

  const byId = new Map((data ?? []).map((row) => [row.id, row]))

  // Quantities are summed per variant first: the same variant can legitimately
  // arrive as two lines, and checking each against stock separately would let
  // 2 + 2 through on 3 units.
  const wanted = new Map<number, number>()
  for (const item of items) {
    if (item.variantId === null) continue
    wanted.set(item.variantId, (wanted.get(item.variantId) ?? 0) + item.qty)
  }

  const lines: PricedLine[] = []

  for (const item of items) {
    // ── a custom line ───────────────────────────────────────────────────
    //
    // Gift wrap, an alteration, stock that arrived without a label. There is
    // nothing to re-price it against, so the posted price IS the price — which
    // is exactly why `settleDiscounts` demands a manager for any sale carrying
    // one. It moves no stock and has no category, so it can never be the base
    // of a category-scoped discount either.
    if (item.variantId === null) {
      const description = (item.description ?? "").trim()
      if (!description) {
        return { error: "A custom line needs a description." }
      }
      const unitPrice = round2(Math.max(0, item.unitPrice ?? 0))
      if (unitPrice <= 0) {
        return { error: `${description} needs a price.` }
      }
      const gross = round2(unitPrice * item.qty)
      const lineDiscount = round2(Math.min(Math.max(0, item.discount), gross))
      lines.push({
        variantId: null,
        description,
        qty: item.qty,
        unitPrice,
        discount: lineDiscount,
        lineTotal: round2(gross - lineDiscount),
        categoryId: 0,
      })
      continue
    }

    const variant = byId.get(item.variantId)
    if (!variant) {
      return { error: "An item in the cart no longer exists. Clear it and rescan." }
    }
    if (!variant.is_active) {
      const name = variant.products?.name ?? "An item"
      return { error: `${name} has been retired and cannot be sold.` }
    }

    const asked = wanted.get(item.variantId) ?? item.qty
    if (asked > variant.qty_on_hand) {
      const name = variant.products?.name ?? "That item"
      return {
        error: `Only ${variant.qty_on_hand} of ${name} left — the cart asks for ${asked}.`,
      }
    }

    const unitPrice = round2(Number(variant.selling_price))
    const gross = round2(unitPrice * item.qty)
    const lineDiscount = round2(Math.min(Math.max(0, item.discount), gross))

    lines.push({
      variantId: item.variantId,
      qty: item.qty,
      unitPrice,
      discount: lineDiscount,
      lineTotal: round2(gross - lineDiscount),
      categoryId: variant.products?.category_id ?? 0,
      description: undefined,
    })
  }

  return { lines }
}

/**
 * Re-settles the sale-level discounts against the `discounts` table.
 *
 * A discount carrying a `discountId` is recomputed from the rule row — its
 * amount, and also its label, kind and value, because those are what the
 * receipt and the discount report are built from. An inactive, expired or
 * under-spend rule is refused outright rather than quietly dropped: the
 * customer has been quoted a price, and silently charging more is worse than
 * failing loudly at the till.
 *
 * A manual discount has no rule to check against, so it is only clamped. That
 * leaves the shop's own policy intact while still making a negative sale
 * impossible.
 *
 * ## The base a rule is measured against
 *
 * `discounts.category_id` means "only applies to lines in this category", and
 * `discounts.scope` distinguishes a basket discount from a per-line one. Both
 * columns are as old as migration 005 and neither was honoured here: every rule
 * was computed against the whole basket, so "10% off Babywear" took 10% off
 * everything in the cart. That gives away the shop's money on every sale where
 * the basket is wider than the category, which is most of them.
 *
 * So the base is now per rule: the category's own lines where the rule names a
 * category, the basket where it does not. `min_spend` stays against the whole
 * basket — "needs a spend of at least X" is a threshold on the sale, not on the
 * category.
 */
/**
 * Exported for its own tests.
 *
 * Not a convenience: this function decides how much money comes off a sale,
 * and every one of its branches — the base a rule is measured against, the
 * clamps that stop a stack exceeding the basket, and the decision that a
 * manager is required — is a rule the shop is relying on. Testing it through
 * `commitSale` would mean stubbing half the schema to reach it.
 */
export async function settleDiscounts(
  supabase: TillClient,
  posted: AppliedDiscountInput[],
  lines: PricedLine[],
  approval: { managerId: string; pin: string } | null | undefined,
): Promise<
  | {
      applied: AppliedDiscountInput[]
      total: number
      /** The manager who authorised, when one was required. */
      approvedBy: string | null
      /** What needed authorising, in words, for the audit trail. */
      approvalReasons: string[]
    }
  | { error: string; needsApproval?: boolean }
> {
  const basket = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0))

  // Money off one item is a cashier deciding the price, exactly like a manual
  // sale discount — so it needs the same manager, checked in the same place
  // rather than in a second call that would double-count the PIN attempt.
  const hasLineDiscount = lines.some((l) => l.discount > 0)

  if (posted.length === 0 && !hasLineDiscount) {
    return { applied: [], total: 0, approvedBy: null, approvalReasons: [] }
  }

  const byCategory = new Map<number, number>()
  for (const line of lines) {
    byCategory.set(line.categoryId, round2((byCategory.get(line.categoryId) ?? 0) + line.lineTotal))
  }

  const ruleIds = posted
    .map((d) => d.discountId)
    .filter((id): id is number => id !== null)

  const rules = new Map<number, DiscountRule>()
  if (ruleIds.length > 0) {
    const { data, error } = await supabase.from("discounts").select("*").in("id", ruleIds)
    if (error) return { error: error.message }

    for (const row of data ?? []) {
      rules.set(row.id, {
        id: row.id,
        name: row.name,
        code: row.code,
        kind: row.kind === "percent" ? "percent" : "amount",
        value: Number(row.value),
        scope: row.scope === "line" ? "line" : "sale",
        categoryId: row.category_id,
        minSpend: Number(row.min_spend),
        maxAmount: row.max_amount === null ? null : Number(row.max_amount),
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        requiresManager: row.requires_manager,
        isActive: row.is_active,
      })
    }
  }

  // Which of these actually need a manager. Decided here from the rule rows and
  // the shape of the discount — never from anything the client asserted.
  //
  // A manual discount always needs one: it has no rule behind it, so there is
  // no ceiling, no minimum spend and no expiry, and an unapproved one is simply
  // a cashier deciding what the shop charges. Money off a single line is the
  // same act on a smaller scale, so it is held to the same bar.
  const requiresApproval =
    hasLineDiscount ||
    posted.some((d) => d.discountId === null) ||
    posted.some((d) => d.discountId !== null && rules.get(d.discountId)?.requiresManager)

  let approvedBy: string | null = null
  if (requiresApproval) {
    const verified = await verifyApproval(supabase, approval)
    if ("error" in verified) return { error: verified.error, needsApproval: true }
    approvedBy = verified.managerId
  }

  const applied: AppliedDiscountInput[] = []
  const seen = new Set<number>()
  let running = 0
  // What each base has already given away, so two rules naming the same
  // category cannot between them exceed that category's lines.
  const spentOn = new Map<number | null, number>()

  for (const entry of posted) {
    // Headroom left in the basket. Each discount is settled against what is
    // still there, so a stack of them can total the basket but never exceed it.
    const remaining = round2(basket - running)
    if (remaining <= 0) continue

    if (entry.discountId === null) {
      const amount = round2(Math.min(Math.max(0, entry.amount), remaining))
      if (amount <= 0) continue
      applied.push({
        discountId: null,
        label: "Manual discount",
        kind: "amount",
        value: amount,
        amount,
        // The manager this call just verified, not whatever the client sent.
        approvedBy,
      })
      running = round2(running + amount)
      continue
    }

    // Mirrors the till's own one-application-per-rule guard, enforced here too
    // because the till is not the only thing that can call this.
    if (seen.has(entry.discountId)) continue
    seen.add(entry.discountId)

    const rule = rules.get(entry.discountId)
    if (!rule) return { error: "A discount on this sale no longer exists." }

    // A line-scoped rule with no category names nothing: there is no line
    // target in the payload and no category to stand in for one, so there is no
    // honest base to measure it against. Refused loudly — the alternative is
    // charging the customer a price nobody chose.
    const base = discountBaseFor(rule, basket, byCategory)
    if (base === null) {
      return {
        error:
          `${rule.name} is set up as a per-line discount but names no category, ` +
          `so the till cannot tell what it applies to. An owner needs to fix it.`,
      }
    }

    // Minimum spend is a threshold on the sale, not on the category.
    const eligible = checkEligibility(rule, basket, shopToday())
    if (!eligible.eligible) {
      return { error: `${rule.name} cannot be used: ${eligible.reason}` }
    }

    const baseHeadroom = round2(base - (spentOn.get(rule.categoryId) ?? 0))

    if (baseHeadroom <= 0) {
      // Nothing in the cart for it to come off. Refused rather than dropped:
      // the cashier put it on the screen and quoted it.
      return {
        error: `${rule.name} does not apply to anything in this sale.`,
      }
    }

    const amount = round2(
      Math.min(
        discountAmountFor(rule.kind, rule.value, base, rule.maxAmount),
        baseHeadroom,
        remaining,
      ),
    )
    if (amount <= 0) continue

    applied.push({
      discountId: rule.id,
      label: rule.name,
      kind: rule.kind,
      value: rule.value,
      amount,
      // Only stamped where the rule actually demanded a manager, so the
      // discount report distinguishes a real override from a routine offer
      // that happened to be rung up in the same sale.
      approvedBy: rule.requiresManager ? approvedBy : null,
    })
    running = round2(running + amount)
    spentOn.set(rule.categoryId, round2((spentOn.get(rule.categoryId) ?? 0) + amount))
  }

  return {
    applied,
    total: round2(Math.min(running, basket)),
    // Carried out so the sale can record WHO authorised it. A line discount
    // demands a manager's PIN but produces no `sale_discounts` row to hang
    // the approver on, so without this the shop made a manager authorise
    // money off and then kept no record that they had.
    approvedBy,
    approvalReasons: [
      hasLineDiscount ? "money off a line" : null,
      posted.some((d) => d.discountId === null) ? "a manual discount" : null,
      posted.some((d) => d.discountId !== null && rules.get(d.discountId)?.requiresManager)
        ? "a rule needing approval"
        : null,
    ].filter((r): r is string => r !== null),
  }
}

// ----------------------------------------------------------------- credit

/**
 * Checks a sale's credit tender against the customer's account.
 *
 * A trigger on `sale_payments` enforces the same rules in the database, so this
 * is not what makes them true. It exists because of what the cashier sees:
 * without it the refusal arrives as a raw Postgres `check_violation` through
 * PostgREST, and "new row for relation sale_payments violates check constraint"
 * is not a sentence anyone can act on. Here the till gets "Rita Appadoo does
 * not have a credit account", which tells them what to do instead.
 *
 * Two things to check now the ceiling is gone: the customer has an OPEN account
 * and it is not on hold. There is no balance arithmetic — an open account may
 * run a tab of any size.
 */
export async function settleCreditTender(
  supabase: TillClient,
  customerId: number | null,
  payments: PaymentInput[],
): Promise<{ credit: number } | { error: string }> {
  const credit = round2(
    payments
      .filter((payment) => payment.method === "credit")
      .reduce((sum, payment) => sum + payment.amount, 0),
  )

  // The overwhelmingly common case: an ordinary sale, paid for. Costs nothing.
  if (credit <= 0) return { credit: 0 }

  if (customerId === null) {
    return {
      error: "A sale on account needs a customer. Attach one, or take payment now.",
    }
  }

  const { data, error } = await supabase
    .from("customer_credit_accounts")
    .select("full_name, credit_enabled, credit_on_hold")
    .eq("customer_id", customerId)
    .maybeSingle()

  if (error) return { error: error.message }
  if (!data) return { error: "That customer no longer exists." }

  const name = data.full_name ?? "That customer"

  // An account is open or it is not — there is no ceiling to check against any
  // more, only whether the shop has opened a tab for this person and whether it
  // is currently on hold.
  if (!data.credit_enabled) {
    return {
      error: `${name} does not have a credit account. An owner sets one up in the back office.`,
    }
  }
  if (data.credit_on_hold) {
    return { error: `${name}'s account is on hold, so nothing can be added to it.` }
  }

  return { credit }
}

// ------------------------------------------------------------ the envelope

/**
 * A field that may be null OR absent, normalised to null.
 *
 * `.nullable()` alone is not enough, and the difference cost two real sales.
 * The Android till serialises with kotlinx `explicitNulls = false`, which OMITS
 * a null property rather than writing `"customerId": null` — so a walk-in sale
 * arrived with no `customerId` key at all and zod refused it with "expected
 * number, received undefined". The till queued it, retried, and was refused
 * again fourteen times.
 *
 * Omitting a null is ordinary JSON practice, so the server accepts it. The
 * transform then collapses `undefined` to `null` here, at the boundary, so
 * everything downstream can keep comparing with `=== null` — `settleDiscounts`
 * in particular branches on `discountId === null` to tell a manual discount
 * from a rule-backed one, and an `undefined` slipping through would send a
 * manual discount looking for a rule that does not exist.
 */
const absentAsNull = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((v) => v ?? null)

/**
 * Absent OR explicitly null, collapsed to absent.
 *
 * `.optional()` is NOT this. It accepts `undefined` and REFUSES `null`, and
 * that difference cost this shop four days of takings: kotlinx is configured
 * with `explicitNulls = true` (TillApi.kt says why — turning it off had
 * previously dropped `discount` and `customerId` out of the payload entirely),
 * so the tablet writes `"unitPrice": null` on every catalogue line. Zod
 * answered "Invalid input: expected number, received null", the route returned
 * 400, and the queue retried the same rejected bytes 102 times.
 *
 * A JSON field this server treats as optional must accept both spellings of
 * "nothing". There is no client on earth that reliably picks one.
 */
const nothingIsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((v) => v ?? undefined)

const saleItemSchema = z
  .object({
    variantId: z.number().int().positive().nullish().transform((v) => v ?? null),
    qty: z.number().int().min(1),
    /**
     * Ignored for a catalogue line — `priceItems` reloads it. For a CUSTOM line
     * it is the price, because there is no catalogue row to read one from, and
     * that is why such a line needs a manager.
     */
    unitPrice: nothingIsUndefined(z.number().min(0)),
    /** Set only on a custom line. */
    description: z.string().trim().max(120).nullish().transform((v) => v ?? null),
    // Defaulted, not required. A line with no discount is the normal case, and a
    // client that omits a zero is not sending an invalid sale.
    discount: z.number().min(0).default(0),
  })
  .refine(
    (item) => item.variantId !== null || (item.description ?? "").length > 0,
    { message: "A custom line needs a description." },
  )
  .refine(
    (item) => item.variantId !== null || (item.unitPrice ?? 0) > 0,
    { message: "A custom line needs a price." },
  )

/**
 * `credit` is a tender here and money everywhere else is not.
 *
 * It means "billed to the customer's account": the sale completes, the goods
 * leave, the VAT is due, and the shop is owed. Recording it as a payment row is
 * what keeps the invariant below intact — payments must sum to exactly the
 * total — and it makes a deposit fall out for free, because cash 200 + credit
 * 300 is a balanced 500 sale with no special case in the pricing path.
 *
 * What it is NOT is unconditional. `settleCreditTender` refuses it without an
 * attached customer, without an account, on a held account, and over the limit,
 * and a trigger on `sale_payments` refuses the same four things again for any
 * client that finds another way in.
 */
const paymentSchema = z.object({
  method: z.enum(["cash", "card", "juice", "myt_money", "bank", "credit"]),
  amount: z.number().min(0),
  tendered: absentAsNull(z.number().min(0)),
})

const appliedDiscountSchema = z.object({
  discountId: absentAsNull(z.number().int().positive()),
  label: z.string().trim().min(1).max(80),
  kind: z.enum(["percent", "amount"]),
  value: z.number().min(0),
  amount: z.number().min(0),
  approvedBy: absentAsNull(z.uuid()),
})

/**
 * A manager standing at the till, typing their PIN to authorise a discount.
 *
 * The PIN travels with the sale rather than being exchanged for a token
 * earlier. That is deliberate: this is a public endpoint, and any approval the
 * *client* mints — a flag, a token, an id from an approvals table — can be
 * forged by whoever controls the device session, which on a shared till is
 * every cashier. Knowing a manager's PIN is the only thing that cannot be, so
 * it is checked at the moment the money is committed.
 */
const approvalSchema = z.object({
  managerId: z.uuid(),
  pin: z.string(),
})

/**
 * What a till may post. Shared by the web action and the Android route handler
 * so neither can be laxer than the other.
 *
 * `discount` is accepted and ignored for the same reason `unitPrice` is: the
 * settled figure comes from `settleDiscounts`, not from the caller.
 */
export const completeSaleSchema = z.object({
  shiftId: z.number().int().positive(),
  customerId: absentAsNull(z.number().int().positive()),
  cashierId: absentAsNull(z.uuid()),
  discounts: z.array(appliedDiscountSchema).default([]),
  discount: nothingIsUndefined(z.number().min(0)),
  items: z.array(saleItemSchema).min(1, "The cart is empty."),
  payments: z.array(paymentSchema).min(1, "Add at least one payment."),
  approval: approvalSchema.nullish(),
  /**
   * Names one sale attempt, stable across retries of that attempt. Optional so
   * an older client still works, but every till sends one.
   */
  idempotencyKey: z.string().trim().min(8).max(64).nullish(),
  /**
   * The immutable policy cached when this attempt was checked out. Missing or
   * null is reserved for pre-policy Android queues and maps to legacy VAT in
   * SQL; a non-null id is never replaced with the server's current policy.
   */
  vatPolicyId: z.number().int().positive().nullable().optional(),
  /** Generated once by the till and retained byte-for-byte on every retry. */
  checkedOutAt: z.string().datetime().nullable().optional(),
})

export type CompleteSaleInput = z.input<typeof completeSaleSchema>

// ------------------------------------------------------------------ sale

export type CommitSaleInput = {
  shiftId: number
  customerId: number | null
  /** The PIN-selected cashier, which is not necessarily the session user. */
  cashierId: string | null
  /** Named rules applied to this sale, frozen for the ledger. */
  discounts: AppliedDiscountInput[]
  items: SaleItemInput[]
  payments: PaymentInput[]
  /** A manager's PIN, when the basket carries a discount that needs one. */
  approval?: { managerId: string; pin: string } | null
  /** Names this attempt so a retry replays rather than charges again. */
  idempotencyKey?: string | null
  /** Immutable VAT policy seen when this attempt was checked out. */
  vatPolicyId?: number | null
  /** Stable checkout instant; callers must not regenerate it on retry. */
  checkedOutAt?: string | null
}

/**
 * Prices, settles and commits one sale. The single networked step.
 *
 * `complete_sale_keyed_at_policy` is SECURITY DEFINER and does the whole write
 * atomically — sale header, items, payments and a stock-out movement per line —
 * so this validates, re-derives the money, and forwards. If it fails the caller
 * keeps the cart and can retry, which is why this returns a result object
 * rather than throwing.
 */
export async function commitSale(
  supabase: TillClient,
  user: TillUser,
  input: CommitSaleInput,
): Promise<CompleteSaleResult> {
  // WHO the sale is attributed to is a claim too.
  //
  // The device is authenticated; the cashier is whoever was picked by PIN on
  // the lock screen, and the till simply asserts that id on every sale. Nothing
  // ties the assertion to the PIN check that preceded it, so an unvalidated
  // `cashierId` lets a crafted request pin a sale — and the discounts on it —
  // on a colleague who never touched the till. The foreign key only stops an
  // id that is not a profile at all; a deactivated account, or an owner with no
  // PIN who cannot appear on the lock screen, both sail through.
  //
  // Narrowed here to the same set the lock screen offers. It does not make the
  // assertion trustworthy — only a server-side cashier session bound to the PIN
  // check would — but it stops a sale being attributed to anyone who could not
  // have rung it up.
  if (input.cashierId !== null && input.cashierId !== user.id) {
    const { data: claimed } = await supabase
      .from("profiles")
      .select("id, pin_code, is_active")
      .eq("id", input.cashierId)
      .maybeSingle()

    if (!claimed || !claimed.is_active || !claimed.pin_code) {
      return { ok: false, error: "That cashier cannot ring up a sale on this till." }
    }
  }

  // Everything about money is rebuilt here from the database. What the client
  // posted for `unitPrice`, for each line's discount and for the sale discount
  // is treated as a claim, not a fact: this is reachable by any signed-in
  // cashier, from a browser console or a rebuilt APK. Trusting it would let a
  // sale be rung up at any price.
  const priced = await priceItems(supabase, input.items)
  if ("error" in priced) return { ok: false, error: priced.error }

  const basket = round2(priced.lines.reduce((sum, l) => sum + l.lineTotal, 0))

  // Rule-backed discounts are recomputed from the rule; manual ones are only
  // clamped. Either way the total can never exceed the basket, which is what
  // stops a crafted discount driving the sale negative.
  const settled = await settleDiscounts(supabase, input.discounts, priced.lines, input.approval)
  if ("error" in settled) {
    return { ok: false, error: settled.error, needsApproval: settled.needsApproval }
  }

  const discount = settled.total
  const total = round2(basket - discount)

  const paid = round2(input.payments.reduce((sum, p) => sum + p.amount, 0))
  if (paid + 0.001 < total) {
    return {
      ok: false,
      error: `Payments total ${paid.toFixed(2)} but the sale is ${total.toFixed(2)}.`,
    }
  }

  /**
   * Over-payment is refused too, not just under-payment.
   *
   * `amount` is what the drawer or the rail actually receives; cash handed over
   * beyond the price is `tendered`, and the change comes back out of it. A
   * payload putting the tendered figure in `amount` — Rs 500 recorded against a
   * Rs 50 sale — was accepted verbatim, so `expected_cash` rose by 500 while
   * the drawer held 50 and the cashier came up 450 short at close. The web
   * till's own clamp never protected this path: `/api/till/sale` does not go
   * through it.
   *
   * A cent of slack, matching the under-payment side, so a legitimate rounding
   * difference is not treated as tampering.
   */
  if (paid > total + 0.001) {
    return {
      ok: false,
      error:
        `Payments total ${paid.toFixed(2)} but the sale is ${total.toFixed(2)}. ` +
        `Cash over the price belongs in the tendered figure, not the amount.`,
    }
  }

  /**
   * The account, when part of this sale is going on one.
   *
   * Checked after the totals are settled and before anything is committed, so
   * the limit is measured against what is actually being billed rather than
   * whatever the client claimed the sale was worth.
   */
  const credit = await settleCreditTender(supabase, input.customerId, input.payments)
  if ("error" in credit) return { ok: false, error: credit.error }

  /**
   * The generated types declare `p_customer_id` and `p_shift_id` as plain
   * numbers because `supabase gen types` cannot see that the SQL parameters are
   * nullable. A walk-in sale genuinely passes NULL for the customer. Casting
   * here — rather than editing database.types.ts — keeps the fix from being
   * wiped by the next types regeneration.
   */
  const args = {
    // Names this ATTEMPT. A retry sends the same one, and the RPC hands back
    // the sale it already made instead of making another — which is what stops
    // "keep the cart and press Confirm again" from charging twice when the
    // sale committed and only the reply went missing.
    p_key: input.idempotencyKey ?? null,
    p_shift_id: input.shiftId,
    p_customer_id: input.customerId,
    // The PIN-selected cashier owns the sale; the session user is only the
    // device that happens to be logged in. Falls back to the session user when
    // nobody has switched, so a sale is never left without an owner.
    p_cashier_id: input.cashierId ?? user.id,
    p_discount: discount,
    // The re-derived lines, not the posted ones.
    p_items: priced.lines.map((l) => ({
      variant_id: l.variantId,
      description: l.description ?? null,
      qty: l.qty,
      unit_price: l.unitPrice,
      discount: l.discount,
    })) as Json,
    p_payments: input.payments.map((p) => ({
      method: p.method,
      amount: round2(p.amount),
      tendered: p.tendered === null ? null : round2(p.tendered),
    })) as Json,
    // Frozen onto sale_discounts in the same transaction as the sale, so a
    // renamed rule can never restate what this receipt said. These are the
    // settled figures — label, kind and value come from the rule row, not from
    // whatever the client claimed the rule said.
    p_discounts: settled.applied.map((d) => ({
      discount_id: d.discountId,
      label: d.label,
      kind: d.kind,
      value: d.value,
      amount: d.amount,
      approved_by: d.approvedBy,
    })) as Json,
    p_vat_policy_id: input.vatPolicyId ?? null,
    p_checked_out_at: input.checkedOutAt ?? null,
  }

  // The distinct policy-aware name avoids PostgREST's overloaded-function
  // ambiguity. The RPC answers idempotency first, then resolves exactly the
  // supplied immutable policy (or the legacy row for an old/null payload).
  //
  // Wrapped because a thrown request is the case that matters most: it means no
  // response came back at all, so whether the sale committed is unknown.
  let data: unknown
  let error: { code?: string; message: string } | null = null
  try {
    ;({ data, error } = await supabase.rpc(
      "complete_sale_keyed_at_policy" as never,
      args as never,
    ))
  } catch (cause) {
    return {
      ok: false,
      uncertain: true,
      error:
        cause instanceof Error
          ? `Couldn't reach the till server: ${cause.message}`
          : "Couldn't reach the till server.",
    }
  }

  if (error) {
    // 23514 is the stock floor from migration 009. It only fires when another
    // till sold the last unit between this cart's check and its commit, so the
    // message points at that rather than at a constraint name.
    const oversold =
      error.code === "23514" && /qty_on_hand_non_negative/.test(error.message)

    return {
      ok: false,
      // A Postgres error code means the request reached the database and the
      // transaction rolled back — nothing committed, so the basket is safe to
      // edit. An error without one did not get that far, and the outcome is
      // unknown.
      uncertain: !error.code,
      error: oversold
        ? "Another till just sold the last of one of these items. Recheck the cart."
        : error.code === "42501"
          ? "You don't have permission to complete a sale."
          : error.message,
    }
  }
  if (typeof data !== "number") {
    return { ok: false, error: "The sale did not return an id. Please retry." }
  }

  /**
   * Who authorised, against the sale that resulted.
   *
   * A named discount carries its approver in `sale_discounts.approved_by`, but
   * money off a LINE produces no such row, and it still demands a manager's
   * PIN. So the shop was making a manager authorise a price and then keeping
   * no record anywhere that they had. This is that record.
   *
   * After the commit and never allowed to fail it: the sale is already the
   * customer's, and an audit write that hiccupped must not turn a completed
   * sale into an error on screen.
   */
  if (settled.approvedBy) {
    const off = round2(
      priced.lines.reduce((sum, l) => sum + l.discount, 0) + settled.total,
    )
    await supabase
      .rpc("log_audit" as never, {
        p_event_type: "discount_approved",
        p_ref_type: "sale",
        p_ref_id: String(data),
        p_summary: `${formatMoney(off)} authorised on a sale — ${settled.approvalReasons.join(", ")}`,
        p_detail: {
          sale_id: data,
          approved_by: settled.approvedBy,
          amount: off,
          reasons: settled.approvalReasons,
        },
        p_device_id: null,
      } as never)
      .then(() => undefined, () => undefined)
  }

  return { ok: true, saleId: data }
}
