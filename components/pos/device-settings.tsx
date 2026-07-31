"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { saveDevice } from "@/lib/pos/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatDateTime } from "@/lib/format"
import type { PosDevice } from "@/lib/pos/overview"

/**
 * Naming and retiring a till.
 *
 * The name is the whole point of the registry — "the counter till is short" is
 * only sayable once somebody has called it the counter. Everything else on this
 * tab is evidence reported by the device, shown read-only: a model or a version
 * an owner could edit would stop being evidence.
 */
export function DeviceSettings({ device }: { device: PosDevice }) {
  const router = useRouter()
  const [name, setName] = useState(device.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save() {
    setError(null)
    setBusy(true)
    const result = await saveDevice({ id: device.id, name })
    setBusy(false)
    if (result.ok) {
      setSaved(true)
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  async function setActive(isActive: boolean) {
    setError(null)
    setBusy(true)
    const result = await saveDevice({ id: device.id, isActive })
    setBusy(false)
    if (result.ok) router.refresh()
    else setError(result.error)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="device-name">Name</Label>
            <div className="flex gap-2">
              <Input
                id="device-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setSaved(false)
                }}
                placeholder="Counter"
                className="max-w-sm"
              />
              <Button onClick={save} disabled={busy || name.trim() === device.name}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              What the shop calls this till. A device names itself after its
              model on first sight; renaming it here sticks, and a reinstall
              will not overwrite it.
            </p>
            {saved ? <p className="text-xs text-emerald-600">Saved.</p> : null}
          </div>

          {/* Reported by the device, not editable. These are evidence about the
              hardware — an owner who could type them could make them lie. */}
          <dl className="grid gap-3 border-t pt-4 sm:grid-cols-2">
            <Detail label="Code" value={device.code} mono />
            <Detail label="Model" value={device.model ?? "—"} />
            <Detail label="App version" value={device.appVersion ? `v${device.appVersion}` : "—"} />
            <Detail
              label="Last seen"
              value={
                device.isBackOffice
                  ? "Always — this is the web till"
                  : device.lastSeenAt
                    ? formatDateTime(device.lastSeenAt)
                    : "Never"
              }
            />
          </dl>
        </CardContent>
      </Card>

      {!device.isBackOffice ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <div className="font-medium">
                {device.isActive ? "Retire this till" : "Bring this till back"}
              </div>
              <p className="text-muted-foreground mt-1 max-w-prose text-sm">
                {device.isActive
                  ? "Drops it off the list. Its past shifts and their variances stay attributed to it — a till that could be deleted would be a variance that belonged to nobody."
                  : "Puts it back on the list. It will pick up where it left off the next time it checks in."}
              </p>
            </div>
            <Button
              variant={device.isActive ? "outline" : "default"}
              onClick={() => setActive(!device.isActive)}
              disabled={busy}
            >
              {device.isActive ? "Retire" : "Restore"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  )
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </dt>
      <dd className={mono ? "mt-0.5 font-mono text-xs break-all" : "mt-0.5 text-sm"}>
        {value}
      </dd>
    </div>
  )
}
