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
  shopAddress,
  shopPhone,
  refundRequiresManager,
  paymentMethods,
  canManage,
}: {
  shopName: string
  /**
   * The two the receipt has always wanted and never had.
   *
   * `getShopIdentity` has read `shop_address` and `shop_phone` since the
   * printer was built. No migration seeds them and no screen wrote them, so
   * every receipt this shop has printed carries a name and nothing else. Empty
   * strings rather than nulls — they feed uncontrolled inputs. (The VAT number
   * moved to the VAT registration card.)
   */
  shopAddress: string
  shopPhone: string
  refundRequiresManager: boolean
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
          What prints at the top of every receipt and the methods the till
          offers. VAT is set in the VAT registration card above.
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

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="shop-address">Address</Label>
            <Input
              id="shop-address"
              name="shopAddress"
              defaultValue={shopAddress}
              placeholder="Royal Road, Curepipe"
              disabled={!canManage}
              aria-invalid={Boolean(state.fieldErrors.shopAddress)}
            />
            {state.fieldErrors.shopAddress ? (
              <p className="text-destructive text-sm">
                {state.fieldErrors.shopAddress}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="shop-phone">Phone</Label>
            <Input
              id="shop-phone"
              name="shopPhone"
              type="tel"
              defaultValue={shopPhone}
              placeholder="+230 …"
              disabled={!canManage}
              aria-invalid={Boolean(state.fieldErrors.shopPhone)}
            />
            {state.fieldErrors.shopPhone ? (
              <p className="text-destructive text-sm">{state.fieldErrors.shopPhone}</p>
            ) : null}
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
