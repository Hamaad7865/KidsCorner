import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PrintButton } from "@/components/pos/print-button"
import { requireProfile } from "@/lib/auth/session"
import { PAYMENT_METHOD_LABELS, isPaymentMethod } from "@/lib/db-enums"
import { formatDateTime, formatRs } from "@/lib/format"
import { changeDue } from "@/lib/pos/payments"
import { getShopIdentity } from "@/lib/pos/queries"
import { receiptTaxView } from "@/lib/receipts/tax-view"
import { createClient } from "@/lib/supabase/server"
import { getCurrentVatPolicy } from "@/lib/vat/policy"

export const metadata: Metadata = { title: "Receipt" }

/** Reads the session and a single sale; must stay per-request. */
export const dynamic = "force-dynamic"

/**
 * 80mm thermal receipt, printed through the browser.
 *
 * Its own top-level route rather than a page under `(admin)`, so it renders
 * with no sidebar or header — the print stylesheet wants the whole page. The
 * back office's Sales list opens it in a new tab to reprint a past sale; the
 * selling itself happens on the tablet till, which prints its own paper.
 *
 * `requireProfile` gates it to signed-in staff, and the middleware maps `/receipt`
 * to the `sales` module, so a role that cannot see sales cannot reprint one.
 */
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireProfile()

  const { id } = await params
  const saleId = Number(id)
  if (!Number.isInteger(saleId) || saleId <= 0) notFound()

  const supabase = await createClient()

  // Column list mirrors lib/sales/queries.ts (both select `rounding`,
  // migration 049 — keep the two in step).
  const RECEIPT_COLUMNS =
    `id, sale_no, sale_date, subtotal, discount, vat_amount, total, rounding, status,
     vat_enabled, vat_rate, vat_number,
     customers ( full_name ),
     profiles ( full_name ),
     sale_items ( qty, unit_price, discount, line_total, description, variant_id,
       product_variants ( sku, products ( name ), sizes ( label ), colours ( name ) ) ),
     sale_payments ( method, amount, tendered )`

  const [{ data: sale }, { data: shopName }, identity] = await Promise.all([
    supabase
      .from("sales")
      .select(RECEIPT_COLUMNS)
      .eq("id", saleId)
      .maybeSingle(),
    supabase.from("settings").select("value").eq("key", "shop_name").maybeSingle(),
    // Address and phone for the header. The VAT number is NOT taken from here —
    // it comes from the sale's own frozen snapshot below, so a receipt reprinted
    // after the shop's registration changed still shows what it showed on the day.
    getShopIdentity(),
  ])

  if (!sale) notFound()

  // Zero on every unrounded sale (and on legacy rows, backfilled to 0).
  const rounding = Number(sale.rounding)

  const shop = typeof shopName?.value === "string" ? shopName.value : "Kids Corner"
  // Display follows the CURRENT toggle: switched off, this renders plain no
  // matter what the sale rang up under. A policy read that fails keeps the
  // old behaviour rather than blanking a receipt mid-shift.
  const policy = await getCurrentVatPolicy().catch(() => null)
  // The document identity comes from the sale's frozen snapshot, gated by
  // today's toggle: a VAT invoice with its frozen number and breakdown, or a
  // plain receipt with neither. When the toggle is on but the frozen number
  // is missing (older sales), the current policy number stands in so the
  // registration is in place.
  const tax = receiptTaxView(
    {
      vatEnabled: sale.vat_enabled,
      vatRate: Number(sale.vat_rate),
      vatNumber: sale.vat_number,
      vatAmount: Number(sale.vat_amount),
      total: Number(sale.total),
    },
    policy ? { enabled: policy.enabled } : undefined,
  )
  const vatNumber =
    tax.vatNumber ?? (tax.isVatInvoice ? (policy?.vatNumber ?? null) : null)
  const payments = sale.sale_payments ?? []
  // The shared answer, not a third one: changeDue sums per-row
  // greatest(tendered - amount, 0) over every rail, exactly the Z report's
  // per-method `change` definition — so this reprint, the web till and the Z
  // agree by construction. (The tablet till still measures cash-only per row;
  // its update is tracked separately.)
  const change = changeDue(
    payments.map((p) => ({
      method: p.method,
      amount: Number(p.amount),
      tendered: p.tendered === null ? null : Number(p.tendered),
    })),
  )

  return (
    <div className="bg-muted/40 min-h-dvh p-4 print:bg-white print:p-0">
      <PrintButton saleId={saleId} />

      {/* 80mm minus the printer's margins. `print:` strips the chrome. */}
      <article className="mx-auto w-[72mm] bg-white p-3 font-mono text-[11px] leading-tight text-black shadow print:w-full print:shadow-none">
        <header className="text-center">
          <h1 className="text-sm font-bold uppercase">{shop}</h1>
          {identity.address ? <p>{identity.address}</p> : <p>Mauritius</p>}
          {identity.phone ? <p>{identity.phone}</p> : null}
          {/* Only a VAT invoice carries a registration number: the frozen one,
              falling back to the current policy number so it is in place. */}
          {tax.isVatInvoice && vatNumber ? <p>VAT {vatNumber}</p> : null}
          {/* The document type: a VAT invoice or a plain receipt, decided by the
              sale's frozen status. */}
          <p className="mt-1 font-bold uppercase">{tax.documentLabel}</p>
          <p className="mt-1">{formatDateTime(sale.sale_date)}</p>
          <p>Sale {sale.sale_no}</p>
          {sale.profiles?.full_name ? <p>Served by {sale.profiles.full_name}</p> : null}
          {sale.customers?.full_name ? <p>Customer: {sale.customers.full_name}</p> : null}
        </header>

        {/* A sale that has been voided or refunded must say so on its own face.
            The sales list offers a Receipt button on every row, voided ones
            included, and a reprint that looks like a live receipt is exactly
            the document someone would use to claim the goods a second time.
            The till has always printed this banner; this page did not. */}
        {sale.status !== "completed" ? (
          <p className="mt-2 text-center text-sm font-bold uppercase">
            *** {sale.status} ***
          </p>
        ) : null}

        <hr className="my-2 border-dashed border-black" />

        <table className="w-full">
          <tbody>
            {(sale.sale_items ?? []).map((item, index) => {
              const variant = item.product_variants
              // A custom line has no variant — its description IS the name.
              // Without this every gift-wrap/alteration row renders as "Item".
              const isCustom =
                item.variant_id == null || variant == null
              const name = isCustom
                ? (item.description?.trim() || "Custom item")
                : (variant?.products?.name ?? "Item")
              return (
                <tr key={index} className="align-top">
                  <td className="pb-1">
                    <div>{name}</div>
                    {!isCustom ? (
                      <div className="opacity-70">
                        {variant?.sizes?.label} / {variant?.colours?.name}
                      </div>
                    ) : null}
                    <div className="opacity-70">
                      {item.qty} x {formatRs(Number(item.unit_price))}
                      {Number(item.discount) > 0
                        ? `  less ${formatRs(Number(item.discount))}`
                        : ""}
                    </div>
                  </td>
                  <td className="pb-1 text-right whitespace-nowrap">
                    {formatRs(Number(item.line_total))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <hr className="my-2 border-dashed border-black" />

        <Line label="Subtotal" value={formatRs(Number(sale.subtotal))} />
        {Number(sale.discount) > 0 ? (
          <Line label="Discount" value={`- ${formatRs(Number(sale.discount))}`} />
        ) : null}
        {/* Cash rounding (migration 049): subtotal − discount + rounding =
            total, so a rounded cash sale shows where the rupees went. */}
        {rounding !== 0 ? (
          <Line
            label="Rounding"
            value={`${rounding < 0 ? "-" : "+"} ${formatRs(Math.abs(rounding))}`}
          />
        ) : null}
        <Line
          label="TOTAL"
          value={formatRs(Number(sale.total))}
          className="text-sm font-bold"
        />
        {/* On a VAT invoice only: prices are inclusive, so the net and the
            contained VAT are shown as a breakdown of the total, not added to it.
            A plain receipt shows nothing here at all. */}
        {tax.isVatInvoice ? (
          <>
            <Line
              label="Net"
              value={formatRs(tax.netAmount)}
              className="opacity-70"
            />
            <Line
              label={`VAT ${tax.rateLabel} (incl.)`}
              value={formatRs(tax.vatAmount)}
              className="opacity-70"
            />
          </>
        ) : null}

        <hr className="my-2 border-dashed border-black" />

        {payments.map((payment, index) => (
          <Line
            key={index}
            label={
              isPaymentMethod(payment.method)
                ? PAYMENT_METHOD_LABELS[payment.method]
                : payment.method
            }
            value={formatRs(Number(payment.amount))}
          />
        ))}
        {change > 0 ? (
          <Line label="Change" value={formatRs(change)} className="font-bold" />
        ) : null}

        <p className="mt-3 text-center">Thank you!</p>
        {/* The shop's return policy. A few lines are final sale; everything else
            may be exchanged within 7 days. Kept word-for-word in step with the
            thermal receipt (till-android ReceiptBuilder.kt) — the two documents
            must never state different terms for the same sale. */}
        <p className="mt-1 text-center font-bold">
          No return or refund on wedding dresses, suits or white shirts.
        </p>
        <p className="text-center opacity-70">
          All other items: exchange within 7 days with this receipt.
        </p>
      </article>
    </div>
  )
}

function Line({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={`flex justify-between gap-2 ${className ?? ""}`}>
      <span>{label}</span>
      <span className="whitespace-nowrap">{value}</span>
    </div>
  )
}
