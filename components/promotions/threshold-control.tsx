"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { IDLE_STATE } from "@/lib/forms"
import type { FormState } from "@/lib/forms"

/**
 * An editable day-count threshold — there are two, and they are the same
 * control: the slow-mover flag ("no sale in N days") and the promotion flag
 * ("on promotion, still no sale for N days"). Owner-only to change; everybody
 * else sees the current value as a sentence. Saving re-runs the list behind
 * it, so the count and the table move together.
 */
export function ThresholdControl({
  days,
  canEdit,
  action,
  lead,
  tail,
  readOnly,
  ariaLabel,
}: {
  days: number
  canEdit: boolean
  action: (state: FormState, formData: FormData) => Promise<FormState>
  /** The sentence before the input: "Flag a product with no sale in the last" */
  lead: string
  /** The sentence after it: "days." */
  tail: string
  /** What a non-owner reads instead, with the current number already in it. */
  readOnly: string
  ariaLabel: string
}) {
  const router = useRouter()
  const [state, formAction] = useActionState(action, IDLE_STATE)
  const [value, setValue] = useState(String(days))
  // Tracks the `days` this render is following, so a change is caught during
  // render itself (React's own pattern for "reset local state when a prop
  // changes") rather than via an effect, which would show the stale value for
  // one extra frame. Without this, since the component stays mounted across a
  // revalidation, a value saved from another tab would never appear here — the
  // input would keep showing whatever was last typed in THIS one.
  const [trackedDays, setTrackedDays] = useState(days)
  if (days !== trackedDays) {
    setTrackedDays(days)
    setValue(String(days))
  }

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message ?? "Saved.")
      router.refresh()
    } else if (state.status === "error" && state.error) {
      toast.error(state.error)
    }
  }, [state, router])

  if (!canEdit) {
    return <p className="text-muted-foreground text-sm">{readOnly}</p>
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">{lead}</span>
      <Input
        name="days"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
        className="h-8 w-16 text-center"
        aria-label={ariaLabel}
      />
      <span className="text-muted-foreground">{tail}</span>
      <Button type="submit" size="sm" variant="outline">
        Save
      </Button>
      {state.status === "error" && state.fieldErrors.days ? (
        <span className="text-destructive">{state.fieldErrors.days}</span>
      ) : null}
    </form>
  )
}
