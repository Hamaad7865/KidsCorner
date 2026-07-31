import { PAYMENT_METHOD_LABELS, isPaymentMethod } from "@/lib/db-enums"

import type { DailySummary, DailySummaryRow } from "./daily-summary"

/**
 * The column set for the daily summary, defined once.
 *
 * Imported by BOTH the on-screen table and the export route, so the spreadsheet
 * an owner sends to their accountant cannot drift from the screen they checked
 * it against. That is the whole reason this file exists.
 *
 * NO JSX HERE, deliberately. The export route imports this, and a React import
 * would pull the whole renderer into a route that only produces bytes.
 *
 * Kids Corner has no "Sale methods" section, unlike the Carfectionist report it
 * follows. That one splits turnover by which POS device rang it; this shop has
 * one till, so the column group would have a single permanent entry. Left out
 * rather than shipped empty — a report with a column that never varies teaches
 * an owner to skim, which is how a real one gets missed.
 */

export const SECTIONS = [
  { key: "payments", label: "Payments" },
  { key: "taxes", label: "VAT" },
  { key: "sellers", label: "Cashiers" },
  { key: "categories", label: "Items sold" },
] as const

export type SectionKey = (typeof SECTIONS)[number]["key"]

export const ALL_SECTIONS = SECTIONS.map((s) => s.key) as SectionKey[]

/** `sec` param → enabled sections. Absent means all; "none" means none. */
export function parseSections(sec?: string): Set<SectionKey> {
  if (sec === undefined) return new Set(ALL_SECTIONS)
  if (sec === "none") return new Set()
  const picked = sec
    .split(",")
    .filter((k): k is SectionKey => (ALL_SECTIONS as string[]).includes(k))
  return new Set(picked)
}

export type ColumnDef = {
  head: string
  group: string
  /** A money figure. The table formats it; the export takes the raw number. */
  money?: (row: DailySummaryRow) => number
  /** A tally. */
  count?: (row: DailySummaryRow) => number
  text?: (row: DailySummaryRow) => string
}

const BASE = "Daily summary"

/** A payment method in the shop's own words, not the database's. */
function methodLabel(method: string): string {
  return isPaymentMethod(method) ? PAYMENT_METHOD_LABELS[method] : method
}

/**
 * The columns for this particular report.
 *
 * Dynamic, mirroring the Carfectionist original: a method, cashier or category
 * earns a column only if it actually traded in the period.
 */
export function columnDefs(
  summary: DailySummary,
  on: Set<SectionKey>,
): ColumnDef[] {
  const cols: ColumnDef[] = [
    { group: BASE, head: "Date", text: (r) => r.day },
    { group: BASE, head: "Tickets", count: (r) => r.tickets },
    { group: BASE, head: "Items", count: (r) => r.items },
    { group: BASE, head: "Named customers", count: (r) => r.customers },
    // Both averages, both derived from the SAME inclusive total. `excl` is what
    // is left after the VAT contained in the price.
    { group: BASE, head: "Avg ticket incl", money: (r) => r.avgIncl },
    { group: BASE, head: "Avg ticket excl", money: (r) => r.avgExcl },
    { group: BASE, head: "Total excl VAT", money: (r) => r.totalExcl },
    { group: BASE, head: "VAT", money: (r) => r.vat },
    { group: BASE, head: "Total incl VAT", money: (r) => r.totalIncl },
  ]

  if (on.has("payments")) {
    for (const method of summary.methods) {
      const label = methodLabel(method)
      cols.push({
        group: "Payments",
        head: `${label} / Qty`,
        count: (r) => r.byMethod[method]?.n ?? 0,
      })
      cols.push({
        group: "Payments",
        head: `${label} / Total`,
        money: (r) => r.byMethod[method]?.amount ?? 0,
      })
    }
  }

  if (on.has("taxes")) {
    for (const rate of summary.taxes) {
      cols.push({
        group: "VAT",
        head: `${rate}% / Excl`,
        money: (r) => r.byTax[rate]?.excl ?? 0,
      })
      cols.push({
        group: "VAT",
        head: `${rate}% / VAT`,
        money: (r) => r.byTax[rate]?.vat ?? 0,
      })
      cols.push({
        group: "VAT",
        head: `${rate}% / Incl`,
        money: (r) => r.byTax[rate]?.incl ?? 0,
      })
    }
  }

  if (on.has("sellers")) {
    for (const seller of summary.sellers) {
      cols.push({
        group: "Cashiers",
        head: `${seller} / Tickets`,
        count: (r) => r.bySeller[seller]?.n ?? 0,
      })
      cols.push({
        group: "Cashiers",
        head: `${seller} / Total`,
        money: (r) => r.bySeller[seller]?.amount ?? 0,
      })
    }
  }

  if (on.has("categories")) {
    for (const category of summary.categories) {
      cols.push({
        group: "Items sold",
        head: `${category} / Qty`,
        count: (r) => r.byCategory[category]?.qty ?? 0,
      })
      cols.push({
        group: "Items sold",
        head: `${category} / Total`,
        money: (r) => r.byCategory[category]?.amount ?? 0,
      })
    }
  }

  return cols
}

/** The raw value of one cell, for the export. */
export function cellValue(col: ColumnDef, row: DailySummaryRow): string | number {
  if (col.text) return col.text(row)
  if (col.money) return col.money(row)
  if (col.count) return col.count(row)
  return ""
}

/**
 * The totals row.
 *
 * Money and counts are summed; an average is NOT — averaging the daily averages
 * would weight a quiet Tuesday the same as a busy Saturday. The period average
 * is recomputed from the period's own totals.
 */
export function totalsRow(
  summary: DailySummary,
  cols: ColumnDef[],
): (string | number)[] {
  const tickets = summary.rows.reduce((sum, r) => sum + r.tickets, 0)
  const totalIncl = summary.rows.reduce((sum, r) => sum + r.totalIncl, 0)
  const totalExcl = summary.rows.reduce((sum, r) => sum + r.totalExcl, 0)

  return cols.map((col) => {
    if (col.text) return "Total"
    if (col.head === "Avg ticket incl") {
      return tickets > 0 ? Math.round((totalIncl / tickets) * 100) / 100 : 0
    }
    if (col.head === "Avg ticket excl") {
      return tickets > 0 ? Math.round((totalExcl / tickets) * 100) / 100 : 0
    }
    const sum = summary.rows.reduce((acc, r) => acc + Number(cellValue(col, r) || 0), 0)
    return col.money ? Math.round(sum * 100) / 100 : sum
  })
}
