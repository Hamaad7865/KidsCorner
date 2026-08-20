"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { BrandLock } from "@/components/brand/logo"
import { visibleSections } from "@/components/admin/nav"
import { cn } from "@/lib/utils"

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Back office sidebar. A fixed column that does not move with the page.
 *
 * `h-full` plus `min-h-0` on the nav is what makes the module list scroll on
 * its own once there are more modules than fit: without the min-height reset a
 * flex child refuses to shrink below its content, so the list would push the
 * column taller instead of scrolling inside it.
 */
export function AppSidebar({ allowed = null }: { allowed?: string[] | null }) {
  const sections = visibleSections(allowed)
  const pathname = usePathname()

  return (
    <aside className="bg-sidebar border-sidebar-border hidden h-full w-60 shrink-0 flex-col border-r lg:flex print:hidden">
      <div className="border-sidebar-border flex h-14 items-center border-b px-4">
        <Link href="/dashboard" className="rounded-md">
          <BrandLock size="sm" />
        </Link>
      </div>

      <nav
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto py-2"
        aria-label="Back office"
      >
        {sections.map((section, index) => (
          <div key={section.label ?? `section-${index}`} className="px-3 py-1">
            {section.label ? (
              <div className="text-muted-foreground px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
                {section.label}
              </div>
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                      )}
                    >
                      <item.icon
                        className={cn(
                          "size-4 shrink-0",
                          active ? "text-brand-600" : "text-muted-foreground",
                        )}
                        aria-hidden
                      />
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}

/**
 * Small-screen fallback: one scrollable strip of every destination. A drawer
 * would be more compact, but the back office is desktop-first and this keeps
 * navigation one tap away with no extra state.
 */
export function MobileNav({ allowed = null }: { allowed?: string[] | null }) {
  const sections = visibleSections(allowed)
  const pathname = usePathname()

  return (
    <nav
      className="bg-sidebar border-sidebar-border overflow-x-auto border-b lg:hidden"
      aria-label="Back office"
    >
      <div className="flex min-w-max gap-1 px-2 py-1.5">
        {sections.flatMap((section) => section.items).map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/80",
              )}
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
