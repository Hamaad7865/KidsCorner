import Link from "next/link"
import {
  BadgePercent,
  Ban,
  Banknote,
  CalendarCheck,
  CircleDot,
  Coins,
  Download,
  HandCoins,
  Power,
  ReceiptText,
  RotateCcw,
  UserRound,
  Wallet,
} from "lucide-react"

import { DateRangeFilter } from "@/components/pos/flow-dates"
import { formatLongDate, formatDateTime, shopDayOf } from "@/lib/format"
import type { DeviceTrace, TraceKind } from "@/lib/pos/traceability"

/**
 * Traceability — one till's day, read top down.
 *
 * Laid out as Carfectionist has it: a written-out day band, then a circle per
 * event with the title, the detail beneath, and the time large on the right.
 * The owner reads this to answer "what happened at that till", so the time and
 * the day are the two things kept big — the rest is supporting detail.
 */

const KIND_ICON: Record<TraceKind, typeof CircleDot> = {
  till_open: Wallet,
  float_in: HandCoins,
  payment: Coins,
  discount: BadgePercent,
  receipt: ReceiptText,
  refund: RotateCcw,
  cash_out: Banknote,
  till_close: CalendarCheck,
  terminal: Power,
  version: Download,
  operator: UserRound,
  device_state: Ban,
}

export function TraceTab({
  trace,
  basePath,
  params,
}: {
  trace: DeviceTrace
  basePath: string
  params: Record<string, string | undefined>
}) {
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Everything this till did in the period — starts and sign-ins, shifts,
          payments, discounts, receipts, refunds and cash movements.
        </p>
        <DateRangeFilter
          basePath={basePath}
          params={params}
          from={trace.from}
          to={trace.to}
        />
      </div>

      {trace.events.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
          Nothing recorded in this period.
        </div>
      ) : (
        <div className="flex flex-col">
          {trace.events.map((event, i) => {
            const Icon = KIND_ICON[event.kind] ?? CircleDot
            const day = shopDayOf(event.at)
            const newDay = i === 0 || day !== shopDayOf(trace.events[i - 1]!.at)

            return (
              <div key={event.key}>
                {newDay ? (
                  <div className={`mb-5 flex items-center gap-3 ${i === 0 ? "" : "mt-2"}`}>
                    <span className="bg-muted rounded-lg px-3.5 py-2 text-sm font-semibold">
                      {formatLongDate(event.at)}
                    </span>
                    <span className="bg-border h-px flex-1" />
                  </div>
                ) : null}

                <div className="flex items-start gap-4 pb-7">
                  <span className="bg-card grid size-11 shrink-0 place-items-center rounded-full border">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    {event.href ? (
                      <Link
                        href={event.href}
                        className="text-brand-700 text-sm font-semibold tracking-wide uppercase hover:underline"
                      >
                        {event.title}
                      </Link>
                    ) : (
                      <span className="text-sm font-semibold tracking-wide uppercase">
                        {event.title}
                      </span>
                    )}
                    {event.detail ? (
                      // break-words: a long unbroken reason or reference must
                      // wrap rather than push the time off the right edge.
                      <div className="text-muted-foreground mt-1 text-sm break-words">
                        {event.detail}
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 pt-0.5 text-sm font-semibold tabular-nums">
                    {formatDateTime(event.at).slice(-5)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
