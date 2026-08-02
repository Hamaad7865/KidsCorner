"use client"

import { useActionState, useEffect } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/db-enums"
import { IDLE_STATE } from "@/lib/forms"
import { saveShopSettings } from "@/lib/settings/actions"
import { cn } from "@/lib/utils"

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
        "Save settings"
      )}
    </Button>
  )
}

export function ShopSettings({
  shopName,
  refundRequiresManager,
  vatRate,
  paymentMethods,
  canManage,
}: {
  shopName: string
  refundRequiresManager: boolean
  /** Stored as a fraction; shown as a percentage. */
  vatRate: number
  paymentMethods: string[]
  canManage: boolean
}) {
  const [state, formAction] = useActionState(saveShopSettings, IDLE_STATE)

  useEffect(() => {
    if (state.status === "success" && state.message) toast.success(state.message)
  }, [state])

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-heading text-base font-medium">Shop</h2>
        <p className="text-muted-foreground text-sm">
          The name on receipts, the VAT rate money is calculated with, and the
          methods the till offers.
          {canManage ? "" : " Only the owner can change these."}
        </p>
      </div>

      <form action={formAction} className="space-y-4 rounded-lg border p-4" noValidate>
        {state.error ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="shop-name">Shop name</Label>
            <Input
              id="shop-name"
              name="shopName"
              defaultValue={shopName}
              disabled={!canManage}
              aria-invalid={Boolean(state.fieldErrors.shopName)}
            />
            {state.fieldErrors.shopName ? (
              <p className="text-destructive text-sm">{state.fieldErrors.shopName}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="vat-percent">VAT rate (%)</Label>
            <Input
              id="vat-percent"
              name="vatPercent"
              type="number"
              step="0.01"
              min="0"
              max="100"
              defaultValue={(vatRate * 100).toFixed(2).replace(/\.00$/, "")}
              disabled={!canManage}
              className="w-32"
              aria-invalid={Boolean(state.fieldErrors.vatPercent)}
            />
            {state.fieldErrors.vatPercent ? (
              <p className="text-destructive text-sm">
                {state.fieldErrors.vatPercent}
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              Prices are VAT-<strong>inclusive</strong>: this is the portion
              extracted from a total, not added to it. Changing it affects new
              sales only — past sales keep the rate they were rung up at.
            </p>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Payment methods</legend>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((method) => {
              const checked = paymentMethods.includes(method)
              return (
                <label
                  key={method}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm select-none",
                    "focus-within:ring-ring focus-within:ring-2",
                    !canManage && "cursor-not-allowed opacity-60",
                  )}
                >
                  {/* Native checkboxes: several share a name and the server
                      reads them with getAll, which is exactly what native
                      multi-value serialisation gives. */}
                  <input
                    type="checkbox"
                    name="paymentMethods"
                    value={method}
                    defaultChecked={checked}
                    disabled={!canManage}
                    className="accent-brand-600"
                  />
                  {PAYMENT_METHOD_LABELS[method]}
                </label>
              )
            })}
          </div>
          {state.fieldErrors.paymentMethods ? (
            <p className="text-destructive text-sm">
              {state.fieldErrors.paymentMethods}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Returns</legend>
          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 select-none",
              "focus-within:ring-ring focus-within:ring-2",
              !canManage && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="checkbox"
              name="refundRequiresManager"
              defaultChecked={refundRequiresManager}
              disabled={!canManage}
              className="accent-brand-600 mt-0.5"
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">
                A manager must approve a return
              </span>
              <span className="text-muted-foreground block text-xs">
                Off by default, and off is how this shop has always worked: any
                cashier can hand money back. A discount already needs a
                manager&rsquo;s PIN, and a refund moves more money than a
                discount does — out of the drawer, against a sale that may be
                weeks old. Switch it on and the till asks for a PIN before it
                pays anything back, and records who said yes.
              </span>
            </span>
          </label>
        </fieldset>

        {canManage ? (
          <div className="flex justify-end">
            <SaveButton />
          </div>
        ) : null}
      </form>
    </section>
  )
}
