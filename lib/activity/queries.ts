import type { SupabaseClient } from "@supabase/supabase-js"

import { endOfShopDay, formatRs, startOfShopDay } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

/**
 * The activity feed.
 *
 * Built by READING the records the shop already keeps — a sale is a sale row, a
 * stock adjustment is a stock_movement, a close is a z_report — rather than by
 * duplicating them into a log. A log that can disagree with the thing it
 * describes is worse than no log, and this way an event cannot exist without
 * the record it reports on.
 *
 * `audit_events` (migration 016) fills only the gaps: a price change, a PIN, a
 * settings edit — actions that otherwise leave no trace anywhere.
 */

export type ActivityTone =
  | "sale"
  | "money"
  | "stock"
  | "cash"
  | "admin"
  | "warn"
  | "neutral"

export type ActivityCategory =
  | "sales"
  | "cash"
  | "stock"
  | "catalogue"
  | "admin"

export type ActivityEvent = {
  id: string
  at: string
  actorName: string
  category: ActivityCategory
  title: string
  detail: string
  amount: number | null
  href: string | null
  tone: ActivityTone
}

export const ACTIVITY_CATEGORIES: { key: ActivityCategory; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "cash", label: "Cash-up" },
  { key: "stock", label: "Stock" },
  { key: "catalogue", label: "Prices" },
  { key: "admin", label: "Staff & settings" },
]

/**
 * Per-source cap, then a cap on the merged feed.
 *
 * Without the per-source cap a busy day of sales would crowd out every price
 * change and settings edit — which are rarer and are exactly what somebody
 * opens this page to find.
 */
const PER_SOURCE = 200
const CAP = 300

export type ActivityFilters = {
  from?: string
  to?: string
  category?: string
}

export type ActivityData = { events: ActivityEvent[]; capped: boolean }

export async function getActivity(filters: ActivityFilters): Promise<ActivityData> {
  const supabase = (await createClient()) as unknown as SupabaseClient

  const from = filters.from ? startOfShopDay(filters.from) : undefined
  const to = filters.to ? endOfShopDay(filters.to) : undefined

  /**
   * Applies the date window to a query builder.
   *
   * Typed loosely on purpose. PostgREST builders are generic over the table and
   * the selected columns, and six differently-shaped queries cannot share one
   * signature without naming all six — which would be more type machinery than
   * the six `as unknown as` casts below it replaces. The shapes are asserted
   * where the rows are read instead, which is where a wrong column actually
   * bites.
   */
  type Result = PromiseLike<{ data: unknown }>

  const range = (column: string, query: unknown): Result => {
    let q = query as {
      gte: (c: string, v: string) => typeof q
      lte: (c: string, v: string) => typeof q
    }
    if (from) q = q.gte(column, from)
    if (to) q = q.lte(column, to)
    return q as unknown as Result
  }

  const [sales, movements, tills, shifts, closes, audits, prints, credits] = await Promise.all([
    range(
      "sale_date",
      supabase
        .from("sales")
        .select("id, sale_no, total, sale_date, status, profiles ( full_name )")
        .order("sale_date", { ascending: false })
        .limit(PER_SOURCE),
    ),
    range(
      "created_at",
      supabase
        .from("stock_movements")
        .select(
          "id, qty, movement_type, notes, created_at, profiles ( full_name )," +
            " product_variants ( sku, products ( name ) )",
        )
        .order("created_at", { ascending: false })
        .limit(PER_SOURCE),
    ),
    range(
      "created_at",
      supabase
        .from("till_movements")
        .select("id, amount, reason, created_at, profiles ( full_name )")
        .order("created_at", { ascending: false })
        .limit(PER_SOURCE),
    ),
    // Twice, on two different columns.
    //
    // A shift is two events at two moments, and this feed is filtered by
    // instant. Ranging the one query on `opened_at` meant a shift opened
    // yesterday and cashed up this morning fell outside today's window
    // entirely — so today's "Till closed, short by Rs X", the warning this
    // page exists to surface, never appeared; while a shift opened at 23:50
    // put its closing event on tomorrow into today's view.
    range(
      "opened_at",
      supabase
        .from("shifts")
        .select(
          "id, opened_at, closed_at, variance, opening_float," +
            " opener:profiles!shifts_opened_by_fkey ( full_name )," +
            " closer:profiles!shifts_closed_by_fkey ( full_name )",
        )
        .order("opened_at", { ascending: false })
        .limit(PER_SOURCE),
    ),
    range(
      "closed_at",
      supabase
        .from("shifts")
        .select(
          "id, opened_at, closed_at, variance, opening_float," +
            " opener:profiles!shifts_opened_by_fkey ( full_name )," +
            " closer:profiles!shifts_closed_by_fkey ( full_name )",
        )
        .not("closed_at", "is", null)
        .order("closed_at", { ascending: false })
        .limit(PER_SOURCE),
    ),
    range(
      "at",
      supabase
        .from("audit_events")
        .select("id, at, event_type, ref_type, ref_id, summary, profiles ( full_name )")
        .order("at", { ascending: false })
        .limit(PER_SOURCE),
    ),
    range(
      "printed_at",
      supabase
        .from("receipt_prints")
        .select("id, printed_at, sale_id, profiles ( full_name )")
        .order("printed_at", { ascending: false })
        .limit(PER_SOURCE),
    ),
    // Attributed through `cashier_id` — the PIN-selected cashier who processed
    // the refund, not the shared device account they were signed in under. That
    // is the person accountable for money going back across the counter.
    range(
      "created_at",
      supabase
        .from("credit_notes")
        .select(
          "id, credit_no, total, reason, refund_method, created_at, sale_id," +
            " profiles ( full_name )",
        )
        .order("created_at", { ascending: false })
        .limit(PER_SOURCE),
    ),
  ])

  const events: ActivityEvent[] = []
  const who = (row: { profiles?: { full_name?: string } | null }) =>
    row.profiles?.full_name ?? "—"

  type Row = Record<string, never>
  const rows = (result: { data?: unknown }): Record<string, never>[] =>
    Array.isArray(result?.data) ? (result.data as Row[]) : []

  for (const s of rows(sales)) {
    const sale = s as unknown as {
      id: number
      sale_no: string
      total: number
      sale_date: string
      status: string
      profiles?: { full_name?: string } | null
    }
    const voided = sale.status !== "completed"
    events.push({
      id: `sale-${sale.id}`,
      at: sale.sale_date,
      actorName: who(sale),
      category: "sales",
      title: voided ? `Sale ${sale.status}` : "Sale",
      detail: sale.sale_no,
      amount: Number(sale.total),
      href: `/sales/${sale.id}`,
      tone: voided ? "warn" : "sale",
    })
  }

  for (const m of rows(movements)) {
    const mv = m as unknown as {
      id: number
      qty: number
      movement_type: string
      notes: string | null
      created_at: string
      profiles?: { full_name?: string } | null
      product_variants?: { sku?: string; products?: { name?: string } | null } | null
    }
    // A stock-out from a sale is already reported as the sale. Repeating it
    // once per line would drown everything else.
    if (mv.movement_type === "sale") continue

    const name = mv.product_variants?.products?.name ?? "an item"
    const sku = mv.product_variants?.sku
    events.push({
      id: `mv-${mv.id}`,
      at: mv.created_at,
      actorName: who(mv),
      category: "stock",
      title: `Stock ${mv.movement_type}`,
      detail: `${mv.qty > 0 ? "+" : ""}${mv.qty} · ${name}${sku ? ` (${sku})` : ""}${
        mv.notes ? ` — ${mv.notes}` : ""
      }`,
      amount: null,
      href: null,
      tone: "stock",
    })
  }

  for (const t of rows(tills)) {
    const tm = t as unknown as {
      id: number
      amount: number
      reason: string
      created_at: string
      profiles?: { full_name?: string } | null
    }
    const paidIn = Number(tm.amount) > 0
    events.push({
      id: `till-${tm.id}`,
      at: tm.created_at,
      actorName: who(tm),
      category: "cash",
      title: paidIn ? "Cash paid in" : "Cash taken out",
      detail: tm.reason,
      amount: Math.abs(Number(tm.amount)),
      href: null,
      tone: "cash",
    })
  }

  for (const s of rows(shifts)) {
    const shift = s as unknown as {
      id: number
      opened_at: string
      closed_at: string | null
      variance: number | null
      opening_float: number
      opener?: { full_name?: string } | null
      closer?: { full_name?: string } | null
    }
    events.push({
      id: `shift-open-${shift.id}`,
      at: shift.opened_at,
      actorName: shift.opener?.full_name ?? "—",
      category: "cash",
      title: "Till opened",
      detail: `Float ${formatRs(Number(shift.opening_float))}`,
      amount: null,
      href: null,
      tone: "cash",
    })

  }

  // Closings come from their own query, ranged on `closed_at`, so a shift that
  // spans midnight lands each end on the day it actually happened.
  for (const row of rows(closes)) {
    const shift = row as unknown as {
      id: number
      closed_at: string | null
      variance: number | null
      closer?: { full_name?: string } | null
    }
    if (!shift.closed_at) continue

    // Null variance means the drawer was never counted, which is not the same
    // as counting it and finding it right. Coercing it to zero reported every
    // uncounted shift as "Balanced" in the shop's own activity log.
    const counted = shift.variance !== null
    const variance = Number(shift.variance ?? 0)

    events.push({
      id: `shift-close-${shift.id}`,
      at: shift.closed_at,
      actorName: shift.closer?.full_name ?? "—",
      category: "cash",
      title: "Till closed",
      detail: !counted
        ? "Closed without a count"
        : variance === 0
          ? "Balanced"
          : `${variance > 0 ? "Over" : "Short"} by ${formatRs(Math.abs(variance))}`,
      amount: null,
      href: `/reports?report=shifts`,
      // A drawer that did not balance is the thing on this page most worth
      // noticing, so it is toned as a warning rather than as routine cash —
      // and one that was never counted is worth noticing just as much.
      tone: counted && variance === 0 ? "cash" : "warn",
    })
  }

  for (const a of rows(audits)) {
    const audit = a as unknown as {
      id: number
      at: string
      event_type: string
      summary: string
      profiles?: { full_name?: string } | null
    }
    const isPrice = audit.event_type.startsWith("price.") || audit.event_type.startsWith("cost.")
    // A discount approved at the till is money given away, so it reads as money
    // rather than as one more administrative note.
    const isMoney = isPrice || audit.event_type === "discount_approved"
    events.push({
      id: `audit-${audit.id}`,
      at: audit.at,
      // NULL actor means the change did not come through the app — a migration
      // or somebody in the SQL editor. Said plainly rather than blanked.
      actorName: audit.profiles?.full_name ?? "not via the app",
      category: isPrice ? "catalogue" : "admin",
      title: TITLES[audit.event_type] ?? audit.event_type,
      detail: audit.summary,
      amount: null,
      href: null,
      tone: audit.event_type.startsWith("sale.") ? "warn" : isMoney ? "money" : "admin",
    })
  }

  for (const c of rows(credits)) {
    const note = c as unknown as {
      id: number
      credit_no: string
      total: number
      reason: string
      refund_method: string
      created_at: string
      sale_id: number
      profiles?: { full_name?: string } | null
    }
    events.push({
      id: `credit-${note.id}`,
      at: note.created_at,
      actorName: who(note),
      category: "sales",
      title: "Refund",
      detail: `${note.credit_no} · ${note.reason}`,
      amount: Number(note.total),
      href: `/sales/${note.sale_id}`,
      // Money going back across the counter is worth noticing, so it is toned
      // as a warning rather than as a routine sale.
      tone: "warn",
    })
  }

  for (const p of rows(prints)) {
    const print = p as unknown as {
      id: number
      printed_at: string
      sale_id: number
      profiles?: { full_name?: string } | null
    }
    events.push({
      id: `print-${print.id}`,
      at: print.printed_at,
      actorName: who(print),
      category: "sales",
      title: "Receipt printed",
      detail: `Sale #${print.sale_id}`,
      amount: null,
      href: `/sales/${print.sale_id}`,
      tone: "neutral",
    })
  }

  const wanted = filters.category
  const filtered = wanted
    ? events.filter((e) => e.category === wanted)
    : events

  filtered.sort((a, b) => b.at.localeCompare(a.at))

  return { events: filtered.slice(0, CAP), capped: filtered.length > CAP }
}

const TITLES: Record<string, string> = {
  "price.changed": "Price changed",
  "cost.changed": "Cost changed",
  "staff.role_changed": "Role changed",
  "staff.pin_changed": "PIN changed",
  "staff.active_changed": "Staff account changed",
  "setting.changed": "Setting changed",
  "discount.created": "Discount created",
  "discount.changed": "Discount changed",
  "discount.deleted": "Discount retired",
  "sale.void": "Sale voided",
  "sale.refunded": "Sale refunded",

  // Events the TILL writes. This feed reads every audit row, so without these
  // an owner was shown the raw type — `terminal_started` — as the title of the
  // only kind of event the shop had actually recorded. The wording matches the
  // Traceability tab exactly: the same event named two ways on two screens is
  // how a person stops believing either.
  till_registered: "Till registered",
  terminal_started: "Terminal started",
  app_version_changed: "App version changed",
  operator_signed_in: "Operator signed in",
  till_retired: "Till retired",
  till_restored: "Till brought back",
  discount_approved: "Discount approved",
}
