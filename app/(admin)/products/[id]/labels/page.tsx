import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { Barcode } from "@/components/barcodes/barcode"
import { PrintButton } from "@/components/pos/print-button"
import { requireAdminProfile } from "@/lib/auth/session"
import { listLabelRows } from "@/lib/barcodes/queries"
import { formatRs } from "@/lib/format"
import { getProduct } from "@/lib/products/queries"

export const metadata: Metadata = { title: "Labels" }

/** 24 labels to an A4 sheet, 3 across by 8 down. */
const PER_PAGE = 24
/** Most copies of any one variant, however deep the stock is. */
const PER_VARIANT_LIMIT = 24
/** Ten sheets. Past this it is a print run, not a shelf-labelling job. */
const SHEET_LIMIT = PER_PAGE * 10

/**
 * A printable sheet of shelf labels: 24 to an A4 page, 3 across by 8 down.
 *
 * Its own route rather than a dialog, for the same reason as the receipt — the
 * print stylesheet needs the whole page, and a new tab means the product screen
 * is not navigated away from.
 *
 * `?variant=` narrows the sheet to particular variants, repeated once per id;
 * with none, every variant of the product that has a barcode is printed. A
 * variant without one is dropped by the query rather than printed blank.
 */
export default async function LabelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminProfile()

  const { id } = await params
  const productId = Number(id)
  if (!Number.isInteger(productId) || productId <= 0) notFound()

  const product = await getProduct(productId)
  if (!product) notFound()

  const requested = await searchParams
  const raw = requested.variant
  const picked = new Set(
    (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
  )

  const candidateIds = product.variants
    .map((variant) => variant.id)
    .filter((variantId) => picked.size === 0 || picked.has(variantId))

  const labels = await listLabelRows(candidateIds)

  // How many of each variant to print is a real question — one per unit on hand
  // is what a shelf actually needs. Capped per variant so a 200-unit line cannot
  // spool nine sheets by accident.
  const wanted = labels.flatMap((label) => {
    const variant = product.variants.find((v) => v.id === label.id)
    const copies = Math.min(Math.max(1, variant?.qtyOnHand ?? 1), PER_VARIANT_LIMIT)
    return Array.from({ length: copies }, (_, copy) => ({ ...label, copy }))
  })

  // And capped again over the whole job. The per-variant limit says nothing
  // about the total: forty variants at twenty-four each is forty A4 pages, which
  // nobody means to send to a printer. Trimmed, and said out loud below.
  const sheet = wanted.slice(0, SHEET_LIMIT)
  const trimmed = wanted.length - sheet.length

  return (
    <div className="bg-muted/40 min-h-full p-4 print:bg-white print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-heading text-lg font-semibold">
            Labels — {product.name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {sheet.length} label{sheet.length === 1 ? "" : "s"} ·{" "}
            {labels.length} variant{labels.length === 1 ? "" : "s"} ·{" "}
            {Math.ceil(sheet.length / PER_PAGE)} sheet
            {Math.ceil(sheet.length / PER_PAGE) === 1 ? "" : "s"} · one per unit
            on hand, up to {PER_VARIANT_LIMIT} each.
            {labels.length < candidateIds.length
              ? ` ${candidateIds.length - labels.length} skipped for having no barcode.`
              : ""}
            {trimmed > 0
              ? ` ${trimmed} more would not fit in ${SHEET_LIMIT / PER_PAGE} sheets — tick fewer variants to print the rest.`
              : ""}
          </p>
        </div>
        <PrintButton />
      </div>

      {sheet.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center print:hidden">
          <p className="font-medium">Nothing to print</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            None of these variants has a barcode yet. Generate them from the
            product page first.
          </p>
        </div>
      ) : (
        <div
          className="mx-auto grid w-[210mm] grid-cols-3 bg-white print:w-full"
          // 24 per A4 at 3 x 8. Sizes in millimetres because the output is
          // physical: a label has to line up with the sticker stock it prints on.
          style={{ gridAutoRows: "33.5mm" }}
        >
          {sheet.map((label, index) => (
            <div
              key={`${label.id}-${label.copy}`}
              className="flex flex-col items-center justify-center gap-1 border border-dashed border-neutral-200 px-2 py-1.5 text-center print:border-neutral-100"
              // Every 24th label starts a new sheet, so a run of them does not
              // drift across page boundaries.
              style={
                index > 0 && index % PER_PAGE === 0
                  ? { breakBefore: "page" }
                  : undefined
              }
            >
              <div className="line-clamp-2 text-[9px] leading-tight font-semibold text-black">
                {label.productName}
              </div>
              <div className="text-[8px] leading-none text-neutral-600">
                {label.colourName} · {label.sizeLabel}
              </div>
              <Barcode code={label.barcode} height={30} className="w-[85%]" />
              <div className="text-[11px] leading-none font-bold text-black">
                {formatRs(label.sellingPrice)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
