"use client"

import { useState } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { saveCategory } from "@/lib/master-data/actions"
import type { Category } from "@/lib/master-data/queries"

import { FieldError, MasterDataDialog } from "./master-data-dialog"
import { ActiveBadge, MasterDataPanel } from "./master-data-panel"
import { RowActions } from "./row-actions"

const TOP_LEVEL = ""

/**
 * Every category beneath `rootId`, so the parent picker can exclude them.
 * `categories.parent_id` is self-referencing and the database does not reject
 * cycles — making a category the child of its own descendant would orphan a
 * whole branch from any tree walk.
 */
function descendantIds(categories: Category[], rootId: number): Set<number> {
  const found = new Set<number>()
  const queue = [rootId]

  while (queue.length > 0) {
    const current = queue.pop()
    for (const category of categories) {
      if (category.parent_id === current && !found.has(category.id)) {
        found.add(category.id)
        queue.push(category.id)
      }
    }
  }
  return found
}

export function CategoriesPanel({ categories }: { categories: Category[] }) {
  const [editing, setEditing] = useState<{ row: Category | null } | null>(null)
  const nameById = new Map(categories.map((c) => [c.id, c.name]))

  return (
    <>
      <MasterDataPanel
        title="Categories"
        description="Every product needs one. Nest them if it helps — “Shoes → Sandals”, for instance."
        count={categories.length}
        addLabel="Add category"
        onAdd={() => setEditing({ row: null })}
        emptyTitle="No categories yet"
        emptyBody="A product can't be created without a category, so this is the first thing to fill in."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-40">Parent</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((category) => (
              <TableRow key={category.id}>
                <TableCell className="font-medium">{category.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {category.parent_id === null
                    ? "—"
                    : (nameById.get(category.parent_id) ?? "—")}
                </TableCell>
                <TableCell>
                  <ActiveBadge isActive={category.is_active} />
                </TableCell>
                <TableCell>
                  <RowActions
                    kind="categories"
                    id={category.id}
                    name={category.name}
                    isActive={category.is_active}
                    onEdit={() => setEditing({ row: category })}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </MasterDataPanel>

      {editing ? (
        <CategoryDialog
          row={editing.row}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  )
}

function CategoryDialog({
  row,
  categories,
  onClose,
}: {
  row: Category | null
  categories: Category[]
  onClose: () => void
}) {
  const [parentId, setParentId] = useState<string>(
    row?.parent_id != null ? String(row.parent_id) : TOP_LEVEL,
  )

  // A category may not parent itself, nor any of its own descendants.
  const blocked = row ? descendantIds(categories, row.id) : new Set<number>()
  const options = [
    { value: TOP_LEVEL, label: "Top level" },
    ...categories
      .filter((c) => c.id !== row?.id && !blocked.has(c.id))
      .map((c) => ({ value: String(c.id), label: c.name })),
  ]

  return (
    <MasterDataDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={row ? "Edit category" : "Add category"}
      description="Category names are unique across the shop."
      action={saveCategory}
      submitLabel={row ? "Save changes" : "Add category"}
      isActive={row?.is_active ?? true}
    >
      {(fieldErrors) => (
        <>
          {row ? <input type="hidden" name="id" value={row.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              name="name"
              defaultValue={row?.name ?? ""}
              placeholder="e.g. Dresses"
              autoFocus
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "category-name-error" : undefined}
            />
            <FieldError id="category-name-error" message={fieldErrors.name} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category-parent">Parent</Label>
            <Select
              name="parentId"
              value={parentId}
              onValueChange={(value) => setParentId(String(value ?? TOP_LEVEL))}
              items={options}
            >
              <SelectTrigger
                id="category-parent"
                className="w-full"
                aria-invalid={Boolean(fieldErrors.parentId)}
                aria-describedby={
                  fieldErrors.parentId ? "category-parent-error" : undefined
                }
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value || "top"} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id="category-parent-error" message={fieldErrors.parentId} />
            {row && blocked.size > 0 ? (
              <p className="text-muted-foreground text-xs">
                {blocked.size === 1 ? "One category sits" : `${blocked.size} categories sit`}{" "}
                below this one and can’t be its parent.
              </p>
            ) : null}
          </div>
        </>
      )}
    </MasterDataDialog>
  )
}
