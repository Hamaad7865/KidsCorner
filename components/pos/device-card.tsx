import Link from "next/link"
import { LayoutDashboard, Monitor, TabletSmartphone } from "lucide-react"

import { CloseTillRemotely } from "@/components/pos/close-till-remotely"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatDateTime, formatQty, formatRs } from "@/lib/format"
import type { PosDevice } from "@/lib/pos/overview"

/**
 * One till, as a card.
 *
 * The three figures on an open drawer are the ones a cashier will be counting
 * against at close, so they are the ones an owner needs to see: what was taken,
 * what should be in the drawer, and the arithmetic between them.
 */
export function DeviceCard({
  device,
  canClose,
}: {
  device: PosDevice
  canClose: boolean
}) {
  const Icon = device.isBackOffice ? Monitor : TabletSmartphone

  return (
    <Card className={device.isActive ? undefined : "border-dashed opacity-70"}>
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <span className="bg-brand-50 text-brand-700 grid size-11 shrink-0 place-items-center rounded-xl">
            <Icon className="size-5" aria-hidden />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/point-of-sale/${encodeURIComponent(device.code)}`}
                className="hover:text-brand-700 truncate font-semibold hover:underline"
              >
                {device.name}
              </Link>

              {/* The web till cannot be offline — it is the page you are on. */}
              {!device.isBackOffice ? (
                <span
                  title={
                    device.online
                      ? "Online"
                      : `Last seen ${device.lastSeenAt ? formatDateTime(device.lastSeenAt) : "never"}`
                  }
                  className={
                    device.online
                      ? "size-2 shrink-0 rounded-full bg-emerald-500"
                      : "bg-muted-foreground/40 size-2 shrink-0 rounded-full"
                  }
                  aria-label={device.online ? "Online" : "Offline"}
                />
              ) : null}

              {!device.isActive ? <Badge variant="secondary">Retired</Badge> : null}
            </div>

            <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
              {device.model ? <span>{device.model}</span> : null}
              <span className="font-mono">#{device.code}</span>
              {device.appVersion ? (
                <span className="bg-muted rounded px-1.5 py-0.5 font-mono text-[10px]">
                  v{device.appVersion}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {device.drawer && canClose ? (
              <CloseTillRemotely till={device.drawer} deviceName={device.name} />
            ) : null}
            <Button
              variant="outline"
              size="icon"
              render={<Link href={`/point-of-sale/${encodeURIComponent(device.code)}`} />}
              aria-label={`Open ${device.name}`}
            >
              <LayoutDashboard aria-hidden />
            </Button>
          </div>
        </div>

        {device.drawer ? (
          <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
            <Figure
              label="Till open"
              value={formatDateTime(device.drawer.openedAt).slice(-5)}
              hint={
                [
                  device.drawer.openedByName,
                  `${formatQty(device.drawer.ticketCount)} sale${device.drawer.ticketCount === 1 ? "" : "s"}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
            />
            <Figure
              label="Cash collected"
              value={formatRs(device.drawer.cashCollected)}
              hint="through the drawer"
            />
            <Figure
              label="Expected in drawer"
              value={formatRs(device.drawer.expected)}
              /* Spelled out because "collected 5,158 · expected 7,158" reads as
                 a fault until you remember the float put in at open. */
              hint={
                [
                  `incl. ${formatRs(device.drawer.openingFloat)} float`,
                  device.drawer.tillMovements !== 0
                    ? `${formatRs(device.drawer.tillMovements)} in/out`
                    : null,
                  device.drawer.cashRefunded !== 0
                    ? `${formatRs(device.drawer.cashRefunded)} refunded`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              }
            />
          </div>
        ) : (
          <div className="text-muted-foreground mt-4 border-t pt-4 text-sm">
            Till closed
            {device.isActive
              ? device.isBackOffice
                ? " — open it from the web till"
                : " — opens from the tablet"
              : ""}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div>
      <div className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">
        {label}
      </div>
      <div className="mt-0.5 font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
    </div>
  )
}
