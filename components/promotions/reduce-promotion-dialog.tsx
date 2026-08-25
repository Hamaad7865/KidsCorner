"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { TrendingDown } from "lucide-react"
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
import { reducePromotion } from "@/lib/promotions/actions"
import { IDLE_STATE } from "@/lib/forms"
import { formatRs, round2 } from "@/lib/format"

/**
 * Marks a RUNNING promotion down again — the second threshold's action.
 *
 * The floor is still cost, and the new price must also sit below the current
 * promotion price (raising a price is lifting, a different button). The
 * original price is never touched: it is what lifting restores and what the
 * till strikes through, however many times this dialog runs.
 */
export function ReducePromotionDialog({
  variantId,
  productName,
  label,
  originalPrice,
  promoPrice,
  costPrice,
  vatRate,
}: {
  variantId: number
  productName: string
  label: string
  originalPrice: number
  promoPrice: number
  costPrice: number
  vatRate: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [price, setPrice] = useState("")
  const [pending, startTransition] = useTransition()

  const n = Number(price)
  const valid = price !== "" && Number.isFinite(n)
  const belowCost = valid && n < costPrice
  const notReduction = valid && n >= promoPrice
  const breakEven = round2(costPrice * (1 + vatRate))
  const belowBreakEven = valid && n >= costPrice && n < breakEven
  const willApply = valid && n > 0 && !belowCost && !notReduction

  function submit() {
    const fd = new FormData()
    fd.set("variantId", String(variantId))
    fd.set("newPrice", String(round2(n)))
    startTransition(async () => {
      const result = await reducePromotion(IDLE_STATE, fd)
      if (result.status === "success") {
        toast.success(result.message ?? "Promotion reduced.")
        setOpen(false)
        router.refresh()
      } else {
        toast.error(result.error ?? "Could not reduce the promotion.")
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setPrice(String(promoPrice))
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <TrendingDown aria-hidden />
        Reduce again
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Reduce “{productName}
            {label ? ` · ${label}` : ""}” again
          </DialogTitle>
          <DialogDescription>
            Lower the running promotion’s price. It was {formatRs(originalPrice)} before
            the promotion; the promotion keeps that history, however many times it is
            reduced.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              Cost {formatRs(costPrice)} · promotion price {formatRs(promoPrice)}
            </p>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-sm">Rs</span>
              <Input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                aria-invalid={belowCost || notReduction}
                aria-label="New promotion price"
                className="h-9 w-24 text-right tabular-nums"
              />
            </div>
          </div>
          {belowCost ? (
            <p className="text-destructive text-xs">
              Below cost ({formatRs(costPrice)}) — that would sell at a loss.
            </p>
          ) : notReduction ? (
            <p className="text-destructive text-xs">
              Must be lower than the current promotion price ({formatRs(promoPrice)}). To
              put the price up, lift the promotion instead.
            </p>
          ) : belowBreakEven ? (
            <p className="text-warning-foreground text-xs">
              Above cost, but below the {formatRs(breakEven)} that breaks even after VAT —
              you keep less than it cost once VAT is paid.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !willApply}>
            {pending ? "Reducing…" : "Reduce promotion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
