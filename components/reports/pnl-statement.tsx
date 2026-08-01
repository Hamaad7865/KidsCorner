import { formatRs } from "@/lib/format"
import type { PnlReport } from "@/lib/reports/pnl"
import { cn } from "@/lib/utils"

/**
 * Simple P&L — Carfectionist's statement card, row for row.
 *
 * Its blue net-profit band becomes the brand coral; a loss goes destructive, as
 * it does there. The one addition is the pay-out breakdown: Carfectionist reads
 * a real `expenses` table, and this reads whatever a cashier typed into the
 * till, so the rows have to be visible for the total to be worth anything.
 */

function Line({
  label,
  note,
  value,
  muted,
}: {
  label: string
  note: string
  value: number
  muted?: boolean
}) {
  return (
    <div className="flex items-center justify-between border-b px-5 py-3.5">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-muted-foreground text-[11px]">{note}</div>
      </div>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          muted && "text-muted-foreground",
        )}
      >
        {formatRs(value)}
      </span>
    </div>
  )
}

export function PnlStatement({ report }: { report: PnlReport }) {
  return (
    <div className="max-w-xl space-y-3">
      <div className="overflow-hidden rounded-lg border bg-card">
        <Line
          label="Revenue"
          note="Sales less credit notes, VAT taken out"
          value={report.revenue}
        />
        <Line
          label="Cost of goods sold"
          note="Stock that left the shelf, at today's cost price"
          value={-report.cost}
          muted
        />
        <div className="bg-muted/50 flex items-center justify-between border-b px-5 py-3">
          <span className="text-sm font-semibold">
            Gross profit
            {report.revenue > 0 ? (
              <span className="text-muted-foreground ml-2 text-xs font-medium tabular-nums">
                {report.grossPct.toFixed(1)}% of revenue
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              "text-sm font-bold tabular-nums",
              report.gross < 0 ? "text-destructive" : "text-success",
            )}
          >
            {formatRs(report.gross)}
          </span>
        </div>
        <Line
          label="Cash paid out of the till"
          note={
            report.counts.payouts === 1
              ? "1 pay-out"
              : `${report.counts.payouts} pay-outs`
          }
          value={-report.expenses}
          muted
        />
        <div
          className={cn(
            "flex items-center justify-between px-5 py-4",
            report.net < 0
              ? "bg-destructive/8"
              : "from-brand-50 bg-gradient-to-br to-white",
          )}
        >
          <span
            className={cn(
              "text-sm font-bold",
              report.net < 0 ? "text-destructive" : "text-brand-900",
            )}
          >
            {report.net < 0 ? "Net loss" : "Net profit"}
          </span>
          <span
            className={cn(
              "text-lg font-bold tabular-nums",
              report.net < 0 ? "text-destructive" : "text-brand-900",
            )}
          >
            {formatRs(report.net)}
          </span>
        </div>
      </div>

      {/* Every pay-out by its reason. The total above is only as good as these
          rows, and one of them may well be a transfer rather than a cost. */}
      {report.expenseRows.length > 0 ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="bg-muted/50 text-muted-foreground border-b px-5 py-2.5 text-[10.5px] font-semibold tracking-wider uppercase">
            What went out of the drawer
          </div>
          {report.expenseRows.map((row) => (
            <div
              key={row.reason}
              className="flex items-center justify-between border-b px-5 py-2.5 text-sm last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate">
                {row.reason}
                {row.count > 1 ? (
                  <span className="text-muted-foreground ml-2 text-xs tabular-nums">
                    ×{row.count}
                  </span>
                ) : null}
              </span>
              <span className="tabular-nums">{formatRs(row.amount)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <p className="text-muted-foreground text-xs">
        Net profit = revenue − cost of goods sold − cash paid out. Two things it
        cannot know: cost is each variant&rsquo;s <em>current</em> cost price,
        because a sale line doesn&rsquo;t record what the item cost that day; and
        the only expenses here are cash taken out of the till, so rent, wages and
        electricity are missing, while a pay-out used to bank the takings is a
        transfer rather than a cost. Read the rows above before trusting the
        bottom line.
      </p>

      {report.truncated ? (
        <p className="text-destructive text-sm">
          This period holds more documents than one report reads. Narrow the
          dates — a truncated P&amp;L does not reconcile.
        </p>
      ) : null}
    </div>
  )
}
