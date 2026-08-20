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

// Ordered as the size manager and the variant matrix group them: the two ways
// clothing is sized (by age, then by S–XXXL), then footwear.
export const SIZE_TYPES = ["age_range", "letter_size", "shoe_size"] as const
export type SizeType = (typeof SIZE_TYPES)[number]

/**
 * The three ways stock is sized. Clothing is sold either by age ("2-3 yrs") or
 * by letter ("S"–"XXXL"); footwear uses EU numbers ("EU 24"). A variant carries
 * exactly one, so these never mix on a single item.
 */
export const SIZE_TYPE_LABELS: Record<SizeType, string> = {
  age_range: "Age range",
  letter_size: "Clothing size",
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

/**
 * Every method the ledger has ever been written in — NOT what the shop offers.
 *
 * The two lists are different on purpose, and migration 040 says why at
 * length: this one only grows, because ten payments are already recorded as
 * `myt_money` and a receipt reprinted next year still has to render them.
 * What the shop offers today is `settings.payment_methods`, which both tills
 * read; retiring a method is a change there and nowhere else.
 *
 * So `myt_money` stays here, and stays out of the settings list.
 *
 * `credit` is here for a different reason, and it is the one member of this
 * union that is not money. It means "billed to the customer's account" — the
 * sale is complete and the shop is owed. It is deliberately absent from
 * `settings.payment_methods` too, because both tills draw their tender tiles
 * from that list and would then offer it unconditionally: credit is the only
 * tender that is illegal without an attached customer and refusable because of
 * a limit, so the tills gate it explicitly instead.
 *
 * Anything totalling "money we took" must therefore exclude it. See
 * `isCollectedMethod` below, which is that filter and the reason it exists.
 */
export const PAYMENT_METHODS = [
  "cash",
  "card",
  "juice",
  "myt_money",
  "bank",
  "credit",
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  juice: "Juice",
  myt_money: "my.t money",
  bank: "Bank",
  credit: "On account",
}

/**
 * Did this tender actually bring money in?
 *
 * True for everything except `credit`, which records a debt rather than a
 * receipt. Every figure that means "collected", "taken", "banked" or "in the
 * drawer" has to filter on this — a Rs 5,000 sale on account is Rs 5,000 of
 * turnover and Rs 0 of cash, and code that cannot tell those apart reports a
 * day's takings as thousands more than the shop is holding.
 *
 * Named for what it asks rather than as `!== "credit"` so that the next
 * non-cash-settling tender added here is caught by every existing caller.
 */
export function isCollectedMethod(method: string): boolean {
  return method !== "credit"
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
