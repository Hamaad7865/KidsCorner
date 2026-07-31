"use client"

import { useState } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { saveBrand } from "@/lib/master-data/actions"
import type { Brand } from "@/lib/master-data/queries"

import { FieldError, MasterDataDialog } from "./master-data-dialog"
import { ActiveBadge, MasterDataPanel } from "./master-data-panel"
import { RowActions } from "./row-actions"

export function BrandsPanel({ brands }: { brands: Brand[] }) {
  // null = closed. { row: null } = creating. { row } = editing that row.
  const [editing, setEditing] = useState<{ row: Brand | null } | null>(null)

  return (
    <>
      <MasterDataPanel
        title="Brands"
        description="Optional on a product — plenty of stock is unbranded."
        count={brands.length}
        addLabel="Add brand"
        onAdd={() => setEditing({ row: null })}
        emptyTitle="No brands yet"
        emptyBody="Add the labels you stock. You can also create them on the fly while importing a spreadsheet."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.map((brand) => (
              <TableRow key={brand.id}>
                <TableCell className="font-medium">{brand.name}</TableCell>
                <TableCell>
                  <ActiveBadge isActive={brand.is_active} />
                </TableCell>
                <TableCell>
                  <RowActions
                    kind="brands"
                    id={brand.id}
                    name={brand.name}
                    isActive={brand.is_active}
                    onEdit={() => setEditing({ row: brand })}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </MasterDataPanel>

      {editing ? (
        <MasterDataDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          title={editing.row ? "Edit brand" : "Add brand"}
          description="Brand names are unique across the shop."
          action={saveBrand}
          submitLabel={editing.row ? "Save changes" : "Add brand"}
          isActive={editing.row?.is_active ?? true}
        >
          {(fieldErrors) => (
            <>
              {editing.row ? (
                <input type="hidden" name="id" value={editing.row.id} />
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="brand-name">Name</Label>
                <Input
                  id="brand-name"
                  name="name"
                  defaultValue={editing.row?.name ?? ""}
                  placeholder="e.g. Zara Kids"
                  autoFocus
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? "brand-name-error" : undefined}
                />
                <FieldError id="brand-name-error" message={fieldErrors.name} />
              </div>
            </>
          )}
        </MasterDataDialog>
      ) : null}
    </>
  )
}
