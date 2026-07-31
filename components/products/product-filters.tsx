"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState, useTransition } from "react"
import { LoaderCircle, Search, X } from "lucide-react"

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
import type { Brand, Category } from "@/lib/master-data/queries"

const ALL = ""

/**
 * Filter state lives in the URL, not in component state, so a filtered view is
 * bookmarkable and survives a refresh — and so the page can stay a server
 * component that simply reads `searchParams`.
 */
export function ProductFilters({
  categories,
  brands,
}: {
  categories: Category[]
  brands: Brand[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [search, setSearch] = useState(searchParams.get("q") ?? "")

  const categoryId = searchParams.get("category") ?? ALL
  const brandId = searchParams.get("brand") ?? ALL
  const showInactive = searchParams.get("inactive") === "1"

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key)
      else next.set(key, value)
    }
    const query = next.toString()
    startTransition(() => router.push(query ? `/products?${query}` : "/products"))
  }

  const categoryOptions = [
    { value: ALL, label: "All categories" },
    ...categories.filter((c) => c.is_active).map((c) => ({
      value: String(c.id),
      label: c.name,
    })),
  ]

  const brandOptions = [
    { value: ALL, label: "All brands" },
    ...brands.filter((b) => b.is_active).map((b) => ({
      value: String(b.id),
      label: b.name,
    })),
  ]

  const hasFilters =
    search !== "" || categoryId !== ALL || brandId !== ALL || showInactive

  return (
    <div className="flex flex-wrap items-end gap-3">
      <form
        className="flex-1 basis-64 space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          apply({ q: search })
        }}
      >
        <Label htmlFor="product-search">Search</Label>
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            id="product-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onBlur={() => search !== (searchParams.get("q") ?? "") && apply({ q: search })}
            placeholder="Product name…"
            className="pl-8"
          />
        </div>
      </form>

      {/* flex + gap rather than space-y-2. The select renders a hidden form
          input beside its trigger, and under space-y-2 that leaves ~8px of dead
          space below the control — enough that the select sits above the search
          box and the button in this row instead of sharing their baseline. */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="filter-category">Category</Label>
        <Select
          value={categoryId}
          onValueChange={(value) => apply({ category: String(value ?? ALL) })}
          items={categoryOptions}
        >
          <SelectTrigger id="filter-category" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categoryOptions.map((option) => (
              <SelectItem key={option.value || "all"} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* flex + gap rather than space-y-2. The select renders a hidden form
          input beside its trigger, and under space-y-2 that leaves ~8px of dead
          space below the control — enough that the select sits above the search
          box and the button in this row instead of sharing their baseline. */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="filter-brand">Brand</Label>
        <Select
          value={brandId}
          onValueChange={(value) => apply({ brand: String(value ?? ALL) })}
          items={brandOptions}
        >
          <SelectTrigger id="filter-brand" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {brandOptions.map((option) => (
              <SelectItem key={option.value || "all"} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        variant={showInactive ? "secondary" : "outline"}
        onClick={() => apply({ inactive: showInactive ? null : "1" })}
      >
        {showInactive ? "Showing inactive" : "Active only"}
      </Button>

      {hasFilters ? (
        <Button
          variant="ghost"
          onClick={() => {
            setSearch("")
            startTransition(() => router.push("/products"))
          }}
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
