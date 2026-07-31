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
  {
    key: "size",
    label: "Size / Age Range",
    required: true,
    aliases: ["size age range", "size", "age range", "age", "sizes", "eu size"],
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

/** Parses a money value, tolerating "Rs 1,250.00" and blank cells. */
export function parseMoney(value: string | undefined): number | null {
  if (value === undefined) return null
  const cleaned = value.replace(/[^0-9.\-]/g, "")
  if (cleaned === "" || cleaned === "-") return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

/** Parses a whole-number quantity. Returns null when unparseable. */
export function parseQty(value: string | undefined): number | null {
  if (value === undefined) return null
  const cleaned = value.replace(/[^0-9.\-]/g, "")
  if (cleaned === "" || cleaned === "-") return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
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

export const TEMPLATE_SAMPLE_ROWS = [
  ["Striped cotton t-shirt", "T-Shirts", "Zara Kids", "Boy", "2-3 yrs", "Navy", 180, 320, 12, "6291041500213"],
  ["Striped cotton t-shirt", "T-Shirts", "Zara Kids", "Boy", "3-4 yrs", "Navy", 180, 320, 8, "6291041500214"],
  ["Striped cotton t-shirt", "T-Shirts", "Zara Kids", "Boy", "2-3 yrs", "Red", 180, 320, 5, ""],
  ["Canvas sandals", "Sandals", "", "Girl", "EU 24", "Pink", 240, 450, 6, ""],
]
