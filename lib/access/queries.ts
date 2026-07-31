import { cache } from "react"

import { isRole, type Role } from "@/lib/db-enums"
import { createClient } from "@/lib/supabase/server"

import { MODULES, defaultAccess, type ModuleKey } from "./modules"

/**
 * Module visibility, read from `module_access`.
 *
 * Every read falls back to `defaultAccess` when a row is missing or the table
 * does not exist yet. That matters: this migration might not be applied, and a
 * back office that locks the owner out because a query returned nothing would
 * be far worse than one that behaves as it did before.
 */

export type AccessMap = Record<ModuleKey, boolean>

function fallbackFor(role: Role): AccessMap {
  return Object.fromEntries(
    MODULES.map((module) => [module, defaultAccess(role, module)]),
  ) as AccessMap
}

/** `cache()` so the nav and the proxy-adjacent checks share one query. */
export const getAccessMap = cache(async (role: Role): Promise<AccessMap> => {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("module_access")
    .select("module, can_view")
    .eq("role", role)

  // Missing table (migration not applied) or any read failure: behave as before.
  if (error || !data || data.length === 0) return fallbackFor(role)

  const map = fallbackFor(role)
  for (const row of data) {
    if ((MODULES as readonly string[]).includes(row.module)) {
      map[row.module as ModuleKey] = row.can_view
    }
  }
  // The till is never hideable — the database trigger enforces it too, but a
  // stale row must not be able to strand somebody with nothing to open.
  map.pos = true
  return map
})

export type StockLocationRow = {
  id: number
  name: string
  isDefault: boolean
  isActive: boolean
}

/** Locations, default first then alphabetical. */
export async function listLocations(): Promise<StockLocationRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("stock_locations")
    .select("id, name, is_default, is_active")
    .order("is_default", { ascending: false })
    .order("name")
    .limit(200)

  // Migration 006 may not be applied yet; an empty list is better than a crash.
  if (error || !data) return []

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    isDefault: row.is_default,
    isActive: row.is_active,
  }))
}

/** The whole grid, for the settings screen. */
export async function getAccessGrid(): Promise<Record<Role, AccessMap>> {
  const supabase = await createClient()
  const roles: Role[] = ["owner", "manager", "cashier"]

  const grid = Object.fromEntries(roles.map((r) => [r, fallbackFor(r)])) as Record<
    Role,
    AccessMap
  >

  const { data, error } = await supabase
    .from("module_access")
    .select("role, module, can_view")

  if (error || !data) return grid

  for (const row of data) {
    if (!isRole(row.role)) continue
    if (!(MODULES as readonly string[]).includes(row.module)) continue
    grid[row.role][row.module as ModuleKey] = row.can_view
  }
  for (const role of roles) grid[role].pos = true
  return grid
}
