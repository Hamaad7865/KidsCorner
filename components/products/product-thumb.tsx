import Image from "next/image"

import { cn } from "@/lib/utils"

/**
 * A product's photograph, at whatever size the row it sits in can spare.
 *
 * Falls back to the product's initials rather than to a grey box or a broken
 * image icon. Most of a shop's catalogue will have no photo for a long time,
 * and a list of nineteen identical grey squares is worse than no column at
 * all — the initials at least differ from row to row, so the eye can still use
 * the column to find its place.
 *
 * `unoptimized` because the URL may be anything: our own bucket, or a
 * supplier's image pasted into the field. `next/image` refuses a host it was
 * not configured for, and a field that works for one kind of URL and silently
 * breaks for the other is worse than one that is plain about what it does. The
 * browser shrinks each upload to about 200 KB on the way in, so there is
 * little left for an optimiser to take.
 */
export function ProductThumb({
  src,
  name,
  size = 40,
  className,
}: {
  src: string | null
  name: string
  size?: number
  className?: string
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")

  return (
    <div
      className={cn(
        "bg-muted relative shrink-0 overflow-hidden rounded-md border",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <Image
          src={src}
          // Decorative: the product's name is always beside it, and a screen
          // reader announcing it twice helps nobody.
          alt=""
          fill
          sizes={`${size}px`}
          className="object-cover"
          unoptimized
        />
      ) : (
        <span
          className="text-muted-foreground absolute inset-0 grid place-items-center font-medium"
          style={{ fontSize: Math.max(10, Math.round(size * 0.32)) }}
          aria-hidden
        >
          {initials || "—"}
        </span>
      )}
    </div>
  )
}
