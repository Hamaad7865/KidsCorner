import { NextResponse } from "next/server"
import { z } from "zod"

import { logAudit } from "@/lib/activity/audit"
import { apiError, requireTillSession } from "@/lib/api/till-session"
import { round2 } from "@/lib/format"
import { verifyApproval } from "@/lib/pos/sale-core"

/**
 * Customer lookup for the "attach customer" step.
 *
 * Searched server-side rather than cached on the device like the catalog. A
 * shop's customer list is personal data — names and phone numbers — and there
 * is no reason for all of it to sit on a tablet that lives on a counter. The
 * catalog is public information about what is for sale; this is not.
 *
 * Read from `customer_credit_accounts` rather than `customers`, because the till
 * needs the account state in the same breath as the name: whether "On account"
 * may be offered at all, and how much room is left on it. Sending the balance
 * lets the tablet grey the tender out and say why, instead of letting a cashier
 * choose it and be refused after the customer has been told a total.
 *
 * The figures are for the screen only. `sale-core` re-reads the account and the
 * database re-checks the limit under a lock, so a stale balance here can show an
 * old number but can never authorise a charge.
 */
/**
 * The shape both read paths send. One mapper so the search path and the browse
 * path can never drift apart in what a customer row looks like to the till.
 */
function toCustomer(row: {
  customer_id: number | null
  full_name: string | null
  phone: string | null
  credit_enabled: boolean | null
  credit_on_hold: boolean | null
  balance: number | string | null
}) {
  return {
    id: row.customer_id,
    fullName: row.full_name ?? "",
    phone: row.phone,
    // Named so an older APK that does not know about credit simply ignores
    // them. `creditEnabled` false is the "no account" case the till keys off.
    creditEnabled: row.credit_enabled ?? false,
    creditBalance: round2(Number(row.balance ?? 0)),
    creditOnHold: row.credit_on_hold ?? false,
  }
}

export async function GET(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const params = new URL(request.url).searchParams
  const query = params.get("q")?.trim() ?? ""

  // ── browse mode: the customer directory ────────────────────────────────────
  //
  // Gated on explicit pagination params rather than on q being blank. The
  // attach dialog already sends `q=""` on mount and expects an empty list
  // back — branching on a blank query would silently turn that into a fetch
  // of everyone. An explicit `offset`/`limit` is an unambiguous ask for pages.
  const offsetParam = params.get("offset")
  const limitParam = params.get("limit")
  if (offsetParam === null && limitParam === null) {
    // Two characters minimum, so an empty box does not stream the whole list back.
    if (query.length < 2) return NextResponse.json({ ok: true, customers: [] })

    // Escaped before interpolation: % and _ are wildcards in LIKE, and a comma
    // would end the PostgREST `or` filter and let the rest be read as new
    // conditions.
    const safe = query.replace(/[%_,()]/g, "")
    if (safe.length < 2) return NextResponse.json({ ok: true, customers: [] })

    const { data, error } = await session.supabase
      .from("customer_credit_accounts")
      .select("customer_id, full_name, phone, credit_enabled, credit_on_hold, balance")
      .or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%`)
      .order("full_name")
      .limit(20)

    if (error) return apiError(error.message, 500)

    return NextResponse.json({
      ok: true,
      customers: (data ?? []).map((row) => toCustomer(row)),
    })
  }

  const offset = Math.max(0, Number.parseInt(offsetParam ?? "0", 10) || 0)
  const limit = Math.min(100, Math.max(1, Number.parseInt(limitParam ?? "40", 10) || 40))

  // Same view as the search: the directory wants the account state too, so a
  // card can show who owes what without a second round trip.
  let select = session.supabase
    .from("customer_credit_accounts")
    .select("customer_id, full_name, phone, credit_enabled, credit_on_hold, balance")
    .order("full_name")

  // The browse screen's own search box composes with pagination: same escape,
  // same two-character floor as the dialog's search above.
  if (query.length >= 2) {
    const safe = query.replace(/[%_,()]/g, "")
    if (safe.length >= 2) select = select.or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%`)
  }

  const { data, error } = await select.range(offset, offset + limit - 1)
  if (error) return apiError(error.message, 500)

  const rows = data ?? []
  return NextResponse.json({
    ok: true,
    customers: rows.map((row) => toCustomer(row)),
    // No COUNT query: "the page came back full" is close enough for a Load-more
    // button that simply goes quiet when the next page is empty or short.
    hasMore: rows.length === limit,
  })
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer's name.").max(120),
  phone: z.string().trim().max(40).nullish(),
  /** Open a credit account for them in the same breath. Gated below. */
  openAccount: z.boolean().optional().default(false),
  /** A manager's PIN, sent only once the till has been told to ask for one. */
  approval: z.object({ managerId: z.string(), pin: z.string() }).nullish(),
})

/**
 * Adds a customer from the till, for the walk-in who wants to be on file.
 *
 * Staff at a till have no route to the back office, so `openAccount` lets them
 * open a credit account in the same request rather than send the customer away
 * to come back later. It is the one part of this endpoint that needs a manager:
 * plain creation is free, but an open account is unlimited credit — the shop's
 * ceiling was removed on purpose, so the only thing left guarding it is who is
 * allowed to say yes. Verified BEFORE the insert, so a declined or wrong PIN
 * leaves nothing behind — the cashier retries with the same name and phone once
 * a manager types theirs.
 */
export async function POST(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("Malformed request.", 400)
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid customer.",
      },
      { status: 400 },
    )
  }

  const { openAccount } = parsed.data
  let approvedBy: string | null = null
  if (openAccount) {
    const verified = await verifyApproval(session.supabase, parsed.data.approval, "credit")
    if ("error" in verified) {
      return NextResponse.json({ ok: false, error: verified.error, needsApproval: true })
    }
    approvedBy = verified.managerId
  }

  const { data, error } = await session.supabase
    .from("customers")
    .insert({
      full_name: parsed.data.name,
      phone: parsed.data.phone?.trim() || null,
      credit_enabled: openAccount,
    })
    .select("id, full_name, phone, credit_enabled")
    .maybeSingle()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({
        ok: false,
        error: "A customer with that phone number already exists.",
      })
    }
    return NextResponse.json({ ok: false, error: error.message })
  }
  if (!data) return NextResponse.json({ ok: false, error: "The customer was not saved." })

  if (openAccount) {
    await logAudit(session.supabase, {
      type: "customer.credit_changed",
      refType: "customer",
      refId: data.id,
      summary: `${data.full_name}: account opened at the till`,
      detail: { creditEnabled: true, approvedBy },
    })
  }

  return NextResponse.json({
    ok: true,
    customer: {
      id: data.id,
      fullName: data.full_name,
      phone: data.phone,
      creditEnabled: data.credit_enabled ?? false,
      creditBalance: 0,
      creditOnHold: false,
    },
  })
}
