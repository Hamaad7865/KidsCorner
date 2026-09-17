/**
 * The most labels the picker will print for a single variant. High enough to
 * label a full warehouse delivery, low enough that one fat-fingered count cannot
 * spool the whole roll. Shared so the sheet, the picker table and the batch
 * action all clamp to the same number.
 */
export const MAX_COPIES_PER_VARIANT = 99

/**
 * The most labels one run prints before the sheet trims the rest. Shared so the
 * picker can warn that a big selection will be cut rather than letting the sheet
 * silently drop the tail mid-roll.
 */
export const MAX_LABELS_PER_RUN = 240

/**
 * The `copies` param that the print-labels picker hands to the label sheet.
 *
 * Encoded as `variantId:count` pairs joined by commas — `12:5,13:3` prints five
 * of variant 12 and three of variant 13. It lets one screen (the picker) choose
 * exactly how many of each variant to print and the other (the label route)
 * stay a dumb renderer, with a URL as the only thing between them.
 */

/**
 * Parse `12:5,13:3` into a variantId → count map.
 *
 * A malformed pair drops that pair rather than the whole string: one
 * fat-fingered entry must not silently blank an entire print run. A count of
 * zero or less is dropped too — "print none of this variant" is the same as
 * leaving it out, and keeping it would only invite a zero-length loop
 * downstream.
 */
export function parseCopies(value: string | undefined): Map<number, number> {
  const out = new Map<number, number>()
  if (!value) return out

  for (const part of value.split(",")) {
    const [rawId, rawCount] = part.split(":")
    const id = Number(rawId?.trim())
    const count = Number(rawCount?.trim())
    if (!Number.isInteger(id) || id <= 0) continue
    if (!Number.isInteger(count) || count <= 0) continue
    out.set(id, count)
  }

  return out
}

/**
 * Build the `copies` param from a map, the inverse of {@link parseCopies}.
 *
 * Non-positive counts are dropped here as well, so a variant a cashier zeroed
 * out in the picker never reaches the URL — the two ends agree on what "none"
 * means without the label route having to re-check.
 */
export function buildCopies(counts: Map<number, number>): string {
  return [...counts.entries()]
    .filter(
      ([id, count]) =>
        Number.isInteger(id) && id > 0 && Number.isInteger(count) && count > 0,
    )
    .map(([id, count]) => `${id}:${count}`)
    .join(",")
}
