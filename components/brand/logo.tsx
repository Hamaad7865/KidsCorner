import Image from "next/image"

import { cn } from "@/lib/utils"

const SIZES = {
  sm: "size-8 rounded-lg",
  md: "size-10 rounded-xl",
  lg: "size-14 rounded-2xl",
} as const

/** Rendered pixel size per variant, so Next can serve the right density. */
const PX = { sm: 32, md: 40, lg: 56 } as const

/**
 * The real brand mark, from kids-corner-brand-assets.
 *
 * Served from /public rather than inlined: the supplied SVG carries embedded
 * raster data and is over 2 MB, which would land in the HTML of every page.
 * `mark.svg` is the 1.8 KB vector favicon — the same artwork, actually
 * lightweight — with the 192px PNG as the raster fallback.
 *
 * No coloured tile behind it any more: the artwork brings its own background,
 * and the old `bg-brand-500` plate would have boxed it in.
 */
export function LogoMark({
  size = "md",
  className,
}: {
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <Image
      src="/brand/mark.svg"
      alt=""
      aria-hidden
      width={PX[size]}
      height={PX[size]}
      // The mark is decorative wherever it appears — every use sits beside the
      // shop name, so announcing it again would just be noise.
      className={cn("shrink-0 object-contain", SIZES[size], className)}
      priority={size === "lg"}
    />
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-semibold tracking-tight", className)}>
      Kids Corner
    </span>
  )
}

export function BrandLock({
  size = "md",
  className,
  subtitle,
}: {
  size?: keyof typeof SIZES
  className?: string
  subtitle?: string
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <LogoMark size={size} />
      <div className="leading-tight">
        <Wordmark className={size === "lg" ? "text-lg" : "text-base"} />
        {subtitle ? (
          <div className="text-muted-foreground text-xs">{subtitle}</div>
        ) : null}
      </div>
    </div>
  )
}
