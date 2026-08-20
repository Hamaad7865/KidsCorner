"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { TicketPercent } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { applyPromotionBatch, fetchPromoVariants } from "@/lib/promotions/actions"
import { IDLE_STATE } from "@/lib/forms"
import { formatRs, round2 } from "@/lib/format"
import type { PromoVariant } from "@/lib/promotions/queries"

/**
 * Sets a promotion price for a slow-moving product's variants. Each variant is
 * floored at its own cost — the input is blocked below it — and the price that
 * would break even after VAT is shown as a soft warning above cost, so a manager
 * marks it down knowingly and never at a loss.
 */
export function ApplyPromotionDialog({
  productId,
  productName,
  vatRate,
}: {
  productId: number
  productName: string
  vatRate: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [variants, setVariants] = useState<PromoVariant[]>([])
  const [prices, setPrices] = useState<Record<number, string>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    setLoading(true)
    setLoadError(null)
    const result = await fetchPromoVariants(productId)
    setLoading(false)
    if (!result.ok) {
      setLoadError(result.error)
      return
    }
    setVariants(result.variants)
    // Seed each input with the current price, so a manager only edits what they
    // want to drop.
    setPrices(Object.fromEntries(result.variants.map((v) => [v.variantId, String(v.currentPrice)])))
  }

  function priceState(v: PromoVariant) {
    const raw = prices[v.variantId] ?? ""
    const n = Number(raw)
    const valid = raw !== "" && Number.isFinite(n)
    const belowCost = valid && n < v.costPrice
    const notReduction = valid && n >= v.currentPrice
    const breakEven = round2(v.costPrice * (1 + vatRate))
    const belowBreakEven = valid && n >= v.costPrice && n < breakEven
    // A valid markdown: a real reduction that does not dip under cost.
    const willApply = valid && n > 0 && !belowCost && !notReduction
    return { raw, n, belowCost, notReduction, belowBreakEven, breakEven, willApply }
  }

  const anyValid = variants.some((v) => priceState(v).willApply)
  const anyBlocked = variants.some((v) => {
    const p = priceState(v)
    return p.belowCost || p.notReduction
  })

  function submit() {
    const fd = new FormData()
    for (const v of variants) {
      const p = priceState(v)
      if (!p.willApply) continue
      fd.append("variantId", String(v.variantId))
      fd.append("promoPrice", String(round2(p.n)))
    }
    startTransition(async () => {
      const result = await applyPromotionBatch(IDLE_STATE, fd)
      if (result.status === "success") {
        toast.success(result.message ?? "Promotion applied.")
        setOpen(false)
        router.refresh()
      } else {
        toast.error(result.error ?? "Could not apply the promotion.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <TicketPercent aria-hidden />
        Set promotion
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Put “{productName}” on promotion</DialogTitle>
          <DialogDescription>
            Lower the price to shift it. It can never go below cost — that would be
            a loss.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-muted-foreground py-6 text-center text-sm">Loading…</p>
        ) : loadError ? (
          <p className="text-destructive py-6 text-center text-sm">{loadError}</p>
        ) : variants.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            This product has no active variants to promote.
          </p>
        ) : (
          <div className="space-y-3">
            {variants.map((v) => {
              const p = priceState(v)
              const label = [v.colourName, v.sizeLabel].filter(Boolean).join(" · ") || v.sku
              return (
                <div key={v.variantId} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{label}</p>
                      <p className="text-muted-foreground text-xs">
                        Cost {formatRs(v.costPrice)} · now {formatRs(v.currentPrice)} ·{" "}
                        {v.qtyOnHand} in stock
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground text-sm">Rs</span>
                      <Input
                        inputMode="decimal"
                        value={p.raw}
                        onChange={(e) =>
                          setPrices((prev) => ({
                            ...prev,
                            [v.variantId]: e.target.value.replace(/[^0-9.]/g, ""),
                          }))
                        }
                        aria-invalid={p.belowCost || p.notReduction}
                        className="h-9 w-24 text-right tabular-nums"
                      />
                    </div>
                  </div>
                  {p.belowCost ? (
                    <p className="text-destructive mt-1.5 text-xs">
                      Below cost ({formatRs(v.costPrice)}) — that would sell at a loss.
                    </p>
                  ) : p.notReduction ? (
                    <p className="text-destructive mt-1.5 text-xs">
                      Must be lower than the current price to be a promotion.
                    </p>
                  ) : p.belowBreakEven ? (
                    <p className="text-warning-foreground mt-1.5 text-xs">
                      Above cost, but below the {formatRs(p.breakEven)} that breaks even
                      after VAT — you keep less than it cost once VAT is paid.
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !anyValid || anyBlocked}>
            {pending ? "Applying…" : "Apply promotion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
