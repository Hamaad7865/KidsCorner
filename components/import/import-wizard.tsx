"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronLeft,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StatusPanel } from "@/components/import/status-panel"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  createMissingMasters,
  findExistingBarcodes,
  findExistingProductCodes,
  importChunk,
  type ChunkResult,
  type CommitRow,
  type CreatedMaster,
  type ImportMasterKind,
} from "@/lib/import/actions"
import {
  IMPORT_FIELDS,
  TEMPLATE_HEADERS,
  TEMPLATE_SAMPLE_ROWS,
  autoMapColumns,
  normaliseKey,
  type ColumnMapping,
  type ImportField,
  type RawRow,
} from "@/lib/import/columns"
import {
  buildErrorReport,
  buildLookup,
  importableRows,
  validateRows,
  type MissingMaster,
  type ValidatedRow,
  type ValidationSummary,
} from "@/lib/import/validate"
import type { MasterData } from "@/lib/master-data/queries"
import { cn } from "@/lib/utils"

/** Rows per server round trip, so the progress bar reflects real work. */
const CHUNK_SIZE = 25

const UNMAPPED = "__none__"

/** localStorage key for the "Use again" card on the upload step. */
const LAST_IMPORT_KEY = "kc-import-last"
/** Keep the persisted file well under the ~5MB localStorage budget. */
const LAST_IMPORT_MAX_BYTES = 3_500_000

type LastImport = {
  name: string
  at: string
  headers: string[]
  rows: string[][]
}

/** Module-level so their identity is stable across renders. */
const NO_BARCODES: ReadonlySet<string> = new Set<string>()
const NO_PRODUCT_CODES: ReadonlySet<string> = new Set<string>()

/**
 * The store behind the last-import read never changes mid-session — the
 * wizard writes it and immediately re-renders — so there is nothing to
 * subscribe to. useSyncExternalStore only needs the snapshot re-read.
 */
const subscribeToNothing = () => () => {}

type Step = 1 | 2 | 3

type Totals = {
  productsCreated: number
  variantsCreated: number
  variantsUpdated: number
  stockAdded: number
  skipped: { rowNumber: number; reason: string }[]
  /** First barcode-allocation failure seen, if any. Kept once, not per chunk. */
  barcodeError: string | null
}

const ZERO: Totals = {
  productsCreated: 0,
  variantsCreated: 0,
  variantsUpdated: 0,
  stockAdded: 0,
  skipped: [],
  barcodeError: null,
}

function downloadBlob(contents: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** A/B/C… for the grid's column letters, the way the spreadsheet shows them. */
function columnLetter(index: number): string {
  let n = index
  let out = ""
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/** Example cell for a field, straight off the template's first sample row. */
const FIELD_EXAMPLES: Record<string, string> = (() => {
  const examples: Record<string, string> = {}
  IMPORT_FIELDS.forEach((field, i) => {
    const raw = TEMPLATE_SAMPLE_ROWS[0]?.[i]
    examples[field.key] = raw === undefined ? "" : String(raw)
  })
  return examples
})()

const FIELD_OF_KIND: Record<MissingMaster["kind"], ImportField[]> = {
  category: ["category"],
  brand: ["brand"],
  colour: ["colour"],
  size: ["ageRange", "clothingSize", "shoeSize"],
}

function missingKey(item: MissingMaster): string {
  return `${item.kind}:${item.sizeType ?? ""}:${normaliseKey(item.name)}`
}

type RowFilter = "all" | "errors" | "new" | "ready"

export function ImportWizard({ master }: { master: MasterData }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [existingBarcodes, setExistingBarcodes] = useState<Set<string>>(new Set())
  /** Set when the duplicate-barcode check could not complete. */
  const [barcodeCheckError, setBarcodeCheckError] = useState<string | null>(null)
  const [existingProductCodes, setExistingProductCodes] = useState<Set<string>>(new Set())
  /** Set when the duplicate-product-code check could not complete. */
  const [productCodeCheckError, setProductCodeCheckError] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [isParsing, startParsing] = useTransition()
  const [filter, setFilter] = useState<RowFilter>("all")

  // Masters created during this import get merged in locally so the preview
  // updates without a full page reload. The names are kept for the result
  // page's "created along the way" chips.
  const [extraMasters, setExtraMasters] = useState<MasterData>({
    categories: [],
    brands: [],
    colours: [],
    sizes: [],
  })
  const [createdAlongTheWay, setCreatedAlongTheWay] = useState<CreatedMaster[]>([])

  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [totals, setTotals] = useState<Totals>(ZERO)
  const [importError, setImportError] = useState<string | null>(null)

  // The last successfully-read file, for the upload step's "Use again". Read
  // through a store subscription rather than an effect: localStorage is not
  // there during SSR, and the server snapshot of null simply means the card
  // is absent until the client renders — never a hydration mismatch.
  const lastImportJson = useSyncExternalStore(
    subscribeToNothing,
    () => window.localStorage.getItem(LAST_IMPORT_KEY),
    () => null,
  )
  const lastImport = useMemo<LastImport | null>(() => {
    if (!lastImportJson) return null
    try {
      return JSON.parse(lastImportJson) as LastImport
    } catch {
      // A malformed or over-budget cache is no reason to break the page.
      window.localStorage.removeItem(LAST_IMPORT_KEY)
      return null
    }
  }, [lastImportJson])

  const lookup = useMemo(
    () =>
      buildLookup({
        categories: [...master.categories, ...extraMasters.categories],
        brands: [...master.brands, ...extraMasters.brands],
        colours: [...master.colours, ...extraMasters.colours],
        sizes: [...master.sizes, ...extraMasters.sizes],
      }),
    [master, extraMasters],
  )

  const rawRows = useMemo<RawRow[]>(() => {
    const index = new Map(headers.map((header, i) => [header, i]))
    return rows.map((cells, i) => {
      const values: Partial<Record<ImportField, string>> = {}
      for (const field of IMPORT_FIELDS) {
        const header = mapping[field.key]
        if (header === undefined) continue
        const column = index.get(header)
        if (column === undefined) continue
        values[field.key] = String(cells[column] ?? "")
      }
      // +2: one for the header row, one because spreadsheets are 1-based.
      return { rowNumber: i + 2, values }
    })
  }, [rows, headers, mapping])

  /** Barcodes as the *current* mapping sees them. */
  const fileBarcodes = useMemo(
    () => [
      ...new Set(
        rawRows.map((r) => (r.values.barcode ?? "").trim()).filter(Boolean),
      ),
    ],
    [rawRows],
  )

  /** Product codes as the *current* mapping sees them, in their typed case. */
  const fileProductCodes = useMemo(
    () => [
      ...new Set(
        rawRows.map((r) => (r.values.productCode ?? "").trim()).filter(Boolean),
      ),
    ],
    [rawRows],
  )

  // Re-checked whenever the mapped barcode values change, so remapping the
  // Barcode column in step 2 revalidates against the database rather than
  // keeping the answer from upload time.
  useEffect(() => {
    if (fileBarcodes.length === 0) return
    let cancelled = false
    findExistingBarcodes(fileBarcodes).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setExistingBarcodes(new Set(result.taken))
        setBarcodeCheckError(null)
      } else {
        // Not treated as "none taken": that reads as a clean file and lets
        // duplicate barcodes through to the merge step.
        setExistingBarcodes(new Set())
        setBarcodeCheckError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [fileBarcodes])

  // Same idea, for the Product Code column.
  useEffect(() => {
    if (fileProductCodes.length === 0) return
    let cancelled = false
    findExistingProductCodes(fileProductCodes).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setExistingProductCodes(new Set(result.taken))
        setProductCodeCheckError(null)
      } else {
        setExistingProductCodes(new Set())
        setProductCodeCheckError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [fileProductCodes])

  const summary: ValidationSummary = useMemo(
    () =>
      validateRows(rawRows, lookup, {
        // Derived rather than reset in the effect: with no barcodes in the file
        // there is nothing to collide with, and clearing state synchronously
        // inside an effect just causes a cascading render.
        existingBarcodes: fileBarcodes.length === 0 ? NO_BARCODES : existingBarcodes,
        existingProductCodes:
          fileProductCodes.length === 0 ? NO_PRODUCT_CODES : existingProductCodes,
      }),
    [rawRows, lookup, existingBarcodes, fileBarcodes, existingProductCodes, fileProductCodes],
  )

  /** Sheet row number → its validated row, for the grid's status column. */
  const validatedByRow = useMemo(
    () => new Map(summary.rows.map((row) => [row.rowNumber, row])),
    [summary],
  )

  const handleFile = useCallback((file: File) => {
    setParseError(null)
    setFileName(file.name)

    startParsing(async () => {
      try {
        // Dynamic import: SheetJS is large and only this route needs it.
        const XLSX = await import("xlsx")
        const workbook = XLSX.read(await file.arrayBuffer())
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        if (!sheet) throw new Error("That workbook has no sheets.")

        const grid = XLSX.utils.sheet_to_json<string[]>(sheet, {
          header: 1,
          raw: false,
          defval: "",
          blankrows: false,
        })
        if (grid.length < 2) {
          throw new Error("The sheet needs a header row and at least one data row.")
        }

        const [headerRow, ...dataRows] = grid
        const cleanHeaders = headerRow.map((h) => String(h ?? "").trim())
        // Drop rows that are entirely empty — trailing blanks are common.
        const cleanRows = dataRows
          .map((r) => r.map((c) => String(c ?? "")))
          .filter((r) => r.some((c) => c.trim() !== ""))

        setHeaders(cleanHeaders)
        setRows(cleanRows)
        setMapping(autoMapColumns(cleanHeaders))
        setFilter("all")

        // Kept for "Use again". A sheet too big for the budget simply gets no
        // card next time — never a failure.
        try {
          const payload: LastImport = {
            name: file.name,
            at: new Date().toISOString(),
            headers: cleanHeaders,
            rows: cleanRows,
          }
          const serialised = JSON.stringify(payload)
          if (serialised.length <= LAST_IMPORT_MAX_BYTES) {
            window.localStorage.setItem(LAST_IMPORT_KEY, serialised)
          }
        } catch {
          // Over quota: the import itself is unaffected.
        }

        // The database duplicate check runs off the *current* mapping, in the
        // effect below — doing it here would go stale the moment the user
        // remapped the Barcode column.
        setStep(2)
      } catch (error) {
        setParseError(
          error instanceof Error ? error.message : "That file could not be read.",
        )
      }
    })
  }, [])

  const useAgain = useCallback(() => {
    if (!lastImport) return
    setParseError(null)
    setFileName(lastImport.name)
    setHeaders(lastImport.headers)
    setRows(lastImport.rows)
    setMapping(autoMapColumns(lastImport.headers))
    setFilter("all")
    setStep(2)
  }, [lastImport])

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx")
    const sheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE_ROWS])
    sheet["!cols"] = TEMPLATE_HEADERS.map((header) => ({
      wch:
        header === "Product Name"
          ? 28
          : header === "Product Code"
            ? 16
            : header === "Shelf Location"
              ? 18
              : header === "Location"
                ? 14
                : Math.max(12, header.length + 2),
    }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, "Products")
    XLSX.writeFile(workbook, "kids-corner-import-template.xlsx")
  }

  /**
   * Creates every master the sheet references that does not exist yet, and
   * remembers them both for validation (extraMasters) and for the result
   * page's "created along the way" chips. Returns the created rows, or null
   * on failure — returned rather than read from state, because state set here
   * is not visible to the caller until the next render.
   */
  const createMasters = async (): Promise<CreatedMaster[] | null> => {
    if (summary.missingMasters.length === 0) return []
    setImportError(null)
    setIsImporting(true)
    const response = await createMissingMasters(summary.missingMasters)
    setIsImporting(false)

    if (!response.ok) {
      setImportError(response.error ?? "Those could not be created.")
      return null
    }

    setCreatedAlongTheWay((current) => [...current, ...response.created])
    // Merge into the local master set so validation re-runs immediately.
    setExtraMasters((current) => ({
      categories: [
        ...current.categories,
        ...response.created
          .filter((c) => c.kind === "category")
          .map((c) => ({ id: c.id, name: c.name, parent_id: null, is_active: true })),
      ],
      brands: [
        ...current.brands,
        ...response.created
          .filter((c) => c.kind === "brand")
          .map((c) => ({ id: c.id, name: c.name, is_active: true })),
      ],
      colours: [
        ...current.colours,
        ...response.created
          .filter((c) => c.kind === "colour")
          .map((c) => ({ id: c.id, name: c.name, hex_code: null, is_active: true })),
      ],
      sizes: [
        ...current.sizes,
        ...response.created
          .filter((c) => c.kind === "size")
          .map((c) => ({
            id: c.id,
            label: c.name,
            size_type: c.sizeType ?? "age_range",
            sort_order: 900,
            is_active: true,
          })),
          ],
        }))
    return response.created
  }

  const runImport = async () => {
    setImportError(null)
    setIsImporting(true)
    setProgress(0)
    setTotals(ZERO)

    // Every row without a hard error goes in — including rows whose colours
    // and categories do not exist yet. Their masters are created right here,
    // first, so "Import 130 rows" is one button rather than a two-step ritual.
    const ready = importableRows(summary)

    // ids for the masters this run creates, keyed exactly like validate's
    // missing entries, so each row's missing list can be resolved locally.
    const createdIds = new Map<string, number>()
    if (summary.missingMasters.length > 0) {
      const created = await createMasters()
      if (created === null) {
        setIsImporting(false)
        return
      }
      for (const item of summary.missingMasters) {
        const match = created.find(
          (c) =>
            c.kind === item.kind &&
            normaliseKey(c.name) === normaliseKey(item.name) &&
            (item.kind !== "size" || c.sizeType === item.sizeType),
        )
        if (match) createdIds.set(missingKey(item), match.id)
      }
    }

    const resolve = (row: ValidatedRow, kind: ImportMasterKind): number | null => {
      const direct =
        kind === "category"
          ? row.categoryId
          : kind === "brand"
            ? row.brandId
            : kind === "colour"
              ? row.colourId
              : row.sizeId
      if (direct !== null) return direct
      const missing = row.missing.find((m) => m.kind === kind)
      if (!missing) return null
      return createdIds.get(missingKey(missing)) ?? null
    }

    const commitRows: CommitRow[] = []
    for (const row of ready) {
      const categoryId = resolve(row, "category")
      const sizeId = resolve(row, "size")
      const colourId = resolve(row, "colour")
      // `missing.length === 0` matters as much as the null checks: a row whose
      // only unresolved value is its *brand* would otherwise import with
      // brand_id null, silently discarding a brand the preview promised to
      // create. Brand is nullable in the schema, so nothing downstream complains.
      if (
        row.missing.some((m) => m.kind !== "brand" && resolve(row, m.kind) === null)
      ) {
        continue
      }
      if (categoryId === null || sizeId === null || colourId === null) continue
      commitRows.push({
        rowNumber: row.rowNumber,
        productName: row.productName,
        productCode: row.productCode,
        categoryId,
        brandId: resolve(row, "brand"),
        gender: row.gender,
        sizeId,
        colourId,
        costPrice: row.costPrice,
        sellPrice: row.sellPrice,
        quantity: row.quantity,
        barcode: row.barcode,
        shelfLocation: row.shelfLocation,
        location: row.location,
      })
    }

    const running: Totals = { ...ZERO, skipped: [] }

    for (let i = 0; i < commitRows.length; i += CHUNK_SIZE) {
      const chunk = commitRows.slice(i, i + CHUNK_SIZE)
      let outcome: ChunkResult
      try {
        outcome = await importChunk(chunk)
      } catch (error) {
        setImportError(
          error instanceof Error ? error.message : "The import failed part-way.",
        )
        break
      }

      if (!outcome.ok) {
        setImportError(outcome.error ?? "The import failed part-way.")
        break
      }

      running.productsCreated += outcome.productsCreated
      running.variantsCreated += outcome.variantsCreated
      running.variantsUpdated += outcome.variantsUpdated
      running.stockAdded += outcome.stockAdded
      running.skipped.push(...outcome.skipped)
      // Every chunk hits the same cause, so the first one is the whole story.
      running.barcodeError ??= outcome.barcodeError ?? null

      setTotals({ ...running, skipped: [...running.skipped] })
      setProgress(Math.min(i + chunk.length, commitRows.length))
    }

    setIsImporting(false)
    setStep(3)
    router.refresh()
  }

  // Must match the filter in runImport exactly, or the button promises a count
  // the import will not deliver. `summary.ready` uses the same rule.
  const readyCount = importableRows(summary).length

  const missingRequired = [
    ...IMPORT_FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label),
    // No size column is required on its own — the rule is "one of the three"
    // per row — so prompt for them together when the sheet maps none.
    ...(mapping.ageRange || mapping.clothingSize || mapping.shoeSize
      ? []
      : ["Age Range, Clothing Size or Shoe Size"]),
  ]

  /**
   * A cell edited on the grid: the sheet data is the source of truth, so the
   * fix lands in `rows` and every derived layer — mapping, validation, the
   * status column, the ready count — re-runs from it. The "Use again" copy is
   * updated with the same edit, so re-loading the file later does not resurrect
   * a value the user already fixed.
   */
  const handleCellChange = useCallback(
    (rowNumber: number, col: number, value: string) => {
      const apply = (cells: string[][]) =>
        cells.map((row, i) =>
          i + 2 === rowNumber ? row.map((cell, j) => (j === col ? value : cell)) : row,
        )
      setRows(apply)
      try {
        const raw = window.localStorage.getItem(LAST_IMPORT_KEY)
        if (raw) {
          const payload = JSON.parse(raw) as LastImport
          payload.rows = apply(payload.rows)
          const serialised = JSON.stringify(payload)
          if (serialised.length <= LAST_IMPORT_MAX_BYTES) {
            window.localStorage.setItem(LAST_IMPORT_KEY, serialised)
          }
        }
      } catch {
        // The cache is a convenience; the import never depends on it.
      }
    },
    [],
  )

  const restart = () => {
    setStep(1)
    setFileName(null)
    setHeaders([])
    setRows([])
    setMapping({})
    setTotals(ZERO)
    setProgress(0)
    setImportError(null)
    setFilter("all")
    setExistingBarcodes(new Set())
    setExistingProductCodes(new Set())
    setProductCodeCheckError(null)
  }

  if (step === 1) {
    return (
      <div className="space-y-6">
        <Stepper current={1} />
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            <StepUpload
              fileName={fileName}
              isParsing={isParsing}
              parseError={parseError}
              onFile={handleFile}
            />
            {lastImport ? (
              <button
                type="button"
                onClick={useAgain}
                className="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <FileSpreadsheet className="text-muted-foreground size-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{lastImport.name}</span>
                  <span className="text-muted-foreground block text-xs">
                    Last uploaded {new Date(lastImport.at).toLocaleDateString()} ·{" "}
                    {lastImport.rows.length} rows read
                  </span>
                </span>
                <span className="text-sm font-medium">Use again</span>
              </button>
            ) : null}
          </div>
          <ColumnsWeLookFor onTemplate={downloadTemplate} />
        </div>
      </div>
    )
  }

  if (step === 2) {
    return (
      <div className="space-y-6">
        <Stepper current={2} />

        {importError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{importError}</AlertDescription>
          </Alert>
        ) : null}

        {missingRequired.length > 0 ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertTitle>Map the required columns</AlertTitle>
            <AlertDescription>
              Still needed: {missingRequired.join(", ")}.
            </AlertDescription>
          </Alert>
        ) : null}

        {barcodeCheckError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertTitle>Barcodes could not be checked</AlertTitle>
            <AlertDescription>
              {barcodeCheckError} Importing is held until this succeeds — a file
              whose barcodes have not been checked can attach its stock to the
              wrong product.
            </AlertDescription>
          </Alert>
        ) : null}

        {productCodeCheckError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertTitle>Product codes could not be checked</AlertTitle>
            <AlertDescription>
              {productCodeCheckError} Importing is held until this succeeds — a
              file whose product codes have not been checked could give two
              products the same one.
            </AlertDescription>
          </Alert>
        ) : null}

        {/* The file bar: what was read, how it shapes up, and the two actions. */}
        <div className="rounded-lg border">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileSpreadsheet className="text-muted-foreground size-5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{fileName}</p>
                <p className="text-muted-foreground text-xs">
                  Sheet-1 · {rows.length} rows read
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium tabular-nums">{summary.rows.length} rows</span>
              <span className="text-success tabular-nums">{readyCount} ready</span>
              <span
                className={cn(
                  "tabular-nums",
                  summary.missingMasters.length > 0 ? "text-warning" : "text-muted-foreground",
                )}
              >
                {summary.missingMasters.length} new colours / categories to create
              </span>
              <span
                className={cn(
                  "tabular-nums",
                  summary.errors > 0 ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {summary.errors} errors
              </span>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              {summary.missingMasters.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void createMasters()}
                  disabled={isImporting}
                >
                  {isImporting ? (
                    <LoaderCircle className="animate-spin" aria-hidden />
                  ) : (
                    <Plus aria-hidden />
                  )}
                  Create all {summary.missingMasters.length} new
                </Button>
              ) : null}
              <Button
                size="sm"
                onClick={runImport}
                // Blocked while the duplicate check is unresolved: importing on
                // an unchecked file is how a barcode already in use gets merged
                // into the wrong product.
                disabled={
                  isImporting ||
                  readyCount === 0 ||
                  missingRequired.length > 0 ||
                  barcodeCheckError !== null ||
                  productCodeCheckError !== null
                }
              >
                {isImporting ? (
                  <>
                    <LoaderCircle className="animate-spin" aria-hidden />
                    Importing…
                  </>
                ) : (
                  `Import ${readyCount} row${readyCount === 1 ? "" : "s"}`
                )}
              </Button>
            </div>
          </div>
          {isImporting && progress > 0 ? (
            <div className="bg-muted h-1 w-full">
              <div
                className="bg-brand-500 h-1 transition-all"
                style={{ width: `${(progress / Math.max(readyCount, 1)) * 100}%` }}
              />
            </div>
          ) : null}
        </div>

        <SheetGrid
          headers={headers}
          rows={rows}
          mapping={mapping}
          onMappingChange={setMapping}
          summary={summary}
          validatedByRow={validatedByRow}
          filter={filter}
          onFilter={setFilter}
          onCellChange={handleCellChange}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="text-muted-foreground text-sm">
            {isImporting && progress > 0
              ? `Importing… ${progress} of ${readyCount}`
              : `${readyCount} row${readyCount === 1 ? "" : "s"} will be imported.`}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)} disabled={isImporting}>
              <ArrowLeft aria-hidden />
              Back to upload
            </Button>
            {summary.errors > 0 ? (
              <Button
                variant="outline"
                onClick={() =>
                  downloadBlob(
                    buildErrorReport(summary),
                    "import-errors.csv",
                    "text/csv;charset=utf-8",
                  )
                }
              >
                <Download aria-hidden />
                Error report
              </Button>
            ) : null}
            <Button
              onClick={runImport}
              disabled={
                isImporting ||
                readyCount === 0 ||
                missingRequired.length > 0 ||
                barcodeCheckError !== null ||
                productCodeCheckError !== null
              }
            >
              {isImporting ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden />
                  Importing…
                </>
              ) : (
                `Import ${readyCount} row${readyCount === 1 ? "" : "s"}`
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <StepResult
      totals={totals}
      summary={summary}
      created={createdAlongTheWay}
      error={importError}
      onRestart={restart}
    />
  )
}

// ────────────────────────────────────────────────────────────── the stepper

function Stepper({ current }: { current: Step }) {
  const steps = [
    { n: 1, label: "Upload", sub: "Pick your file" },
    { n: 2, label: "Check & map", sub: "Fix problems" },
    { n: 3, label: "Result", sub: "What went in" },
  ] as const

  return (
    <ol className="flex items-center gap-3">
      {steps.map((item, i) => {
        const done = item.n < current
        const active = item.n === current
        return (
          <li key={item.n} className={cn("flex items-center gap-3", i > 0 && "flex-1")}>
            {i > 0 ? <span className="bg-border h-px flex-1" aria-hidden /> : null}
            <span className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  done && "bg-brand-500 text-white",
                  active && "bg-brand-50 text-brand-700 ring-brand-500 ring-2",
                  !done && !active && "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-4" aria-hidden /> : item.n}
              </span>
              <span className="leading-tight">
                <span
                  className={cn(
                    "block text-sm font-medium",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
                <span className="text-muted-foreground block text-xs">{item.sub}</span>
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// ─────────────────────────────────────────────────────────── step 1: upload

function StepUpload({
  fileName,
  isParsing,
  parseError,
  onFile,
}: {
  fileName: string | null
  isParsing: boolean
  parseError: string | null
  onFile: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div className="space-y-4">
      {parseError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>Couldn’t read that file</AlertTitle>
          <AlertDescription>{parseError}</AlertDescription>
        </Alert>
      ) : null}

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files?.[0]
          if (file) onFile(file)
        }}
        className={cn(
          "rounded-lg border-2 border-dashed p-10 text-center transition-colors",
          dragging ? "border-brand-500 bg-brand-50" : "border-input",
        )}
      >
        {isParsing ? (
          <LoaderCircle
            className="text-muted-foreground mx-auto size-8 animate-spin"
            aria-hidden
          />
        ) : (
          <span className="bg-brand-50 text-brand-700 mx-auto flex size-12 items-center justify-center rounded-xl">
            <Upload className="size-5" aria-hidden />
          </span>
        )}
        <p className="mt-3 font-medium">
          {isParsing ? `Reading ${fileName}…` : "Drop your Excel file here"}
        </p>
        <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
          One row per variant — a size and colour on each line. .xlsx, .xlsm
          and .csv all work.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,.xls,.csv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onFile(file)
            // Reset so choosing the same file twice still fires onChange.
            event.target.value = ""
          }}
        />

        <div className="mt-4">
          <Button onClick={() => inputRef.current?.click()} disabled={isParsing}>
            Browse files
          </Button>
        </div>
      </div>
    </div>
  )
}

function ColumnsWeLookFor({ onTemplate }: { onTemplate: () => void }) {
  return (
    <div className="rounded-lg border lg:col-span-2">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-medium">Columns we look for</p>
        <p className="text-muted-foreground text-xs">
          Header names don’t need to match — you map them on the next step.
        </p>
      </div>
      <ul className="px-4 py-2">
        {IMPORT_FIELDS.map((field) => (
          <li
            key={field.key}
            className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
          >
            <span className="text-sm">{field.label}</span>
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground max-w-36 truncate font-mono text-xs">
                {field.key === "barcode"
                  ? "Blank = generated"
                  : (FIELD_EXAMPLES[field.key] ?? "")}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  field.required
                    ? "border-brand-200 bg-brand-50 text-brand-700"
                    : "text-muted-foreground",
                )}
              >
                {field.required ? "REQUIRED" : "OPTIONAL"}
              </Badge>
            </span>
          </li>
        ))}
      </ul>
      <div className="border-t px-4 py-3">
        <Button variant="ghost" size="sm" className="text-brand-700" onClick={onTemplate}>
          <Download aria-hidden />
          Download the blank template
        </Button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────── step 2: check & map

function SheetGrid({
  headers,
  rows,
  mapping,
  onMappingChange,
  summary,
  validatedByRow,
  filter,
  onFilter,
  onCellChange,
}: {
  headers: string[]
  rows: string[][]
  mapping: ColumnMapping
  onMappingChange: (next: ColumnMapping) => void
  summary: ValidationSummary
  validatedByRow: Map<number, ValidatedRow>
  filter: RowFilter
  onFilter: (next: RowFilter) => void
  onCellChange: (rowNumber: number, col: number, value: string) => void
}) {
  /** The cell being edited: sheet row number + column index, and its draft. */
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null)
  const [draft, setDraft] = useState("")
  const [statusOpen, setStatusOpen] = useState(true)

  // The status panel sits beside the sheet as its own card, so the two panes'
  // vertical scroll is mirrored to keep row 27 on the left lined up with row
  // 27 on the right. The flag breaks the feedback loop a mirrored scroll
  // would otherwise create.
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const panelScrollRef = useRef<HTMLDivElement>(null)
  const syncingScroll = useRef(false)

  const onGridScroll = () => {
    if (syncingScroll.current) {
      syncingScroll.current = false
      return
    }
    syncingScroll.current = true
    if (gridScrollRef.current && panelScrollRef.current) {
      panelScrollRef.current.scrollTop = gridScrollRef.current.scrollTop
    }
  }

  const onPanelScroll = () => {
    if (syncingScroll.current) {
      syncingScroll.current = false
      return
    }
    syncingScroll.current = true
    if (gridScrollRef.current && panelScrollRef.current) {
      gridScrollRef.current.scrollTop = panelScrollRef.current.scrollTop
    }
  }

  const startEdit = (rowNumber: number, col: number, current: string) => {
    setEditing({ row: rowNumber, col })
    setDraft(current)
  }

  const commitEdit = () => {
    if (!editing) return
    onCellChange(editing.row, editing.col, draft.trim())
    setEditing(null)
  }
  /** Which field each column currently feeds — the reverse of the mapping. */
  const fieldByHeader = useMemo(() => {
    const map = new Map<string, ImportField>()
    for (const [field, header] of Object.entries(mapping)) {
      if (header) map.set(header, field as ImportField)
    }
    return map
  }, [mapping])

  const setColumn = (header: string, field: string) => {
    const next: ColumnMapping = { ...mapping }
    // A field can only read from one column: taking it here takes it from
    // wherever it was, so two dropdowns can never both claim Product Name.
    for (const key of Object.keys(next)) {
      if (next[key as ImportField] === header) delete next[key as ImportField]
    }
    if (field === UNMAPPED) {
      for (const [key, value] of Object.entries(next)) {
        if (value === header) delete next[key as ImportField]
      }
    } else {
      next[field as ImportField] = header
    }
    onMappingChange(next)
  }

  const counts = {
    all: summary.rows.length,
    errors: summary.errors,
    new: summary.needsMasters,
    ready: summary.ready,
  }

  // Errors first — the whole point of the check step is fixing those — then
  // rows that need masters, then the ready ones. Ties keep sheet order.
  const rank = (row?: ValidatedRow) =>
    row && row.errors.length > 0 ? 0 : row && row.missing.length > 0 ? 1 : 2

  const ordered = useMemo(() => {
    const indexed = rows.map((cells, i) => ({
      cells,
      rowNumber: i + 2,
      validated: validatedByRow.get(i + 2),
    }))
    const filtered = indexed.filter(({ validated }) => {
      if (filter === "errors") return (validated?.errors.length ?? 0) > 0
      if (filter === "new") return (
        (validated?.errors.length ?? 0) === 0 && (validated?.missing.length ?? 0) > 0
      )
      if (filter === "ready")
        return (validated?.errors.length ?? 0) === 0 && (validated?.missing.length ?? 0) === 0
      return true
    })
    filtered.sort(
      (a, b) => rank(a.validated) - rank(b.validated) || a.rowNumber - b.rowNumber,
    )
    return filtered
  }, [rows, validatedByRow, filter])

  const shown = ordered.slice(0, 100)

  const filters: { key: RowFilter; label: string }[] = [
    { key: "all", label: `All ${counts.all}` },
    { key: "errors", label: `Errors ${counts.errors}` },
    { key: "new", label: `New values ${counts.new}` },
    { key: "ready", label: `Ready ${counts.ready}` },
  ]

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onFilter(item.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                filter === item.key
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "hover:bg-muted/60 border-input text-muted-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setStatusOpen((value) => !value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              statusOpen
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "hover:bg-muted/60 border-input text-muted-foreground",
            )}
          >
            Status
          </button>
        </div>
        <p className="text-muted-foreground text-xs">
          Change any dropdown to re-point it. Tap any cell to fix its value — the
          status re-checks as you type.
        </p>
      </div>

      <div className="flex items-stretch border-t">
        <div
          ref={gridScrollRef}
          onScroll={onGridScroll}
          // Same fixed height as the status pane, so neither outgrows the card.
          className="h-[26rem] min-w-0 flex-1 overflow-auto"
        >
          <table className="w-full min-w-max border-collapse text-sm">
            <thead className="bg-background sticky top-0 z-10">
              <tr>
                <th className="text-muted-foreground bg-muted/60 h-[68px] w-12 border-b px-2 py-2 text-right text-xs font-medium">
                  ROW
                </th>
                {headers.map((header, i) => {
                  const field = fieldByHeader.get(header)
                  const options = [
                    { value: UNMAPPED, label: "— skip —" },
                    ...IMPORT_FIELDS.map((f) => ({ value: f.key, label: f.label })),
                  ]
                  return (
                    <th
                      key={`${header}-${i}`}
                      className="bg-muted/60 h-[68px] w-40 border-b px-2 py-2 text-left align-top font-normal"
                    >
                      <div className="text-muted-foreground mb-1 font-mono text-[10px]">
                        ↑ {columnLetter(i)} · {header || "—"}
                      </div>
                      <Select
                        value={field ?? UNMAPPED}
                        items={options}
                        onValueChange={(next) => setColumn(header, String(next ?? UNMAPPED))}
                      >
                        <SelectTrigger
                          aria-label={`Map column ${header}`}
                          className={cn(
                            "h-8 w-full text-xs",
                            field === undefined && "text-muted-foreground",
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map(({ cells, rowNumber, validated }, index) => {
                const hasError = (validated?.errors.length ?? 0) > 0
                const missing = validated?.missing ?? []
                // The row border lives on the CELLS, inside the fixed h-9, so
                // a grid row and a status row are exactly the same 36 pixels —
                // a border on the <tr> would sit outside it and the two panes
                // would drift apart one pixel per row.
                const isLastShown = index === shown.length - 1
                return (
                  <tr
                    key={rowNumber}
                    className={cn(
                      hasError && "bg-destructive/5",
                      !hasError && missing.length > 0 && "bg-warning-muted/40",
                    )}
                  >
                    {/* Fixed h-9 on every cell: the status panel's rows are
                        the same height, and the two panes stay lined up even
                        while a cell editor is open. */}
                    <td
                      className={cn(
                        "text-muted-foreground h-9 border-b px-2 text-right font-mono text-xs tabular-nums",
                        isLastShown && "border-b-0",
                      )}
                    >
                      {rowNumber}
                    </td>
                    {headers.map((header, i) => {
                      const field = fieldByHeader.get(header)
                      // The "+ Create" chip rides the cell whose column is mapped
                      // to a field this row cannot resolve yet.
                      const needsCreate =
                        field !== undefined && missing.some((m) => FIELD_OF_KIND[m.kind]?.includes(field))
                      const barcodeFixable =
                        field === "barcode" &&
                        validated?.errors.some((message) => message.startsWith("Barcode")) === true
                      const isEditing = editing?.row === rowNumber && editing.col === i
                      const raw = cells[i] ?? ""
                      return (
                        <td
                          key={`${header}-${i}`}
                          // overflow-hidden + the truncating value span keep the
                          // chips inside the cell instead of drifting over the
                          // next column.
                          className={cn(
                            "h-9 max-w-44 overflow-hidden border-b px-2",
                            isLastShown && "border-b-0",
                          )}
                        >
                          {isEditing ? (
                            <input
                              // A tap opened this cell; the caret belongs in it.
                              autoFocus
                              value={draft}
                              onChange={(event) => setDraft(event.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") commitEdit()
                                if (event.key === "Escape") setEditing(null)
                              }}
                              aria-label={`${header} on row ${rowNumber}`}
                              className="border-brand-400 ring-brand-200 h-7 w-full min-w-24 rounded border px-1.5 text-sm outline-none ring-2"
                            />
                          ) : (
                            <span className="flex items-center gap-1.5">
                              <span
                                onClick={() => startEdit(rowNumber, i, raw)}
                                className={cn(
                                  "min-w-0 truncate rounded px-1 py-0.5",
                                  raw.trim() === ""
                                    ? "text-muted-foreground/60"
                                    : "hover:bg-brand-50 cursor-text",
                                )}
                              >
                                {raw.trim() || "—"}
                              </span>
                              {needsCreate ? (
                                <span className="bg-warning-muted text-warning-foreground inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
                                  <Plus className="size-2.5" aria-hidden />
                                  Create
                                </span>
                              ) : null}
                              {barcodeFixable && raw.trim() !== "" ? (
                                <button
                                  type="button"
                                  // Blank is not "no barcode": the import issues a
                                  // fresh code for every blank cell on the way in,
                                  // so clearing here IS the fix — the clash is with
                                  // a code the shop already uses.
                                  onClick={() => onCellChange(rowNumber, i, "")}
                                  title="Clear it — a fresh barcode is generated on import"
                                  className="text-brand-700 border-brand-200 bg-brand-50 hover:bg-brand-100 inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                                >
                                  <RefreshCw className="size-2.5" aria-hidden />
                                  Generate new
                                </button>
                              ) : null}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {statusOpen ? (
          <StatusPanel
            entries={shown}
            onCollapse={() => setStatusOpen(false)}
            onScroll={onPanelScroll}
            scrollRef={panelScrollRef}
          />
        ) : (
          // The collapsed panel leaves a slim strip in its place — the reopen
          // control lives where the panel used to be, not hidden in a chip.
          <button
            type="button"
            onClick={() => setStatusOpen(true)}
            title="Show the status panel"
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-9 shrink-0 flex-col items-center justify-center gap-2 border-l"
          >
            <ChevronLeft className="size-4" aria-hidden />
            <span className="text-[10px] font-semibold tracking-wider uppercase [writing-mode:vertical-rl]">
              Status
            </span>
          </button>
        )}
      </div>

      <div className="text-muted-foreground border-t px-4 py-2 text-xs">
        Showing rows {shown.length > 0 ? `${ordered[0]?.rowNumber}–${shown[shown.length - 1]?.rowNumber}` : "—"} of{" "}
        {ordered.length} · errors first
        {ordered.length > shown.length ? ` (${ordered.length - shown.length} more not drawn)` : ""}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────── step 3: result

function StepResult({
  totals,
  summary,
  created,
  error,
  onRestart,
}: {
  totals: Totals
  summary: ValidationSummary
  created: CreatedMaster[]
  error: string | null
  onRestart: () => void
}) {
  const imported = totals.productsCreated + totals.variantsCreated + totals.variantsUpdated
  const skippedTotal =
    totals.skipped.length + summary.rows.filter((row) => row.errors.length > 0).length

  const stats = [
    { label: "Products created", value: totals.productsCreated },
    { label: "Variants created", value: totals.variantsCreated },
    { label: "Variants topped up", value: totals.variantsUpdated },
    { label: "Stock added", value: `${totals.stockAdded.toLocaleString()} units` },
    {
      label: "Rows skipped",
      value: skippedTotal,
      danger: skippedTotal > 0,
    },
  ]

  // Everything that did not go in, from both places a row can fall out:
  // refused by validation here, or skipped by the server mid-import.
  const skipped = [
    ...totals.skipped.map((item) => {
      const validated = summary.rows.find((row) => row.rowNumber === item.rowNumber)
      return {
        rowNumber: item.rowNumber,
        productName: validated?.productName ?? "",
        detail: validated
          ? [
              validated.colourName,
              validated.sizeLabel,
              `qty ${validated.quantity}`,
            ]
              .filter(Boolean)
              .join(" · ")
          : "",
        reason: item.reason,
      }
    }),
    ...summary.rows
      .filter(
        (row) =>
          row.errors.length > 0 &&
          !totals.skipped.some((item) => item.rowNumber === row.rowNumber),
      )
      .map((row) => ({
        rowNumber: row.rowNumber,
        productName: row.productName,
        detail: [row.colourName, row.sizeLabel, `qty ${row.quantity}`]
          .filter(Boolean)
          .join(" · "),
        reason: row.errors[0],
      })),
  ].sort((a, b) => a.rowNumber - b.rowNumber)

  return (
    <div className="space-y-6">
      <Stepper current={3} />

      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>The import stopped early</AlertTitle>
          <AlertDescription>
            {error} Anything already committed is saved — re-run with the same
            file to finish, matching rows will update rather than duplicate.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {!error ? (
            <div className="flex items-start gap-3">
              <span className="bg-brand-50 text-brand-700 flex size-10 shrink-0 items-center justify-center rounded-xl">
                <CheckCircle2 className="size-5" aria-hidden />
              </span>
              <div>
                <h2 className="font-heading text-lg font-semibold">Import finished</h2>
                <p className="text-muted-foreground text-sm">
                  {imported} of {summary.rows.length} rows went in
                  {skippedTotal > 0
                    ? ` — the skipped ones are listed on the right so you can fix and re-upload just those.`
                    : "."}
                </p>
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border">
            <ul className="divide-y">
              {stats.map((stat) => (
                <li key={stat.label} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm">{stat.label}</span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      stat.danger ? "text-destructive" : undefined,
                    )}
                  >
                    {stat.value}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {totals.barcodeError ? (
            <Alert variant="warning">
              <AlertCircle aria-hidden />
              <AlertTitle>Imported without barcodes</AlertTitle>
              <AlertDescription>
                {totals.barcodeError} Rows whose Barcode column was filled in kept
                their own code. You can issue the rest from each product page.
              </AlertDescription>
            </Alert>
          ) : null}

          {created.length > 0 ? (
            <div>
              <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                Created along the way
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {created.map((item) => (
                  <Badge key={`${item.kind}:${item.id}`} variant="outline">
                    {item.name}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button render={<Link href="/products" />}>View products</Button>
            <Button variant="outline" onClick={onRestart}>
              Import another file
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {skipped.length > 0 ? (
            <div className="rounded-lg border">
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Skipped rows</p>
                  <p className="text-muted-foreground text-xs">
                    Nothing was changed for these.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadBlob(
                      buildErrorReport(summary),
                      "import-errors.csv",
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  <Download aria-hidden />
                  Download error report
                </Button>
              </div>
              <ul className="divide-y">
                {skipped.slice(0, 20).map((item) => (
                  <li key={item.rowNumber} className="flex gap-3 px-4 py-2.5">
                    <span className="text-muted-foreground w-10 shrink-0 pt-0.5 font-mono text-xs tabular-nums">
                      {item.rowNumber}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {item.productName || "—"}
                      </p>
                      <p className="text-muted-foreground text-xs">{item.detail}</p>
                      <p className="text-destructive mt-0.5 text-xs">{item.reason}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {skipped.length > 20 ? (
                <p className="text-muted-foreground border-t px-4 py-2 text-xs">
                  Showing the first 20 of {skipped.length}. The error report has
                  them all.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
              Every row went in — nothing was skipped.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
