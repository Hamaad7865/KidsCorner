"use client"

import { useCallback, useEffect, useRef } from "react"
import { Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { recordReceiptPrint } from "@/lib/receipts/actions"

/**
 * Opens the print dialog automatically, and offers a button for the reprint
 * case. Hidden from the printed output itself via `print:hidden`.
 *
 * Every print is recorded (migration 012). One receipt printed four times over
 * three days is worth a question — that is the whole point of the trail — so
 * the automatic print on open counts just as much as a deliberate second one.
 */
export function PrintButton({
  /**
   * Omitted by the barcode label sheet, which shares this button but is not a
   * receipt and has nothing to audit.
   */
  saleId,
}: {
  saleId?: number
}) {
  // React runs effects twice in development. Without this the very first open
  // of every receipt would log two prints, and a trail that miscounts is worse
  // than none.
  const autoPrinted = useRef(false)

  const print = useCallback(() => {
    // Not awaited: the dialog should open the moment it is asked for, and the
    // audit row is not worth a frame of delay in front of a customer.
    if (saleId !== undefined) void recordReceiptPrint(saleId)
    window.print()
  }, [saleId])

  useEffect(() => {
    if (autoPrinted.current) return
    autoPrinted.current = true

    // A frame's delay so fonts and layout settle before the dialog snapshots
    // the page — printing too early can produce a blank first receipt.
    const timer = setTimeout(print, 400)
    return () => clearTimeout(timer)
  }, [print])

  return (
    <div className="mb-3 flex justify-center gap-2 print:hidden">
      <Button onClick={print}>
        <Printer aria-hidden />
        Print again
      </Button>
      <Button variant="outline" onClick={() => window.close()}>
        Close
      </Button>
    </div>
  )
}
