import type { Metadata } from "next"
import Link from "next/link"
import { TicketPercent } from "lucide-react"

import { ApplyPromotionDialog } from "@/components/promotions/apply-promotion-dialog"
import { LiftButton } from "@/components/promotions/lift-button"
import { ReducePromotionDialog } from "@/components/promotions/reduce-promotion-dialog"
import { ThresholdControl } from "@/components/promotions/threshold-control"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { canManageCatalog, canManageSettings } from "@/lib/auth/roles"
import { requireAdminProfile } from "@/lib/auth/session"
import { formatDate, formatPriceRange, formatRs } from "@/lib/format"
import { setPromoStillDays, setSlowMoverDays } from "@/lib/promotions/actions"
import {
  getPromoStillDays,
  getSlowMoverDays,
  listActivePromotions,
  listSlowMovers,
  listStalePromotions,
} from "@/lib/promotions/queries"
import { getCurrentVatPolicy } from "@/lib/vat/policy"

export const metadata: Metadata = { title: "Promotions" }

export default async function PromotionsPage() {
  const profile = await requireAdminProfile()
  const days = await getSlowMoverDays()
  const stillDays = await getPromoStillDays()

  const [slowMovers, active, stale, vatPolicy] = await Promise.all([
    listSlowMovers(days),
    listActivePromotions(),
    // The second threshold's list: marked down once, still not selling. Only
    // worth fetching for somebody who could act on it — a cashier reading the
    // page (if one ever did) needs none of it.
    canManageCatalog(profile.role) ? listStalePromotions(stillDays) : [],
    // effectiveRate, not configuredRate: VAT stays "prepared" at its last
    // configured rate even while disabled (so re-enabling doesn't lose it),
    // but a disabled shop charges no VAT at all — the break-even warning below
    // must reflect what a sale actually does right now, not what is on file.
    getCurrentVatPolicy(),
  ])
  const vatRate = vatPolicy.effectiveRate

  const canManage = canManageCatalog(profile.role)
  const canEditThreshold = canManageSettings(profile.role)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold">Promotions</h1>
        <p className="text-muted-foreground text-sm">
          Products that have stopped selling, and the promotions running now. A
          promotion lowers the price to shift stock — never below cost, so it can
          never sell at a loss.
        </p>
      </header>

      <div className="rounded-lg border p-4">
        <div className="space-y-3">
          <ThresholdControl
            days={days}
            canEdit={canEditThreshold}
            action={setSlowMoverDays}
            lead="Flag a product with no sale in the last"
            tail="days."
            ariaLabel="Days without a sale"
            readOnly={`Products with no sale in the last ${days} days are flagged as slow movers. Only the owner can change this.`}
          />
          <ThresholdControl
            days={stillDays}
            canEdit={canEditThreshold}
            action={setPromoStillDays}
            lead="Flag a promotion still unsold after"
            tail="days on promotion."
            ariaLabel="Days on promotion without a sale"
            readOnly={`A promotion still unsold after ${stillDays} days is flagged to be reduced again. Only the owner can change this.`}
          />
        </div>
      </div>

      {/* ── Slow movers ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="font-heading text-base font-semibold">
          Slow movers{" "}
          {slowMovers.length > 0 ? (
            <span className="text-muted-foreground font-normal">
              ({slowMovers.length})
            </span>
          ) : null}
        </h2>

        {slowMovers.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            Nothing has gone quiet — every product with stock has sold within the
            last {days} days.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Idle</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {slowMovers.map((p) => (
                  <TableRow key={p.productId}>
                    <TableCell>
                      <Link
                        href={`/products/${p.productId}`}
                        className="hover:text-brand-700 font-medium hover:underline"
                      >
                        {p.productName}
                      </Link>
                      {p.productCode ? (
                        <span className="text-muted-foreground ml-2 font-mono text-xs">
                          {p.productCode}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.categoryName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.daysIdle} {p.daysIdle === 1 ? "day" : "days"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.qtyOnHand}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPriceRange(p.minPrice, p.maxPrice)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <ApplyPromotionDialog
                          productId={p.productId}
                          productName={p.productName}
                          vatRate={vatRate}
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ── On promotion ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="font-heading text-base font-semibold">
          On promotion{" "}
          {active.length > 0 ? (
            <span className="text-muted-foreground font-normal">({active.length})</span>
          ) : null}
        </h2>

        {active.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            No promotions are running. Put a product on promotion from the slow-mover
            list above, or from its page under Products.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Was</TableHead>
                  <TableHead className="text-right">Now</TableHead>
                  <TableHead className="text-right">Off</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.map((pr) => {
                  const off = pr.originalPrice - pr.promoPrice
                  const label = [pr.colourName, pr.sizeLabel].filter(Boolean).join(" · ")
                  return (
                    <TableRow key={pr.id}>
                      <TableCell>
                        {pr.productId ? (
                          <Link
                            href={`/products/${pr.productId}`}
                            className="hover:text-brand-700 font-medium hover:underline"
                          >
                            {pr.productName}
                          </Link>
                        ) : (
                          <span className="font-medium">{pr.productName}</span>
                        )}
                        {label ? (
                          <span className="text-muted-foreground ml-2 text-xs">{label}</span>
                        ) : null}
                        {pr.soldSincePromo ? (
                          <Badge variant="secondary" className="ml-2 align-middle">
                            selling again
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums line-through">
                        {formatRs(pr.originalPrice)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatRs(pr.promoPrice)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatRs(off)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(pr.appliedAt)}
                        {pr.appliedBy ? ` · ${pr.appliedBy}` : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage ? <LiftButton promotionId={pr.id} /> : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ── Still not selling — the second threshold ────────────────────── */}
      {canManage && stale.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-heading text-base font-semibold">
            Still not selling{" "}
            <span className="text-muted-foreground font-normal">({stale.length})</span>
          </h2>
          <p className="text-muted-foreground text-sm">
            On promotion with no sale in the last {stillDays} days. Reduce the price
            again — the original price is remembered, so lifting later still puts it
            all back.
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Was</TableHead>
                  <TableHead className="text-right">Now</TableHead>
                  <TableHead className="text-right">Idle</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead className="w-56" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {stale.map((pr) => {
                  const label = [pr.colourName, pr.sizeLabel].filter(Boolean).join(" · ")
                  return (
                    <TableRow key={pr.promotionId}>
                      <TableCell>
                        <Link
                          href={`/products/${pr.productId}`}
                          className="hover:text-brand-700 font-medium hover:underline"
                        >
                          {pr.productName}
                        </Link>
                        {label ? (
                          <span className="text-muted-foreground ml-2 text-xs">{label}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums line-through">
                        {formatRs(pr.originalPrice)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatRs(pr.promoPrice)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pr.daysIdle} {pr.daysIdle === 1 ? "day" : "days"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(pr.appliedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <ReducePromotionDialog
                            variantId={pr.variantId}
                            productName={pr.productName}
                            label={label}
                            originalPrice={pr.originalPrice}
                            promoPrice={pr.promoPrice}
                            costPrice={pr.costPrice}
                            vatRate={vatRate}
                          />
                          <LiftButton promotionId={pr.promotionId} />
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      <p className="text-muted-foreground flex items-center gap-1.5 border-t pt-4 text-xs">
        <TicketPercent className="size-3.5" aria-hidden />A promotion changes the
        real selling price, so the till shows it automatically on its next sync.
        Lifting it puts the price back.
      </p>
    </div>
  )
}
