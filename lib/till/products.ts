import { isValidEan13 } from "@/lib/barcodes/ean13"
import {
  allocateBarcodes,
  getBarcodeSettings,
  type Db,
} from "@/lib/barcodes/settings"
import {
  logAudits,
  moneyChange,
  type AuditClient,
} from "@/lib/activity/audit"
import { canSeeCostPrice } from "@/lib/auth/roles"
import type { Role } from "@/lib/db-enums"
import { round2 } from "@/lib/format"
import type { Database } from "@/lib/supabase/database.types"

/**
 * Product reads and writes for the Android till.
 *
 * The back-office queries in `lib/products` and `lib/barcodes` bind
 * `createClient()` (the browser cookie), which a bearer-token till route
 * cannot use — so this module takes the client as a parameter and follows
 * the same rules with the same messages:
 *
 * - reads run on the till session's own client, so RLS keeps its job, and
 *   cost is stripped for roles that may not see it — the same gate
 *   `getProduct` applies;
 * - writes run on an elevated client (the shop owner chose "anyone on the
 *   till" over the web's owner/manager rule), and every mutation is
 *   audit-logged through the actor's own session client so the trail still
 *   names who did it.
 */

export type TillProductRow = {
  id: number
  name: string
  productCode: string | null
  categoryName: string | null
  brandName: string | null
  imageUrl: string | null
  isActive: boolean
  variantCount: number
  totalStock: number
  minPrice: number | null
  maxPrice: number | null
  /** Variants with no barcode or an invalid one — what Generate fixes. */
  barcodelessCount: number
}

export async function listTillProducts(
  db: Db,
  search: string,
  limit = 60,
): Promise<{ rows: TillProductRow[]; hasMore: boolean }> {
  let query = db
    .from("products")
    .select(
      `id, name, product_code, image_url, is_active,
       categories ( name ),
       brands ( name ),
       product_variants ( selling_price, qty_on_hand, is_active, barcode )`,
    )
    .order("name")

  const term = search.trim()
  if (term) {
    // Escape PostgREST's wildcards so a literal % still matches itself.
    const escaped = term.replace(/[%_]/g, (c) => `\\${c}`)
    query = query.or(`name.ilike.%${escaped}%,product_code.ilike.%${escaped}%`)
  }

  // One extra row: if it comes back, there were more matches than shown.
  const { data, error } = await query.limit(limit + 1)
  if (error) throw error

  const slice = (data ?? []).slice(0, limit)
  return {
    rows: slice.map((row) => {
      const variants = row.product_variants ?? []
      const live = variants.filter((v) => v.is_active)
      const prices = live.map((v) => Number(v.selling_price))
      return {
        id: row.id,
        name: row.name,
        productCode: row.product_code,
        categoryName: row.categories?.name ?? null,
        brandName: row.brands?.name ?? null,
        imageUrl: row.image_url,
        isActive: row.is_active,
        variantCount: live.length,
        totalStock: live.reduce((sum, v) => sum + v.qty_on_hand, 0),
        minPrice: prices.length > 0 ? Math.min(...prices) : null,
        maxPrice: prices.length > 0 ? Math.max(...prices) : null,
        barcodelessCount: variants.filter(
          (v) => v.barcode === null || !isValidEan13(v.barcode),
        ).length,
      }
    }),
    hasMore: (data ?? []).length > limit,
  }
}

export type TillVariant = {
  id: number
  sku: string
  sizeLabel: string
  colourName: string
  colourHex: string | null
  costPrice: number
  sellingPrice: number
  qtyOnHand: number
  reorderLevel: number
  barcode: string | null
  /** False when missing or failing the EAN-13 check — unscannable. */
  barcodeValid: boolean
  isActive: boolean
}

export type TillProductDetail = {
  id: number
  name: string
  productCode: string | null
  categoryName: string | null
  brandName: string | null
  shelfLocation: string | null
  description: string | null
  imageUrl: string | null
  isActive: boolean
  variants: TillVariant[]
}

export async function getTillProduct(
  db: Db,
  id: number,
  role: Role,
): Promise<TillProductDetail | null> {
  const { data, error } = await db
    .from("products")
    .select(
      `id, name, product_code, shelf_location, description, image_url, is_active,
       categories ( name ),
       brands ( name ),
       product_variants (
         id, sku, cost_price, selling_price, qty_on_hand, reorder_level,
         barcode, is_active,
         sizes ( label, sort_order ),
         colours ( name, hex_code )
       )`,
    )
    .eq("id", id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const showCost = canSeeCostPrice(role)
  const rows = [...(data.product_variants ?? [])]
  rows.sort(
    (a, b) =>
      (a.sizes?.sort_order ?? 0) - (b.sizes?.sort_order ?? 0) ||
      (a.colours?.name ?? "").localeCompare(b.colours?.name ?? ""),
  )

  return {
    id: data.id,
    name: data.name,
    productCode: data.product_code,
    categoryName: data.categories?.name ?? null,
    brandName: data.brands?.name ?? null,
    shelfLocation: data.shelf_location,
    description: data.description,
    imageUrl: data.image_url,
    isActive: data.is_active,
    variants: rows.map((row) => ({
      id: row.id,
      sku: row.sku,
      sizeLabel: row.sizes?.label ?? "—",
      colourName: row.colours?.name ?? "—",
      colourHex: row.colours?.hex_code ?? null,
      costPrice: showCost ? Number(row.cost_price) : 0,
      sellingPrice: Number(row.selling_price),
      qtyOnHand: row.qty_on_hand,
      reorderLevel: row.reorder_level,
      barcode: row.barcode,
      barcodeValid: row.barcode !== null && isValidEan13(row.barcode),
      isActive: row.is_active,
    })),
  }
}

export type VariantPatch = {
  sellingPrice: number
  costPrice?: number
  reorderLevel: number
  /** Null clears it; undefined leaves it alone. */
  barcode?: string | null
  isActive: boolean
}

export type MutationResult =
  | { ok: true }
  | { ok: false; error: string; field?: string }

function moneyError(value: number): string | null {
  if (!Number.isFinite(value)) return "Enter a number."
  if (value < 0) return "Price cannot be negative."
  if (value > 99_999_999.99) return "That price is too large for the database column."
  return null
}

/**
 * One variant's editable fields, with the web matrix's rules and messages.
 *
 * Cost is applied only for roles that may see it; a cashier's attempt is
 * refused outright rather than silently dropped — silent drops teach staff
 * the screen is broken.
 */
export async function updateTillVariant(options: {
  db: Db
  audit: AuditClient
  actorName: string
  actorRole: Role
  variantId: number
  patch: VariantPatch
}): Promise<MutationResult> {
  const { db, audit, actorName, actorRole, variantId, patch } = options

  const priceProblem = moneyError(patch.sellingPrice)
  if (priceProblem) return { ok: false, error: priceProblem, field: "sellingPrice" }

  if (patch.costPrice !== undefined) {
    if (!canSeeCostPrice(actorRole)) {
      return { ok: false, error: "Only an owner or manager can change the cost price.", field: "costPrice" }
    }
    const costProblem = moneyError(patch.costPrice)
    if (costProblem) return { ok: false, error: costProblem, field: "costPrice" }
  }

  if (!Number.isInteger(patch.reorderLevel) || patch.reorderLevel < 0) {
    return { ok: false, error: "Reorder level cannot be negative.", field: "reorderLevel" }
  }
  if (patch.reorderLevel > 100_000) {
    return { ok: false, error: "That reorder level is unrealistically large.", field: "reorderLevel" }
  }

  let barcode: string | null | undefined = patch.barcode
  if (typeof barcode === "string") {
    const trimmed = barcode.trim()
    if (trimmed === "") {
      barcode = null
    } else {
      if (trimmed.length < 4) {
        return { ok: false, error: "A barcode needs at least 4 characters.", field: "barcode" }
      }
      if (trimmed.length > 64) {
        return { ok: false, error: "That barcode is too long.", field: "barcode" }
      }
      barcode = trimmed
    }
  }

  const { data: before, error: readError } = await db
    .from("product_variants")
    .select("sku, cost_price, selling_price, product_id")
    .eq("id", variantId)
    .maybeSingle()
  if (readError) return { ok: false, error: readError.message }
  if (!before) return { ok: false, error: "That variant no longer exists. Refresh and try again." }

  // Who already has this barcode, if anyone — the friendly half of the
  // unique index, naming the garment so the scanner has somewhere to go.
  if (barcode) {
    const { data: clash } = await db
      .from("product_variants")
      .select("id, products ( name ), sizes ( label ), colours ( name )")
      .eq("barcode", barcode)
      .neq("id", variantId)
      .maybeSingle()
    if (clash) {
      const what = [
        clash.products?.name,
        clash.colours?.name,
        clash.sizes?.label,
      ]
        .filter(Boolean)
        .join(" · ")
      return {
        ok: false,
        error: what
          ? `That barcode is already on ${what}.`
          : "That barcode is already on another variant.",
        field: "barcode",
      }
    }
  }

  const values: Database["public"]["Tables"]["product_variants"]["Update"] = {
    selling_price: round2(patch.sellingPrice),
    reorder_level: patch.reorderLevel,
    is_active: patch.isActive,
  }
  if (patch.costPrice !== undefined) values.cost_price = round2(patch.costPrice)
  if (barcode !== undefined) values.barcode = barcode

  const { data: written, error: writeError } = await db
    .from("product_variants")
    .update(values)
    .eq("id", variantId)
    .select("id")
  if (writeError) {
    return {
      ok: false,
      error:
        writeError.code === "23505"
          ? "That SKU or barcode is already used by another variant."
          : writeError.message,
    }
  }
  if ((written ?? []).length === 0) {
    return { ok: false, error: "That variant no longer exists. Refresh and try again." }
  }

  const sku = before.sku ?? String(variantId)
  const sold = moneyChange(before.selling_price, round2(patch.sellingPrice))
  const cost =
    patch.costPrice !== undefined
      ? moneyChange(before.cost_price, round2(patch.costPrice))
      : null
  // The actor rides in the summary: the RPC writes auth.uid() itself, and
  // this call arrives on the actor's own session so it names them — but the
  // feed shows the summary, and the summary should say who held the tablet.
  await logAudits(audit, [
    ...(sold
      ? [
          {
            type: "price.changed",
            refType: "variant",
            refId: variantId,
            summary: `${sku} · ${sold.summary} (till, ${actorName})`,
            detail: { sku, before: sold.before, after: sold.after, by: actorName },
          },
        ]
      : []),
    ...(cost
      ? [
          {
            type: "cost.changed",
            refType: "variant",
            refId: variantId,
            summary: `${sku} · ${cost.summary} (till, ${actorName})`,
            detail: { sku, before: cost.before, after: cost.after, by: actorName },
          },
        ]
      : []),
  ])

  return { ok: true }
}

export type ProductPatch = {
  name: string
  productCode: string
  shelfLocation: string | null
  isActive: boolean
}

/** The header fields a tablet can sensibly edit at the counter. */
export async function updateTillProduct(options: {
  db: Db
  audit: AuditClient
  actorName: string
  productId: number
  patch: ProductPatch
}): Promise<MutationResult> {
  const { db, audit, actorName, productId, patch } = options

  const name = patch.name.trim()
  if (!name) return { ok: false, error: "Product name is required.", field: "name" }
  if (name.length > 120) {
    return { ok: false, error: "Keep the name under 120 characters.", field: "name" }
  }
  const code = patch.productCode.trim()
  if (!code) return { ok: false, error: "Product code is required.", field: "productCode" }
  if (code.length > 40) {
    return { ok: false, error: "Keep the product code under 40 characters.", field: "productCode" }
  }
  const shelf = patch.shelfLocation?.trim() || null
  if (shelf && shelf.length > 120) {
    return { ok: false, error: "Keep the shelf location under 120 characters.", field: "shelfLocation" }
  }

  const { data: before } = await db
    .from("products")
    .select("name")
    .eq("id", productId)
    .maybeSingle()
  if (!before) return { ok: false, error: "That product no longer exists." }

  const { data: written, error: writeError } = await db
    .from("products")
    .update({
      name,
      product_code: code,
      shelf_location: shelf,
      is_active: patch.isActive,
    })
    .eq("id", productId)
    .select("id")
  if (writeError) {
    return {
      ok: false,
      error:
        writeError.code === "23505" &&
        /product_code/i.test(writeError.message)
          ? "That product code is already used by another product."
          : writeError.message,
    }
  }
  if ((written ?? []).length === 0) {
    return { ok: false, error: "That product no longer exists." }
  }

  if (before.name !== name) {
    await logAudits(audit, [
      {
        type: "product.changed",
        refType: "product",
        refId: productId,
        summary: `Renamed "${before.name}" to "${name}" (till, ${actorName})`,
        detail: { before: before.name, after: name, by: actorName },
      },
    ])
  }

  return { ok: true }
}

export type GenerateResult = {
  written: number
  /** Variants asked for that already carry a valid code — never touched. */
  skippedValid: number
  error: string | null
}

/**
 * Issue codes to variants that have none or an invalid one.
 *
 * The web's single-writer semantics, kept whole: a valid barcode already on
 * a printed sticker is never overwritten — re-read here so a stale tablet
 * list cannot clobber one — and each row is filled under a guard matching
 * what it was when read, so a concurrent write wins.
 */
export async function generateTillBarcodes(
  db: Db,
  variantIds: number[],
): Promise<GenerateResult> {
  if (variantIds.length === 0) return { written: 0, skippedValid: 0, error: null }

  const { data: rows, error: readError } = await db
    .from("product_variants")
    .select("id, barcode")
    .in("id", variantIds)
  if (readError) return { written: 0, skippedValid: 0, error: readError.message }

  const targets = (rows ?? []).filter(
    (row) => row.barcode === null || !isValidEan13(row.barcode),
  )
  const skippedValid = (rows ?? []).length - targets.length
  if (targets.length === 0) {
    return { written: 0, skippedValid, error: null }
  }

  // `auto` forced on: the flag only governs filling at creation, and an
  // explicit press must work even with it off — same as the web dialog.
  const settings = await getBarcodeSettings(db)
  const { codes, error: allocError } = await allocateBarcodes(db, targets.length, {
    ...settings,
    auto: true,
  })
  if (allocError) return { written: 0, skippedValid, error: allocError }
  if (codes.length !== targets.length) {
    return { written: 0, skippedValid, error: "Could not reserve enough barcode numbers. Try again." }
  }

  let written = 0
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]
    const update = db
      .from("product_variants")
      .update({ barcode: codes[i] })
      .eq("id", target.id)
    const guarded =
      target.barcode === null
        ? update.is("barcode", null)
        : update.eq("barcode", target.barcode)
    const { data, error } = await guarded.select("id")
    if (!error && (data ?? []).length > 0) written += 1
  }

  return { written, skippedValid, error: null }
}
