import type { Role } from "@/lib/db-enums"

/**
 * Role policy for the UI layer: owner > manager > cashier.
 *
 * These helpers decide what to *render*. They are not the security boundary —
 * RLS in migration 001 is. Every check here has a matching policy in the
 * database, and the two must agree.
 */

export const ROLE_RANK: Record<Role, number> = {
  owner: 3,
  manager: 2,
  cashier: 1,
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
}

/** Roles allowed into the `(admin)` route group. */
export const ADMIN_ROLES: readonly Role[] = ["owner", "manager"]

export function atLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum]
}

/** Back office access. Mirrors the proxy's `(admin)` rule. */
export function isAdminRole(role: Role): boolean {
  return ADMIN_ROLES.includes(role)
}

/** Cost price and margin are owner/manager only (spec: Design system). */
export function canSeeCostPrice(role: Role): boolean {
  return atLeast(role, "manager")
}

/** RLS: `manage ON settings ... current_role_of_user() = 'owner'`. */
export function canManageSettings(role: Role): boolean {
  return role === "owner"
}

/** RLS: `manage_profiles ON profiles ... current_role_of_user() = 'owner'`. */
export function canManageUsers(role: Role): boolean {
  return role === "owner"
}

/** RLS: `manage ON products/product_variants/... IN ('owner','manager')`. */
export function canManageCatalog(role: Role): boolean {
  return atLeast(role, "manager")
}
