import { cache } from "react"

import { ageLedger, EMPTY_AGING, sumAging, type AgingBuckets } from "@/lib/credit/aging"
import { isPaymentMethod, type PaymentMethod } from "@/lib/db-enums"
import { round2, shopToday } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

/**
 * Reads for the shop's account book.
 *
 * Balances are never selected from a column, because there is no such column:
 * `customer_credit_accounts` derives every figure from `sum(amount)` over the
 * append-only ledger. That is the whole design, and it is why a statement and
 * the aging report can never quietly disagree about what someone owes.
 */

/** Entry types the ledger uses, as words a person reads. */
export const CREDIT_ENTRY_LABELS: Record<string, string> = {
  charge: "Sale on account",
  settlement: "Payment received",
  refund: "Return credited",
  adjustment: "Adjustment",
  writeoff: "Written off",
}

export type CreditAccount = {
  customerId: number
  fullName: string
  phone: string | null
  /** Whether the shop has opened an account for them at all. */
  creditEnabled: boolean
  creditTermsDays: number
  onHold: boolean
  /** Positive: the customer owes the shop. Negative: the shop owes them. */
  balance: number
  oldestDueOn: string | null
  lastActivityAt: string | null
  chargeCount: number
}

export type CreditEntry = {
  id: number
  entryType: string
  /** Signed, as stored: positive increases the debt. */
  amount: number
  method: PaymentMethod | null
  reason: string | null
  dueOn: string | null
  createdAt: string
  saleId: number | null
  saleNo: string | null
  createdByName: string | null
  /** The balance immediately after this entry, oldest-first. */
  runningBalance: number
}

/** How many ledger rows one statement will render. */
export const STATEMENT_LIMIT = 400

/** How many accounts and entries the receivables report will read. */
const RECEIVABLES_ACCOUNT_CAP = 500
const RECEIVABLES_ENTRY_CAP = 5_000

function accountFrom(row: {
  customer_id: number | null
  full_name: string | null
  phone: string | null
  credit_enabled: boolean | null
  credit_terms_days: number | null
  credit_on_hold: boolean | null
  balance: number | null
  oldest_due_on: string | null
  last_activity_at: string | null
  charge_count: number | null
}): CreditAccount {
  return {
    // The view is a LEFT JOIN, so every column is nullable to the type
    // generator even though `customer_id` cannot actually be null in a row that
    // exists. Defaulted rather than asserted so a shape change fails visibly
    // as a zero rather than as a crash on a page the owner opens every morning.
    customerId: row.customer_id ?? 0,
    fullName: row.full_name ?? "Unknown",
    phone: row.phone,
    creditEnabled: row.credit_enabled ?? false,
    creditTermsDays: row.credit_terms_days ?? 30,
    onHold: row.credit_on_hold ?? false,
    balance: round2(Number(row.balance ?? 0)),
    oldestDueOn: row.oldest_due_on,
    lastActivityAt: row.last_activity_at,
    chargeCount: Number(row.charge_count ?? 0),
  }
}

const ACCOUNT_COLUMNS =
  `customer_id, full_name, phone, credit_enabled, credit_terms_days,
   credit_on_hold, balance, oldest_due_on, last_activity_at,
   charge_count`

/**
 * One customer's account, or null when they have neither a limit nor history.
 *
 * Returns a row for a customer with a limit and no activity — that is an open
 * account with nothing on it, which the customer page should show — and null
 * only when there is no account at all, so the page can hide the section.
 */
export const getCreditAccount = cache(
  async (customerId: number): Promise<CreditAccount | null> => {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("customer_credit_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("customer_id", customerId)
      .maybeSingle()

    if (error) throw error
    if (!data) return null

    const account = accountFrom(data)
    // Not enabled and nothing ever charged: not an account, just a customer.
    if (!account.creditEnabled && account.balance === 0 && account.chargeCount === 0) {
      return null
    }
    return account
  },
)

/**
 * One customer's statement, oldest first, with a running balance.
 *
 * Ordered ascending because that is what a statement is: the running balance
 * only means anything read downwards from the start. The page reverses it for
 * display if it wants newest first; the arithmetic has to happen in this order.
 */
export async function getCreditStatement(customerId: number): Promise<CreditEntry[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("customer_credit_entries")
    .select(
      `id, entry_type, amount, method, reason, due_on, created_at, sale_id,
       sales ( sale_no ),
       profiles ( full_name )`,
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(STATEMENT_LIMIT)

  if (error) throw error

  let running = 0
  return (data ?? []).map((row) => {
    const amount = round2(Number(row.amount))
    running = round2(running + amount)
    return {
      id: row.id,
      entryType: row.entry_type,
      amount,
      method: isPaymentMethod(row.method) ? row.method : null,
      reason: row.reason,
      dueOn: row.due_on,
      createdAt: row.created_at,
      saleId: row.sale_id,
      saleNo: row.sales?.sale_no ?? null,
      createdByName: row.profiles?.full_name ?? null,
      runningBalance: running,
    }
  })
}

/** One customer's aging, for the account card on their page. */
export async function getCreditAging(customerId: number): Promise<AgingBuckets> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("customer_credit_entries")
    .select("amount, due_on, created_at")
    .eq("customer_id", customerId)
    .limit(RECEIVABLES_ENTRY_CAP)

  if (error) throw error
  if (!data || data.length === 0) return EMPTY_AGING

  return ageLedger(
    data.map((row) => ({
      amount: round2(Number(row.amount)),
      dueOn: row.due_on,
      createdAt: row.created_at,
    })),
    shopToday(),
  )
}

export type ReceivableRow = CreditAccount & { aging: AgingBuckets }

export type Receivables = {
  asAt: string
  rows: ReceivableRow[]
  totals: AgingBuckets
  /** Total owed across every account. Matches `totals.total`. */
  outstanding: number
  /** Accounts open but with nothing owed, counted rather than listed. */
  settledCount: number
  /** Money the shop is holding on customers' behalf, across all accounts. */
  heldInCredit: number
  truncated: boolean
}

/**
 * Every account with money on it, aged.
 *
 * Two queries rather than a join: the accounts view gives the balances, and the
 * ledger rows are needed in full to age them, because aging is a FIFO run over
 * the entries and cannot be expressed as a per-customer aggregate. Both are
 * capped, and the report says so if either cap is hit — a receivables page that
 * quietly drops the oldest debt is worse than one that admits its limit.
 */
export async function getReceivables(): Promise<Receivables> {
  const supabase = await createClient()
  const asAt = shopToday()

  const { data: accountRows, error: accountError } = await supabase
    .from("customer_credit_accounts")
    .select(ACCOUNT_COLUMNS)
    // An account is interesting if it is open, has been charged, or holds a
    // balance either way. A balance on a closed account exists: an account
    // switched off with money still owed, or a return credited to an
    // account-holder — and it is exactly the row the report must not miss.
    .or("credit_enabled.eq.true,charge_count.gt.0,balance.neq.0")
    .order("balance", { ascending: false })
    .limit(RECEIVABLES_ACCOUNT_CAP + 1)

  if (accountError) throw accountError

  const all = (accountRows ?? []).map(accountFrom)
  const accounts = all.slice(0, RECEIVABLES_ACCOUNT_CAP)
  const owing = accounts.filter((account) => account.balance !== 0)

  if (owing.length === 0) {
    return {
      asAt,
      rows: [],
      totals: EMPTY_AGING,
      outstanding: 0,
      settledCount: accounts.length,
      heldInCredit: 0,
      truncated: all.length > RECEIVABLES_ACCOUNT_CAP,
    }
  }

  const { data: entryRows, error: entryError } = await supabase
    .from("customer_credit_entries")
    .select("customer_id, amount, due_on, created_at")
    .in(
      "customer_id",
      owing.map((account) => account.customerId),
    )
    .limit(RECEIVABLES_ENTRY_CAP + 1)

  if (entryError) throw entryError

  const entries = entryRows ?? []
  const byCustomer = new Map<number, { amount: number; dueOn: string | null; createdAt: string }[]>()
  for (const row of entries.slice(0, RECEIVABLES_ENTRY_CAP)) {
    const list = byCustomer.get(row.customer_id) ?? []
    list.push({
      amount: round2(Number(row.amount)),
      dueOn: row.due_on,
      createdAt: row.created_at,
    })
    byCustomer.set(row.customer_id, list)
  }

  const rows: ReceivableRow[] = owing
    .map((account) => ({
      ...account,
      aging: ageLedger(byCustomer.get(account.customerId) ?? [], asAt),
    }))
    // Oldest trouble first: that is the order the owner wants to make phone
    // calls in, and it is not the same as biggest-balance-first.
    .sort(
      (a, b) =>
        b.aging.days60plus - a.aging.days60plus ||
        b.aging.days31to60 - a.aging.days31to60 ||
        b.aging.total - a.aging.total,
    )

  const totals = sumAging(rows.map((row) => row.aging))

  return {
    asAt,
    rows,
    totals,
    outstanding: totals.total,
    settledCount: accounts.length - owing.length,
    heldInCredit: totals.inCredit,
    truncated:
      all.length > RECEIVABLES_ACCOUNT_CAP || entries.length > RECEIVABLES_ENTRY_CAP,
  }
}
