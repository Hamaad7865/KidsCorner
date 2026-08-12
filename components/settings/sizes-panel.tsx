"use client"

import { Fragment, useState } from "react"

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
import { SIZE_TYPES, SIZE_TYPE_LABELS, type SizeType } from "@/lib/db-enums"
import { saveSize } from "@/lib/master-data/actions"
import type { Size } from "@/lib/master-data/queries"

import { FieldError, MasterDataDialog } from "./master-data-dialog"
import { ActiveBadge, MasterDataPanel } from "./master-data-panel"
import { RowActions } from "./row-actions"

const SIZE_TYPE_ITEMS = SIZE_TYPES.map((value) => ({
  value,
  label: SIZE_TYPE_LABELS[value],
}))

// Keyed by SizeType so a new size_type forces its own hints rather than falling
// back to another type's example.
const LABEL_HINT: Record<SizeType, string> = {
  age_range: "e.g. 2-3 yrs",
  letter_size: "e.g. M",
  shoe_size: "e.g. EU 24",
}

const SORT_HINT: Record<SizeType, string> = {
  age_range: "The seed uses 1–10 for age ranges, smallest first.",
  letter_size: "The seed uses 40–45 for clothing sizes, S to XXXL.",
  shoe_size: "The seed uses 20–29 for shoe sizes.",
}

export function SizesPanel({ sizes }: { sizes: Size[] }) {
  const [editing, setEditing] = useState<{ row: Size | null } | null>(null)

  // Grouped so shoe sizes never interleave with age ranges. `getMasterData`
  // already orders by size_type then sort_order, so each group stays sorted.
  const groups = SIZE_TYPES.map((type) => ({
    type,
    rows: sizes.filter((size) => size.size_type === type),
  })).filter((group) => group.rows.length > 0)

  return (
    <>
      <MasterDataPanel
        title="Sizes"
        description="Sort order controls the column order in the variant matrix — leave gaps so you can slot new sizes in later."
        count={sizes.length}
        addLabel="Add size"
        onAdd={() => setEditing({ row: null })}
        emptyTitle="No sizes yet"
        emptyBody="Migration 001 seeds twenty common sizes. If this is empty, the seed block at the end of that file didn't run."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead className="w-28">Sort</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <Fragment key={group.type}>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell
                    colSpan={4}
                    className="text-muted-foreground py-1.5 text-xs font-medium tracking-wide uppercase"
                  >
                    {SIZE_TYPE_LABELS[group.type]}
                  </TableCell>
                </TableRow>
                {group.rows.map((size) => (
                  <TableRow key={size.id}>
                    <TableCell className="font-medium">{size.label}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {size.sort_order}
                    </TableCell>
                    <TableCell>
                      <ActiveBadge isActive={size.is_active} />
                    </TableCell>
                    <TableCell>
                      <RowActions
                        kind="sizes"
                        id={size.id}
                        name={size.label}
                        isActive={size.is_active}
                        onEdit={() => setEditing({ row: size })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </MasterDataPanel>

      {editing ? (
        <SizeDialog row={editing.row} onClose={() => setEditing(null)} />
      ) : null}
    </>
  )
}

function SizeDialog({ row, onClose }: { row: Size | null; onClose: () => void }) {
  // Controlled so the hint under "Sort order" can react to the chosen type.
  const [sizeType, setSizeType] = useState<SizeType>(row?.size_type ?? "age_range")

  return (
    <MasterDataDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={row ? "Edit size" : "Add size"}
      description="A label is unique within its type, so “EU 24” can exist as a shoe size without clashing with anything in age ranges."
      action={saveSize}
      submitLabel={row ? "Save changes" : "Add size"}
      isActive={row?.is_active ?? true}
    >
      {(fieldErrors) => (
        <>
          {row ? <input type="hidden" name="id" value={row.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor="size-type">Type</Label>
            <Select
              name="sizeType"
              value={sizeType}
              onValueChange={(value) => setSizeType(value as SizeType)}
              items={SIZE_TYPE_ITEMS}
            >
              <SelectTrigger
                id="size-type"
                className="w-full"
                aria-invalid={Boolean(fieldErrors.sizeType)}
                aria-describedby={fieldErrors.sizeType ? "size-type-error" : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZE_TYPE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id="size-type-error" message={fieldErrors.sizeType} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="size-label">Label</Label>
            <Input
              id="size-label"
              name="label"
              defaultValue={row?.label ?? ""}
              placeholder={LABEL_HINT[sizeType]}
              autoFocus
              aria-invalid={Boolean(fieldErrors.label)}
              aria-describedby={fieldErrors.label ? "size-label-error" : undefined}
            />
            <FieldError id="size-label-error" message={fieldErrors.label} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="size-sort">Sort order</Label>
            <Input
              id="size-sort"
              name="sortOrder"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              defaultValue={row?.sort_order ?? 0}
              className="w-32"
              aria-invalid={Boolean(fieldErrors.sortOrder)}
              aria-describedby={fieldErrors.sortOrder ? "size-sort-error" : undefined}
            />
            <FieldError id="size-sort-error" message={fieldErrors.sortOrder} />
            <p className="text-muted-foreground text-xs">
              {SORT_HINT[sizeType]}
            </p>
          </div>
        </>
      )}
    </MasterDataDialog>
  )
}
