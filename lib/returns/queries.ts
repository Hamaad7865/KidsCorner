import { cache } from "react"

import { isSaleStatus, type SaleStatus } from "@/lib/db-enums"
import { createClient } from "@/lib/supabase/server"

/**
 * Everything the return screen needs about one sale.
 *
 * Already-returned quantities are summed in JS from the sale's own credit note
 * lines: it is bounded by the number of lines on a single ticket, and PostgREST
 * cannot GROUP BY without a view. The database enforces the same rule anyway —
 * `create_credit_note` refuses to over-return — so this figure is for showing
 * the cashier what is possible, not for policing it.
 */

export type ReturnableLine = {
  saleItemId: number
  /** Null on a custom line — gift wrap and alterations have no variant. */
  variantId: number | null
  productName: string
  sizeLabel: string
  colourName: string
  colourHex: string | null
  sku: string
  qtySold: number
  qtyReturned: number
  qtyReturnable: number
  /** What the customer actually paid per unit, discount included. */
  unitPaid: number
}

export type SaleForReturn = {
  id: number
  saleNo: string
  saleDate: string
  total: number
  status: SaleStatus
  /**
   * The sale's frozen VAT status. A credit note reverses the VAT of the
   * ORIGINAL sale regardless of today's setting, so a VAT sale yields a VAT
   * credit note even after the shop disables VAT, and a non-VAT sale yields a
   * non-VAT credit note even after it registers.
   */
  vatEnabled: boolean
  vatRate: number
  vatNumber: string | null
  vatAmount: number
  customerName: string | null
  cashierName: string | null
  lines: ReturnableLine[]
  /** Credit notes already raised against this sale. */
  creditNotes: {
    id: number
    creditNo: string
    createdAt: string
    total: number
    reason: string
    refundMethod: string
  }[]
  fullyReturned: boolean
}

export const getSaleForReturn = cache(
  async (saleId: number): Promise<SaleForReturn | null> => {
    const supabase = await createClient()

    const [{ data: sale, error }, { data: returnedRows }] = await Promise.all([
      supabase
        .from("sales")
        .select(
          `id, sale_no, sale_date, subtotal, discount, total, status,
         vat_enabled, vat_rate, vat_number, vat_amount,
         customers ( full_name ),
         profiles ( full_name ),
         sale_items ( id, variant_id, qty, unit_price, discount, line_total,
           product_variants ( sku, products ( name ), sizes ( label ),
                              colours ( name, hex_code ) ) ),
         credit_notes!credit_notes_sale_id_fkey
           ( id, credit_no, created_at, total, reason, refund_method )`,
        )
        .eq("id", saleId)
        .maybeSingle(),
      // Return lines for this sale, to work out what is left on each line.
      supabase
        .from("credit_note_items")
        .select("sale_item_id, qty, credit_notes!inner ( sale_id )")
        .eq("credit_notes.sale_id", saleId),
    ])

    if (error) throw error
    if (!sale) return null

    const returnedByLine = new Map<number, number>()
    for (const row of returnedRows ?? []) {
      returnedByLine.set(
        row.sale_item_id,
        (returnedByLine.get(row.sale_item_id) ?? 0) + row.qty,
      )
    }

    // 1 when nothing came off the basket, so the common case is unchanged.
    const paidFactor =
      Number(sale.subtotal) > 0 ? Number(sale.total) / Number(sale.subtotal) : 1

    const lines = (sale.sale_items ?? []).map<ReturnableLine>((item) => {
      const variant = item.product_variants
      const returned = returnedByLine.get(item.id) ?? 0
      return {
        saleItemId: item.id,
        variantId: item.variant_id,
        productName: variant?.products?.name ?? "Item",
        sizeLabel: variant?.sizes?.label ?? "",
        colourName: variant?.colours?.name ?? "",
        colourHex: variant?.colours?.hex_code ?? null,
        sku: variant?.sku ?? "",
        qtySold: item.qty,
        qtyReturned: returned,
        qtyReturnable: Math.max(0, item.qty - returned),
        // Scaled by what was actually paid. `line_total` is net of the
        // LINE's discount but knows nothing about a discount taken off the
        // whole basket, so quoting it would promise a refund larger than
        // `create_credit_note` will pay out — see migration 021.
        unitPaid: item.qty > 0 ? (Number(item.line_total) / item.qty) * paidFactor : 0,
      }
    })

    return {
      id: sale.id,
      saleNo: sale.sale_no,
      saleDate: sale.sale_date,
      total: Number(sale.total),
      status: isSaleStatus(sale.status) ? sale.status : "completed",
      vatEnabled: sale.vat_enabled,
      vatRate: Number(sale.vat_rate),
      vatNumber:
        typeof sale.vat_number === "string" && sale.vat_number.trim()
          ? sale.vat_number.trim()
          : null,
      vatAmount: Number(sale.vat_amount),
      customerName: sale.customers?.full_name ?? null,
      cashierName: sale.profiles?.full_name ?? null,
      lines,
      creditNotes: (sale.credit_notes ?? []).map((note) => ({
        id: note.id,
        creditNo: note.credit_no,
        createdAt: note.created_at,
        total: Number(note.total),
        reason: note.reason,
        refundMethod: note.refund_method,
      })),
      fullyReturned: lines.every((l) => l.qtyReturnable === 0),
    }
  },
)
