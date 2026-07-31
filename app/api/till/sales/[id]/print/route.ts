import { NextResponse } from "next/server"

import { apiError, requireTillSession } from "@/lib/api/till-session"

/**
 * Records that a receipt went to the printer.
 *
 * Posted by the print button, never by the detail route's GET. A mutation on a
 * read is the sort of thing a retry or a double-fetch turns into phantom rows,
 * and "printed" is what this trail is supposed to mean — opening a receipt to
 * read it is not the event anyone cares about.
 *
 * The trail itself is append-only by design: `receipt_prints` has no INSERT,
 * UPDATE or DELETE policy, so rows arrive only through the SECURITY DEFINER
 * function and nobody can quietly remove the evidence of a reprint afterwards.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const saleId = Number((await params).id)
  if (!Number.isInteger(saleId) || saleId <= 0) {
    return apiError("That is not a sale number.", 400)
  }

  const { data, error } = await session.supabase.rpc("record_receipt_print", {
    p_sale_id: saleId,
  })

  // Reported rather than swallowed, unlike the web action.
  //
  // There, the print is a browser job that has already happened by the time
  // this is called — failing the trail must not stop a cashier printing. Here
  // the till asks *before* it prints, so it can say "reprint #3" on the paper,
  // and a silent failure would put the wrong number on a customer's receipt.
  if (error) return NextResponse.json({ ok: false, error: error.message })

  return NextResponse.json({
    ok: true,
    printCount: typeof data === "number" ? data : null,
  })
}
