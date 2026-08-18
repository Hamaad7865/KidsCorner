/**
 * Column contract for the Excel import.
 *
 * One spreadsheet row is one *variant*; the product name repeats across its
 * size and colour rows. Aliases exist so a supplier's own header row usually
 * auto-maps without the user touching the dropdowns — they can always override.
 *
 * Client-safe: no server imports, because the file is parsed in the browser.
 */

export const IMPORT_FIELDS = [
  {
    key: "productName",
    label: "Product Name",
    required: true,
    aliases: ["product name", "product", "name", "item", "item name", "description"],
  },
  {
    key: "category",
    label: "Category",
    required: true,
    aliases: ["category", "cat", "type", "product type"],
  },
  {
    key: "brand",
    label: "Brand",
    required: false,
    aliases: ["brand", "make", "label", "supplier brand"],
  },
  {
    key: "gender",
    label: "Gender",
    required: false,
    aliases: ["gender", "sex", "for", "boy girl"],
  },
  // Three columns, one per size_type in the schema. Clothing is sized by age
  // ("2-3 yrs") or by letter ("S"–"XXXL"); footwear by its EU number. A variant
  // carries exactly one, so a row fills exactly one of these three (enforced in
  // validate.ts) — which is what lets the importer stop *guessing* the type.
  // A bare "Size" header maps to none of them on purpose: with three size kinds
  // it is genuinely ambiguous, so the user picks rather than the tool guessing.
  {
    key: "ageRange",
    label: "Age Range",
    required: false,
    aliases: ["age range", "age", "age months", "age years", "age mths", "age yrs"],
  },
  {
    key: "clothingSize",
    label: "Clothing Size",
    required: false,
    aliases: ["clothing size", "letter size", "garment size", "top size", "apparel size", "size letter"],
  },
  {
    key: "shoeSize",
    label: "Shoe Size",
    required: false,
    aliases: ["shoe size", "eu size", "eu", "shoe", "foot size"],
  },
  {
    key: "colour",
    label: "Colour",
    required: true,
    aliases: ["colour", "color", "col", "shade"],
  },
  {
    key: "costPrice",
    label: "Cost Price",
    required: false,
    aliases: ["cost price", "cost", "buy price", "purchase price", "unit cost"],
  },
  {
    key: "sellPrice",
    label: "Sell Price",
    required: true,
    aliases: ["sell price", "selling price", "price", "retail", "retail price", "rrp"],
  },
  {
    key: "quantity",
    label: "Quantity",
    required: true,
    aliases: ["quantity", "qty", "stock", "count", "units", "pcs"],
  },
  {
    key: "barcode",
    label: "Barcode",
    required: false,
    aliases: ["barcode", "bar code", "ean", "upc", "gtin"],
  },
  {
    key: "shelfLocation",
    label: "Shelf Location",
    required: false,
    aliases: ["shelf location", "shelf", "shelf code", "rack", "rack location"],
  },
  {
    key: "location",
    label: "Location",
    required: false,
    aliases: ["location", "stock location", "stockroom", "shop warehouse"],
  },
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"]

export const REQUIRED_FIELDS = IMPORT_FIELDS.filter((f) => f.required).map(
  (f) => f.key,
)

/** Maps each field to the spreadsheet column header it reads from. */
export type ColumnMapping = Partial<Record<ImportField, string>>

/** A single spreadsheet row, already mapped onto our field names. */
export type RawRow = {
  /** 1-based row number as it appears in Excel, for error reports. */
  rowNumber: number
  values: Partial<Record<ImportField, string>>
}

/**
 * Loose comparison key for header matching and for looking master data up by
 * name: case-insensitive, accent-stripped, and punctuation-agnostic so
 * "Age Range", "age_range" and "age-range" all agree.
 */
// Built from escapes so the source file stays plain ASCII — a literal range of
// combining marks is easy to mangle in an editor (same approach as lib/format).
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g")

export function normaliseKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export type StockLocationName = "Shop" | "Warehouse"

/** Blank remains backwards-compatible with old templates by allocating to Shop. */
export function parseStockLocation(
  value: string | undefined,
): StockLocationName | null {
  const key = normaliseKey(value ?? "")
  if (key === "") return "Shop"
  if (key === "shop" || key === "shop floor") return "Shop"
  if (key === "warehouse") return "Warehouse"
  return null
}

/** Best-guess mapping from the sheet's header row to our fields. */
export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const used = new Set<string>()

  for (const field of IMPORT_FIELDS) {
    const match = headers.find((header) => {
      if (used.has(header)) return false
      const key = normaliseKey(header)
      // `as const` narrows aliases to a literal tuple, so `includes` would only
      // accept those exact literals; widen it to compare against any string.
      const aliases = field.aliases as readonly string[]
      return key === normaliseKey(field.label) || aliases.includes(key)
    })
    if (match) {
      mapping[field.key] = match
      used.add(match)
    }
  }
  return mapping
}

/**
 * A number out of a spreadsheet cell, in either of the conventions a
 * Mauritian shop actually receives.
 *
 * Both are routine here: an English-locale export writes 1 234,50 as
 * "1,234.50" and a French-locale one writes it as "1 234,50". Stripping every
 * non-digit and calling Number() — what this used to do — reads the second as
 * 123450, a HUNDREDFOLD overcharge that reaches the till with nothing
 * downstream to catch it, because the result is a perfectly finite number and
 * validation only checks that.
 *
 * The rule, which resolves every case a price or a quantity can present:
 *
 *   • Both separators → the RIGHTMOST is the decimal point, the other groups
 *     thousands. "1.234,50" is 1234.50 and "1,234.50" is the same figure.
 *   • One separator, appearing more than once → it groups thousands.
 *     "1,234,567" is 1234567.
 *   • One separator followed by exactly three digits → it groups thousands.
 *     "1,234" and "1.234" are both 1234. Money here is quoted to two decimals,
 *     so a three-decimal price is a misread grouping far more often than it is
 *     a real figure.
 *   • Otherwise it is the decimal point. "1,50" is 1.50, "1.5" is 1.5.
 *
 * Spaces group thousands in the French convention, including the non-breaking
 * and narrow ones Excel emits, so they are removed before any of this.
 */
function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null

  // Strip currency, spaces of every stripe, and anything else that is not a
  // digit, a separator or a leading minus.
  const trimmed = value.replace(/[\s   ]/g, "")
  const negative = /^-/.test(trimmed)
  const body = trimmed.replace(/[^0-9.,]/g, "")
  if (body === "") return null

  const lastDot = body.lastIndexOf(".")
  const lastComma = body.lastIndexOf(",")

  let decimalAt = -1
  if (lastDot >= 0 && lastComma >= 0) {
    decimalAt = Math.max(lastDot, lastComma)
  } else if (lastDot >= 0 || lastComma >= 0) {
    const at = Math.max(lastDot, lastComma)
    const sep = body[at]!
    const occurrences = body.split(sep).length - 1
    const trailing = body.length - at - 1
    // Repeated, or grouping exactly three digits: a thousands separator.
    decimalAt = occurrences > 1 || trailing === 3 ? -1 : at
  }

  const digitsOnly = (s: string) => s.replace(/[^0-9]/g, "")
  const whole = digitsOnly(decimalAt >= 0 ? body.slice(0, decimalAt) : body)
  const fraction = decimalAt >= 0 ? digitsOnly(body.slice(decimalAt + 1)) : ""
  if (whole === "" && fraction === "") return null

  const parsed = Number(`${whole || "0"}.${fraction || "0"}`)
  if (!Number.isFinite(parsed)) return null
  return negative ? -parsed : parsed
}

/** Parses a money value, tolerating "Rs 1,250.00", "1 234,50" and blank cells. */
export function parseMoney(value: string | undefined): number | null {
  return parseNumber(value)
}

/** Parses a whole-number quantity. Returns null when unparseable. */
export function parseQty(value: string | undefined): number | null {
  const parsed = parseNumber(value)
  return parsed === null ? null : Math.trunc(parsed)
}

const GENDER_WORDS: Record<string, "boy" | "girl" | "unisex"> = {
  boy: "boy",
  boys: "boy",
  b: "boy",
  m: "boy",
  male: "boy",
  girl: "girl",
  girls: "girl",
  g: "girl",
  f: "girl",
  female: "girl",
  unisex: "unisex",
  u: "unisex",
  both: "unisex",
  any: "unisex",
}

/** Spreadsheets say "Boys", "M", "unisex" — all of which mean something here. */
export function parseGender(value: string | undefined): "boy" | "girl" | "unisex" {
  if (!value) return "unisex"
  return GENDER_WORDS[normaliseKey(value)] ?? "unisex"
}

/** The template's header row, in the order the spec lists them. */
export const TEMPLATE_HEADERS = IMPORT_FIELDS.map((f) => f.label)

// Age Range, Clothing Size and Shoe Size are three separate columns; each row
// fills exactly one. The age t-shirts leave the other two blank; the graphic
// tee is sized "M" (Clothing Size); the sandals carry a Shoe Size. That is the
// shape the importer expects — one size kind per row.
export const TEMPLATE_SAMPLE_ROWS = [
  ["Striped cotton t-shirt", "T-Shirts", "Zara Kids", "Boy", "2-3 yrs", "", "", "Navy", 180, 320, 12, "6291041500213", "A12", "Shop"],
  ["Striped cotton t-shirt", "T-Shirts", "Zara Kids", "Boy", "3-4 yrs", "", "", "Navy", 180, 320, 8, "6291041500214", "A12", "Shop"],
  ["Striped cotton t-shirt", "T-Shirts", "Zara Kids", "Boy", "2-3 yrs", "", "", "Red", 180, 320, 5, "", "A12", "Warehouse"],
  ["Graphic tee", "T-Shirts", "Zara Kids", "Boy", "", "M", "", "Navy", 190, 340, 9, "", "B03", "Shop"],
  ["Canvas sandals", "Sandals", "", "Girl", "", "", "EU 24", "Pink", 240, 450, 6, "", "S08", "Warehouse"],
]
