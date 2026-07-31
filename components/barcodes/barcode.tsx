import {
  EAN13_MODULES,
  ean13Bars,
  ean13HumanGroups,
  isValidEan13,
} from "@/lib/barcodes/ean13"

/**
 * An EAN-13 symbol drawn as SVG.
 *
 * Vector rather than a raster or a barcode font: this ends up on a thermal
 * label printed at whatever DPI the shop owns, and a scanner is unforgiving
 * about blurred module edges. SVG rasterises crisply at any size, and it
 * prints from the browser with no font to install.
 *
 * No "use client" — it renders identically on the server and never handles an
 * event, so it can sit inside a server component page.
 */

/** Standard quiet zones, in modules. Scanners need them; they are not padding. */
const QUIET_LEFT = 11
const QUIET_RIGHT = 7
const TOTAL_MODULES = QUIET_LEFT + EAN13_MODULES + QUIET_RIGHT

/** Module spans of the three guard patterns, which print taller than the rest. */
const GUARDS: Array<[number, number]> = [
  [0, 3],
  [45, 50],
  [92, 95],
]

/** How far guard bars drop past the data bars, so digits sit between them. */
const GUARD_OVERHANG = 5

function isGuardBar(x: number, width: number): boolean {
  return GUARDS.some(([from, to]) => x >= from && x + width <= to)
}

export function Barcode({
  code,
  height = 44,
  showDigits = true,
  className,
}: {
  code: string
  /** Bar height in SVG units, where one module is one unit. */
  height?: number
  showDigits?: boolean
  className?: string
}) {
  // A malformed code must not render as a plausible-looking symbol — somebody
  // would print a sheet of them. Say so instead.
  if (!isValidEan13(code)) {
    return (
      <span className="text-destructive font-mono text-[10px]">
        {code ? `Invalid barcode: ${code}` : "No barcode"}
      </span>
    )
  }

  const bars = ean13Bars(code)
  const [first, left, right] = ean13HumanGroups(code)

  const digitY = height + GUARD_OVERHANG + 8
  const totalHeight = showDigits ? digitY + 2 : height + GUARD_OVERHANG

  return (
    <svg
      className={className}
      viewBox={`0 0 ${TOTAL_MODULES} ${totalHeight}`}
      // Explicit white: labels print on white stock, and a transparent symbol
      // over a tinted card is exactly the low-contrast case scanners fail on.
      style={{ background: "#fff" }}
      role="img"
      aria-label={`Barcode ${code}`}
      shapeRendering="crispEdges"
    >
      {bars.map((bar) => (
        <rect
          key={bar.x}
          x={QUIET_LEFT + bar.x}
          y={0}
          width={bar.width}
          height={isGuardBar(bar.x, bar.width) ? height + GUARD_OVERHANG : height}
          fill="#000"
        />
      ))}

      {showDigits ? (
        <g fill="#000" fontFamily="monospace" fontSize={9} letterSpacing={0.6}>
          {/* The first digit sits in the left quiet zone, outside the bars. */}
          <text x={0} y={digitY}>
            {first}
          </text>
          <text x={QUIET_LEFT + 4} y={digitY}>
            {left}
          </text>
          <text x={QUIET_LEFT + 50} y={digitY}>
            {right}
          </text>
        </g>
      ) : null}
    </svg>
  )
}
