import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { ProductForm } from "@/components/products/product-form"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireAdminProfile } from "@/lib/auth/session"
import { getMasterData } from "@/lib/master-data/queries"

export const metadata: Metadata = { title: "New product" }

export default async function NewProductPage() {
  await requireAdminProfile()
  const { categories, brands } = await getMasterData()

  const hasCategories = categories.some((c) => c.is_active)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" render={<Link href="/products" />}>
          <ArrowLeft aria-hidden />
          Products
        </Button>
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">New product</h1>
          <p className="text-muted-foreground text-sm">
            Create the parent product first. You’ll add its size and colour
            variants on the next screen.
          </p>
        </div>
      </div>

      {hasCategories ? (
        <Card>
          <CardContent>
            <ProductForm product={null} categories={categories} brands={brands} />
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">No categories yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Every product needs a category, and there aren’t any active ones. Add
            one in Settings first.
          </p>
          <Button className="mt-4" render={<Link href="/settings" />}>
            Go to settings
          </Button>
        </div>
      )}
    </div>
  )
}
