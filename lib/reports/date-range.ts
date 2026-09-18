/**
 * Shop-local calendar maths for the journal's range picker.
 *
 * Everything is a `YYYY-MM-DD` string and every step goes through `Date.UTC`,
 * so no local timezone ever enters the arithmetic — the same trap the journal's
 * "settled earlier" bug came from. Zero-padded fixed-width dates also compare
 * correctly with plain string `<`/`>=`, which the range highlight relies on.
 */

export type Ymd = string

export type DayCell = { iso: Ymd; day: number; inMonth: boolean }

const pad = (n: number) => String(n).padStart(2, "0")

export function ymd(year: number, month0: number, day: number): Ymd {
  return `${year}-${pad(month0 + 1)}-${pad(day)}`
}

export function parseYmd(iso: Ymd): { year: number; month0: number; day: number } {
  const [y, m, d] = iso.split("-").map(Number)
  return { year: y, month0: m - 1, day: d }
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
}

/** Sunday-first 6×7 matrix covering the month, spill days flagged out-of-month. */
export function monthMatrix(year: number, month0: number): DayCell[][] {
  const firstDow = new Date(Date.UTC(year, month0, 1)).getUTCDay()
  const weeks: DayCell[][] = []
  for (let w = 0; w < 6; w++) {
    const row: DayCell[] = []
    for (let d = 0; d < 7; d++) {
      const cur = new Date(Date.UTC(year, month0, 1 - firstDow + w * 7 + d))
      row.push({
        iso: cur.toISOString().slice(0, 10),
        day: cur.getUTCDate(),
        inMonth: cur.getUTCMonth() === month0,
      })
    }
    weeks.push(row)
  }
  return weeks
}

export function addMonths(
  year: number,
  month0: number,
  delta: number,
): { year: number; month0: number } {
  const total = year * 12 + month0 + delta
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 }
}

/**
 * The twelve years the picker's year level shows as one block.
 *
 * Aligned to multiples of twelve from the viewed year, so stepping months or
 * single years never reshuffles the block under the cursor — only crossing a
 * block edge (or the chevrons) moves it.
 */
export const YEAR_BLOCK = 12

export function yearBlock(year: number): { start: number; years: number[] } {
  const start = year - (((year % YEAR_BLOCK) + YEAR_BLOCK) % YEAR_BLOCK)
  return { start, years: Array.from({ length: YEAR_BLOCK }, (_, i) => start + i) }
}

/** d/m/yyyy — Mauritius reads dates day-first. */
export function formatYmd(iso: Ymd): string {
  const { year, month0, day } = parseYmd(iso)
  return `${day}/${month0 + 1}/${year}`
}

export function formatRange(from: Ymd, to: Ymd): string {
  return from === to ? formatYmd(from) : `${formatYmd(from)} – ${formatYmd(to)}`
}

export const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
]

export const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"]

function shift(iso: Ymd, days: number): Ymd {
  const { year, month0, day } = parseYmd(iso)
  return new Date(Date.UTC(year, month0, day + days)).toISOString().slice(0, 10)
}

/** Named quick ranges relative to the shop's "today". */
export function presets(today: Ymd): { label: string; from: Ymd; to: Ymd }[] {
  const t = parseYmd(today)
  const lastMonth = addMonths(t.year, t.month0, -1)
  return [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: shift(today, -1), to: shift(today, -1) },
    { label: "Last 7 days", from: shift(today, -6), to: today },
    { label: "This month", from: ymd(t.year, t.month0, 1), to: today },
    {
      label: "Last month",
      from: ymd(lastMonth.year, lastMonth.month0, 1),
      to: ymd(
        lastMonth.year,
        lastMonth.month0,
        daysInMonth(lastMonth.year, lastMonth.month0),
      ),
    },
    { label: "This year", from: ymd(t.year, 0, 1), to: today },
  ]
}

/** Orders two picks so the earlier is `from`. */
export function orderRange(a: Ymd, b: Ymd): { from: Ymd; to: Ymd } {
  return a <= b ? { from: a, to: b } : { from: b, to: a }
}

export function inRange(iso: Ymd, from: Ymd, to: Ymd): boolean {
  return iso >= from && iso <= to
}
