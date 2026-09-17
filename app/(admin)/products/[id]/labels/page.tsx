import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { Barcode } from "@/components/barcodes/barcode"
import { PrintButton } from "@/components/pos/print-button"
import { requireAdminProfile } from "@/lib/auth/session"
import {
  MAX_COPIES_PER_VARIANT,
  MAX_LABELS_PER_RUN,
  parseCopies,
} from "@/lib/barcodes/labels"
import { listLabelRows } from "@/lib/barcodes/queries"
import { formatRs } from "@/lib/format"
import { getProduct } from "@/lib/products/queries"

export const metadata: Metadata = { title: "Labels" }

/** 24 labels to an A4 sheet, 3 across by 8 down. */
const PER_PAGE = 24
/**
 * Most copies of any one variant when the count is left to default from stock —
 * a shelf-labelling guard, so a 200-unit line cannot spool nine sheets by
 * accident. The picker overrides this: when it names an exact count the shop
 * asked for that many, so the ceiling lifts to `EXPLICIT_PER_VARIANT_LIMIT`.
 */
const PER_VARIANT_LIMIT = 24
/** The picker's own ceiling — shared so the table and batch action agree. */
const EXPLICIT_PER_VARIANT_LIMIT = MAX_COPIES_PER_VARIANT
/** Ten A4 sheets' worth. Past this it is a print run, not a labelling job. */
const SHEET_LIMIT = MAX_LABELS_PER_RUN

/**
 * How much shorter than the physical label the printed block is.
 *
 * A block sized to exactly the page height is the whole reason a roll came out
 * one printed, one blank, forever: the usable page is always a hair shorter than
 * its nominal size — 30mm is 113.386px at 96dpi, never a whole number, and the
 * driver reserves an unprintable edge of its own — so an exactly-sized block
 * spills a fraction onto a second page. `overflow: hidden` makes the block
 * unsplittable, so that fraction becomes a whole empty page, which the printer
 * dutifully feeds as a blank sticker.
 *
 * Two millimetres of headroom is invisible on the sticker and removes the entire
 * class of problem, whatever the driver's margins turn out to be.
 */
const PAGE_SAFETY_MM = 2

/**
 * A roll label's physical size, from `?label=WIDTHxHEIGHT` in millimetres.
 *
 * The whole point of the parameter is `@page { size }`: without it the browser
 * prints an A4 page and shrinks the sheet grid onto a small label roll, which is
 * exactly the garbled two-labels-per-sticker output a roll printer gives with
 * the default A4 layout. Bounded to sane label sizes so a typo cannot ask the
 * driver for a metre of paper.
 */
function parseLabelSize(value?: string): { w: number; h: number } | null {
  if (!value) return null
  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i.exec(value.trim())
  if (!match) return null
  const w = Number(match[1])
  const h = Number(match[2])
  if (!(w >= 10 && w <= 150 && h >= 10 && h <= 150)) return null
  return { w, h }
}

/**
 * A printable sheet of shelf labels.
 *
 * Two shapes from one page. With no `?label`, it is 24 labels to an A4 page, 3
 * across by 8 down, for a laser printer and a sheet of sticker stock. With
 * `?label=40x30` (millimetres), it becomes a single column sized to a thermal
 * roll printer — one barcode per physical label, one label per printed page,
 * and a real `@page` size so the browser stops treating the job as A4.
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

  const rawLabel = requested.label
  const roll = parseLabelSize(Array.isArray(rawLabel) ? rawLabel[0] : rawLabel)

  // The picker at /print-labels chooses exact counts per variant and passes them
  // as `copies=id:n,...`. When present they win: the route stops guessing from
  // stock on hand and prints precisely what it was told, for precisely those
  // variants. Absent, it keeps its own default of one label per unit on hand.
  const rawCopies = requested.copies
  const copies = parseCopies(Array.isArray(rawCopies) ? rawCopies[0] : rawCopies)
  const explicit = copies.size > 0

  // In explicit mode the ids are taken as given, across any products: the batch
  // picker prints several products in one run, so the sheet is no longer scoped
  // to this URL's product (the id only anchors the route and the title). Without
  // a picker it stays this product's own variants.
  const candidateIds = explicit
    ? [...copies.keys()]
    : product.variants
        .map((variant) => variant.id)
        .filter((variantId) => picked.size === 0 || picked.has(variantId))

  const labels = await listLabelRows(candidateIds)

  // How many of each variant to print is a real question — one per unit on hand
  // is what a shelf actually needs, unless the picker said otherwise. Capped per
  // variant either way, so a 200-unit line cannot spool nine sheets by accident.
  const perVariantCap = explicit ? EXPLICIT_PER_VARIANT_LIMIT : PER_VARIANT_LIMIT
  const wanted = labels.flatMap((label) => {
    const requestedCount = explicit
      ? (copies.get(label.id) ?? 0)
      : (product.variants.find((v) => v.id === label.id)?.qtyOnHand ?? 1)
    const count = Math.min(Math.max(explicit ? 0 : 1, requestedCount), perVariantCap)
    return Array.from({ length: count }, (_, copy) => ({ ...label, copy }))
  })

  // And capped again over the whole job. The per-variant limit says nothing
  // about the total: forty variants at twenty-four each is forty A4 pages, which
  // nobody means to send to a printer. Trimmed, and said out loud below.
  const sheet = wanted.slice(0, SHEET_LIMIT)
  const trimmed = wanted.length - sheet.length

  const skippedNote =
    labels.length < candidateIds.length
      ? ` ${candidateIds.length - labels.length} skipped for having no barcode.`
      : ""
  const trimmedNote =
    trimmed > 0
      ? roll
        ? ` ${trimmed} more over the ${SHEET_LIMIT}-label cap — tick fewer variants to print the rest.`
        : ` ${trimmed} more would not fit in ${SHEET_LIMIT / PER_PAGE} sheets — tick fewer variants to print the rest.`
      : ""

  // In batch mode the sheet spans several products, so the single product this
  // URL names is no longer the whole story — the heading follows what actually
  // printed.
  const productNames = [...new Set(labels.map((label) => label.productName))]
  const heading = !explicit
    ? product.name
    : productNames.length === 1
      ? productNames[0]
      : productNames.length === 0
        ? product.name
        : `${productNames.length} products`
  // The stock-default clause only tells the truth when counts came from stock.
  const perUnitNote = explicit
    ? ""
    : ` · one per unit on hand, up to ${PER_VARIANT_LIMIT} each`

  const emptyState = (
    <div className="rounded-lg border border-dashed p-10 text-center print:hidden">
      <p className="font-medium">Nothing to print</p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
        {explicit
          ? // Reached only by a stale or hand-edited link: the chosen variants
            // are not on this product, or their barcodes have since been removed.
            "Those variants aren’t on this product, or no longer have a barcode. Start again from Print labels."
          : "None of these variants has a barcode yet. Generate them from the product page first."}
      </p>
    </div>
  )

  if (roll) {
    return (
      <div className="bg-muted/40 min-h-full p-4 print:bg-white print:p-0">
        {/*
          The one line that makes a roll printer behave: a physical page the size
          of the label, no margins. Interpolated into the stylesheet as a string
          on purpose — `@page { size: var(--w) var(--h) }` is silently dropped by
          Chrome and falls back to A4, which is the very bug being fixed here.
        */}
        <style
          dangerouslySetInnerHTML={{
            __html: `@page { size: ${roll.w}mm ${roll.h}mm; margin: 0; }`,
          }}
        />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <h1 className="font-heading text-lg font-semibold">
              Labels — {heading}
            </h1>
            <p className="text-muted-foreground text-sm">
              {sheet.length} label{sheet.length === 1 ? "" : "s"} ·{" "}
              {labels.length} variant{labels.length === 1 ? "" : "s"} ·{" "}
              {roll.w}×{roll.h}mm roll{perUnitNote}.
              {skippedNote}
              {trimmedNote}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              In the print dialog: keep Scale at 100% (not “Fit to page”), set
              the PUQU paper size to {roll.w}×{roll.h}mm, and switch Headers
              and footers off — a header on every 30mm page pushes each label
              across a page boundary, which prints as label, blank, label.
            </p>
          </div>
          <PrintButton />
        </div>

        {sheet.length === 0 ? (
          emptyState
        ) : (
          <div className="mx-auto bg-white" style={{ width: `${roll.w}mm` }}>
            {sheet.map((label) => (
              <div
                key={`${label.id}-${label.copy}`}
                className="flex flex-col items-center justify-center bg-white text-center"
                // One label per physical page, by construction rather than by
                // luck. A forced `break-after: page` is what caused the
                // blank-every-other-label bug, so there is none — instead each
                // label refuses to split (`break-inside: avoid`) and measures a
                // clear PAGE_SAFETY_MM under the page. Exactly page-sized boxes
                // are at the mercy of sub-pixel rounding (30mm is 113.39px) and
                // of whatever unprintable edge the driver reserves for itself;
                // the fraction that does not fit spills each label onto a
                // second, blank page, which reads as print one, skip one. Half a
                // millimetre covered the rounding but not the driver's margin,
                // so the headroom is a full two — invisible on the sticker, and
                // wide enough that no driver's idea of its own edge can bring
                // the blanks back.
                style={{
                  width: `${roll.w}mm`,
                  height: `calc(${roll.h}mm - ${PAGE_SAFETY_MM}mm)`,
                  padding: "1mm",
                  boxSizing: "border-box",
                  overflow: "hidden",
                  breakInside: "avoid",
                  pageBreakInside: "avoid",
                }}
              >
                <div className="w-full truncate text-[7px] leading-tight font-semibold text-black">
                  {label.productName}
                </div>
                <div className="text-[6px] leading-none text-neutral-600">
                  {label.colourName} · {label.sizeLabel}
                </div>
                {/* Full label width: the quiet zones live inside the symbol's
                    own viewBox, so anything narrower eats the margin a scanner
                    needs. */}
                <Barcode code={label.barcode} height={28} className="my-0.5 w-full" />
                <div className="text-[9px] leading-none font-bold text-black">
                  {formatRs(label.sellingPrice)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-muted/40 min-h-full p-4 print:bg-white print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-heading text-lg font-semibold">
            Labels — {heading}
          </h1>
          <p className="text-muted-foreground text-sm">
            {sheet.length} label{sheet.length === 1 ? "" : "s"} ·{" "}
            {labels.length} variant{labels.length === 1 ? "" : "s"} ·{" "}
            {Math.ceil(sheet.length / PER_PAGE)} sheet
            {Math.ceil(sheet.length / PER_PAGE) === 1 ? "" : "s"}
            {perUnitNote}.
            {skippedNote}
            {trimmedNote}
          </p>
        </div>
        <PrintButton />
      </div>

      {sheet.length === 0 ? (
        emptyState
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
