"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle } from "lucide-react"
import { toast } from "sonner"

import { ImageField } from "@/components/products/image-field"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { Switch } from "@/components/ui/switch"
import { GENDERS, type Gender } from "@/lib/db-enums"
import { IDLE_STATE } from "@/lib/forms"
import type { Brand, Category } from "@/lib/master-data/queries"
import { saveProduct } from "@/lib/products/actions"
import type { ProductDetail } from "@/lib/products/queries"

const GENDER_LABELS: Record<Gender, string> = {
  boy: "Boy",
  girl: "Girl",
  unisex: "Unisex",
}

const GENDER_ITEMS = GENDERS.map((value) => ({
  value,
  label: GENDER_LABELS[value],
}))

const NO_BRAND = ""

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="text-destructive text-sm">
      {message}
    </p>
  )
}

function SaveButton({ isNew }: { isNew: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Saving…
        </>
      ) : isNew ? (
        "Create product"
      ) : (
        "Save changes"
      )}
    </Button>
  )
}

export function ProductForm({
  product,
  categories,
  brands,
}: {
  product: ProductDetail | null
  categories: Category[]
  brands: Brand[]
}) {
  const [state, formAction] = useActionState(saveProduct, IDLE_STATE)
  const isNew = product === null

  // Both selects are controlled so the chosen value survives a failed submit —
  // an uncontrolled Base UI select would reset to its defaultValue on re-render.
  const [categoryId, setCategoryId] = useState(
    product ? String(product.categoryId) : "",
  )
  const [brandId, setBrandId] = useState(
    product?.brandId != null ? String(product.brandId) : NO_BRAND,
  )
  const [gender, setGender] = useState<string>(product?.gender ?? "unisex")

  useEffect(() => {
    if (state.status === "success" && state.message) toast.success(state.message)
  }, [state])

  // Only active master data is offered for new selections, but whatever this
  // product already points at must stay in the list — otherwise editing an
  // unrelated field would silently reassign it.
  const categoryOptions = categories
    .filter((c) => c.is_active || c.id === product?.categoryId)
    .map((c) => ({ value: String(c.id), label: c.name }))

  const brandOptions = [
    { value: NO_BRAND, label: "No brand" },
    ...brands
      .filter((b) => b.is_active || b.id === product?.brandId)
      .map((b) => ({ value: String(b.id), label: b.name })),
  ]

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {product ? <input type="hidden" name="id" value={product.id} /> : null}

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="product-name">Name</Label>
        <Input
          id="product-name"
          name="name"
          defaultValue={product?.name ?? ""}
          placeholder="e.g. Striped cotton t-shirt"
          autoFocus={isNew}
          aria-invalid={Boolean(state.fieldErrors.name)}
          aria-describedby={state.fieldErrors.name ? "product-name-error" : undefined}
        />
        <FieldError id="product-name-error" message={state.fieldErrors.name} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-code">Product code</Label>
        <Input
          id="product-code"
          name="productCode"
          defaultValue={product?.productCode ?? ""}
          placeholder="e.g. PC-1023"
          maxLength={40}
          aria-invalid={Boolean(state.fieldErrors.productCode)}
          aria-describedby={
            state.fieldErrors.productCode ? "product-code-error" : "product-code-help"
          }
        />
        <p id="product-code-help" className="text-muted-foreground text-xs">
          How staff identify this product — must be unique.
        </p>
        <FieldError id="product-code-error" message={state.fieldErrors.productCode} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="product-category">Category</Label>
          <Select
            name="categoryId"
            value={categoryId}
            onValueChange={(value) => setCategoryId(String(value ?? ""))}
            items={categoryOptions}
          >
            <SelectTrigger
              id="product-category"
              className="w-full"
              aria-invalid={Boolean(state.fieldErrors.categoryId)}
              aria-describedby={
                state.fieldErrors.categoryId ? "product-category-error" : undefined
              }
            >
              <SelectValue placeholder="Choose a category" />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError
            id="product-category-error"
            message={state.fieldErrors.categoryId}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="product-brand">Brand</Label>
          <Select
            name="brandId"
            value={brandId}
            onValueChange={(value) => setBrandId(String(value ?? NO_BRAND))}
            items={brandOptions}
          >
            <SelectTrigger id="product-brand" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {brandOptions.map((option) => (
                <SelectItem key={option.value || "none"} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-gender">Gender</Label>
        <Select
          name="gender"
          value={gender}
          onValueChange={(value) => setGender(String(value ?? "unisex"))}
          items={GENDER_ITEMS}
        >
          <SelectTrigger id="product-gender" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GENDER_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-shelf-location">Shelf location</Label>
        <Input
          id="product-shelf-location"
          name="shelfLocation"
          defaultValue={product?.shelfLocation ?? ""}
          placeholder="e.g. A12 or Shelf B3"
          maxLength={120}
          aria-invalid={Boolean(state.fieldErrors.shelfLocation)}
          aria-describedby={
            state.fieldErrors.shelfLocation
              ? "product-shelf-location-error"
              : "product-shelf-location-help"
          }
        />
        <p id="product-shelf-location-help" className="text-muted-foreground text-xs">
          Shown to staff when they look up stock in the back office or Android till.
        </p>
        <FieldError
          id="product-shelf-location-error"
          message={state.fieldErrors.shelfLocation}
        />
      </div>

      <ImageField
        defaultValue={product?.imageUrl ?? null}
        error={state.fieldErrors.imageUrl}
      />

      <div className="space-y-2">
        <Label htmlFor="product-description">Description</Label>
        <textarea
          id="product-description"
          name="description"
          rows={3}
          defaultValue={product?.description ?? ""}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3"
        />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="product-active">Active</Label>
          <p className="text-muted-foreground text-xs">
            Inactive products stay on past sales but are hidden from the till.
          </p>
        </div>
        <Switch
          id="product-active"
          name="isActive"
          value="true"
          defaultChecked={product?.isActive ?? true}
        />
      </div>

      <div className="flex justify-end">
        <SaveButton isNew={isNew} />
      </div>
    </form>
  )
}
