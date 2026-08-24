import { NextResponse } from "next/server"
import { z } from "zod"

import { logAudit } from "@/lib/activity/audit"
import { apiError, requireTillSession } from "@/lib/api/till-session"

/**
 * Edits a customer's details from the till — name and phone number.
 *
 * The directory profile is read-only about money on purpose (balances and
 * statements come from the server in their own time), but a misspelt name or
 * an old phone number is exactly the kind of thing the cashier learns while
 * the customer is standing there. Unlike opening a credit account, nothing
 * here moves money or risk, so no manager approval stands in the way.
 *
 * The answer carries the customer's account state back in the same shape as
 * `/api/till/customers`, so the tablet can swap its profile card for this row
 * without a second round trip.
 */
const updateSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer's name.").max(120),
  phone: z.string().trim().max(40).nullish(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const customerId = Number((await params).id)
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return apiError("That is not a customer number.", 400)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("Malformed request.", 400)
  }

  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid customer.",
      },
      { status: 400 },
    )
  }

  const { error: writeError } = await session.supabase
    .from("customers")
    .update({
      full_name: parsed.data.name,
      phone: parsed.data.phone?.trim() || null,
    })
    .eq("id", customerId)

  if (writeError) {
    if (writeError.code === "23505") {
      return NextResponse.json({
        ok: false,
        error: "A customer with that phone number already exists.",
      })
    }
    return NextResponse.json({ ok: false, error: writeError.message })
  }

  // Read back through the same view every other till path uses, so the
  // balance and hold state arrive with the new name rather than going stale
  // on screen while somebody else takes a payment.
  const { data: row, error: readError } = await session.supabase
    .from("customer_credit_accounts")
    .select("customer_id, full_name, phone, credit_enabled, credit_on_hold, balance")
    .eq("customer_id", customerId)
    .maybeSingle()

  if (readError) return apiError(readError.message, 500)
  if (!row) return apiError("That customer was not found.", 404)

  await logAudit(session.supabase, {
    type: "customer.updated",
    refType: "customer",
    refId: customerId,
    summary: `${row.full_name}: details edited at the till`,
    detail: { name: row.full_name, phone: row.phone },
  })

  return NextResponse.json({
    ok: true,
    customer: {
      id: row.customer_id,
      fullName: row.full_name ?? "",
      phone: row.phone,
      creditEnabled: row.credit_enabled ?? false,
      creditBalance: Number(row.balance ?? 0),
      creditOnHold: row.credit_on_hold ?? false,
    },
  })
}
