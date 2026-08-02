import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * One tab in a back-office filter strip.
 *
 * Links rather than buttons, so a filtered list is a URL: the shop can
 * bookmark "purchases still on order", the dashboard can link straight into
 * it, and the back button works the way a back button should.
 *
 * Lifted out of the Stock page when Purchases needed the same strip. Two
 * copies of a tab is how one of them ends up a pixel off and neither gets
 * fixed.
 */
export function TabLink({
  href,
  active,
  icon: Icon,
  count,
  children,
}: {
  href: string
  active: boolean
  /** Optional: Reports and Activity carry eleven and seven tabs respectively,
   *  and a row of icons that long stops distinguishing anything. */
  icon?: React.ComponentType<{ className?: string }>
  /** Shown as a badge when above zero. Zero is left off — a tab that reads
   *  "Cancelled 0" is noise, and its absence says the same thing. */
  count?: number
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-brand-600 text-foreground"
          : "text-muted-foreground hover:text-foreground border-transparent",
      )}
    >
      {Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
      {count !== undefined && count > 0 ? (
        <Badge variant="secondary" className="ml-1">
          {count}
        </Badge>
      ) : null}
    </Link>
  )
}
