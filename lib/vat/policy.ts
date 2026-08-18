import type { TillClient } from "@/lib/pos/sale-core"
import { createClient } from "@/lib/supabase/server"

/**
 * The shop's current VAT registration policy.
 *
 * A policy is an immutable row in `vat_policies`; the current one is the highest
 * `id`. `configuredRate` is the rate saved for the next enabled policy (0.15 by
 * default); `effectiveRate` is what a sale rung up under this policy actually
 * uses — zero while disabled, the configured rate while enabled. The two are
 * separate so disabling VAT keeps the prepared rate for later reactivation
 * without ever adding VAT to a disabled sale.
 */
export type VatPolicy = {
  id: number
  enabled: boolean
  configuredRate: number
  effectiveRate: number
  vatNumber: string | null
  createdAt: string
}

/** The cookie-session client unless the caller brought its own (Android bearer). */
async function clientFor(client?: TillClient): Promise<TillClient> {
  return client ?? (await createClient())
}

/**
 * Reads the current VAT policy — the latest ledger row, not a reconstruction of
 * `settings`.
 *
 * Ordered by `id desc`, not `created_at`: two policies created in the same
 * transaction instant would tie on the timestamp, and the identity sequence is
 * the only total order the ledger guarantees. A blank disabled VAT number is
 * normalised to null so callers never print an empty registration line.
 */
export async function getCurrentVatPolicy(client?: TillClient): Promise<VatPolicy> {
  const supabase = await clientFor(client)

  const { data, error } = await supabase
    .from("vat_policies")
    .select("id, enabled, configured_rate, vat_number, created_at")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) {
    // The migration always seeds a current policy, so this is the "database not
    // migrated yet" case rather than anything a running shop can reach.
    throw new Error("No VAT policy is configured.")
  }

  const configuredRate = Number(data.configured_rate)
  // The policy keeps a prepared number even while disabled, so the owner can
  // enter it ahead of registration; a blank one normalises to null so nothing
  // downstream prints an empty registration line.
  const vatNumber =
    typeof data.vat_number === "string" && data.vat_number.trim()
      ? data.vat_number.trim()
      : null

  return {
    id: data.id,
    enabled: data.enabled,
    configuredRate,
    effectiveRate: data.enabled ? configuredRate : 0,
    vatNumber,
    createdAt: data.created_at,
  }
}
