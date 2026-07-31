/**
 * Postgres CHECK constraints from migration 001 expressed as TypeScript unions.
 *
 * The schema uses `TEXT ... CHECK (col IN (...))` rather than real Postgres
 * enums, so `supabase gen types` widens these columns to `string`. These unions
 * live outside `database.types.ts` on purpose: regenerating that file must never
 * wipe them. Keep them in step with 001 — the migration is the source of truth.
 */

export const ROLES = ["owner", "manager", "cashier"] as const
export type Role = (typeof ROLES)[number]

export const GENDERS = ["boy", "girl", "unisex"] as const
export type Gender = (typeof GENDERS)[number]

export const SIZE_TYPES = ["age_range", "shoe_size"] as const
export type SizeType = (typeof SIZE_TYPES)[number]

/** Clothing sizes are age ranges ("2-3 yrs"); footwear uses EU numbers ("EU 24"). */
export const SIZE_TYPE_LABELS: Record<SizeType, string> = {
  age_range: "Age range",
  shoe_size: "Shoe size",
}

export const MOVEMENT_TYPES = [
  "purchase",
  "sale",
  "adjustment",
  "return",
  "opening",
  "import",
] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  purchase: "Purchase",
  sale: "Sale",
  adjustment: "Adjustment",
  return: "Return",
  opening: "Opening",
  import: "Import",
}

export const PURCHASE_STATUSES = ["draft", "received", "cancelled"] as const
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number]

export const SALE_STATUSES = ["completed", "refunded", "void"] as const
export type SaleStatus = (typeof SALE_STATUSES)[number]

export const PAYMENT_METHODS = ["cash", "card", "juice", "myt_money"] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  juice: "Juice",
  myt_money: "my.t money",
}

function isMember<T extends readonly string[]>(
  values: T,
  value: string | null | undefined,
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value)
}

export function isRole(value: string | null | undefined): value is Role {
  return isMember(ROLES, value)
}

export function isGender(value: string | null | undefined): value is Gender {
  return isMember(GENDERS, value)
}

export function isSizeType(value: string | null | undefined): value is SizeType {
  return isMember(SIZE_TYPES, value)
}

export function isMovementType(
  value: string | null | undefined,
): value is MovementType {
  return isMember(MOVEMENT_TYPES, value)
}

export function isPaymentMethod(
  value: string | null | undefined,
): value is PaymentMethod {
  return isMember(PAYMENT_METHODS, value)
}

export function isPurchaseStatus(
  value: string | null | undefined,
): value is PurchaseStatus {
  return isMember(PURCHASE_STATUSES, value)
}

export function isSaleStatus(value: string | null | undefined): value is SaleStatus {
  return isMember(SALE_STATUSES, value)
}
