import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Monitor, TabletSmartphone } from "lucide-react"

import { CashFlowTab } from "@/components/pos/cash-flow-tab"
import { CashOut } from "@/components/pos/cash-out"
import { CloseTillRemotely } from "@/components/pos/close-till-remotely"
import { DeviceSettings } from "@/components/pos/device-settings"
import { TraceTab } from "@/components/pos/trace-tab"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireAdminProfile } from "@/lib/auth/session"
import { cn } from "@/lib/utils"
import { formatDateTime, formatQty, formatRs, shopToday } from "@/lib/format"
import { getDeviceCashFlow } from "@/lib/pos/cash-flow"
import { getDevice, getDeviceSessions } from "@/lib/pos/overview"
import { getDeviceTrace } from "@/lib/pos/traceability"

export const metadata: Metadata = { title: "Till" }

const TABS = [
  { key: "general", label: "General" },
  { key: "settings", label: "Settings" },
  { key: "cashflow", label: "Cash flow" },
  { key: "trace", label: "Traceability" },
  { key: "sessions", label: "Sessions" },
] as const

/** Tabs whose content is driven by the date pickers. */
const DATED_TABS = new Set(["cashflow", "trace"])

/**
 * One till — General, Settings, Cash flow, Traceability, Sessions.
 *
 * The first four are Carfectionist's Point of Sale module, tab for tab.
 * Sessions is ours: the cash-up record per shift, which Carfectionist folds
 * into its General tab and which is worth its own table here.
 */
export default async function DevicePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ tab?: string; ref?: string; from?: string; to?: string }>
}) {
  const profile = await requireAdminProfile()
  const { code } = await params
  const sp = await searchParams

  const device = await getDevice(decodeURIComponent(code))
  if (!device) notFound()

  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "general"
  const sessions = await getDeviceSessions(device)
  const canClose = profile.role === "owner" || profile.role === "manager"

  // Only read on the tab that shows it — this is several joins over a period,
  // and General has no use for it.
  const flow =
    tab === "cashflow"
      ? await getDeviceCashFlow(device, { ref: sp.ref, from: sp.from, to: sp.to })
      : null
  const trace =
    tab === "trace" ? await getDeviceTrace(device, { from: sp.from, to: sp.to }) : null

  const basePath = `/point-of-sale/${encodeURIComponent(device.code)}`
  const today = shopToday()

  const Icon = device.isBackOffice ? Monitor : TabletSmartphone
  const closed = sessions.filter((s) => s.closedAt)
  // Only a counted shift can be said to have balanced; the legacy rows closed
  // with no count at all, and a zero variance there is an absence, not a match.
  const counted = closed.filter((s) => s.variance !== null)

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" render={<Link href="/point-of-sale" />}>
          <ArrowLeft aria-hidden />
          Point of sale
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="bg-brand-50 text-brand-700 grid size-12 shrink-0 place-items-center rounded-xl">
              <Icon className="size-6" aria-hidden />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-heading text-xl font-semibold">{device.name}</h1>
                {!device.isBackOffice ? (
                  <Badge variant={device.online ? "default" : "secondary"}>
                    {device.online ? "Online" : "Offline"}
                  </Badge>
                ) : null}
                {!device.isActive ? <Badge variant="secondary">Retired</Badge> : null}
              </div>
              <p className="text-muted-foreground mt-1 font-mono text-xs">
                #{device.code}
                {device.appVersion ? ` · v${device.appVersion}` : ""}
              </p>
            </div>
          </div>

          {device.drawer && canClose ? (
            <CloseTillRemotely till={device.drawer} deviceName={device.name} />
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            // Cash flow is driven by its pickers, so the tab arrives with them
            // filled — today to today, the way Carfectionist opens it. Landing
            // on empty pickers reads as "no movements", not "pick a date".
            href={
              DATED_TABS.has(t.key)
                ? `${basePath}?tab=${t.key}&ref=${today}&from=${today}&to=${today}`
                : `${basePath}?tab=${t.key}`
            }
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-brand-600 text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "general" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="py-4">
                <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Till
                </div>
                {device.drawer ? (
                  <>
                    <div className="mt-1 text-xl font-semibold tabular-nums">
                      {formatRs(device.drawer.expected)}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      Expected in drawer · open since{" "}
                      {formatDateTime(device.drawer.openedAt).slice(-5)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-muted-foreground mt-1 text-xl font-semibold">
                      Closed
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {device.isBackOffice
                        ? "Open it from the web till"
                        : "Opens from the tablet"}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-4">
                <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Taken this shift
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums">
                  {device.drawer ? formatRs(device.drawer.salesTotal) : "—"}
                </div>
                <div className="text-muted-foreground text-xs">
                  {device.drawer
                    ? `${formatQty(device.drawer.ticketCount)} ticket${device.drawer.ticketCount === 1 ? "" : "s"} · ${formatRs(device.drawer.cashCollected)} cash`
                    : "No shift open"}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-4">
                <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Reconciliation
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums">
                  {counted.length > 0
                    ? `${counted.filter((s) => s.variance === 0).length}/${counted.length}`
                    : "—"}
                </div>
                <div className="text-muted-foreground text-xs">
                  {counted.length > 0
                    ? "shifts balanced to the cent"
                    : closed.length > 0
                      ? "No shift on this till was counted at close"
                      : "No shift closed on this till yet"}
                </div>
              </CardContent>
            </Card>
          </div>

          <SessionTable sessions={sessions.slice(0, 8)} />
        </div>
      ) : null}

      {tab === "sessions" ? <SessionTable sessions={sessions} /> : null}

      {tab === "settings" ? <DeviceSettings device={device} /> : null}

      {tab === "cashflow" && flow ? (
        <CashFlowTab
          flow={flow}
          basePath={basePath}
          params={{ tab: "cashflow", ref: flow.refDate, from: flow.from, to: flow.to }}
          action={
            device.drawer && canClose ? (
              <CashOut till={device.drawer} deviceName={device.name} />
            ) : null
          }
        />
      ) : null}

      {tab === "trace" && trace ? (
        <TraceTab
          trace={trace}
          basePath={basePath}
          params={{ tab: "trace", from: trace.from, to: trace.to }}
        />
      ) : null}
    </div>
  )
}

function SessionTable({
  sessions,
}: {
  sessions: Awaited<ReturnType<typeof getDeviceSessions>>
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-44">Opened</TableHead>
            <TableHead className="w-44">Closed</TableHead>
            <TableHead>By</TableHead>
            <TableHead className="w-32 text-right">Expected</TableHead>
            <TableHead className="w-32 text-right">Counted</TableHead>
            <TableHead className="w-32 text-right">Variance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
                This till has not opened a shift yet.
              </TableCell>
            </TableRow>
          ) : null}

          {sessions.map((s) => {
            const open = !s.closedAt
            return (
              <TableRow key={s.shiftId}>
                <TableCell className="text-muted-foreground text-xs">
                  {formatDateTime(s.openedAt)}
                </TableCell>
                <TableCell className="text-xs">
                  {open ? (
                    <Badge variant="default">Open</Badge>
                  ) : (
                    <span className="text-muted-foreground">
                      {formatDateTime(s.closedAt!)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {s.closedByName ?? s.openedByName ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.expected === null ? "—" : formatRs(s.expected)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.counted === null ? "—" : formatRs(s.counted)}
                </TableCell>
                <TableCell
                  className={
                    open || s.variance === null
                      ? "text-muted-foreground text-right"
                      : s.variance === 0
                        ? "text-right font-semibold tabular-nums text-emerald-600"
                        : s.variance < 0
                          ? "text-destructive text-right font-semibold tabular-nums"
                          : "text-right font-semibold tabular-nums text-amber-600"
                  }
                >
                  {/* A shift closed without a count is not a shift that
                      balanced — it says so rather than showing a green zero. */}
                  {open ? "—" : s.variance === null ? "Not counted" : formatRs(s.variance)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
