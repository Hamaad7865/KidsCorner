import { isPaymentMethod, type PaymentMethod } from "@/lib/db-enums"
import type { TillClient } from "@/lib/pos/sale-core"
import { createClient } from "@/lib/supabase/server"

/**
 * POS reads: the current shift and the sellable catalog.
 *
 * The catalog is loaded once when the till opens and handed to the sell screen
 * as a client island. Per the spec the cart is entirely client-side and the
 * network is only needed at `complete_sale`, so everything the till needs to
 * ring up a sale has to be in memory before the first scan.
 *
 * The reads the Android till also needs take an optional client, because it
 * authenticates with a bearer token and there are no cookies to read. Passing
 * one in is the only difference — the query, and the RLS it runs under, are the
 * same either way.
 */

/** The cookie-session client unless the caller brought its own. */
async function clientFor(client?: TillClient): Promise<TillClient> {
  return client ?? (await createClient())
}

export type OpenShift = {
  id: number
  openedAt: string
  openingFloat: number
  openedBy: string | null
}

/** The one shift that is still open, if any. */
export async function getOpenShift(client?: TillClient): Promise<OpenShift | null> {
  const supabase = await clientFor(client)

  const { data, error } = await supabase
    .from("shifts")
    .select("id, opened_at, opening_float, profiles!shifts_opened_by_fkey ( full_name )")
    .is("closed_at", null)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    id: data.id,
    openedAt: data.opened_at,
    openingFloat: Number(data.opening_float),
    openedBy: data.profiles?.full_name ?? null,
  }
}

export type ShiftTotals = {
  saleCount: number
  salesTotal: number
  vatTotal: number
  discountTotal: number
  itemCount: number
  averageBasket: number
  /** Money taken, keyed by payment method. */
  byMethod: Record<string, number>
  byCashier: { cashierId: string | null; name: string; saleCount: number; total: number }[]
  openingFloat: number
  cashTaken: number
  /** Signed sum of petty-cash movements: negative means cash was taken out. */
  tillMovements: number
  /** Refunds handed back in cash, already netted out of `expectedCash`. */
  cashRefunded: number
  /** What should physically be in the drawer. */
  expectedCash: number
}

function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * What a shift has taken, straight from the `shift_totals` RPC.
 *
 * Deliberately not aggregated here. The close screen, the X-read and the Z
 * report all read this one function, so they cannot quote different numbers for
 * the same shift — the mistake the Carfectionist system documents having made
 * and fixed. It also means the expected-cash figure includes till movements,
 * which a client-side sum over `sales` alone would miss entirely.
 */
export async function getShiftTotals(
  shiftId: number,
  client?: TillClient,
): Promise<ShiftTotals> {
  const supabase = await clientFor(client)

  const { data, error } = await supabase.rpc("shift_totals", {
    p_shift_id: shiftId,
  })
  if (error) throw error

  const t = (data ?? {}) as Record<string, unknown>
  const methods = (t.by_method ?? {}) as Record<string, unknown>
  const cashiers = Array.isArray(t.by_cashier) ? t.by_cashier : []

  return {
    saleCount: num(t.sale_count),
    salesTotal: num(t.sales_total),
    vatTotal: num(t.vat_total),
    discountTotal: num(t.discount_total),
    itemCount: num(t.item_count),
    averageBasket: num(t.average_basket),
    byMethod: Object.fromEntries(
      Object.entries(methods).map(([key, value]) => [key, num(value)]),
    ),
    byCashier: cashiers.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>
      return {
        cashierId: typeof r.cashier_id === "string" ? r.cashier_id : null,
        name: typeof r.name === "string" ? r.name : "Unknown",
        saleCount: num(r.sale_count),
        total: num(r.total),
      }
    }),
    openingFloat: num(t.opening_float),
    cashTaken: num(t.cash_taken),
    tillMovements: num(t.till_movements),
    cashRefunded: num(t.cash_refunded),
    expectedCash: num(t.expected_cash),
  }
}

export type CatalogVariant = {
  id: number
  productId: number
  productName: string
  productCode: string | null
  shelfLocation: string | null
  categoryId: number | null
  categoryName: string | null
  sizeLabel: string
  sizeSort: number
  colourName: string
  colourHex: string | null
  sku: string
  barcode: string | null
  price: number
  qtyOnHand: number
  /**
   * The product's photograph, where there is one.
   *
   * On the product, not the variant: the shop photographs a garment once, and
   * the colour a customer is holding is already carried by `colourHex`.
   */
  imageUrl: string | null
}

/** Page size for the catalog load — comfortably under PostgREST's max-rows. */
const CATALOG_PAGE = 900

/**
 * Every sellable variant.
 *
 * Fetched in explicit pages rather than one big select: an unbounded query is
 * silently capped at `max-rows` (1000 on Supabase), and a till that is missing
 * the tail of the catalog would simply fail to find items with no indication
 * why. Ranging until a short page comes back gets all of them.
 */
export async function loadCatalog(client?: TillClient): Promise<CatalogVariant[]> {
  const supabase = await clientFor(client)
  const rows: CatalogVariant[] = []

  for (let page = 0; ; page += 1) {
    const from = page * CATALOG_PAGE
    const { data, error } = await supabase
      .from("product_variants")
      .select(
        `id, sku, barcode, selling_price, qty_on_hand,
         products!inner ( id, name, is_active, category_id, image_url, shelf_location, product_code, categories ( name ) ),
         sizes ( label, sort_order ),
         colours ( name, hex_code )`,
      )
      .eq("is_active", true)
      .eq("products.is_active", true)
      .order("id")
      .range(from, from + CATALOG_PAGE - 1)

    if (error) throw error
    const batch = data ?? []

    for (const row of batch) {
      rows.push({
        id: row.id,
        productId: row.products?.id ?? 0,
        productName: row.products?.name ?? "",
        productCode: row.products?.product_code ?? null,
        shelfLocation: row.products?.shelf_location ?? null,
        categoryId: row.products?.category_id ?? null,
        categoryName: row.products?.categories?.name ?? null,
        sizeLabel: row.sizes?.label ?? "",
        sizeSort: row.sizes?.sort_order ?? 0,
        colourName: row.colours?.name ?? "",
        colourHex: row.colours?.hex_code ?? null,
        sku: row.sku,
        barcode: row.barcode,
        price: Number(row.selling_price),
        qtyOnHand: row.qty_on_hand,
        imageUrl: row.products?.image_url ?? null,
      })
    }

    // A short page means we've reached the end.
    if (batch.length < CATALOG_PAGE) break
    // Safety stop: 45k variants is far beyond this shop, and an unbounded loop
    // against a paginated API is not something to leave open.
    if (page > 50) break
  }

  return rows
}

/**
 * Payment methods the shop accepts, from the settings table.
 *
 * `settings.value` is JSON, so anything could be in there. Narrowed to the
 * known methods at this boundary rather than downstream: a stray value would
 * otherwise travel as a plain string all the way to `complete_sale`, where the
 * `sale_payments.method` CHECK would reject it — long after the cashier had
 * taken the customer's money.
 */
export async function getPaymentMethods(client?: TillClient): Promise<PaymentMethod[]> {
  const supabase = await clientFor(client)
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "payment_methods")
    .maybeSingle()

  const value = data?.value
  return Array.isArray(value)
    ? value.filter((v): v is PaymentMethod => typeof v === "string" && isPaymentMethod(v))
    : []
}

/** Shop name from settings, for receipts and the settings screen. */
export async function getShopName(client?: TillClient): Promise<string> {
  const supabase = await clientFor(client)
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "shop_name")
    .maybeSingle()

  return typeof data?.value === "string" ? data.value : "Kids Corner"
}

/**
 * The shop's address, phone and VAT number, in one query.
 *
 * Each is optional — a shop that has not filled them in gets a receipt without
 * those lines rather than one that says "null", and the missing VAT number is
 * visible to the owner as an omission rather than an invented value.
 *
 * Shared by the till's bootstrap and the back office's dashboard, which both
 * want to say where the shop is.
 */
export async function getShopIdentity(client?: TillClient): Promise<{
  address: string | null
  phone: string | null
  vatNumber: string | null
}> {
  const supabase = await clientFor(client)
  const { data } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["shop_address", "shop_phone", "vat_number"])

  const read = (key: string) => {
    const value = (data ?? []).find((row) => row.key === key)?.value
    return typeof value === "string" && value.trim() ? value.trim() : null
  }

  return {
    address: read("shop_address"),
    phone: read("shop_phone"),
    vatNumber: read("vat_number"),
  }
}

/**
 * Does this shop want a manager to sign off a return?
 *
 * Off unless it has been switched on, which is how the shop worked before the
 * setting existed. The database enforces it either way (migration 036) — this
 * read is only so the screens can ASK for a PIN rather than let a cashier fill
 * in a whole return and then be refused by the server.
 */
export async function getRefundRequiresManager(client?: TillClient): Promise<boolean> {
  const supabase = await clientFor(client)
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "refund_requires_manager")
    .maybeSingle()

  return data?.value === true
}

/** VAT rate from settings, falling back to the spec's 15%. */
export async function getVatRate(client?: TillClient): Promise<number> {
  const supabase = await clientFor(client)
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "vat_rate")
    .maybeSingle()

  const parsed = Number(data?.value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.15
}
