import { isPurchaseStatus, type PurchaseStatus } from "@/lib/db-enums"
import type { Tables } from "@/lib/supabase/database.types"
import { createClient } from "@/lib/supabase/server"

/**
 * Purchase and supplier reads.
 *
 * A purchase is a draft until `receive_purchase` runs; that RPC is what turns
 * its lines into stock movements and updates each variant's cost price. Nothing
 * here writes.
 */

export type Supplier = Tables<"suppliers">

export async function listSuppliers(): Promise<Supplier[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .order("name")
    .limit(500)
  if (error) throw error
  return data ?? []
}

export type SupplierRow = Supplier & {
  /** Distinct brands this supplier has actually delivered, from purchase history. */
  brands: string[]
  lastOrder: string | null
  /** Spend against this supplier in the current calendar year. */
  spendThisYear: number
}

/**
 * Suppliers as a buying relationship, which is what the design shows.
 *
 * Brands, last order and spend are derived from `purchases` rather than stored:
 * they are answers to "what have we actually done with this supplier", and a
 * stored copy would be a second version of the truth that drifts the moment
 * someone edits a purchase.
 *
 * Received purchases only. A draft is an intention — counting it as spend
 * would show money out that has not gone out, and the whole point of the
 * draft/received split is that stock and money move on receipt.
 */
/**
 * @param search Narrows by name. The global search links here with the
 *   supplier's own name, because a result row that reads "Tiny Threads Ltd"
 *   used to land on the whole list and lose the name it was clicked for.
 */
export async function listSupplierRows(search?: string): Promise<SupplierRow[]> {
  const supabase = await createClient()
  const yearStart = `${new Date().getFullYear()}-01-01`

  const [all, { data: history }] = await Promise.all([
    listSuppliers(),
    supabase
      .from("purchases")
      .select(
        `supplier_id, purchase_date, total_amount, status,
         purchase_items ( product_variants ( products ( brands ( name ) ) ) )`,
      )
      .eq("status", "received")
      .order("purchase_date", { ascending: false })
      .limit(1000),
  ])

  const bySupplier = new Map<
    number,
    { brands: Set<string>; lastOrder: string | null; spend: number }
  >()

  for (const row of history ?? []) {
    if (row.supplier_id === null) continue
    const entry = bySupplier.get(row.supplier_id) ?? {
      brands: new Set<string>(),
      lastOrder: null,
      spend: 0,
    }
    // Ordered newest-first, so the first one seen is the latest.
    entry.lastOrder ??= row.purchase_date
    if (row.purchase_date >= yearStart) entry.spend += Number(row.total_amount)
    for (const item of row.purchase_items ?? []) {
      const brand = item.product_variants?.products?.brands?.name
      if (brand) entry.brands.add(brand)
    }
    bySupplier.set(row.supplier_id, entry)
  }

  // Filtered here rather than in the query: there are at most 500 suppliers
  // and the spend history has already been fetched for all of them, so a
  // second round trip to narrow a list this size would cost more than it saves.
  const term = search?.trim().toLowerCase()
  const suppliers = term
    ? all.filter(
        (s) =>
          s.name.toLowerCase().includes(term) ||
          (s.contact_name ?? "").toLowerCase().includes(term) ||
          (s.town ?? "").toLowerCase().includes(term),
      )
    : all

  return suppliers.map((supplier) => {
    const seen = bySupplier.get(supplier.id)
    return {
      ...supplier,
      brands: [...(seen?.brands ?? [])].sort(),
      lastOrder: seen?.lastOrder ?? null,
      spendThisYear: seen?.spend ?? 0,
    }
  })
}

export type PurchaseListRow = {
  id: number
  invoiceNo: string | null
  purchaseDate: string
  /** Null until the supplier gives one. */
  expectedDate: string | null
  status: PurchaseStatus
  totalAmount: number
  supplierName: string | null
  /** Town and contact, for the second line under the supplier's name. */
  supplierMeta: string | null
  lineCount: number
  /** Units across every line — what actually lands on the shelf. */
  unitCount: number
}

export const PURCHASE_LIST_LIMIT = 200

/**
 * One supplier's name, for a heading that says whose purchases these are.
 *
 * Null when the id names nobody, so a made-up `?supplier=` in the URL falls
 * back to the plain heading rather than titling the page after nothing.
 */
export async function getSupplierName(id: number): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("suppliers")
    .select("name")
    .eq("id", id)
    .maybeSingle()
  return data?.name ?? null
}

export type PurchaseList = {
  rows: PurchaseListRow[]
  truncated: boolean
  /** How many purchases sit in each status, whatever is being shown. */
  counts: Record<PurchaseStatus, number>
}

/**
 * @param filters.status Narrow to one status, or undefined for all of them.
 * @param filters.supplierId Narrow to one supplier.
 *
 * The counts follow the supplier but NOT the status. A tab reading "On order
 * 4" has to keep saying 4 while you are looking at the received ones — it is
 * the thing you are about to click. Scoping them to the supplier is the
 * opposite case: "On order 4" on a page showing one supplier's purchases
 * would be counting somebody else's deliveries.
 */
export async function listPurchases(
  filters: { status?: PurchaseStatus; supplierId?: number } = {},
): Promise<PurchaseList> {
  const { status, supplierId } = filters
  const supabase = await createClient()

  let query = supabase
    .from("purchases")
    .select(
      `id, invoice_no, purchase_date, expected_date, status, total_amount,
       suppliers ( name, town, contact_name ),
       purchase_items ( id, qty )`,
    )
    .order("purchase_date", { ascending: false })
    .order("id", { ascending: false })
    // One extra row so a capped list can say so rather than just ending.
    .limit(PURCHASE_LIST_LIMIT + 1)

  if (status) query = query.eq("status", status)
  if (supplierId !== undefined) query = query.eq("supplier_id", supplierId)

  let countQuery = supabase.from("purchases").select("status")
  if (supplierId !== undefined) countQuery = countQuery.eq("supplier_id", supplierId)

  const [{ data, error }, statusRows] = await Promise.all([query, countQuery])

  if (error) throw error
  if (statusRows.error) throw statusRows.error

  const counts: Record<PurchaseStatus, number> = {
    draft: 0,
    received: 0,
    cancelled: 0,
  }
  for (const row of statusRows.data ?? []) {
    if (isPurchaseStatus(row.status)) counts[row.status] += 1
  }

  const all = data ?? []
  const rows = all.slice(0, PURCHASE_LIST_LIMIT).map((row) => ({
    id: row.id,
    invoiceNo: row.invoice_no,
    purchaseDate: row.purchase_date,
    status: isPurchaseStatus(row.status) ? row.status : "draft",
    totalAmount: Number(row.total_amount),
    supplierName: row.suppliers?.name ?? null,
    supplierMeta:
      [row.suppliers?.town, row.suppliers?.contact_name].filter(Boolean).join(" · ") ||
      null,
    lineCount: (row.purchase_items ?? []).length,
    unitCount: (row.purchase_items ?? []).reduce((sum, i) => sum + i.qty, 0),
    expectedDate: row.expected_date,
  }))

  return { rows, truncated: all.length > PURCHASE_LIST_LIMIT, counts }
}

export type PurchaseLine = {
  id: number
  variantId: number
  qty: number
  unitCost: number
  lineTotal: number
  sku: string
  productName: string
  sizeLabel: string
  colourName: string
  colourHex: string | null
  qtyOnHand: number
}

export type PurchaseDetail = {
  id: number
  invoiceNo: string | null
  purchaseDate: string
  /** Null until the supplier gives one. */
  expectedDate: string | null
  status: PurchaseStatus
  totalAmount: number
  /** Null on a draft/cancelled purchase; frozen once receipt books stock in. */
  vatPolicyId: number | null
  vatEnabled: boolean | null
  /** Effective rate: zero when the frozen policy was disabled. */
  vatRate: number | null
  vatAmount: number | null
  notes: string | null
  supplierId: number
  supplierName: string | null
  lines: PurchaseLine[]
}

export async function getPurchase(id: number): Promise<PurchaseDetail | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("purchases")
    .select(
      `id, invoice_no, purchase_date, expected_date, status, total_amount,
       vat_policy_id, vat_enabled, vat_rate, vat_amount, notes, supplier_id,
       suppliers ( name ),
       purchase_items (
         id, variant_id, qty, unit_cost, line_total,
         product_variants (
           sku, qty_on_hand,
           products ( name ),
           sizes ( label ),
           colours ( name, hex_code )
         )
       )`,
    )
    .eq("id", id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    id: data.id,
    invoiceNo: data.invoice_no,
    purchaseDate: data.purchase_date,
    expectedDate: data.expected_date,
    status: isPurchaseStatus(data.status) ? data.status : "draft",
    totalAmount: Number(data.total_amount),
    vatPolicyId: data.vat_policy_id,
    vatEnabled: data.vat_enabled,
    vatRate: data.vat_rate === null ? null : Number(data.vat_rate),
    vatAmount: data.vat_amount === null ? null : Number(data.vat_amount),
    notes: data.notes,
    supplierId: data.supplier_id,
    supplierName: data.suppliers?.name ?? null,
    lines: (data.purchase_items ?? []).map((line) => {
      const variant = line.product_variants
      return {
        id: line.id,
        variantId: line.variant_id,
        qty: line.qty,
        unitCost: Number(line.unit_cost),
        // line_total is a GENERATED column, so it is read-only and always
        // agrees with qty * unit_cost.
        lineTotal: Number(line.line_total ?? 0),
        sku: variant?.sku ?? "",
        productName: variant?.products?.name ?? "",
        sizeLabel: variant?.sizes?.label ?? "",
        colourName: variant?.colours?.name ?? "",
        colourHex: variant?.colours?.hex_code ?? null,
        qtyOnHand: variant?.qty_on_hand ?? 0,
      }
    }),
  }
}
