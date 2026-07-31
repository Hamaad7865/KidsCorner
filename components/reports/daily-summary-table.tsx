import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { formatDate, formatRs } from "@/lib/format"
import type { DailySummary } from "@/lib/reports/daily-summary"
import {
  SECTIONS,
  columnDefs,
  totalsRow,
  type ColumnDef,
  type SectionKey,
} from "@/lib/reports/daily-summary-sections"
import { cn } from "@/lib/utils"

/**
 * The wide daily report.
 *
 * Read across, not down — "which day did card overtake cash", "which category
 * carried the week". That means a lot of columns, so the date column and both
 * header rows are sticky: scrolling right must never leave a figure whose row
 * and column are both off screen.
 */
export function DailySummaryTable({
  summary,
  on,
  href,
}: {
  summary: DailySummary
  on: Set<SectionKey>
  /** Builds a URL with a different section set, for the toggles. */
  href: (sections: SectionKey[]) => string
}) {
  const cols = columnDefs(summary, on)
  const totals = totalsRow(summary, cols)

  // Header groups, so "Payments" spans its own columns rather than repeating
  // above each one.
  const groups: { label: string; span: number }[] = []
  for (const col of cols) {
    const last = groups[groups.length - 1]
    if (last && last.label === col.group) last.span += 1
    else groups.push({ label: col.group, span: 1 })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-sm">Sections</span>
        {SECTIONS.map((section) => {
          const enabled = on.has(section.key)
          const next = enabled
            ? [...on].filter((k) => k !== section.key)
            : [...on, section.key]
          return (
            <Link
              key={section.key}
              href={href(next)}
              scroll={false}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                enabled
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {section.label}
            </Link>
          )
        })}
        <Badge variant="outline" className="ml-auto">
          {cols.length} columns
        </Badge>
      </div>

      {summary.rows.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          Nothing sold in this range.
        </p>
      ) : (
        <div className="relative max-h-[70vh] overflow-auto rounded-lg border">
          <table className="w-max text-sm">
            <thead>
              <tr className="bg-muted/60 sticky top-0 z-20">
                {groups.map((group, index) => (
                  <th
                    key={`${group.label}-${index}`}
                    colSpan={group.span}
                    className={cn(
                      "border-b border-r px-3 py-2 text-left font-medium whitespace-nowrap",
                      index === 0 && "bg-muted/60 sticky left-0 z-30",
                    )}
                  >
                    {group.label}
                  </th>
                ))}
              </tr>
              <tr className="bg-background sticky top-[37px] z-20">
                {cols.map((col, index) => (
                  <th
                    key={col.head}
                    className={cn(
                      "text-muted-foreground border-b px-3 py-2 font-normal whitespace-nowrap",
                      col.text ? "text-left" : "text-right",
                      index === 0 && "bg-background sticky left-0 z-30 border-r",
                    )}
                  >
                    {col.head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={row.day} className="hover:bg-muted/40">
                  {cols.map((col, index) => (
                    <td
                      key={col.head}
                      className={cn(
                        "border-b px-3 py-2 whitespace-nowrap",
                        col.text ? "text-left" : "text-right tabular-nums",
                        index === 0 &&
                          "bg-background sticky left-0 z-10 border-r font-medium",
                      )}
                    >
                      {render(col, row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/60 sticky bottom-0 z-20 font-medium">
                {cols.map((col, index) => (
                  <td
                    key={col.head}
                    className={cn(
                      "border-t px-3 py-2 whitespace-nowrap",
                      col.text ? "text-left" : "text-right tabular-nums",
                      index === 0 && "bg-muted/60 sticky left-0 z-30 border-r",
                    )}
                  >
                    {typeof totals[index] === "number" && col.money
                      ? formatRs(totals[index] as number)
                      : totals[index]}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function render(
  col: ColumnDef,
  row: Parameters<NonNullable<ColumnDef["text"]>>[0],
) {
  if (col.text) return formatDate(col.text(row))
  if (col.money) {
    const value = col.money(row)
    // A zero in a wide grid is noise — the eye should land on the figures that
    // are there, not scan past a column of "Rs 0.00".
    return value === 0 ? <span className="text-muted-foreground">–</span> : formatRs(value)
  }
  if (col.count) {
    const value = col.count(row)
    return value === 0 ? <span className="text-muted-foreground">–</span> : value
  }
  return null
}
