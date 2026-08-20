import { round2 } from "@/lib/format"

/**
 * How old the money is that a customer owes.
 *
 * Pure, and out here rather than in a query, for the reason `sale-core` and
 * `payments` are: this decides which debts the owner is told to chase, and code
 * that decides money should be testable without a database.
 *
 * ## Why FIFO, and why it has to be computed at all
 *
 * The ledger stores charges and payments, not "which payment settled which
 * charge". Nothing links them, on purpose — a customer hands over Rs 500
 * against a running tab, not against invoice #7 — so the age of what is still
 * owed has to be derived, and the derivation needs a rule.
 *
 * The rule is oldest-first, which is the one every shop already uses out loud:
 * money paid against an account clears the oldest debt first. The alternative,
 * spreading a payment evenly, would make every charge permanently part-paid and
 * report a two-year-old debt as 30% current.
 *
 * The consequence worth knowing: a customer who keeps paying roughly what they
 * spend never shows old debt, even if they have owed *something* continuously
 * for a year. That is correct. The shop's exposure is the balance, and the age
 * of that balance is the age of the money it has not been given.
 */

/** One row of the account ledger, as this module needs it. */
export type LedgerEntry = {
  /** Signed: positive is a charge, negative is anything that reduces the debt. */
  amount: number
  /**
   * When a charge falls due. Null on payments and adjustments, which have no
   * due date of their own, and — defensively — on a charge written before due
   * dates existed, which falls back to the day it was raised.
   */
  dueOn: string | null
  /** ISO instant. Orders the FIFO run. */
  createdAt: string
}

export type AgingBuckets = {
  /** Owed but not yet due. */
  current: number
  /** Overdue by 1–30 days. */
  days1to30: number
  /** Overdue by 31–60 days. */
  days31to60: number
  /** Overdue by more than 60 days. */
  days60plus: number
  /** Everything still owed. Equals the account balance when it is positive. */
  total: number
  /**
   * Money the shop is holding for the customer — a balance below zero, which a
   * return against a settled account legitimately produces.
   *
   * Reported positive, and never mixed into the buckets: it is not a debt of
   * any age, and adding it in would silently reduce the overdue figure.
   */
  inCredit: number
}

export const EMPTY_AGING: AgingBuckets = {
  current: 0,
  days1to30: 0,
  days31to60: 0,
  days60plus: 0,
  total: 0,
  inCredit: 0,
}

/**
 * Whole days between two shop calendar dates, `to - from`.
 *
 * Both are anchored at noon UTC before subtracting. Parsing a bare
 * "2026-08-20" gives midnight UTC, and differencing two midnights is only
 * reliably a whole number of days while no offset is involved — the noon anchor
 * is the same guard `formatLongDate` uses, and it keeps a date one day either
 * side of the boundary from rounding to the wrong day count.
 */
export function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T12:00:00Z`)
  const toMs = Date.parse(`${to}T12:00:00Z`)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0
  return Math.round((toMs - fromMs) / 86_400_000)
}

/**
 * Ages one account's ledger as at `today`.
 *
 * `today` is passed in rather than read from the clock so the report is
 * reproducible and the tests do not have to travel in time.
 */
export function ageLedger(entries: LedgerEntry[], today: string): AgingBuckets {
  // Oldest first: the order the FIFO rule is defined in. Ties broken by
  // nothing in particular, because two charges on the same instant are
  // interchangeable for this purpose.
  const charges = entries
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))

  // Everything that reduces the debt, as one pool: settlements, returns to
  // account, write-offs and negative corrections are all just money the
  // customer no longer owes, and none of them names a charge.
  let pool = round2(
    entries
      .filter((entry) => entry.amount < 0)
      .reduce((sum, entry) => sum + -entry.amount, 0),
  )

  const buckets: AgingBuckets = { ...EMPTY_AGING }

  for (const charge of charges) {
    const applied = Math.min(pool, charge.amount)
    pool = round2(pool - applied)
    const unpaid = round2(charge.amount - applied)
    if (unpaid <= 0) continue

    // A charge with no due date is treated as due the day it was raised. That
    // is the harsher reading, and the right one: a debt whose terms nobody
    // recorded should surface for a decision, not hide in "current".
    const due = charge.dueOn ?? charge.createdAt.slice(0, 10)
    const overdue = daysBetween(due, today)

    if (overdue <= 0) buckets.current = round2(buckets.current + unpaid)
    else if (overdue <= 30) buckets.days1to30 = round2(buckets.days1to30 + unpaid)
    else if (overdue <= 60) buckets.days31to60 = round2(buckets.days31to60 + unpaid)
    else buckets.days60plus = round2(buckets.days60plus + unpaid)

    buckets.total = round2(buckets.total + unpaid)
  }

  // Whatever the pool could not be applied to is money held on the customer's
  // behalf. It only survives here when payments exceed every charge.
  buckets.inCredit = round2(pool)

  return buckets
}

/** Adds up several accounts' buckets, for the report's footer. */
export function sumAging(rows: AgingBuckets[]): AgingBuckets {
  return rows.reduce<AgingBuckets>(
    (acc, row) => ({
      current: round2(acc.current + row.current),
      days1to30: round2(acc.days1to30 + row.days1to30),
      days31to60: round2(acc.days31to60 + row.days31to60),
      days60plus: round2(acc.days60plus + row.days60plus),
      total: round2(acc.total + row.total),
      inCredit: round2(acc.inCredit + row.inCredit),
    }),
    { ...EMPTY_AGING },
  )
}

/** The bucket columns, in the order the report shows them. */
export const AGING_COLUMNS = [
  { key: "current", label: "Current" },
  { key: "days1to30", label: "1–30 days" },
  { key: "days31to60", label: "31–60 days" },
  { key: "days60plus", label: "60+ days" },
] as const satisfies readonly { key: keyof AgingBuckets; label: string }[]
