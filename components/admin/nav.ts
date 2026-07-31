import {
  Boxes,
  ChartColumn,
  History,
  FileSpreadsheet,
  Factory,
  LayoutDashboard,
  ReceiptText,
  Settings,
  Shirt,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
}

export type NavSection = {
  label?: string
  items: NavItem[]
}

/** Back office navigation, following the spec's route structure. */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Catalogue",
    items: [
      { href: "/products", label: "Products", icon: Shirt },
      { href: "/import", label: "Excel import", icon: FileSpreadsheet },
    ],
  },
  {
    label: "Inventory",
    items: [
      { href: "/stock", label: "Stock", icon: Boxes },
      { href: "/purchases", label: "Purchases", icon: Truck },
      { href: "/suppliers", label: "Suppliers", icon: Factory },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/sales", label: "Sales", icon: ReceiptText },
      { href: "/reports", label: "Reports", icon: ChartColumn },
      { href: "/activity", label: "Activity", icon: History },
      { href: "/customers", label: "Customers", icon: Users },
    ],
  },
  {
    label: "Shop",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
]

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items)

/**
 * Sections with hidden modules removed, and any section left empty dropped so
 * no stray heading is rendered over nothing.
 *
 * `allowed` is null when module access is unknown (the migration may not be
 * applied), in which case everything shows — the behaviour before the feature.
 */
export function visibleSections(allowed: string[] | null): NavSection[] {
  if (allowed === null) return NAV_SECTIONS
  const set = new Set(allowed)
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => set.has(moduleOf(item.href))),
  })).filter((section) => section.items.length > 0)
}

/** `/products` -> `products`, matching the module keys in lib/access. */
function moduleOf(href: string): string {
  return href.replace(/^\//, "")
}

