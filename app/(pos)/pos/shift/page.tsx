import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { ShiftCloseForm } from "@/components/pos/shift-close-form"
import { ShiftOpenForm } from "@/components/pos/shift-open-form"
import { TillMovementDialog } from "@/components/pos/till-movement-dialog"
import { Button } from "@/components/ui/button"
import { requireProfile } from "@/lib/auth/session"
import { PAYMENT_METHOD_LABELS, isPaymentMethod } from "@/lib/db-enums"
import { formatDateTime, formatRs } from "@/lib/format"
import { getOpenShift, getShiftTotals } from "@/lib/pos/queries"

export const metadata: Metadata = { title: "Shift" }

export default async function ShiftPage() {
  const profile = await requireProfile()
  const shift = await getOpenShift()

  if (!shift) {
    return <ShiftOpenForm cashierName={profile.fullName} />
  }

  const totals = await getShiftTotals(shift.id)

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <Button variant="ghost" size="sm" render={<Link href="/pos" />}>
        <ArrowLeft aria-hidden />
        Back to till
      </Button>

      <div>
        <h1 className="font-heading text-2xl font-semibold">Close the till</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Open since {formatDateTime(shift.openedAt)}
          {shift.openedBy ? ` by ${shift.openedBy}` : ""}.
        </p>
      </div>

      <div className="space-y-2 rounded-lg border p-4">
        <Row label="Sales" value={String(totals.saleCount)} />
        <Row label="Sales total" value={formatRs(totals.salesTotal)} />

        <div className="border-t pt-2">
          {Object.entries(totals.byMethod).length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing taken yet.</p>
          ) : (
            Object.entries(totals.byMethod).map(([method, amount]) => (
              <Row
                key={method}
                label={
                  isPaymentMethod(method) ? PAYMENT_METHOD_LABELS[method] : method
                }
                value={formatRs(amount)}
                muted
              />
            ))
          )}
        </div>

        <div className="space-y-1 border-t pt-2">
          <Row label="Opening float" value={formatRs(totals.openingFloat)} muted />
          <Row label="Cash taken" value={formatRs(totals.cashTaken)} muted />
          {totals.tillMovements !== 0 ? (
            <Row
              label="Cash in / out"
              value={formatRs(totals.tillMovements)}
              muted
            />
          ) : null}
          <Row
            label="Expected in drawer"
            value={formatRs(totals.expectedCash)}
            strong
          />
        </div>

        {totals.byCashier.length > 0 ? (
          <div className="space-y-1 border-t pt-2">
            {totals.byCashier.map((c) => (
              <Row
                key={c.cashierId ?? c.name}
                label={`${c.name} (${c.saleCount})`}
                value={formatRs(c.total)}
                muted
              />
            ))}
          </div>
        ) : null}

        <div className="space-y-1 border-t pt-2">
          <Row label="Items sold" value={String(totals.itemCount)} muted />
          <Row label="Average basket" value={formatRs(totals.averageBasket)} muted />
          <Row label="VAT included" value={formatRs(totals.vatTotal)} muted />
        </div>
      </div>

      <TillMovementDialog shiftId={shift.id} />

      <ShiftCloseForm shiftId={shift.id} expectedCash={totals.expectedCash} />
    </div>
  )
}

function Row({
  label,
  value,
  muted,
  strong,
}: {
  label: string
  value: string
  muted?: boolean
  strong?: boolean
}) {
  return (
    <div
      className={[
        "flex items-baseline justify-between text-sm",
        muted ? "text-muted-foreground" : "",
        strong ? "font-medium" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
