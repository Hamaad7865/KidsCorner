import Link from "next/link"
import { Bell } from "lucide-react"

/**
 * Standing count of variants at or below their reorder level.
 *
 * Lives in the header rather than only on the dashboard because reordering is
 * the one back-office job that is time-sensitive — a size that ran out on
 * Saturday is lost trade by the time somebody next opens the dashboard.
 *
 * Renders nothing at zero: a permanent "0 low stock" chip is noise, and its
 * absence is the good news.
 */
export function LowStockPill({ count }: { count: number }) {
  if (count <= 0) return null

  return (
    <Link
      href="/stock?tab=low"
      className="bg-warning-muted text-warning-foreground border-warning/30 hover:border-warning/60 hidden h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors sm:inline-flex"
    >
      <Bell className="size-3.5" aria-hidden />
      {count} low stock
    </Link>
  )
}
