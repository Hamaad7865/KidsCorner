import type { Metadata } from "next"

import { SellScreen } from "@/components/pos/sell-screen"
import { ShiftOpenForm } from "@/components/pos/shift-open-form"
import { requireProfile } from "@/lib/auth/session"
import { listDiscounts } from "@/lib/discounts/queries"
import { shopToday } from "@/lib/format"
import { listCashiers } from "@/lib/pos/actions"
import {
  getOpenShift,
  getPaymentMethods,
  getVatRate,
  loadCatalog,
} from "@/lib/pos/queries"

export const metadata: Metadata = { title: "Till" }

export default async function PosPage() {
  const profile = await requireProfile()
  const shift = await getOpenShift()

  // No shift, no selling — the spec makes the float a precondition, and it is
  // what the end-of-day variance is measured against.
  if (!shift) {
    return <ShiftOpenForm cashierName={profile.fullName} />
  }

  // Loaded once, here, and handed to the client island: from this point the
  // till can ring up a sale without touching the network until complete_sale.
  const [catalog, vatRate, paymentMethods, cashiers, discounts] =
    await Promise.all([
      loadCatalog(),
      getVatRate(),
      getPaymentMethods(),
      listCashiers(),
      // Active rules only: an expired or disabled offer must not reach the till.
      listDiscounts(true),
    ])

  return (
    <SellScreen
      catalog={catalog}
      shiftId={shift.id}
      vatRate={vatRate}
      paymentMethods={paymentMethods.length > 0 ? paymentMethods : ["cash"]}
      cashierName={profile.fullName}
      cashiers={cashiers}
      discounts={discounts}
      // Computed on the server so the shop's calendar day decides eligibility,
      // not whatever timezone the till happens to be set to.
      today={shopToday()}
    />
  )
}
