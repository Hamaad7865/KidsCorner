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
import { saveColour } from "@/lib/master-data/actions"
import type { Colour } from "@/lib/master-data/queries"

import { ColourSwatch } from "./colour-swatch"
import { FieldError, MasterDataDialog } from "./master-data-dialog"
import { ActiveBadge, MasterDataPanel } from "./master-data-panel"
import { RowActions } from "./row-actions"

export function ColoursPanel({ colours }: { colours: Colour[] }) {
  const [editing, setEditing] = useState<{ row: Colour | null } | null>(null)

  return (
    <>
      <MasterDataPanel
        title="Colours"
        description="The hex code drives every swatch in the app — the variant matrix, the POS picker and the cart."
        count={colours.length}
        addLabel="Add colour"
        onAdd={() => setEditing({ row: null })}
        emptyTitle="No colours yet"
        emptyBody="Colours pair with sizes to make the sellable variants of a product."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Swatch</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-32">Hex</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {colours.map((colour) => (
              <TableRow key={colour.id}>
                <TableCell>
                  <ColourSwatch
                    hex={colour.hex_code}
                    name={colour.name}
                    className="size-6"
                  />
                </TableCell>
                <TableCell className="font-medium">{colour.name}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs uppercase">
                  {colour.hex_code ?? "—"}
                </TableCell>
                <TableCell>
                  <ActiveBadge isActive={colour.is_active} />
                </TableCell>
                <TableCell>
                  <RowActions
                    kind="colours"
                    id={colour.id}
                    name={colour.name}
                    isActive={colour.is_active}
                    onEdit={() => setEditing({ row: colour })}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </MasterDataPanel>

      {editing ? (
        <ColourDialog
          row={editing.row}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  )
}

/**
 * Split out so the colour picker and the hex text field can share local state:
 * the two inputs edit the same value and must stay in step, which needs a
 * controlled value rather than defaultValue.
 */
function ColourDialog({ row, onClose }: { row: Colour | null; onClose: () => void }) {
  const [hex, setHex] = useState(row?.hex_code ?? "")

  // <input type="color"> has no empty state — it falls back to #000000. Show a
  // neutral grey in the picker while the real field is blank, so an untouched
  // picker doesn't imply the colour is black.
  const pickerValue = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#9E9E9E"

  return (
    <MasterDataDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={row ? "Edit colour" : "Add colour"}
      description="Colour names are unique. The hex code is optional but makes swatches far easier to scan."
      action={saveColour}
      submitLabel={row ? "Save changes" : "Add colour"}
      isActive={row?.is_active ?? true}
    >
      {(fieldErrors) => (
        <>
          {row ? <input type="hidden" name="id" value={row.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor="colour-name">Name</Label>
            <Input
              id="colour-name"
              name="name"
              defaultValue={row?.name ?? ""}
              placeholder="e.g. Navy"
              autoFocus
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "colour-name-error" : undefined}
            />
            <FieldError id="colour-name-error" message={fieldErrors.name} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="colour-hex">Hex code</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={pickerValue}
                onChange={(event) => setHex(event.target.value.toUpperCase())}
                className="border-input h-9 w-12 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
                aria-label="Pick a colour"
              />
              <Input
                id="colour-hex"
                name="hexCode"
                value={hex}
                onChange={(event) => setHex(event.target.value)}
                placeholder="#1A237E"
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-mono"
                aria-invalid={Boolean(fieldErrors.hexCode)}
                aria-describedby={fieldErrors.hexCode ? "colour-hex-error" : undefined}
              />
            </div>
            <FieldError id="colour-hex-error" message={fieldErrors.hexCode} />
            <p className="text-muted-foreground text-xs">
              Leave blank if you’d rather not set one.
            </p>
          </div>
        </>
      )}
    </MasterDataDialog>
  )
}
