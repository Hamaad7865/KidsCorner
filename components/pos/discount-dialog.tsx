"use client"

import { useMemo, useState } from "react"
import { Percent, Tag, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  applyRule,
  checkEligibility,
  discountAmountFor,
  discountBaseFor,
  manualDiscount,
  type DiscountRule,
} from "@/lib/discounts/rules"
import { formatRs, round2 } from "@/lib/format"
import { useCart } from "@/lib/pos/cart-store"
import { cn } from "@/lib/utils"

/**
 * Applies a discount to the basket.
 *
 * Every figure shown here comes from `discountAmountFor`, the same function the
 * `discount_amount_for` SQL mirrors — so what the cashier is shown before the
 * sale is exactly what gets recorded against it. Quoting one number and
 * charging another is the failure this is built to avoid.
 */
export function DiscountDialog({
  rules,
  basketTotal,
  today,
}: {
  rules: DiscountRule[]
  /** Basket before any sale-level discount. The base a given rule works
   *  against is narrower when the rule names a category — see `baseFor`. */
  basketTotal: number
  /** Shop calendar day, passed in so the timezone is the shop's, not the device's. */
  today: string
}) {
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState("")

  const applied = useCart((s) => s.appliedDiscounts)
  const applyDiscount = useCart((s) => s.applyDiscount)
  const removeDiscount = useCart((s) => s.removeDiscount)

  const manualAmount = Number(manual) || 0

  const lines = useCart((s) => s.lines)

  /**
   * What each rule is actually measured against.
   *
   * `discountBaseFor` is the server's own function: a category-scoped rule is
   * worth a percentage of THAT CATEGORY's lines, not of the basket. The dialog
   * used to quote every rule against the whole basket, so "20% off shoes" on a
   * basket of Rs 1,000 clothes and Rs 300 shoes showed −Rs 260 and the cashier
   * collected Rs 1,040 — then the server settled it at Rs 60 and refused the
   * sale as underpaid, with the money already in the drawer.
   */
  const byCategory = useMemo(() => {
    const totals = new Map<number, number>()
    for (const line of lines) {
      if (line.categoryId === null) continue
      const lineTotal = round2(line.unitPrice * line.qty - line.discount)
      totals.set(line.categoryId, round2((totals.get(line.categoryId) ?? 0) + lineTotal))
    }
    return totals
  }, [lines])

  const baseFor = (rule: DiscountRule) =>
    discountBaseFor(rule, basketTotal, byCategory) ?? 0

  return (
    <>
      <div className="space-y-2">
        {applied.length > 0 ? (
          <ul className="space-y-1">
            {applied.map((d, index) => (
              <li
                key={`${d.discountId ?? "manual"}-${index}`}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Tag className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{d.label}</span>
                  {d.kind === "percent" ? (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {d.value}%
                    </Badge>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="tabular-nums">− {formatRs(d.amount)}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeDiscount(index)}
                    aria-label={`Remove ${d.label}`}
                  >
                    <X aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <Button
          variant="outline"
          className="h-control w-full"
          onClick={() => setOpen(true)}
          disabled={basketTotal <= 0}
        >
          <Percent aria-hidden />
          {applied.length > 0 ? "Add another discount" : "Add a discount"}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Discount</DialogTitle>
            <DialogDescription>
              Applied to {formatRs(basketTotal)}. Named discounts are recorded
              against the sale so the reports can show what was given away.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-72 space-y-2 overflow-y-auto">
            {rules.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No discounts are set up. An owner or manager adds them in
                Settings.
              </p>
            ) : (
              rules.map((rule) => {
                // Eligibility (min spend, dates) is a question about the
                // BASKET; the money is a question about the rule's own base.
                const eligibility = checkEligibility(rule, basketTotal, today)
                const already = applied.some((d) => d.discountId === rule.id)
                const base = baseFor(rule)
                const amount = discountAmountFor(
                  rule.kind,
                  rule.value,
                  base,
                  rule.maxAmount,
                )
                // A rule that matches nothing in this basket is worth nothing,
                // and the server refuses it outright — so it is not offered.
                const blocked = !eligibility.eligible || already || base <= 0

                return (
                  <button
                    key={rule.id}
                    type="button"
                    disabled={blocked}
                    onClick={() => {
                      applyDiscount(applyRule(rule, base))
                      setOpen(false)
                    }}
                    className={cn(
                      "hover:bg-accent flex min-h-tap w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors",
                      blocked && "cursor-not-allowed opacity-50 hover:bg-transparent",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{rule.name}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {already
                          ? "Already applied"
                          : eligibility.eligible
                            ? rule.kind === "percent"
                              ? `${rule.value}% off${rule.maxAmount ? `, max ${formatRs(rule.maxAmount)}` : ""}`
                              : `${formatRs(rule.value)} off`
                            : eligibility.reason}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {eligibility.eligible && !already ? `− ${formatRs(amount)}` : "—"}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="manual-discount">Or an amount off</Label>
            <div className="flex gap-2">
              <Input
                id="manual-discount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={manual}
                onChange={(event) => setManual(event.target.value)}
                placeholder="0.00"
                className="h-control"
              />
              <Button
                className="h-control shrink-0"
                disabled={manualAmount <= 0}
                onClick={() => {
                  applyDiscount(manualDiscount(manualAmount, basketTotal))
                  setManual("")
                  setOpen(false)
                }}
              >
                Apply
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              An ad-hoc amount is recorded as &ldquo;Manual discount&rdquo; with
              no rule behind it — it still shows in the totals, just not against
              a named offer.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
