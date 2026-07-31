import type { z } from "zod"

/**
 * Shared plumbing for server-action-backed forms.
 *
 * This module exists partly for reuse and partly because of a hard constraint:
 * a `"use server"` file may only export async functions. Next ships a runtime
 * validator (`ensureServerEntryExports`) that throws
 * `A "use server" file can only export async functions, found object` — so the
 * idle state constant and these helpers cannot live in an actions module even
 * though that is where they are used.
 */

export type FormState = {
  status: "idle" | "success" | "error"
  /** Form-level message. Field-level problems go in `fieldErrors`. */
  error: string | null
  /** Success feedback, e.g. "12 variants created, 3 already existed". */
  message: string | null
  fieldErrors: Record<string, string>
}

export const IDLE_STATE: FormState = {
  status: "idle",
  error: null,
  message: null,
  fieldErrors: {},
}

/** `error` is null when every problem is field-level and rendered inline. */
export function formFail(
  error: string | null,
  fieldErrors: Record<string, string> = {},
): FormState {
  return { status: "error", error, message: null, fieldErrors }
}

export function formOk(message: string | null = null): FormState {
  return { status: "success", error: null, message, fieldErrors: {} }
}

/** Flattens a ZodError into the shape the forms render — first issue per field. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === "string" && !(key in out)) out[key] = issue.message
  }
  return out
}

// ---------------------------------------------------------------- coercion
// FormData is all strings. These normalise before zod sees the values, so the
// schemas can describe the real shape instead of parsing strings.

export function textOf(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

/** A positive integer id, or null when absent/blank/malformed. */
export function idOf(formData: FormData, key: string): number | null {
  const raw = textOf(formData, key).trim()
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** NaN on malformed input so the zod `.int()` check reports it as a field error. */
export function intOf(formData: FormData, key: string, fallback: number): number {
  const raw = textOf(formData, key).trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : NaN
}

/** NaN on malformed input, for the same reason as `intOf`. */
export function numberOf(formData: FormData, key: string, fallback: number): number {
  const raw = textOf(formData, key).trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : NaN
}

/** An unchecked checkbox sends nothing at all, which is the `false` case. */
export function boolOf(formData: FormData, key: string): boolean {
  const raw = textOf(formData, key)
  return raw === "on" || raw === "true"
}

export function nullableTextOf(formData: FormData, key: string): string | null {
  const raw = textOf(formData, key).trim()
  return raw === "" ? null : raw
}

/** Repeated checkbox inputs (`name="sizeIds"`) arrive as multiple entries. */
export function idListOf(formData: FormData, key: string): number[] {
  return formData
    .getAll(key)
    .map((value) => (typeof value === "string" ? Number(value.trim()) : NaN))
    .filter((value) => Number.isInteger(value) && value > 0)
}
