import { cn } from "@/lib/utils"

/**
 * A colour chip. The spec asks for swatches wherever colours appear, so this
 * is shared rather than local to settings — products, the variant matrix and
 * the POS cart all reuse it.
 *
 * `hex_code` is nullable in migration 001, so a missing colour renders as a
 * dashed outline instead of a misleading solid block.
 */
export function ColourSwatch({
  hex,
  name,
  className,
}: {
  hex: string | null
  name?: string
  className?: string
}) {
  const label = name ? `${name}${hex ? ` (${hex})` : " (no colour set)"}` : undefined

  if (!hex) {
    return (
      <span
        className={cn(
          "border-muted-foreground/40 inline-block size-4 shrink-0 rounded-full border border-dashed",
          className,
        )}
        title={label}
        role={label ? "img" : undefined}
        aria-label={label}
      />
    )
  }

  return (
    <span
      className={cn(
        // A ring rather than a border: white and near-white swatches would
        // otherwise vanish against the card.
        "ring-foreground/15 inline-block size-4 shrink-0 rounded-full ring-1 ring-inset",
        className,
      )}
      style={{ backgroundColor: hex }}
      title={label}
      role={label ? "img" : undefined}
      aria-label={label}
    />
  )
}
