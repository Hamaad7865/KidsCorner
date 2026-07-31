import { cache } from "react"

import { isSaleStatus, type SaleStatus } from "@/lib/db-enums"
import { createClient } from "@/lib/supabase/server"

/**
 * Customer reads.
 *
 * The list deliberately carries no spend aggregates. Computing them would mean
 * embedding every sale row for every customer — an unbounded payload whose
 * truncation behaviour I can't guarantee, and a silently-wrong money figure is
 * far worse than an absent one. Aggregates live on the detail page instead,
 * where they are bounded to a single customer.
 *
 * If they are wanted on the list later, the right answer is a view (as with
 * `low_stock_variants`), not a bigger embedded select.
 *
 * Only completed sales count toward totals — a refunded or voided sale should
 * not inflate what someone has spent.
 */

export const CUSTOMER_LIST_LIMIT = 300

export type CustomerListRow = {
  id: number
  fullName: string
  phone: string | null
  email: string | null
  notes: string | null
  createdAt: string
}

export type CustomerList = {
  rows: CustomerListRow[]
  truncated: boolean
}

export async function listCustomers(search?: string): Promise<CustomerList> {
  const supabase = await createClient()

  let query = supabase
    .from("customers")
    .select("id, full_name, phone, email, notes, created_at")
    .order("full_name")

  if (search) {
    // Escaped so a literal % or _ matches itself, and quoted because `or()`
    // splits on commas and periods — a search for "J. Smith" would otherwise
    // be parsed as extra filter conditions.
    const pattern = `%${search.replace(/["]/g, "").replace(/[%_]/g, (c) => `\\${c}`)}%`
    query = query.or(`full_name.ilike."${pattern}",phone.ilike."${pattern}"`)
  }

  const { data, error } = await query.limit(CUSTOMER_LIST_LIMIT + 1)
  if (error) throw error

  const all = data ?? []
  const rows = all.slice(0, CUSTOMER_LIST_LIMIT).map<CustomerListRow>((row) => ({
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    createdAt: row.created_at,
  }))

  return { rows, truncated: all.length > CUSTOMER_LIST_LIMIT }
}

export type CustomerSale = {
  id: number
  saleNo: string
  saleDate: string
  total: number
  status: SaleStatus
  itemCount: number
}

export type CustomerDetail = {
  id: number
  fullName: string
  phone: string | null
  email: string | null
  notes: string | null
  createdAt: string
  sales: CustomerSale[]
  totalSpent: number
}

export const getCustomer = cache(
  async (id: number): Promise<CustomerDetail | null> => {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("customers")
      .select(
        `id, full_name, phone, email, notes, created_at,
         sales ( id, sale_no, sale_date, total, status, sale_items ( id ) )`,
      )
      .eq("id", id)
      .maybeSingle()

    if (error) throw error
    if (!data) return null

    const sales = (data.sales ?? [])
      .map<CustomerSale>((sale) => ({
        id: sale.id,
        saleNo: sale.sale_no,
        saleDate: sale.sale_date,
        total: Number(sale.total),
        status: isSaleStatus(sale.status) ? sale.status : "completed",
        itemCount: (sale.sale_items ?? []).length,
      }))
      // Most recent first; the embedded select has no ordering of its own.
      .sort((a, b) => b.saleDate.localeCompare(a.saleDate))

    return {
      id: data.id,
      fullName: data.full_name,
      phone: data.phone,
      email: data.email,
      notes: data.notes,
      createdAt: data.created_at,
      sales,
      totalSpent: sales
        .filter((s) => s.status === "completed")
        .reduce((sum, s) => sum + s.total, 0),
    }
  },
)
