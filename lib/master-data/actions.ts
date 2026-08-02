"use server"

import { revalidatePath } from "next/cache"

import { canManageCatalog } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import {
  boolOf,
  fieldErrorsOf,
  formFail as fail,
  formOk,
  idOf,
  intOf,
  nullableTextOf,
  textOf,
  type FormState,
} from "@/lib/forms"
import { createClient } from "@/lib/supabase/server"

import { brandSchema, categorySchema, colourSchema, sizeSchema } from "./schemas"

/**
 * Master data mutations for the settings screen.
 *
 * RLS (`manage ON categories|brands|colours|sizes ... IN ('owner','manager')`)
 * is the real gate. The role check here is so a cashier gets a sentence instead
 * of an opaque 42501, and so the UI and the database agree about who may write.
 *
 * This module may only export async functions — Next validates that at runtime
 * and throws on anything else — so the shared state type, the idle constant and
 * the FormData coercion helpers all live in `lib/forms`.
 */

const MASTER_TABLES = ["categories", "brands", "colours", "sizes"] as const
type MasterTable = (typeof MASTER_TABLES)[number]

/** Singular, for error copy: "A brand called X already exists." */
const SINGULAR: Record<MasterTable, string> = {
  categories: "category",
  brands: "brand",
  colours: "colour",
  sizes: "size",
}

function isMasterTable(value: unknown): value is MasterTable {
  return (
    typeof value === "string" && (MASTER_TABLES as readonly string[]).includes(value)
  )
}

function succeed(): FormState {
  revalidatePath("/settings")
  return formOk()
}

/**
 * Turns a Postgres error into something actionable.
 *
 * The two that matter here are 23505 (the name is taken) and 23503 (something
 * still references this row) — the latter is why every master table carries
 * `is_active`: deactivating preserves history that deleting would destroy.
 */
function describeDbError(
  error: { code?: string; message: string },
  table: MasterTable,
  name?: string,
): string {
  const noun = SINGULAR[table]
  switch (error.code) {
    case "23505":
      return name
        ? `A ${noun} called "${name}" already exists.`
        : `That ${noun} already exists.`
    case "23503":
      return `This ${noun} is still used by existing products, so it can't be deleted. Deactivate it instead — that hides it from new entry without altering past records.`
    case "42501":
      return `You don't have permission to change ${table}.`
    default:
      return error.message
  }
}

/** Shared guard: a session, and a role RLS will actually accept. */
async function requireCatalogManager(): Promise<FormState | null> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return fail("Your session has expired. Sign in again.")
  }
  if (!canManageCatalog(profile.role)) {
    return fail("Only an owner or manager can change master data.")
  }
  return null
}

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Runs a write and maps the outcome. The caller supplies the query rather than
 * a payload object: `supabase.from(table)` with a *union* of table names widens
 * the accepted row to a union too, which no single object type satisfies.
 * Building the query against a literal table name keeps every column checked.
 */
async function runWrite(
  build: (supabase: ServerClient) => PromiseLike<{
    error: { code?: string; message: string } | null
    data: unknown[] | null
  }>,
  table: MasterTable,
  displayName?: string,
): Promise<FormState> {
  const supabase = await createClient()
  const { data, error } = await build(supabase)

  if (error) {
    // 23503 is the one failure with an obvious next move — the row is still
    // referenced, so deactivating is what the shop actually wants. Flagged in
    // `fieldErrors` so the dialog can offer that button rather than only
    // naming it, which is what it used to do.
    return fail(
      describeDbError(error, table, displayName),
      error.code === "23503" ? { inUse: "1" } : {},
    )
  }

  // Every caller ends in `.select("id")`, so `data` is the rows actually
  // written. An UPDATE or DELETE whose filter matches nothing returns neither
  // an error nor a row — without this check the UI would report success and
  // silently do nothing, which is how a stale second tab corrupts someone's
  // mental model of what is in the database.
  if (Array.isArray(data) && data.length === 0) {
    return fail(
      `That ${SINGULAR[table]} no longer exists — it may have been removed in another tab. Refresh and try again.`,
    )
  }

  return succeed()
}

// ------------------------------------------------------------- categories

export async function saveCategory(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireCatalogManager()
  if (denied) return denied

  const parsed = categorySchema.safeParse({
    id: idOf(formData, "id"),
    name: textOf(formData, "name"),
    parentId: idOf(formData, "parentId"),
    isActive: boolOf(formData, "isActive"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { id, name, parentId, isActive } = parsed.data
  const values = { name, parent_id: parentId, is_active: isActive }

  return runWrite(
    (sb) =>
      id === null
        ? sb.from("categories").insert(values).select("id")
        : sb.from("categories").update(values).eq("id", id).select("id"),
    "categories",
    name,
  )
}

// ----------------------------------------------------------------- brands

export async function saveBrand(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireCatalogManager()
  if (denied) return denied

  const parsed = brandSchema.safeParse({
    id: idOf(formData, "id"),
    name: textOf(formData, "name"),
    isActive: boolOf(formData, "isActive"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { id, name, isActive } = parsed.data
  const values = { name, is_active: isActive }

  return runWrite(
    (sb) =>
      id === null
        ? sb.from("brands").insert(values).select("id")
        : sb.from("brands").update(values).eq("id", id).select("id"),
    "brands",
    name,
  )
}

// ---------------------------------------------------------------- colours

export async function saveColour(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireCatalogManager()
  if (denied) return denied

  const parsed = colourSchema.safeParse({
    id: idOf(formData, "id"),
    name: textOf(formData, "name"),
    hexCode: nullableTextOf(formData, "hexCode"),
    isActive: boolOf(formData, "isActive"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { id, name, hexCode, isActive } = parsed.data
  const values = { name, hex_code: hexCode, is_active: isActive }

  return runWrite(
    (sb) =>
      id === null
        ? sb.from("colours").insert(values).select("id")
        : sb.from("colours").update(values).eq("id", id).select("id"),
    "colours",
    name,
  )
}

// ------------------------------------------------------------------ sizes

export async function saveSize(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireCatalogManager()
  if (denied) return denied

  const parsed = sizeSchema.safeParse({
    id: idOf(formData, "id"),
    sizeType: textOf(formData, "sizeType"),
    label: textOf(formData, "label"),
    sortOrder: intOf(formData, "sortOrder", 0),
    isActive: boolOf(formData, "isActive"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { id, sizeType, label, sortOrder, isActive } = parsed.data
  const values = {
    size_type: sizeType,
    label,
    sort_order: sortOrder,
    is_active: isActive,
  }

  return runWrite(
    (sb) =>
      id === null
        ? sb.from("sizes").insert(values).select("id")
        : sb.from("sizes").update(values).eq("id", id).select("id"),
    "sizes",
    label,
  )
}

// -------------------------------------------------------- delete / toggle
// Uniform across all four tables: each has an `id` and an `is_active`. `kind`
// is checked against a literal whitelist so it can never name another table.

export async function deleteMasterRow(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireCatalogManager()
  if (denied) return denied

  const kind = textOf(formData, "kind")
  const id = idOf(formData, "id")
  if (!isMasterTable(kind) || id === null) return fail("Nothing to delete.")

  return runWrite((sb) => sb.from(kind).delete().eq("id", id).select("id"), kind)
}

export async function setMasterRowActive(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireCatalogManager()
  if (denied) return denied

  const kind = textOf(formData, "kind")
  const id = idOf(formData, "id")
  if (!isMasterTable(kind) || id === null) return fail("Nothing to update.")

  const isActive = boolOf(formData, "isActive")

  return runWrite(
    (sb) => sb.from(kind).update({ is_active: isActive }).eq("id", id).select("id"),
    kind,
  )
}
