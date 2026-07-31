"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { LoaderCircle, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS } from "@/lib/db-enums"

const ALL = ""

const TYPE_OPTIONS = [
  { value: ALL, label: "All types" },
  ...MOVEMENT_TYPES.map((value) => ({
    value,
    label: MOVEMENT_TYPE_LABELS[value],
  })),
]

/** Filter state lives in the URL so a filtered ledger is bookmarkable. */
export function MovementFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const type = searchParams.get("type") ?? ALL
  const from = searchParams.get("from") ?? ""
  const to = searchParams.get("to") ?? ""

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key)
      else next.set(key, value)
    }
    const query = next.toString()
    startTransition(() => router.push(query ? `/stock?${query}` : "/stock"))
  }

  const hasFilters = type !== ALL || from !== "" || to !== ""

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* flex + gap rather than space-y-2: the select renders a hidden form
          input beside its trigger, and space-y-2 leaves ~8px of dead space
          under it, lifting Type out of line with the two date fields. */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="movement-type">Type</Label>
        <Select
          value={type}
          items={TYPE_OPTIONS}
          onValueChange={(value) => apply({ type: String(value ?? ALL) })}
        >
          <SelectTrigger id="movement-type" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value || "all"} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="movement-from">From</Label>
        <Input
          id="movement-from"
          type="date"
          value={from}
          onChange={(event) => apply({ from: event.target.value })}
          className="w-40"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="movement-to">To</Label>
        <Input
          id="movement-to"
          type="date"
          value={to}
          onChange={(event) => apply({ to: event.target.value })}
          className="w-40"
        />
      </div>

      {hasFilters ? (
        <Button
          variant="ghost"
          onClick={() => startTransition(() => router.push("/stock"))}
        >
          <X aria-hidden />
          Clear
        </Button>
      ) : null}

      {isPending ? (
        <LoaderCircle
          className="text-muted-foreground size-4 animate-spin"
          aria-label="Loading"
        />
      ) : null}
    </div>
  )
}
