"use client"

import { Fragment, useState } from "react"
import { ChevronRight } from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PAYMENT_METHOD_LABELS } from "@/lib/db-enums"
import { formatRs } from "@/lib/format"
import type { SalesJournal } from "@/lib/reports/sales-journal"
import { cn } from "@/lib/utils"

type Method = SalesJournal["sections"]["byMethod"][number]

const round = (n: number) => Math.round(n * 100) / 100

/**
 * The Methods section, with each method's takings drilling down to the
 * documents underneath — the one part of the journal a shopkeeper reaches for
 * to answer "which bills made up the cash". Its own client island because that
 * expand is the page's only interaction; the totals still foot to the rows.
 */
export function JournalMethods({ methods }: { methods: Method[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (method: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(method)) next.delete(method)
      else next.add(method)
      return next
    })

  const totalBills = methods.reduce((sum, m) => sum + m.bills, 0)
  const totalExcl = round(methods.reduce((sum, m) => sum + m.excl, 0))
  const totalIncl = round(methods.reduce((sum, m) => sum + m.incl, 0))
  const headClass =
    "text-muted-foreground text-xs font-medium tracking-wide uppercase"

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            <TableHead className={headClass}>Method</TableHead>
            <TableHead className={`${headClass} text-right`}>Bills settled</TableHead>
            <TableHead className={`${headClass} text-right`}>Total excl tax</TableHead>
            <TableHead className={`${headClass} text-right`}>Total incl tax</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {methods.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="text-muted-foreground py-8 text-center"
              >
                No money received in this period.
              </TableCell>
            </TableRow>
          ) : (
            methods.map((m) => {
              const label =
                PAYMENT_METHOD_LABELS[
                  m.method as keyof typeof PAYMENT_METHOD_LABELS
                ] ?? m.method
              const isOpen = open.has(m.method)
              const canOpen = m.breakdown.length > 0
              return (
                <Fragment key={m.method}>
                  <TableRow
                    className={cn(canOpen && "cursor-pointer")}
                    onClick={canOpen ? () => toggle(m.method) : undefined}
                    aria-expanded={canOpen ? isOpen : undefined}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        <ChevronRight
                          aria-hidden
                          className={cn(
                            "size-3.5 shrink-0 transition-transform",
                            canOpen ? "opacity-60" : "opacity-0",
                            isOpen && "rotate-90",
                          )}
                        />
                        {label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.bills}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRs(m.excl)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRs(m.incl)}</TableCell>
                  </TableRow>
                  {isOpen
                    ? m.breakdown.map((b) => (
                        <TableRow
                          key={`${m.method}:${b.ref}`}
                          className="bg-muted/20 hover:bg-muted/20"
                        >
                          <TableCell className="text-muted-foreground py-2 pl-9">
                            {b.ref}
                            {b.customer ? ` · ${b.customer}` : ""}
                          </TableCell>
                          <TableCell />
                          <TableCell className="text-muted-foreground py-2 text-right tabular-nums">
                            {formatRs(b.excl)}
                          </TableCell>
                          <TableCell className="text-muted-foreground py-2 text-right tabular-nums">
                            {formatRs(b.incl)}
                          </TableCell>
                        </TableRow>
                      ))
                    : null}
                </Fragment>
              )
            })
          )}
          {methods.length > 0 ? (
            <TableRow className="bg-muted/40 hover:bg-muted/40 font-semibold">
              <TableCell className="pl-9">Total</TableCell>
              <TableCell className="text-right tabular-nums">{totalBills}</TableCell>
              <TableCell className="text-right tabular-nums">{formatRs(totalExcl)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatRs(totalIncl)}</TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  )
}
