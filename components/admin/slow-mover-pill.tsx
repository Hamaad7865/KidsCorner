import Link from "next/link"
import { TicketPercent } from "lucide-react"

/**
 * Standing count of products that have stopped selling and could go on
 * promotion. Sits in the header beside the low-stock pill.
 *
 * Brand-toned, not amber: a slow mover is an opportunity to act on, not
 * something wrong — amber is reserved for money given up (see the shop's colour
 * rules). Renders nothing at zero; the absence is the good news.
 */
export function SlowMoverPill({ count }: { count: number }) {
  if (count <= 0) return null

  return (
    <Link
      href="/promotions"
      className="bg-brand-50 text-brand-700 border-brand-200 hover:border-brand-400 hidden h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors sm:inline-flex"
    >
      <TicketPercent className="size-3.5" aria-hidden />
      {count} slow {count === 1 ? "mover" : "movers"}
    </Link>
  )
}
