"use server"

import { getSessionProfile } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"

/**
 * Records that a receipt was sent to the printer.
 *
 * Called from the print button rather than from the receipt page's render, for
 * two reasons. A mutation during a GET render is the sort of thing a prefetch
 * or a double-render turns into phantom rows. And "printed" is what the trail
 * is supposed to mean — opening a receipt to read it is not the event anyone
 * cares about.
 *
 * Failures are swallowed. A cashier with a customer waiting must not be stopped
 * from printing because an audit row would not write; the receipt is the job,
 * the trail is the record of it.
 */
export async function recordReceiptPrint(saleId: number): Promise<void> {
  if (!Number.isInteger(saleId) || saleId <= 0) return

  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return

  try {
    const supabase = await createClient()
    await supabase.rpc("record_receipt_print", { p_sale_id: saleId })
  } catch {
    // Deliberately silent — see above.
  }
}
