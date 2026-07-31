import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { PurchaseEditor } from "@/components/purchases/purchase-editor"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireAdminProfile } from "@/lib/auth/session"
import { listSuppliers } from "@/lib/purchases/queries"

export const metadata: Metadata = { title: "New purchase" }

export default async function NewPurchasePage() {
  await requireAdminProfile()
  const suppliers = await listSuppliers()
  const hasSuppliers = suppliers.some((s) => s.is_active)

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" render={<Link href="/purchases" />}>
          <ArrowLeft aria-hidden />
          Purchases
        </Button>
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">New purchase</h1>
          <p className="text-muted-foreground text-sm">
            Saved as a draft. Nothing reaches stock until you receive it.
          </p>
        </div>
      </div>

      {hasSuppliers ? (
        <Card>
          <CardContent>
            <PurchaseEditor purchase={null} suppliers={suppliers} />
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">No suppliers yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            A purchase must be raised against a supplier, and there aren’t any
            active ones.
          </p>
          <Button className="mt-4" render={<Link href="/suppliers" />}>
            Add a supplier
          </Button>
        </div>
      )}
    </div>
  )
}
