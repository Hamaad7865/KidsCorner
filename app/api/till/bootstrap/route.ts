import { NextResponse } from "next/server"

import { requireTillSession } from "@/lib/api/till-session"
import { listCashiers } from "@/lib/pos/sale-core"
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

  const [shopName, vatRate, paymentMethods, shift, cashiers, identity] = await Promise.all([
    getShopName(supabase),
    getVatRate(supabase),
    getPaymentMethods(supabase),
    getOpenShift(supabase),
    listCashiers(supabase),
    // For the receipt header. Absent keys come back null and the receipt omits
    // the line — a Mauritian VAT receipt is required to carry the shop's
    // registration number, so this being blank is a compliance gap the shop
    // needs to close, not something to invent a value for.
    getShopIdentity(supabase),
  ])

  return NextResponse.json({
    ok: true,
    device: { id: user.id, name: user.name, role: user.role },
    shopName,
    shopAddress: identity.address,
    shopPhone: identity.phone,
    vatNumber: identity.vatNumber,
    vatRate,
    paymentMethods: paymentMethods.length > 0 ? paymentMethods : ["cash"],
    shift,
    // Only staff with a PIN can be picked on the lock screen. The hash is not
    // in here — `listCashiers` reduces it to a boolean precisely so a decompiled
    // APK yields nothing to attack offline.
    cashiers,
  })
}
