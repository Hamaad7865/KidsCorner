import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PrintButton } from "@/components/pos/print-button"
import { requireProfile } from "@/lib/auth/session"
import { PAYMENT_METHOD_LABELS, isPaymentMethod } from "@/lib/db-enums"
import { formatDateTime, formatRs } from "@/lib/format"
import { changeDue } from "@/lib/pos/payments"
import { getShopIdentity } from "@/lib/pos/queries"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Receipt" }

/**
 * 80mm thermal receipt, printed through the browser.
 *
 * Deliberately its own route rather than a dialog: the print stylesheet needs
 * the whole page, and opening it in a new tab means the print dialog never
 * navigates the till away from the sell screen mid-queue.
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

  const [{ data: sale }, { data: shopName }, identity] = await Promise.all([
    supabase
      .from("sales")
      .select(
        `id, sale_no, sale_date, subtotal, discount, vat_amount, total, status,
         customers ( full_name ),
         profiles ( full_name ),
         sale_items ( qty, unit_price, discount, line_total,
           product_variants ( sku, products ( name ), sizes ( label ), colours ( name ) ) ),
         sale_payments ( method, amount, tendered )`,
      )
      .eq("id", saleId)
      .maybeSingle(),
    supabase.from("settings").select("value").eq("key", "shop_name").maybeSingle(),
    // The same three the thermal receipt prints. Without this the browser
    // receipt and the tablet's receipt described the same sale differently —
    // and the browser one said "Mauritius" where the VAT number belongs.
    getShopIdentity(),
  ])

  if (!sale) notFound()

  const shop = typeof shopName?.value === "string" ? shopName.value : "Kids Corner"
  const payments = sale.sale_payments ?? []
  // The shared answer, not a third one. This page used to total the tendered
  // figures across EVERY payment — a card row carrying a tendered value would
  // have counted as cash handed over — and subtract the cash owed. Both tills
  // and this receipt now agree by construction.
  const change = changeDue(
    payments.map((p) => ({
      method: p.method,
      amount: Number(p.amount),
      tendered: p.tendered === null ? null : Number(p.tendered),
    })),
  )

  return (
    <div className="bg-muted/40 min-h-full p-4 print:bg-white print:p-0">
      <PrintButton saleId={saleId} />

      {/* 80mm minus the printer's margins. `print:` strips the chrome. */}
      <article className="mx-auto w-[72mm] bg-white p-3 font-mono text-[11px] leading-tight text-black shadow print:w-full print:shadow-none">
        <header className="text-center">
          <h1 className="text-sm font-bold uppercase">{shop}</h1>
          {identity.address ? <p>{identity.address}</p> : <p>Mauritius</p>}
          {identity.phone ? <p>{identity.phone}</p> : null}
          {/* A VAT-registered business has to show its number on a VAT
              invoice, and this page is one — it itemises the VAT. */}
          {identity.vatNumber ? <p>VAT {identity.vatNumber}</p> : null}
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
              return (
                <tr key={index} className="align-top">
                  <td className="pb-1">
                    <div>{variant?.products?.name ?? "Item"}</div>
                    <div className="opacity-70">
                      {variant?.sizes?.label} / {variant?.colours?.name}
                    </div>
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
        <Line
          label="TOTAL"
          value={formatRs(Number(sale.total))}
          className="text-sm font-bold"
        />
        {/* Prices are VAT-inclusive, so VAT is shown as contained, not added. */}
        <Line
          label="VAT included"
          value={formatRs(Number(sale.vat_amount))}
          className="opacity-70"
        />

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
        {/* Seven days, matching the till exactly. These two receipts used to
            promise 14 here and 7 on paper, so two customers buying the same
            day got contradictory terms in writing depending on which device
            printed — and the one holding "14 days" is entitled by it. */}
        <p className="text-center opacity-70">Exchange within 7 days with this receipt</p>
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
