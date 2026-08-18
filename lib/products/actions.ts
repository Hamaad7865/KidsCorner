"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { logAudits, moneyChange } from "@/lib/activity/audit"
import { allocateBarcodes } from "@/lib/barcodes/settings"
import { canManageCatalog } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import { round2, slugifyForSku } from "@/lib/format"
import {
  boolOf,
  fieldErrorsOf,
  formFail as fail,
  formOk,
  idListOf,
  idOf,
  intOf,
  nullableTextOf,
  numberOf,
  textOf,
  type FormState,
} from "@/lib/forms"
import { createClient } from "@/lib/supabase/server"

import {
  generateVariantsSchema,
  productSchema,
  variantUpdateSchema,
} from "./schemas"

/**
 * Product and variant mutations.
 *
 * As with master data, RLS (`manage ON products|product_variants ... IN
 * ('owner','manager')`) is the real gate; the role check here exists to turn a
 * silent 42501 into a sentence.
 *
 * Only async functions may be exported from a `"use server"` module, so shared
 * state helpers live in `lib/forms`.
 */

async function requireCatalogManager(): Promise<FormState | null> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return fail("Your session has expired. Sign in again.")
  }
  if (!canManageCatalog(profile.role)) {
    return fail("Only an owner or manager can change the catalog.")
  }
  return null
}

function describeDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case "23505":
      return "That SKU or barcode is already used by another variant."
    case "23503":
      return "That category, brand, size or colour no longer exists. Refresh and try again."
    case "42501":
      return "You don't have permission to change the catalog."
    default:
      return error.message
  }
}

// --------------------------------------------------------------- products

export async function saveProduct(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireCatalogManager()
  if (denied) return denied

  const parsed = productSchema.safeParse({
    id: idOf(formData, "id"),
    name: textOf(formData, "name"),
    // 0 rather than null when unset, so zod reports "Pick a category" as a
    // field error instead of a type error.
    categoryId: intOf(formData, "categoryId", 0),
    brandId: idOf(formData, "brandId"),
    gender: textOf(formData, "gender"),
    shelfLocation: nullableTextOf(formData, "shelfLocation"),
    description: nullableTextOf(formData, "description"),
    imageUrl: nullableTextOf(formData, "imageUrl"),
    isActive: boolOf(formData, "isActive"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const {
    id,
    name,
    categoryId,
    brandId,
    gender,
    shelfLocation,
    description,
    imageUrl,
    isActive,
  } = parsed.data

  const values = {
    name,
    category_id: categoryId,
    brand_id: brandId,
    gender,
    shelf_location: shelfLocation,
    description,
    image_url: imageUrl,
    is_active: isActive,
  }

  const supabase = await createClient()

  if (id === null) {
    const { data, error } = await supabase
      .from("products")
      .insert(values)
      .select("id")
      .maybeSingle()

    if (error) return fail(describeDbError(error))
    if (!data) return fail("The product was not created. Please try again.")

    revalidatePath("/products")
    // A new product has no variants yet, so send the user straight to the
    // matrix — generating variants is the actual next step.
    redirect(`/products/${data.id}`)
  }

  const { data, error } = await supabase
    .from("products")
    .update(values)
    .eq("id", id)
    .select("id")

  if (error) return fail(describeDbError(error))
  if (data.length === 0) {
    return fail("That product no longer exists. It may have been deleted in another tab.")
  }

  revalidatePath("/products")
  revalidatePath(`/products/${id}`)
  return formOk("Product saved.")
}

// --------------------------------------------------------------- variants

export async function updateVariant(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireCatalogManager()
  if (denied) return denied

  // Guarded before zod: a bad id would otherwise produce a field error keyed
  // "id", and nothing renders that — the dialog would sit there showing nothing.
  const variantId = idOf(formData, "id")
  if (variantId === null) return fail("Couldn't tell which variant to save.")

  const parsed = variantUpdateSchema.safeParse({
    id: variantId,
    costPrice: numberOf(formData, "costPrice", 0),
    sellingPrice: numberOf(formData, "sellingPrice", 0),
    reorderLevel: intOf(formData, "reorderLevel", 0),
    barcode: nullableTextOf(formData, "barcode"),
    isActive: boolOf(formData, "isActive"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { id, costPrice, sellingPrice, reorderLevel, barcode, isActive } = parsed.data
  const productId = idOf(formData, "productId")

  const supabase = await createClient()

  // Read first, purely so the trail can say what the price WAS. A line reading
  // "Price changed" without a figure tells nobody anything, and a price edit
  // leaves no other record anywhere — the row is simply different afterwards.
  const { data: before } = await supabase
    .from("product_variants")
    .select("sku, cost_price, selling_price")
    .eq("id", id)
    .maybeSingle()

  // Who already has this barcode, if anyone. The unique index refuses a
  // duplicate either way — this is the friendly half, and the difference
  // matters: "already used by another variant" leaves a shopkeeper holding a
  // scanner with nothing to do next, while naming the garment ends it.
  //
  // A pre-check rather than a parse of the constraint violation, because
  // reading which column failed out of an error string is exactly what
  // migration 008 went out of its way to avoid. Two people saving the same
  // barcode at once still land on the index, which is the backstop working.
  if (barcode) {
    const { data: clash } = await supabase
      .from("product_variants")
      .select("id, products ( name ), sizes ( label ), colours ( name )")
      .eq("barcode", barcode)
      .neq("id", id)
      .maybeSingle()

    if (clash) {
      const what = [
        clash.products?.name,
        clash.colours?.name,
        clash.sizes?.label,
      ].filter(Boolean).join(" · ")
      return fail(null, {
        barcode: what
          ? `That barcode is already on ${what}.`
          : "That barcode is already on another variant.",
      })
    }
  }

  const { data, error } = await supabase
    .from("product_variants")
    .update({
      // Rounded here because the columns are NUMERIC(10,2): sending more
      // precision would be silently truncated, leaving the UI disagreeing
      // with what is actually stored.
      cost_price: round2(costPrice),
      selling_price: round2(sellingPrice),
      reorder_level: reorderLevel,
      barcode,
      is_active: isActive,
      // qty_on_hand is deliberately not written here — it is a cache owned by
      // the record_stock_movement RPC.
    })
    .eq("id", id)
    .select("id")

  if (error) return fail(describeDbError(error))
  if (data.length === 0) {
    return fail("That variant no longer exists. Refresh and try again.")
  }

  if (before) {
    const sku = before.sku ?? String(id)
    const sold = moneyChange(before.selling_price, round2(sellingPrice))
    const cost = moneyChange(before.cost_price, round2(costPrice))

    await logAudits(supabase, [
      ...(sold
        ? [{
            type: "price.changed",
            refType: "variant",
            refId: id,
            summary: `${sku} · ${sold.summary}`,
            detail: { sku, before: sold.before, after: sold.after },
          }]
        : []),
      ...(cost
        ? [{
            type: "cost.changed",
            refType: "variant",
            refId: id,
            summary: `${sku} · ${cost.summary}`,
            detail: { sku, before: cost.before, after: cost.after },
          }]
        : []),
    ])
  }

  revalidatePath("/products")
  if (productId !== null) revalidatePath(`/products/${productId}`)
  return formOk("Variant saved.")
}

/**
 * Creates every size × colour combination that does not already exist.
 *
 * SKUs follow the spec's `{PRODUCTID}-{SIZE}-{COLOUR}` pattern, slugified.
 * Because two different labels can slugify to the same string ("2-3 yrs" and
 * "2 3 yrs" both give "2-3-YRS"), the generated SKU is checked against both the
 * existing rows and the rest of this batch, and disambiguated with the size and
 * colour ids on collision. `sku` is UNIQUE, so an undetected clash would abort
 * the whole insert.
 */
export async function generateVariants(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireCatalogManager()
  if (denied) return denied

  // Same reasoning as updateVariant: no UI renders a "productId" field error.
  const product = idOf(formData, "productId")
  if (product === null) return fail("Couldn't tell which product to add variants to.")

  const parsed = generateVariantsSchema.safeParse({
    productId: product,
    sizeIds: idListOf(formData, "sizeIds"),
    colourIds: idListOf(formData, "colourIds"),
    costPrice: numberOf(formData, "costPrice", 0),
    sellingPrice: numberOf(formData, "sellingPrice", 0),
    reorderLevel: intOf(formData, "reorderLevel", 0),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { productId, sizeIds, colourIds, costPrice, sellingPrice, reorderLevel } =
    parsed.data

  const supabase = await createClient()

  const [existingResult, sizesResult, coloursResult] = await Promise.all([
    supabase
      .from("product_variants")
      .select("size_id, colour_id")
      .eq("product_id", productId),
    supabase.from("sizes").select("id, label").in("id", sizeIds),
    supabase.from("colours").select("id, name").in("id", colourIds),
  ])

  const failed = [existingResult, sizesResult, coloursResult].find((r) => r.error)
  if (failed?.error) return fail(describeDbError(failed.error))

  const sizeLabels = new Map((sizesResult.data ?? []).map((s) => [s.id, s.label]))
  const colourNames = new Map((coloursResult.data ?? []).map((c) => [c.id, c.name]))

  if (sizeLabels.size === 0 || colourNames.size === 0) {
    return fail("Those sizes or colours no longer exist. Refresh and try again.")
  }

  const existing = new Set(
    (existingResult.data ?? []).map((v) => `${v.size_id}:${v.colour_id}`),
  )

  // Which combinations we intend to create, and the SKU each one wants.
  const planned: { sizeId: number; colourId: number; baseSku: string }[] = []
  let skipped = 0

  for (const sizeId of sizeIds) {
    for (const colourId of colourIds) {
      const label = sizeLabels.get(sizeId)
      const colour = colourNames.get(colourId)
      if (existing.has(`${sizeId}:${colourId}`) || !label || !colour) {
        skipped += 1
        continue
      }
      planned.push({
        sizeId,
        colourId,
        baseSku: `${productId}-${slugifyForSku(label)}-${slugifyForSku(colour)}`,
      })
    }
  }

  // Check only the SKUs we are about to use, never the whole table. `sku` is
  // UNIQUE across all products, but selecting every row would be silently
  // truncated by PostgREST's max-rows (1000 by default on Supabase) — past that
  // a real collision would slip through and abort the entire batch insert with
  // a 23505. Scoping the lookup keeps it exact at any catalog size.
  const takenSkus = new Set<string>()
  if (planned.length > 0) {
    const { data: clashes, error: clashError } = await supabase
      .from("product_variants")
      .select("sku")
      .in(
        "sku",
        planned.map((p) => p.baseSku),
      )
    if (clashError) return fail(describeDbError(clashError))
    for (const row of clashes ?? []) takenSkus.add(row.sku)
  }

  const rows: {
    product_id: number
    size_id: number
    colour_id: number
    sku: string
    barcode: string | null
    cost_price: number
    selling_price: number
    reorder_level: number
  }[] = []

  for (const { sizeId, colourId, baseSku } of planned) {
    // Two labels can slugify to the same string ("2-3 yrs" and "2 3 yrs" both
    // give 2-3-YRS), so a base SKU can clash with an existing row or with
    // another combination in this same batch. The id suffix is unique by
    // construction because (product, size, colour) is unique.
    const sku = takenSkus.has(baseSku) ? `${baseSku}-${sizeId}-${colourId}` : baseSku
    if (takenSkus.has(sku)) {
      skipped += 1
      continue
    }
    takenSkus.add(sku)

    rows.push({
      product_id: productId,
      size_id: sizeId,
      colour_id: colourId,
      sku,
      // Filled in below, once we know how many rows survived de-duplication.
      barcode: null,
      cost_price: round2(costPrice),
      selling_price: round2(sellingPrice),
      reorder_level: reorderLevel,
    })
  }

  if (rows.length === 0) {
    return fail(
      skipped > 0
        ? "Every one of those combinations already exists on this product."
        : "Nothing to create.",
    )
  }

  // One reservation for the whole batch. Allocating per row would mean N round
  // trips and N chances to half-fail; this way the codes either all exist
  // before the insert or none do.
  const { codes, error: barcodeError } = await allocateBarcodes(supabase, rows.length)
  if (codes.length === rows.length) {
    rows.forEach((row, i) => {
      row.barcode = codes[i]
    })
  }

  const { error } = await supabase.from("product_variants").insert(rows)
  if (error) return fail(describeDbError(error))

  revalidatePath("/products")
  revalidatePath(`/products/${productId}`)
  // Issuing codes moved the counter, and Settings displays it. Without this the
  // field there goes stale, and the next save from that page is refused as a
  // rewind — an error about a number the shopkeeper never touched.
  if (codes.length > 0) revalidatePath("/settings")

  const created = `${rows.length} variant${rows.length === 1 ? "" : "s"} created`
  const notes: string[] = []
  if (skipped > 0) notes.push(`${skipped} already existed`)
  // Variants are still created without codes — the generate dialog on the
  // product page fills them in later. Saying so beats a silent blank column.
  if (barcodeError) notes.push(`no barcodes issued (${barcodeError})`)

  return formOk(
    notes.length > 0 ? `${created}, ${notes.join(", ")}.` : `${created}.`,
  )
}
