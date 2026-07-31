import type { SupabaseClient } from "@supabase/supabase-js"

import { buildEan13, prefixProblem } from "@/lib/barcodes/ean13"
import type { Database } from "@/lib/supabase/database.types"

/**
 * The shop's barcode scheme, and the allocator that issues codes against it.
 *
 * Deliberately not a `"use server"` module: `allocateBarcodes` is called *from*
 * server actions in products, imports and stock, and a file marked "use server"
 * may only export actions. This is a plain helper those actions reuse.
 */

export type Db = SupabaseClient<Database>

export type BarcodeSettings = {
  /** Whether a blank barcode is filled in automatically on create. */
  auto: boolean
  /** Leading digits that mark a code as this shop's own. */
  prefix: string
  /** The next serial that will be issued — display only; the DB owns the truth. */
  next: number
}

export const BARCODE_DEFAULTS: BarcodeSettings = {
  auto: true,
  prefix: "6291041",
  next: 1,
}

/**
 * Reads the three barcode keys, falling back to the defaults for any that are
 * missing so a shop that has not applied migration 007 still renders rather
 * than throwing on every product page.
 */
export async function getBarcodeSettings(db: Db): Promise<BarcodeSettings> {
  const { data, error } = await db
    .from("settings")
    .select("key, value")
    .in("key", ["barcode_auto", "barcode_prefix", "barcode_next"])

  if (error || !data) return BARCODE_DEFAULTS

  const byKey = new Map(data.map((row) => [row.key, row.value]))

  const prefix = byKey.get("barcode_prefix")
  const next = byKey.get("barcode_next")
  const auto = byKey.get("barcode_auto")

  return {
    auto: typeof auto === "boolean" ? auto : BARCODE_DEFAULTS.auto,
    prefix:
      typeof prefix === "string" && !prefixProblem(prefix)
        ? prefix
        : BARCODE_DEFAULTS.prefix,
    next:
      typeof next === "number" && Number.isInteger(next) && next >= 0
        ? next
        : BARCODE_DEFAULTS.next,
  }
}

/**
 * Reserves `count` serials and returns the codes built from them.
 *
 * Returns an empty array when auto-generation is switched off, which callers
 * read as "leave the barcode blank" — not as a failure.
 *
 * The serials come from `allocate_barcode_serials`, a single atomic UPDATE, so
 * two people adding variants at the same moment cannot be handed the same code.
 * The check digit and assembly happen here rather than in SQL because the same
 * `buildEan13` then backs the live preview in Settings.
 */
export async function allocateBarcodes(
  db: Db,
  count: number,
  settings?: BarcodeSettings,
): Promise<{ codes: string[]; error: string | null }> {
  if (count < 1) return { codes: [], error: null }

  const scheme = settings ?? (await getBarcodeSettings(db))
  if (!scheme.auto) return { codes: [], error: null }

  const { data, error } = await db.rpc("allocate_barcode_serials", {
    p_count: count,
  })

  if (error) {
    // The most likely cause by far is migration 007 not having been run. Say
    // that, rather than surfacing "function does not exist" to a shopkeeper.
    const missing = error.message.includes("allocate_barcode_serials")
    return {
      codes: [],
      error: missing
        ? "Barcode numbering is not set up yet. Run migration 007."
        : error.message,
    }
  }

  const first = typeof data === "number" ? data : null
  if (first === null) {
    return { codes: [], error: "Could not reserve barcode numbers." }
  }

  try {
    return {
      codes: Array.from({ length: count }, (_, i) =>
        buildEan13(scheme.prefix, first + i),
      ),
      error: null,
    }
  } catch (cause) {
    // Serials have outrun the prefix. The numbers are already spent, but no
    // code is issued, which is the safe direction: a duplicate barcode on a
    // shelf is far worse than a gap in the sequence.
    return {
      codes: [],
      error: cause instanceof Error ? cause.message : "Could not build a barcode.",
    }
  }
}
