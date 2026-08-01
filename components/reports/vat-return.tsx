import { Card, CardContent } from "@/components/ui/card"
import { formatPercent, formatRs, shopToday } from "@/lib/format"
import type { VatReport } from "@/lib/reports/vat"
import { cn } from "@/lib/utils"

/**
 * The VAT return position — Carfectionist's "VAT report", layout for layout.
 *
 * Its blue is Kids Corner's coral and its amber stays amber: output VAT is the
 * shop's own money going to the MRA, so it carries the brand; input VAT is
 * money coming back, so it sits on the warning ramp beside it and the two are
 * never confused at a glance.
 *
 * Four blocks, in the order an owner reads them: the three figures, the
 * sentence that defines them, the shape of the year, and the month-by-month
 * table each return is filed from.
 */

const CHART_HEIGHT = 150

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/** Rs 1.2k / Rs 340 — axis ticks, where four significant digits are noise. */
function rsCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(Math.round(value))
}

export function VatReturn({ report }: { report: VatReport }) {
  const thisMonth = shopToday().slice(0, 7)
  const peak = Math.max(
    1,
    ...report.months.map((m) => Math.max(m.output, m.input)),
  )
  const active = report.months.some((m) => m.output !== 0 || m.input !== 0)

  return (
    <div className="max-w-4xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <div className="text-muted-foreground text-sm font-medium">
              Output VAT
            </div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">
              {formatRs(report.output)}
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              Charged on sales, less credit notes
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-muted-foreground text-sm font-medium">
              Input VAT
            </div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">
              {formatRs(report.input)}
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              Contained in received purchases
            </div>
          </CardContent>
        </Card>
        {/* The figure that gets filed, so it is the one carrying the brand. */}
        <Card className="border-brand-200 from-brand-50 bg-gradient-to-br to-white">
          <CardContent className="py-4">
            <div className="text-brand-800 text-sm font-medium">
              {report.net < 0 ? "Net VAT reclaimable" : "Net VAT payable"}
            </div>
            <div className="text-brand-900 mt-1.5 text-2xl font-semibold tabular-nums">
              {formatRs(Math.abs(report.net))}
            </div>
            <div className="text-brand-800 mt-1 text-xs">Output − Input</div>
          </CardContent>
        </Card>
      </div>

      <p className="text-muted-foreground text-sm">
        Output VAT is read from each sale as it was charged, at the rate in
        force that day — not re-derived, so a rate change never restates an
        older sale. Input VAT is taken out of each received purchase by
        subtraction at {formatPercent(report.rate, 1)}, because the
        supplier invoice is recorded as one VAT-inclusive total.
      </p>
      <p className="text-warning-foreground bg-warning-muted rounded-lg px-3.5 py-2.5 text-sm">
        Check input VAT against the paper before filing. A supplier who
        isn&rsquo;t VAT-registered charges none, and nothing here records which
        of yours are — so this figure is the most VAT those purchases could
        carry, not the amount you can certainly reclaim.
      </p>

      {/* ── VAT by month — the figure each MRA return asks for ── */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-base font-semibold">
              VAT by month
            </h2>
            <span className="flex items-center gap-4 text-xs font-medium">
              <span className="flex items-center gap-1.5">
                <span className="bg-brand-600 size-2.5 rounded-[3px]" /> Output
              </span>
              <span className="flex items-center gap-1.5">
                <span className="bg-warning size-2.5 rounded-[3px]" /> Input
              </span>
            </span>
          </div>

          {!active ? (
            <div className="border-border text-muted-foreground mt-4 rounded-xl border border-dashed px-4 py-8 text-center text-sm">
              No VAT activity in this range.
            </div>
          ) : (
            <div className="mt-4 flex gap-3">
              {/* y-axis — compact rupee ticks */}
              <div
                className="flex flex-col justify-between text-right"
                style={{ height: CHART_HEIGHT + 18 }}
              >
                {[1, 2 / 3, 1 / 3, 0].map((f) => (
                  <span
                    key={f}
                    className="text-muted-foreground text-[10px] leading-none tabular-nums"
                  >
                    {rsCompact(peak * f)}
                  </span>
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <div className="relative" style={{ height: CHART_HEIGHT }}>
                  {[0, 1 / 3, 2 / 3].map((f) => (
                    <div
                      key={f}
                      className="border-border absolute inset-x-0 border-t"
                      style={{ top: CHART_HEIGHT * f }}
                    />
                  ))}
                  <div className="border-foreground/25 absolute inset-x-0 bottom-0 border-t" />
                  <div className="flex h-full items-end gap-1 overflow-visible">
                    {report.months.map((m) => (
                      <div
                        key={m.month}
                        className="group relative flex h-full max-w-[60px] flex-1 items-end justify-center gap-[2px]"
                      >
                        {/* hover tooltip — month, all three figures */}
                        <div className="bg-foreground text-background pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 flex-col rounded-lg px-3 py-2 text-[11px] whitespace-nowrap shadow-lg group-hover:flex">
                          <span className="font-semibold">{m.label}</span>
                          <span className="mt-1 tabular-nums">
                            Output {formatRs(m.output)}
                          </span>
                          <span className="tabular-nums">
                            Input {formatRs(m.input)}
                          </span>
                          <span className="mt-0.5 font-semibold tabular-nums">
                            {m.net >= 0
                              ? `Pay ${formatRs(m.net)}`
                              : `Credit ${formatRs(-m.net)}`}
                          </span>
                        </div>
                        <div className="group-hover:bg-brand-50/60 absolute inset-0 rounded-md" />
                        <div
                          className="bg-brand-600 w-[11px] rounded-t-[3px]"
                          style={{
                            height: Math.round(
                              (Math.max(0, m.output) / peak) * CHART_HEIGHT,
                            ),
                          }}
                        />
                        <div
                          className="bg-warning w-[11px] rounded-t-[3px]"
                          style={{
                            height: Math.round(
                              (Math.max(0, m.input) / peak) * CHART_HEIGHT,
                            ),
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-1 flex gap-1">
                  {report.months.map((m, i) => (
                    <div
                      key={m.month}
                      className="text-muted-foreground max-w-[60px] flex-1 text-center text-[10px] tabular-nums"
                    >
                      {/* The year is stamped on January and on the first
                          column, so a range spanning a new year says so
                          without repeating "26" twelve times. */}
                      {m.month.slice(5) === "01" || i === 0
                        ? `${MONTH_SHORT[Number(m.month.slice(5)) - 1]} ${m.month.slice(2, 4)}`
                        : MONTH_SHORT[Number(m.month.slice(5)) - 1]}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* The accessible twin of the chart — and the thing a return is typed from. */}
      {report.months.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <div className="bg-muted/50 text-muted-foreground grid grid-cols-[1fr_110px_110px_130px] gap-3 border-b px-5 py-2.5 text-[10.5px] font-semibold tracking-wider uppercase">
            <span>Month</span>
            <span className="text-right">Output VAT</span>
            <span className="text-right">Input VAT</span>
            <span className="text-right">Net payable</span>
          </div>
          {[...report.months].reverse().map((m) => {
            const current = m.month === thisMonth
            return (
              <div
                key={m.month}
                className={cn(
                  "grid grid-cols-[1fr_110px_110px_130px] items-center gap-3 border-b px-5 py-2.5 text-sm last:border-b-0",
                  current && "bg-brand-50/60",
                )}
              >
                <span className="font-medium">
                  {m.label}
                  {current ? (
                    <span className="bg-brand-100 text-brand-800 ml-2 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase">
                      Current
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground text-right tabular-nums">
                  {formatRs(m.output)}
                </span>
                <span className="text-muted-foreground text-right tabular-nums">
                  {formatRs(m.input)}
                </span>
                <span
                  className={cn(
                    "text-right font-semibold tabular-nums",
                    m.net < 0 && "text-success",
                  )}
                >
                  {formatRs(m.net)}
                </span>
              </div>
            )
          })}
          <div className="text-muted-foreground px-5 py-3 text-xs">
            A month&rsquo;s VAT return is due to the MRA by the end of the
            following month. A negative net is a credit — input VAT exceeded
            output for that month.
          </div>
        </div>
      ) : null}

      {report.truncated ? (
        <p className="text-destructive text-sm">
          This period holds more documents than one report reads. Narrow the
          dates — a truncated VAT figure must not be filed.
        </p>
      ) : null}
    </div>
  )
}
