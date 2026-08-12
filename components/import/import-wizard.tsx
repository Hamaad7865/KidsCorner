"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Upload,
  Wand2,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatRs } from "@/lib/format"
import {
  createMissingMasters,
  findExistingBarcodes,
  importChunk,
  type ChunkResult,
  type CommitRow,
} from "@/lib/import/actions"
import {
  IMPORT_FIELDS,
  TEMPLATE_HEADERS,
  TEMPLATE_SAMPLE_ROWS,
  autoMapColumns,
  type ColumnMapping,
  type ImportField,
  type RawRow,
} from "@/lib/import/columns"
import {
  buildErrorReport,
  buildLookup,
  importableRows,
  validateRows,
  type ValidationSummary,
} from "@/lib/import/validate"
import type { MasterData } from "@/lib/master-data/queries"
import { cn } from "@/lib/utils"

/** Rows per server round trip, so the progress bar reflects real work. */
const CHUNK_SIZE = 25

const UNMAPPED = "__none__"

/** Module-level so its identity is stable across renders. */
const NO_BARCODES: ReadonlySet<string> = new Set<string>()

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
  const [parseError, setParseError] = useState<string | null>(null)
  const [isParsing, startParsing] = useTransition()

  // Masters created during this import get merged in locally so the preview
  // updates without a full page reload.
  const [extraMasters, setExtraMasters] = useState<MasterData>({
    categories: [],
    brands: [],
    colours: [],
    sizes: [],
  })

  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [totals, setTotals] = useState<Totals>(ZERO)
  const [importError, setImportError] = useState<string | null>(null)

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

  const summary: ValidationSummary = useMemo(
    () =>
      validateRows(rawRows, lookup, {
        // Derived rather than reset in the effect: with no barcodes in the file
        // there is nothing to collide with, and clearing state synchronously
        // inside an effect just causes a cascading render.
        existingBarcodes: fileBarcodes.length === 0 ? NO_BARCODES : existingBarcodes,
      }),
    [rawRows, lookup, existingBarcodes, fileBarcodes],
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

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx")
    const sheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE_ROWS])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, "Products")
    XLSX.writeFile(workbook, "kids-corner-import-template.xlsx")
  }

  const createMasters = async () => {
    setImportError(null)
    setIsImporting(true)
    const response = await createMissingMasters(summary.missingMasters)
    setIsImporting(false)

    if (!response.ok) {
      setImportError(response.error ?? "Those could not be created.")
      return
    }

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
  }

  const runImport = async () => {
    setImportError(null)
    setIsImporting(true)
    setProgress(0)
    setTotals(ZERO)

    // `missing.length === 0` matters as much as the null checks: a row whose
    // only unresolved value is its *brand* would otherwise import with
    // brand_id null, silently discarding a brand the preview promised to
    // create. Brand is nullable in the schema, so nothing downstream complains.
    const ready = importableRows(summary).filter(
      (row) =>
        row.missing.length === 0 &&
        row.categoryId !== null &&
        row.sizeId !== null &&
        row.colourId !== null,
    )

    const commitRows: CommitRow[] = ready.map((row) => ({
      rowNumber: row.rowNumber,
      productName: row.productName,
      categoryId: row.categoryId as number,
      brandId: row.brandId,
      gender: row.gender,
      sizeId: row.sizeId as number,
      colourId: row.colourId as number,
      costPrice: row.costPrice,
      sellPrice: row.sellPrice,
      quantity: row.quantity,
      barcode: row.barcode,
    }))

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
  const readyCount = summary.ready

  const missingRequired = [
    ...IMPORT_FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label),
    // Neither size column is required on its own — the rule is "one of the two"
    // per row — so prompt for them together when the sheet maps neither.
    ...(mapping.ageRange || mapping.shoeSize ? [] : ["Age Range or Shoe Size"]),
  ]

  if (step === 1) {
    return (
      <StepUpload
        fileName={fileName}
        isParsing={isParsing}
        parseError={parseError}
        onFile={handleFile}
        onTemplate={downloadTemplate}
      />
    )
  }

  if (step === 2) {
    return (
      <div className="space-y-6">
        <StepHeader step={2} onBack={() => setStep(1)} fileName={fileName} />

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

        <ColumnMapper headers={headers} mapping={mapping} onChange={setMapping} />

        <SummaryBar
          total={summary.rows.length}
          ready={readyCount}
          newMasters={summary.missingMasters.length}
          errors={summary.errors}
        />

        {summary.missingMasters.length > 0 ? (
          <MissingMastersPanel
            missing={summary.missingMasters}
            busy={isImporting}
            onCreate={createMasters}
          />
        ) : null}

        <PreviewTable summary={summary} />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="text-muted-foreground text-sm">
            {isImporting && progress > 0
              ? `Importing… ${progress} of ${readyCount}`
              : `${readyCount} row${readyCount === 1 ? "" : "s"} will be imported.`}
          </div>
          <div className="flex gap-2">
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
              // Blocked while the duplicate check is unresolved: importing on
              // an unchecked file is how a barcode already in use gets merged
              // into the wrong product.
              disabled={
                isImporting ||
                readyCount === 0 ||
                missingRequired.length > 0 ||
                barcodeCheckError !== null
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
      error={importError}
      onRestart={() => {
        setStep(1)
        setFileName(null)
        setHeaders([])
        setRows([])
        setMapping({})
        setTotals(ZERO)
        setProgress(0)
        setImportError(null)
        setExistingBarcodes(new Set())
      }}
    />
  )
}

function StepHeader({
  step,
  fileName,
  onBack,
}: {
  step: Step
  fileName: string | null
  onBack: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="secondary">Step {step} of 3</Badge>
        {fileName ? (
          <span className="text-muted-foreground flex items-center gap-1.5">
            <FileSpreadsheet className="size-4" aria-hidden />
            {fileName}
          </span>
        ) : null}
      </div>
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft aria-hidden />
        Choose a different file
      </Button>
    </div>
  )
}

function StepUpload({
  fileName,
  isParsing,
  parseError,
  onFile,
  onTemplate,
}: {
  fileName: string | null
  isParsing: boolean
  parseError: string | null
  onFile: (file: File) => void
  onTemplate: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div className="space-y-4">
      <Badge variant="secondary">Step 1 of 3</Badge>

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
          <Upload className="text-muted-foreground mx-auto size-8" aria-hidden />
        )}
        <p className="mt-3 font-medium">
          {isParsing ? `Reading ${fileName}…` : "Drop your spreadsheet here"}
        </p>
        <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
          One row per variant — the product name repeats across its size and
          colour rows. .xlsx, .xlsm and .csv all work.
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

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button onClick={() => inputRef.current?.click()} disabled={isParsing}>
            Choose file
          </Button>
          <Button variant="outline" onClick={onTemplate}>
            <Download aria-hidden />
            Download template
          </Button>
        </div>
      </div>
    </div>
  )
}

function ColumnMapper({
  headers,
  mapping,
  onChange,
}: {
  headers: string[]
  mapping: ColumnMapping
  onChange: (next: ColumnMapping) => void
}) {
  const options = [
    { value: UNMAPPED, label: "— not mapped —" },
    ...headers.map((h) => ({ value: h, label: h })),
  ]

  return (
    <Card>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {IMPORT_FIELDS.map((field) => {
          const value = mapping[field.key] ?? UNMAPPED
          return (
            <div key={field.key} className="space-y-1.5">
              <label
                htmlFor={`map-${field.key}`}
                className="flex items-center gap-1.5 text-sm font-medium"
              >
                {field.label}
                {field.required ? (
                  <span className="text-destructive" aria-label="required">
                    *
                  </span>
                ) : null}
              </label>
              <Select
                value={value}
                items={options}
                onValueChange={(next) => {
                  const chosen = String(next ?? UNMAPPED)
                  const updated = { ...mapping }
                  if (chosen === UNMAPPED) delete updated[field.key]
                  else updated[field.key] = chosen
                  onChange(updated)
                }}
              >
                <SelectTrigger id={`map-${field.key}`} className="w-full">
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
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function SummaryBar({
  total,
  ready,
  newMasters,
  errors,
}: {
  total: number
  ready: number
  newMasters: number
  errors: number
}) {
  return (
    <div className="bg-muted/40 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-3 text-sm">
      <span className="font-medium">
        {total} row{total === 1 ? "" : "s"}
      </span>
      <span className="text-success flex items-center gap-1.5">
        <CheckCircle2 className="size-4" aria-hidden />
        {ready} ready
      </span>
      <span className={newMasters > 0 ? "text-warning" : "text-muted-foreground"}>
        {newMasters} new master{newMasters === 1 ? "" : "s"} to create
      </span>
      <span className={errors > 0 ? "text-destructive" : "text-muted-foreground"}>
        {errors} error{errors === 1 ? "" : "s"}
      </span>
    </div>
  )
}

function MissingMastersPanel({
  missing,
  busy,
  onCreate,
}: {
  missing: { kind: string; name: string }[]
  busy: boolean
  onCreate: () => void
}) {
  return (
    <Alert>
      <Wand2 aria-hidden />
      <AlertTitle>
        {missing.length} value{missing.length === 1 ? "" : "s"} not in your master data
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          These rows can’t be imported until the values exist. Create them all in
          one go, or fix the spelling in the spreadsheet and re-upload.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {missing.map((item) => (
            <Badge key={`${item.kind}:${item.name}`} variant="outline">
              {item.kind}: {item.name}
            </Badge>
          ))}
        </div>
        <Button size="sm" onClick={onCreate} disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden />
              Creating…
            </>
          ) : (
            `Create all ${missing.length}`
          )}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function PreviewTable({ summary }: { summary: ValidationSummary }) {
  const shown = summary.rows.slice(0, 100)

  return (
    <div className="space-y-2">
      <div className="max-h-96 overflow-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow>
              <TableHead className="w-14">Row</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="w-28">Size</TableHead>
              <TableHead className="w-28">Colour</TableHead>
              <TableHead className="w-24 text-right">Qty</TableHead>
              <TableHead className="w-28 text-right">Price</TableHead>
              <TableHead className="w-64">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => {
              const hasError = row.errors.length > 0
              const needsMaster = !hasError && row.missing.length > 0
              return (
                <TableRow
                  key={row.rowNumber}
                  className={cn(
                    hasError && "bg-destructive/5",
                    needsMaster && "bg-warning-muted/50",
                  )}
                >
                  <TableCell className="text-muted-foreground tabular-nums">
                    {row.rowNumber}
                  </TableCell>
                  <TableCell className="font-medium">{row.productName || "—"}</TableCell>
                  <TableCell>{row.sizeLabel || "—"}</TableCell>
                  <TableCell>{row.colourName || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.quantity}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRs(row.sellPrice)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {hasError ? (
                      <span className="text-destructive">{row.errors.join(" ")}</span>
                    ) : needsMaster ? (
                      <span className="text-warning">
                        Will create:{" "}
                        {row.missing.map((m) => `${m.kind} “${m.name}”`).join(", ")}
                      </span>
                    ) : (
                      <span className="text-success">Ready</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {summary.rows.length > shown.length ? (
        <p className="text-muted-foreground text-xs">
          Showing the first {shown.length} of {summary.rows.length} rows. All of
          them are validated and will be imported.
        </p>
      ) : null}
    </div>
  )
}

function StepResult({
  totals,
  summary,
  error,
  onRestart,
}: {
  totals: Totals
  summary: ValidationSummary
  error: string | null
  onRestart: () => void
}) {
  const stats = [
    { label: "Products created", value: totals.productsCreated },
    { label: "Variants created", value: totals.variantsCreated },
    { label: "Variants updated", value: totals.variantsUpdated },
    { label: "Stock added", value: totals.stockAdded },
  ]

  return (
    <div className="space-y-6">
      <Badge variant="secondary">Step 3 of 3</Badge>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>The import stopped early</AlertTitle>
          <AlertDescription>
            {error} Anything already committed is saved — re-run with the same
            file to finish, matching rows will update rather than duplicate.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <CheckCircle2 aria-hidden />
          <AlertTitle>Import finished</AlertTitle>
          <AlertDescription>
            Stock went in as movements of type “import”, so every quantity is
            traceable in the stock history.
          </AlertDescription>
        </Alert>
      )}

      {/* Separate from the outcome above: the import itself succeeded, but new
          stock that cannot be scanned is not something to leave unsaid. */}
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="py-4">
              <div className="text-2xl font-semibold tabular-nums">{stat.value}</div>
              <div className="text-muted-foreground text-sm">{stat.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {totals.skipped.length > 0 ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>{totals.skipped.length} rows were skipped</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-0.5 text-xs">
              {totals.skipped.slice(0, 10).map((item) => (
                <li key={item.rowNumber}>
                  Row {item.rowNumber}: {item.reason}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button render={<Link href="/products" />}>View products</Button>
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
            Download error report ({summary.errors})
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onRestart}>
          Import another file
        </Button>
      </div>
    </div>
  )
}
