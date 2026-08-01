import type { SupabaseClient } from "@supabase/supabase-js"

import { formatRs } from "@/lib/format"

/**
 * Writing to the audit trail from the back office.
 *
 * The activity feed is built by READING the shop's own records — a sale is a
 * sale row, a close is a z_report — and `audit_events` exists only for the
 * actions that leave no other trace. Those are precisely the dangerous ones: a
 * price dropped to Rs 50 and put back an hour later moves real money and
 * changes nothing else in the database.
 *
 * The feed already knew how to display them; nothing wrote them. `TITLES` in
 * queries.ts listed eight event types with no writer anywhere in the app, so
 * every one of those actions happened invisibly.
 *
 * Two rules hold everywhere here:
 *
 *   A FAILED AUDIT NEVER FAILS THE ACTION. Saving a price must not bounce
 *   because the log write hiccupped — the same discipline `settleDiscounts`
 *   already applies at the till. The consequence is accepted deliberately: a
 *   dropped event is worse than nothing only if it is invisible, and the
 *   underlying record still changed, which is what the shopkeeper is looking at.
 *
 *   A NO-OP IS NOT AN EVENT. Saving a form without touching anything writes
 *   nothing. A trail padded with "Price changed: Rs 450 → Rs 450" is one nobody
 *   reads, and a trail nobody reads catches nothing.
 */

/** Enough of a Supabase client to call the RPC. Keeps this testable. */
export type AuditClient = Pick<SupabaseClient, "rpc">

export type AuditEvent = {
  /** One of the keys `TITLES` renders — see lib/activity/queries.ts. */
  type: string
  refType: string
  refId: string | number
  summary: string
  detail?: Record<string, unknown>
}

/**
 * Records one event. Never throws and never rejects.
 *
 * `log_audit` is SECURITY DEFINER and writes `auth.uid()` as the actor, so the
 * caller cannot claim to be somebody else — it is the session's own name or
 * nothing.
 */
export async function logAudit(
  client: AuditClient,
  event: AuditEvent,
): Promise<void> {
  try {
    await client
      .rpc("log_audit" as never, {
        p_event_type: event.type,
        p_ref_type: event.refType,
        p_ref_id: String(event.refId),
        p_summary: event.summary,
        p_detail: event.detail ?? {},
        p_device_id: null,
      } as never)
      .then(
        () => undefined,
        () => undefined,
      )
  } catch {
    // Deliberately swallowed — see the note above.
  }
}

/** Records several events, and still never throws. */
export async function logAudits(
  client: AuditClient,
  events: AuditEvent[],
): Promise<void> {
  await Promise.all(events.map((event) => logAudit(client, event)))
}

export type FieldChange = {
  field: string
  before: unknown
  after: unknown
}

/**
 * What actually changed between two versions of a row.
 *
 * Compared as strings so `15` and `"15"` are the same value: Postgres hands
 * NUMERIC back as a string and the form parses it to a number, and without
 * this every save of an untouched price would log a change. Null and undefined
 * both read as empty, so a field going from absent to blank is not an event.
 *
 * The two arguments are deliberately NOT required to share a type. The whole
 * reason this exists is that they never do — one side is a database row and
 * the other is what a form parsed — and a signature insisting otherwise would
 * be describing a comparison this function does not perform.
 *
 * Pure and exported for the tests.
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = []

  for (const [field, next] of Object.entries(after)) {
    const previous = before[field]
    const a = previous === null || previous === undefined ? "" : String(previous)
    const b = next === null || next === undefined ? "" : String(next)
    if (a !== b) changes.push({ field, before: previous ?? null, after: next ?? null })
  }

  return changes
}

/**
 * Did this money field move, and by how much?
 *
 * Returns null when it did not. Compared at two decimals because that is what
 * the column stores — 450 and 450.001 are the same price, and logging the
 * difference would be logging a rounding artefact.
 */
export function moneyChange(
  before: unknown,
  after: number,
): { before: number; after: number; summary: string } | null {
  const from = Number(before)
  const previous = Number.isFinite(from) ? Math.round(from * 100) / 100 : 0
  const next = Math.round(after * 100) / 100
  if (previous === next) return null

  return {
    before: previous,
    after: next,
    summary: `${formatRs(previous)} → ${formatRs(next)}`,
  }
}
