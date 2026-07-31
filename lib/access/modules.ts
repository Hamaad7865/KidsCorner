import type { Role } from "@/lib/db-enums"

/**
 * Module keys and the paths they own.
 *
 * Client-safe: the nav needs this, and so does the proxy.
 *
 * IMPORTANT: this is a VISIBILITY layer, not a security boundary. RLS in
 * migration 001 is what actually stops a cashier writing to `products`. Hiding
 * a module removes it from the nav and blocks the route; granting one grants no
 * database permission whatsoever. It can only ever restrict further than the
 * role rules already do — the proxy still applies `isAdminPath` first, so a
 * cashier granted "products" here still cannot reach the back office.
 */

export const MODULES = [
  "dashboard",
  "products",
  "import",
  "stock",
  "purchases",
  "suppliers",
  "sales",
  "reports",
  "activity",
  "customers",
  "settings",
  "pos",
] as const

export type ModuleKey = (typeof MODULES)[number]

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: "Dashboard",
  products: "Products",
  import: "Excel import",
  stock: "Stock",
  purchases: "Purchases",
  suppliers: "Suppliers",
  sales: "Sales",
  reports: "Reports",
  activity: "Activity log",
  customers: "Customers",
  settings: "Settings",
  pos: "Till",
}

/**
 * Longest-prefix first, so `/products/new` resolves to `products` and never to
 * a shorter accidental match.
 */
const PATH_TO_MODULE: { prefix: string; module: ModuleKey }[] = [
  { prefix: "/dashboard", module: "dashboard" },
  { prefix: "/products", module: "products" },
  { prefix: "/import", module: "import" },
  { prefix: "/stock", module: "stock" },
  { prefix: "/purchases", module: "purchases" },
  { prefix: "/suppliers", module: "suppliers" },
  { prefix: "/sales", module: "sales" },
  { prefix: "/reports", module: "reports" },
  { prefix: "/activity", module: "activity" },
  { prefix: "/customers", module: "customers" },
  { prefix: "/settings", module: "settings" },
  { prefix: "/pos", module: "pos" },
]

export function moduleForPath(pathname: string): ModuleKey | null {
  const hit = PATH_TO_MODULE.find(
    (entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`),
  )
  return hit?.module ?? null
}

/**
 * What a role sees when `module_access` has no row for it — the behaviour
 * before this feature existed. Used as a fallback so a missing migration or a
 * deleted row degrades to "as it was", never to "locked out".
 */
export function defaultAccess(role: Role, module: ModuleKey): boolean {
  if (module === "pos") return true
  return role === "owner" || role === "manager"
}
