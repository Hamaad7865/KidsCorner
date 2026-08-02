import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, Printer, Receipt, RotateCcw, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { requireProfile } from "@/lib/auth/session"
import { PAYMENT_METHOD_LABELS, isPaymentMethod } from "@/lib/db-enums"
import { formatDateTime, formatRs, shopToday } from "@/lib/format"
import { listSales } from "@/lib/sales/queries"

export const metadata: Metadata = { title: "Past sales" }

/** How far back the till can look without going to the back office. */
const DAYS_BACK = 7

/**
 * Recent sales, at the till.
 *
 * This exists because the back office is where sales history lived, and a
 * cashier cannot get there — `module_access` hides it and the proxy blocks the
 * route. So the one thing a customer actually asks for at the counter, "can I
 * have another receipt", needed a manager. It does not any more.
 *
 * Deliberately NOT the back-office list. It is capped to the last week and
 * offers only a receipt number to search on, because a till is not a reporting
 * tool: a cashier needs to find the sale in front of them, not browse the
 * shop's takings. Anything older, or any other question, is still the back
 * office's job.
 */
export default async function PosSalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Every role, cashiers included — this is a till screen.
  await requireProfile()

  const params = await searchParams
  const raw = params.q
  const search = (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined

  // A search reaches back past the window: somebody holding a receipt knows
  // exactly which sale they mean, and refusing it because it is eight days old
  // would just send them to find a manager.
  const from = search
    ? undefined
    : new Date(Date.parse(`${shopToday()}T12:00:00Z`) - (DAYS_BACK - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10)

  const { rows: sales } = await listSales({ from, search })

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" render={<Link href="/pos" />}>
          <ArrowLeft aria-hidden />
          Back to till
        </Button>
        <h1 className="font-heading text-lg font-semibold">Past sales</h1>
      </div>

      {/* A plain GET form so this works with no client JS, and so a scanner
          typing a number and pressing Enter submits it like a person would. */}
      <form method="get" className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
            aria-hidden
          />
          <input
            name="q"
            type="search"
            defaultValue={search ?? ""}
            placeholder="Receipt number…"
            aria-label="Search by receipt number"
            className="border-input bg-card h-control w-full rounded-lg border pr-3 pl-10 text-base"
          />
        </div>
        <Button type="submit" className="h-control px-6">
          Find
        </Button>
        {search ? (
          <Button
            variant="outline"
            className="h-control px-4"
            render={<Link href="/pos/sales" />}
          >
            Clear
          </Button>
        ) : null}
      </form>

      {sales.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Receipt className="text-muted-foreground size-10" aria-hidden />
          <p className="font-medium">
            {search ? `Nothing matches “${search}”` : "No sales in the last week"}
          </p>
          <p className="text-muted-foreground max-w-sm text-sm">
            {search
              ? "Check the number printed on the receipt."
              : "Sales appear here as soon as the till completes one."}
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {sales.map((sale) => (
            // Two targets, both large. The row stays the reprint — a small
            // icon button beside a wide row is the thing people miss on a
            // touch screen — and Return sits beside it as its own full-height
            // key rather than nested inside the anchor, which would be invalid
            // HTML and would swallow the tap.
            <li key={sale.id} className="flex items-stretch gap-2">
              <a
                href={`/pos/receipt/${sale.id}`}
                target="_blank"
                rel="noreferrer"
                className="bg-card hover:border-brand-500 hover:bg-accent flex min-h-tap flex-1 items-center gap-4 rounded-lg border p-4 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{sale.saleNo}</span>
                    {sale.status === "refunded" ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Refunded
                      </Badge>
                    ) : sale.status === "void" ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Void
                      </Badge>
                    ) : sale.partReturned ? (
                      // The back office's sales list grew this badge earlier
                      // and this screen did not, which left the two lists
                      // describing the same sale differently. It matters more
                      // here: this screen exists for the moment somebody walks
                      // up holding a receipt, and whether part of it has
                      // already come back is the first thing to know.
                      <Badge variant="outline" className="text-warning">
                        Part returned
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground mt-0.5 truncate text-sm">
                    {formatDateTime(sale.saleDate)}
                    {" · "}
                    {sale.itemCount} item{sale.itemCount === 1 ? "" : "s"}
                    {sale.methods.length > 0
                      ? ` · ${sale.methods
                          .map((m) => (isPaymentMethod(m) ? PAYMENT_METHOD_LABELS[m] : m))
                          .join(", ")}`
                      : ""}
                    {sale.customerName ? ` · ${sale.customerName}` : ""}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="font-semibold tabular-nums">
                    {formatRs(sale.total)}
                  </div>
                  <div className="text-muted-foreground flex items-center justify-end gap-1 text-xs">
                    <Printer className="size-3.5" aria-hidden />
                    Reprint
                  </div>
                </div>
              </a>

              {/* Only while something can still come back. `refunded` means
                  every unit already has, and a void sale has nothing to
                  return — the same rule the back office list follows. */}
              {sale.status === "completed" ? (
                <Button
                  variant="outline"
                  className="h-auto min-h-tap shrink-0 px-5"
                  render={<Link href={`/pos/sales/${sale.id}/return`} />}
                >
                  <RotateCcw aria-hidden />
                  Return
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
