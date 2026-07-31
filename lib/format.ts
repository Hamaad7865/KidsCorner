/**
 * Money and number formatting for Kids Corner.
 *
 * Currency is MUR, displayed as "Rs". Prices in this shop are VAT-inclusive at
 * 15%, so VAT is always *extracted* from a total rather than added to it.
 *
 * Arithmetic rule (per spec): keep values as plain numbers, but round to 2dp at
 * every boundary — when a line total is computed, when a total is stored, and
 * when anything is displayed. Never let an unrounded float reach the database
 * or the screen.
 */

export const CURRENCY_CODE = "MUR"
export const CURRENCY_SYMBOL = "Rs"

/** Fallback only. The live rate lives in `settings.vat_rate`. */
export const DEFAULT_VAT_RATE = 0.15

/**
 * A fixed locale (not the visitor's) so the server and client always render the
 * same string — a locale-dependent format would cause hydration mismatches.
 */
const NUMBER_FORMAT = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const INTEGER_FORMAT = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 0,
})

/** Round half-away-from-zero to 2dp, correcting binary float drift first. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  const scaled = Number((Math.abs(value) * 100).toPrecision(12))
  const rounded = Math.sign(value) * Math.round(scaled)
  // A negative input that rounds to zero yields -0, which Intl renders as
  // "-0.00" ("Rs -0.00" on screen). Collapse it here. The explicit comparison
  // is required precisely because -0 === 0 is true, so nothing downstream can
  // detect it — the sign only reappears at format time.
  return (rounded === 0 ? 0 : rounded) / 100
}

/** `formatRs(1250.5)` -> `"Rs 1,250.50"` */
export function formatRs(value: number | null | undefined): string {
  return `${CURRENCY_SYMBOL} ${NUMBER_FORMAT.format(round2(value ?? 0))}`
}

/** Amount without the symbol, for table cells that carry their own header. */
export function formatAmount(value: number | null | undefined): string {
  return NUMBER_FORMAT.format(round2(value ?? 0))
}

/** `formatQty(1234)` -> `"1,234"` */
export function formatQty(value: number | null | undefined): string {
  return INTEGER_FORMAT.format(Math.trunc(value ?? 0))
}

/** `"Rs 120.00 – Rs 340.00"`, collapsing to one value when they match. */
export function formatPriceRange(min: number, max: number): string {
  return round2(min) === round2(max)
    ? formatRs(min)
    : `${formatRs(min)} – ${formatRs(max)}`
}

/**
 * VAT contained in a VAT-inclusive total. Mirrors the `complete_sale` RPC:
 * `round(total - total / (1 + vat_rate), 2)`.
 */
export function vatFromInclusive(
  total: number,
  rate: number = DEFAULT_VAT_RATE,
): number {
  return round2(total - total / (1 + rate))
}

/** The pre-VAT portion of a VAT-inclusive total. */
export function netFromInclusive(
  total: number,
  rate: number = DEFAULT_VAT_RATE,
): number {
  return round2(total / (1 + rate))
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return `${(value * 100).toFixed(fractionDigits)}%`
}

/**
 * The shop's timezone, pinned explicitly.
 *
 * `TIMESTAMPTZ` values come back as UTC instants. Without a fixed zone the
 * server would format them in the container's zone (UTC) and the browser in the
 * viewer's, which both causes a hydration mismatch and — for anything logged
 * after 20:00 UTC — shows the wrong calendar day in Mauritius (UTC+4).
 */
export const SHOP_TIME_ZONE = "Indian/Mauritius"

/**
 * Mauritius is a fixed UTC+4 with no daylight saving, so a literal offset is
 * safe here. Used to turn a calendar date the user picked into the correct
 * instant range — filtering on a bare "2026-03-05" would be read as midnight
 * UTC, which is 4am locally, silently dropping the first four hours of the day.
 */
export const SHOP_UTC_OFFSET = "+04:00"

/** Start of that local calendar day, as an instant. */
export function startOfShopDay(isoDate: string): string {
  return `${isoDate}T00:00:00.000${SHOP_UTC_OFFSET}`
}

/** End of that local calendar day, as an instant. */
export function endOfShopDay(isoDate: string): string {
  return `${isoDate}T23:59:59.999${SHOP_UTC_OFFSET}`
}

/**
 * Today's date in the shop's timezone, as `YYYY-MM-DD`.
 *
 * Deliberately not `new Date().toISOString().slice(0,10)` nor anything derived
 * from `getTimezoneOffset()`: a client component renders once on the server
 * (UTC) and again in the browser (the device's zone), so either of those gives
 * two different answers for the same moment and React reports a hydration
 * mismatch. Formatting through a fixed zone gives both sides the same string.
 * `en-CA` is used because it formats as ISO.
 */
const SHOP_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHOP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export function shopToday(): string {
  return SHOP_DAY_FORMAT.format(new Date())
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: SHOP_TIME_ZONE,
})

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: SHOP_TIME_ZONE,
})

/** "Sunday, 26 July 2026" — the dashboard's own subtitle. */
const LONG_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: SHOP_TIME_ZONE,
})

export function formatLongDate(value: string | Date | null | undefined): string {
  if (!value) return ""
  // A bare "2026-07-26" parses as UTC midnight, which in Mauritius is already
  // the 26th — but anchoring at noon keeps it the 26th whichever way a future
  // offset moves, the same guard `recentShopDays` uses.
  const date = typeof value === "string"
    ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value)
    : value
  return Number.isNaN(date.getTime()) ? "" : LONG_DATE_FORMAT.format(date)
}

/**
 * "Good morning" / "Good afternoon" / "Good evening", on the shop's clock.
 *
 * The design greets by time of day. Read from Mauritius rather than the
 * viewer's machine: an owner checking takings from abroad is asking about the
 * shop's day, not their own.
 */
export function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: SHOP_TIME_ZONE,
    }).format(new Date()),
  )
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—"
  const date = typeof value === "string" ? new Date(value) : value
  return Number.isNaN(date.getTime()) ? "—" : DATE_FORMAT.format(date)
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—"
  const date = typeof value === "string" ? new Date(value) : value
  return Number.isNaN(date.getTime()) ? "—" : DATE_TIME_FORMAT.format(date)
}

// Unicode combining diacritical marks, built from escapes so the source file
// stays plain ASCII (a literal range here is easy to mangle in an editor).
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g")

/** Slug used for auto-generated SKUs: `{PRODUCTID}-{SIZE}-{COLOUR}`. */
export function slugifyForSku(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * "PR" from "Priya Ramdin" — the initials in every avatar.
 *
 * First and last, never the middle: "Jean Marie Louis" is JL, which is what a
 * two-letter circle can carry and what a person recognises.
 */
export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""
  return (first + last).toUpperCase()
}
