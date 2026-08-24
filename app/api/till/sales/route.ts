import { NextResponse } from "next/server"

import { requireTillSession } from "@/lib/api/till-session"

/**
 * Recent sales, for the till's own history.
 *
 * Deliberately narrow. The back office's `listSales` takes date ranges,
 * cashiers, methods and statuses; a cashier reaching for a reprint wants the
 * last few sales or a receipt number, and nothing else. So this is capped, most
 * recent first, with one optional search on the sale number.
 *
 * Not scoped to the open shift. The commonest reprint is "the customer came
 * back after we changed shift", and a history that hid yesterday's sale would
 * fail exactly when it is needed.
 *
 * `customerId` switches the endpoint into "one customer's history" mode: the
 * same shape, but a higher cap, because a profile wants completeness where the
 * quick-reprint list wants recency. Without it the route behaves exactly as it
 * always did.
 */
const LIMIT = 40
const CUSTOMER_HISTORY_LIMIT = 200

/** A positive integer, or null — anything else is treated as absent. */
function customerIdParam(raw: string | null): number | null {
  if (!/^\d+$/.test(raw ?? "")) return null
  const id = Number(raw)
  return id > 0 ? id : null
}

export async function GET(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const params = new URL(request.url).searchParams
  const query = params.get("q")?.trim() ?? ""
  const customerId = customerIdParam(params.get("customerId"))

  let select = session.supabase
    .from("sales")
    .select(
      `id, sale_no, sale_date, total, status,
       profiles ( full_name ),
       customers ( full_name ),
       sale_items ( qty )`,
    )
    .order("id", { ascending: false })
    .limit(customerId ? CUSTOMER_HISTORY_LIMIT : LIMIT)

  // Composes with the sale-number search: a customer's history filtered to one
  // receipt number is exactly how "which visit was this?" gets answered.
  if (customerId) select = select.eq("customer_id", customerId)

  if (query.length >= 2) {
    // Escaped before interpolation: % and _ are LIKE wildcards, and a comma
    // would end the filter and let the rest be read as new conditions.
    const safe = query.replace(/[%_,()]/g, "")
    if (safe.length >= 2) select = select.ilike("sale_no", `%${safe}%`)
  }

  const { data, error } = await select
  if (error) return NextResponse.json({ ok: false, error: error.message })

  return NextResponse.json({
    ok: true,
    sales: (data ?? []).map((row) => ({
      id: row.id,
      saleNo: row.sale_no,
      saleDate: row.sale_date,
      total: Number(row.total),
      status: row.status,
      itemCount: (row.sale_items ?? []).reduce((sum, i) => sum + i.qty, 0),
      cashierName: row.profiles?.full_name ?? null,
      customerName: row.customers?.full_name ?? null,
    })),
  })
}
