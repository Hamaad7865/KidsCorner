import { NextResponse } from "next/server"

import { requireTillSession } from "@/lib/api/till-session"
import { listCashiersForDevice } from "@/lib/pos/sale-core"
import {
  getOpenShift,
  getPaymentMethods,
  getShopIdentity,
  getShopName,
  getVatRate,
} from "@/lib/pos/queries"

/**
 * Everything the Android till needs to draw its first screen, in one call.
 *
 * Deliberately one round trip rather than six. A shop's connection is the
 * thing this app is least able to rely on, and six chances to fail before the
 * lock screen appears is five too many.
 */
export async function GET(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const { supabase, user } = session

  /**
   * The till announces itself.
   *
   * Sent as query parameters rather than a body because this is a GET, and it
   * is deliberately fire-and-forget: a device that cannot register still gets
   * its catalogue and can still sell. The registry is for the back office to
   * look at, and losing a heartbeat must never stop a shop trading.
   */
  const params = new URL(request.url).searchParams
  const deviceCode = params.get("device")?.trim()
  let deviceId: number | null = null

  if (deviceCode) {
    const { data } = await supabase.rpc("register_pos_device" as never, {
      p_code: deviceCode,
      p_model: params.get("model")?.trim() || null,
      p_app_version: params.get("version")?.trim() || null,
    } as never)
    deviceId = typeof data === "number" ? data : null
  }

  const [shopName, vatRate, paymentMethods, shift, cashiers, identity] = await Promise.all([
    getShopName(supabase),
    getVatRate(supabase),
    getPaymentMethods(supabase),
    getOpenShift(supabase),
    listCashiersForDevice(supabase),
    // For the receipt header. Absent keys come back null and the receipt omits
    // the line — a Mauritian VAT receipt is required to carry the shop's
    // registration number, so this being blank is a compliance gap the shop
    // needs to close, not something to invent a value for.
    getShopIdentity(supabase),
  ])

  return NextResponse.json({
    ok: true,
    device: { id: user.id, name: user.name, role: user.role },
    // The registry row for this install, so the till can stamp its shifts.
    deviceId,
    shopName,
    shopAddress: identity.address,
    shopPhone: identity.phone,
    vatNumber: identity.vatNumber,
    vatRate,
    paymentMethods: paymentMethods.length > 0 ? paymentMethods : ["cash"],
    shift,
    /**
     * Who may be picked on the lock screen, and — for a tablet only — the
     * verifier that lets the keypad work through an outage.
     *
     * `pin_code` is still not in here and never will be: that is the value
     * this server authenticates against. What travels is a second derivation
     * of the PIN (lib/pos/device-verifier.ts), useful only for saying yes or
     * no on the device, revocable from the back office, and worthless against
     * this endpoint. It rides on bootstrap rather than a route of its own
     * because a device that cannot reach bootstrap has nothing to sync
     * anyway, and one round trip is the whole point of this endpoint.
     */
    cashiers,
  })
}
