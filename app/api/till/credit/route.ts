import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { logAudit } from "@/lib/activity/audit"
import { outstandingCharges } from "@/lib/credit/aging"
import { STATEMENT_LIMIT } from "@/lib/credit/queries"
import { formatRs, round2 } from "@/lib/format"

/**
 * The sales that make up a customer's tab, for the till's account-payment view.
 *
 * The cashier picking a customer to settle needs to show what the balance is
 * made of — each sale on account, its receipt number and what is still owed on
 * it — rather than a bare figure with nothing tied to it. The payment itself
 * stays whole-balance and oldest-first (see `settle_customer_credit`); this is
 * read-only transparency.
 *
 * The oldest-first reduction that turns raw ledger rows into a per-charge
 * remaining is the SAME one the aging report uses (`outstandingCharges`), so the
 * back office and the till can never disagree about what is unpaid.
 */
export async function GET(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const customerId = Number(new URL(request.url).searchParams.get("customerId"))
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return NextResponse.json({ ok: true, balance: 0, charges: [] })
  }

  const { data, error } = await session.supabase
    .from("customer_credit_entries")
    .select("amount, due_on, created_at, sale_id, sales ( sale_no )")
    .eq("customer_id", customerId)
    // Oldest first: the order the FIFO rule is defined in, matching
    // getCreditStatement so the two read the ledger identically.
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(STATEMENT_LIMIT)

  if (error) return apiError(error.message, 500)

  const entries = (data ?? []).map((row) => ({
    amount: round2(Number(row.amount)),
    createdAt: row.created_at,
    saleId: row.sale_id,
    saleNo: row.sales?.sale_no ?? null,
  }))

  // Charges are the positive entries; everything negative is money the customer
  // no longer owes, pooled and applied oldest-first.
  const charges = entries.filter((entry) => entry.amount > 0)
  const reductions = round2(
    entries.filter((entry) => entry.amount < 0).reduce((sum, entry) => sum + -entry.amount, 0),
  )

  const { charges: unpaid } = outstandingCharges(charges, reductions)

  return NextResponse.json({
    ok: true,
    balance: round2(unpaid.reduce((sum, charge) => sum + charge.outstanding, 0)),
    charges: unpaid.map((charge) => ({
      saleId: charge.saleId,
      saleNo: charge.saleNo,
      date: charge.createdAt,
      amount: charge.outstanding,
    })),
  })
}

/**
 * A customer walking in to pay their tab.
 *
 * Open to cashiers, unlike the back office's own settle action, because this is
 * a counter job: somebody hands over notes across the till and expects the debt
 * to go down. The back-office route is owner/manager only for the opposite
 * reason — `/customers` is a screen a cashier cannot reach.
 *
 * `shiftId` is what makes the cash side correct. `settle_customer_credit` writes
 * a matching `till_movements` row for a cash payment taken against a shift, so
 * the drawer expects the money at close; without it the cashier would count more
 * cash than the shift's sales can explain and be recorded as over.
 *
 * Nothing about the amount is decided here. The function locks the customer,
 * re-reads the balance from the ledger, and refuses an over-payment — so a till
 * that posted a stale balance gets a refusal rather than a wrong entry.
 */

const settleSchema = z.object({
  customerId: z.number().int().positive(),
  amount: z.number().positive(),
  method: z.enum(["cash", "card", "juice", "myt_money", "bank"]),
  /**
   * Nullable, and it must be: a till with no shift open cannot take money into
   * a drawer that is not there. The RPC treats null as "not in any drawer".
   */
  shiftId: z.number().int().positive().nullish(),
  reason: z.string().trim().max(200).nullish(),
  /**
   * Which open receipts the customer says this money settles.
   *
   * The LEDGER does not care: settlement remains one pooled reduction applied
   * oldest-first by `settle_customer_credit`, because that is how a tab works.
   * This names the receipts for the record — the ledger entry's reason and the
   * printed slip — and it is checked rather than copied: every number must be
   * an OPEN charge on THIS account, recomputed here from the ledger with the
   * same FIFO reduction the statement uses, so a stale or crafted list can
   * never pin a payment to a receipt that was not owed.
   */
  saleNos: z.array(z.string().trim().min(1).max(40)).max(20).nullish(),
})

export async function POST(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("Malformed request.", 400)
  }

  const parsed = settleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid payment.",
      },
      // Schema failures are client bugs; business refusals stay 200 so a till
      // never mistakes "the limit was refused" for "the request failed".
      { status: 400 },
    )
  }

  const { customerId, amount, method, shiftId, reason } = parsed.data

  // Verify the named receipts against the ledger before anything is recorded.
  // Same read and same oldest-first reduction as the GET above, so what the
  // till offered as payable and what this accepts as named cannot drift apart.
  const wanted = [
    ...new Set((parsed.data.saleNos ?? []).map((no) => no.trim()).filter(Boolean)),
  ]
  let namedReceipts: string[] = []
  if (wanted.length > 0) {
    const { data, error } = await session.supabase
      .from("customer_credit_entries")
      .select("amount, created_at, sale_id, sales ( sale_no )")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(STATEMENT_LIMIT)

    if (error) return apiError(error.message, 500)

    const rows = (data ?? []).map((row) => ({
      amount: round2(Number(row.amount)),
      createdAt: row.created_at,
      saleNo: row.sales?.sale_no ?? null,
    }))
    const reductions = round2(
      rows.filter((entry) => entry.amount < 0).reduce((sum, entry) => sum + -entry.amount, 0),
    )
    const { charges: unpaid } = outstandingCharges(
      rows.filter((entry) => entry.amount > 0),
      reductions,
    )
    const owedBySaleNo = new Map(
      unpaid.filter((charge) => charge.saleNo !== null).map((charge) => [charge.saleNo!, charge.outstanding]),
    )

    const notOwed = wanted.find((no) => !owedBySaleNo.has(no))
    if (notOwed) {
      return NextResponse.json({
        ok: false,
        error: `${notOwed} is not an open receipt on this account.`,
      })
    }
    namedReceipts = wanted
  }

  const reasonForLedger =
    namedReceipts.length > 0
      ? `Against ${namedReceipts.join(", ")}`.slice(0, 200)
      : (reason ?? undefined)

  const { data, error } = await session.supabase.rpc("settle_customer_credit", {
    p_customer_id: customerId,
    p_amount: round2(amount),
    p_method: method,
    p_shift_id: shiftId ?? undefined,
    p_reason: reasonForLedger,
  })

  if (error) {
    /**
     * Always 200, like `/api/till/sale`.
     *
     * Every failure here is one the cashier has to act on and the till renders
     * differently — "they only owe Rs 350", "that shift is closed" — and an HTTP
     * status would flatten them into "request failed" and invite a blind retry
     * of a payment that may have been recorded.
     */
    return NextResponse.json({ ok: false, error: error.message })
  }

  const result = (data ?? {}) as { balance?: unknown; entry_id?: unknown }
  const balance = round2(Number(result.balance ?? 0))

  await logAudit(session.supabase, {
    type: "customer.credit_settled",
    refType: "customer",
    refId: customerId,
    summary: `${formatRs(amount)} received on account at the till`,
    detail: {
      amount,
      method,
      shiftId: shiftId ?? null,
      reason: reasonForLedger ?? null,
      receipts: namedReceipts.length > 0 ? namedReceipts : null,
      balance,
    },
  })

  return NextResponse.json({
    ok: true,
    entryId: Number(result.entry_id ?? 0),
    balance,
    settled: round2(amount),
  })
}
