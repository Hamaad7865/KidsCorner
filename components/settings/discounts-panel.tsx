"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle, Pencil, Plus, Tag } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { saveDiscount } from "@/lib/discounts/actions"
import type { DiscountRule } from "@/lib/discounts/rules"
import { formatRs } from "@/lib/format"
import { IDLE_STATE } from "@/lib/forms"
import type { Category } from "@/lib/master-data/queries"

/** Human summary of a rule, so the list reads without decoding fields. */
function describe(rule: DiscountRule): string {
  const amount =
    rule.kind === "percent" ? `${rule.value}% off` : `${formatRs(rule.value)} off`
  const cap =
    rule.kind === "percent" && rule.maxAmount !== null
      ? `, max ${formatRs(rule.maxAmount)}`
      : ""
  const scope = rule.scope === "sale" ? "the sale" : "a line"
  const min = rule.minSpend > 0 ? `, over ${formatRs(rule.minSpend)}` : ""
  return `${amount}${cap} on ${scope}${min}`
}

export function DiscountsPanel({
  discounts,
  categories,
  canManage,
}: {
  discounts: DiscountRule[]
  categories: Category[]
  canManage: boolean
}) {
  const [editing, setEditing] = useState<{ rule: DiscountRule | null } | null>(null)

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-heading text-base font-medium">Discounts</h2>
          <p className="text-muted-foreground text-sm">
            Named rules the till can apply. Every one used is recorded against
            the sale, so the reports can say what was given away and why.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setEditing({ rule: null })}>
            <Plus aria-hidden />
            New discount
          </Button>
        ) : null}
      </div>

      {discounts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Tag className="text-muted-foreground mx-auto size-7" aria-hidden />
          <p className="mt-2 font-medium">No discounts yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Until one exists the till can still take an ad-hoc amount off, but
            nothing records the reason.
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {discounts.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{rule.name}</span>
                  {rule.code ? (
                    <Badge variant="outline" className="font-mono text-xs">
                      {rule.code}
                    </Badge>
                  ) : null}
                  {rule.requiresManager ? (
                    <Badge variant="outline" className="text-warning-foreground">
                      Manager
                    </Badge>
                  ) : null}
                  {rule.isActive ? null : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Inactive
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {describe(rule)}
                  {rule.startsOn || rule.endsOn
                    ? ` · ${rule.startsOn ?? "any"} → ${rule.endsOn ?? "any"}`
                    : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!canManage}
                onClick={() => setEditing({ rule })}
                aria-label={`Edit ${rule.name}`}
              >
                <Pencil aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <Dialog open onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editing.rule ? "Edit discount" : "New discount"}
              </DialogTitle>
              <DialogDescription>
                Percentages are capped at 100, and a discount can never take a
                total below zero.
              </DialogDescription>
            </DialogHeader>
            {/* Unmounts on close, resetting the action state. */}
            <DiscountForm
              rule={editing.rule}
              categories={categories}
              onSaved={() => setEditing(null)}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Saving…
        </>
      ) : (
        "Save discount"
      )}
    </Button>
  )
}

function DiscountForm({
  rule,
  categories,
  onSaved,
}: {
  rule: DiscountRule | null
  categories: Category[]
  onSaved: () => void
}) {
  const [state, formAction] = useActionState(saveDiscount, IDLE_STATE)
  const [kind, setKind] = useState(rule?.kind ?? "percent")

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onSaved()
    }
  }, [state, onSaved])

  const err = state.fieldErrors
  const field = "border-input h-9 w-full rounded-lg border bg-transparent px-3 text-sm"

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {rule ? <input type="hidden" name="id" value={rule.id} /> : null}

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="d-name">Name</Label>
          <Input
            id="d-name"
            name="name"
            defaultValue={rule?.name ?? ""}
            placeholder="e.g. Staff discount"
            autoFocus
            aria-invalid={Boolean(err.name)}
          />
          {err.name ? <p className="text-destructive text-sm">{err.name}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-code">Till code</Label>
          <Input
            id="d-code"
            name="code"
            defaultValue={rule?.code ?? ""}
            placeholder="Optional"
            className="font-mono"
            aria-invalid={Boolean(err.code)}
          />
          {err.code ? <p className="text-destructive text-sm">{err.code}</p> : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="d-kind">Type</Label>
          <select
            id="d-kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "percent" | "amount")}
            className={field}
          >
            <option value="percent">Percentage</option>
            <option value="amount">Fixed amount</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-value">{kind === "percent" ? "Percent" : "Amount"}</Label>
          <Input
            id="d-value"
            name="value"
            type="number"
            step="0.01"
            min="0"
            max={kind === "percent" ? 100 : undefined}
            defaultValue={rule?.value ?? ""}
            aria-invalid={Boolean(err.value)}
          />
          {err.value ? <p className="text-destructive text-sm">{err.value}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-scope">Applies to</Label>
          <select
            id="d-scope"
            name="scope"
            defaultValue={rule?.scope ?? "sale"}
            className={field}
          >
            <option value="sale">Whole sale</option>
            <option value="line">One line</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="d-min">Minimum spend</Label>
          <Input
            id="d-min"
            name="minSpend"
            type="number"
            step="0.01"
            min="0"
            defaultValue={rule?.minSpend ?? 0}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-max">Cap</Label>
          <Input
            id="d-max"
            name="maxAmount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={rule?.maxAmount ?? ""}
            placeholder="No cap"
            aria-invalid={Boolean(err.maxAmount)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-category">Category</Label>
          <select
            id="d-category"
            name="categoryId"
            defaultValue={rule?.categoryId ?? ""}
            className={field}
          >
            <option value="">Any</option>
            {categories
              .filter((c) => c.is_active || c.id === rule?.categoryId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="d-start">Starts</Label>
          <input
            id="d-start"
            name="startsOn"
            type="date"
            defaultValue={rule?.startsOn ?? ""}
            className={field}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-end">Ends</Label>
          <input
            id="d-end"
            name="endsOn"
            type="date"
            defaultValue={rule?.endsOn ?? ""}
            className={field}
          />
          {err.endsOn ? (
            <p className="text-destructive text-sm">{err.endsOn}</p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="d-manager">Needs manager approval</Label>
          <p className="text-muted-foreground text-xs">
            The till records who approved it.
          </p>
        </div>
        <Switch
          id="d-manager"
          name="requiresManager"
          value="true"
          defaultChecked={rule?.requiresManager ?? false}
        />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <Label htmlFor="d-active">Active</Label>
        <Switch
          id="d-active"
          name="isActive"
          value="true"
          defaultChecked={rule?.isActive ?? true}
        />
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <SaveButton />
      </DialogFooter>
    </form>
  )
}
