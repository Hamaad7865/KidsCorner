import { isSizeType, type SizeType } from "@/lib/db-enums"
import type { Tables } from "@/lib/supabase/database.types"
import { createClient } from "@/lib/supabase/server"

/**
 * Reads for the master data tables. Server-only: every call goes through the
 * cookie-bound Supabase client, so RLS applies as the signed-in user.
 *
 * These four tables are tiny (tens of rows) and are read together by the
 * settings screen, so they are fetched in one parallel batch rather than
 * lazily per tab.
 */

export type Category = Tables<"categories">
export type Brand = Tables<"brands">
export type Colour = Tables<"colours">

/**
 * `sizes.size_type` is a CHECK constraint rather than a Postgres enum, so the
 * generated type widens it to `string`. Narrow it once here so nothing
 * downstream has to re-check.
 */
export type Size = Omit<Tables<"sizes">, "size_type"> & { size_type: SizeType }

export type MasterData = {
  categories: Category[]
  brands: Brand[]
  colours: Colour[]
  sizes: Size[]
}

export async function getMasterData(): Promise<MasterData> {
  const supabase = await createClient()

  const [categories, brands, colours, sizes] = await Promise.all([
    supabase.from("categories").select("*").order("name"),
    supabase.from("brands").select("*").order("name"),
    supabase.from("colours").select("*").order("name"),
    // Matches the seed's intent: age ranges first, then shoe sizes, each in
    // wearing order rather than alphabetically ("EU 9" must not precede "EU 24").
    supabase
      .from("sizes")
      .select("*")
      .order("size_type")
      .order("sort_order")
      .order("label"),
  ])

  const failed = [categories, brands, colours, sizes].find((r) => r.error)
  if (failed?.error) throw failed.error

  return {
    categories: categories.data ?? [],
    brands: brands.data ?? [],
    colours: colours.data ?? [],
    // A row whose size_type somehow fails the CHECK would break the grouped UI,
    // so drop it here rather than render an orphan tab.
    sizes: (sizes.data ?? []).filter((row): row is Size => isSizeType(row.size_type)),
  }
}

/** Category name by id, for rendering the parent column without a join. */
export function categoryNameById(categories: Category[]): Map<number, string> {
  return new Map(categories.map((c) => [c.id, c.name]))
}
