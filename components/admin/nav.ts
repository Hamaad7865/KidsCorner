import {
  Boxes,
  ChartColumn,
  HandCoins,
  History,
  FileSpreadsheet,
  Factory,
  LayoutDashboard,
  ReceiptText,
  Settings,
  Store,
  Shirt,
  TicketPercent,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react"

import { moduleForPath } from "@/lib/access/modules"

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
      { href: "/promotions", label: "Promotions", icon: TicketPercent },
      { href: "/purchases", label: "Purchases", icon: Truck },
      { href: "/suppliers", label: "Suppliers", icon: Factory },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/point-of-sale", label: "Point of sale", icon: Store },
      { href: "/sales", label: "Sales", icon: ReceiptText },
      { href: "/deposits", label: "Deposits", icon: HandCoins },
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

/**
 * Which module a nav item belongs to.
 *
 * Delegated to `moduleForPath` rather than stripping the leading slash. That
 * shortcut held only while every href happened to equal its module key, and
 * broke silently the moment one did not: `/point-of-sale` became the key
 * "point-of-sale", matched nothing, and the item vanished from every role's
 * nav with no error anywhere.
 */
function moduleOf(href: string): string {
  return moduleForPath(href) ?? href.replace(/^\//, "")
}

