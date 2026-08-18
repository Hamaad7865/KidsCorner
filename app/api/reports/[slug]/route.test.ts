import * as XLSX from "xlsx"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  getSalesJournal: vi.fn(),
  getVatReport: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({
  getSessionProfile: async () => ({ role: "owner", isActive: true }),
}))
vi.mock("@/lib/auth/roles", () => ({ isAdminRole: () => true }))
vi.mock("@/lib/reports/sales-journal", () => ({
  getSalesJournal: mocks.getSalesJournal,
}))
vi.mock("@/lib/reports/vat", () => ({ getVatReport: mocks.getVatReport }))
vi.mock("@/lib/reports/collected", () => ({ getCollectedReport: vi.fn() }))
vi.mock("@/lib/reports/queries", () => ({
  getBestSellers: vi.fn(),
  getMarginReport: vi.fn(),
  getSalesSummary: vi.fn(),
  getShiftReports: vi.fn(),
}))
vi.mock("@/lib/reports/pnl", () => ({ getPnlReport: vi.fn() }))
vi.mock("@/lib/discounts/queries", () => ({ getDiscountReport: vi.fn() }))

const { GET } = await import("./route")

const journal = {
  from: "2026-08-18",
  to: "2026-08-18",
  rows: [
    {
      kind: "sale" as const,
      reference: "S-1",
      at: "2026-08-18T06:00:00.000Z",
      customerName: null,
      cashierName: "Marie",
      methods: ["cash"],
      vatEnabled: false,
      vatRate: 0,
      vatStatus: "Not VAT registered",
      net: 115,
      vat: 0,
      gross: 115,
      status: "completed",
    },
    {
      kind: "sale" as const,
      reference: "S-2",
      at: "2026-08-18T07:00:00.000Z",
      customerName: "Asha",
      cashierName: "Marie",
      methods: ["card"],
      vatEnabled: true,
      vatRate: 0.15,
      vatStatus: "VAT registered",
      net: 100,
      vat: 15,
      gross: 115,
      status: "completed",
    },
  ],
  totals: { net: 215, vat: 15, gross: 230 },
  counts: { sales: 2, credits: 0, voids: 0 },
  truncated: false,
}

const request = (format?: "xlsx") =>
  new NextRequest(
    `http://test/api/reports/journal?from=2026-08-18&to=2026-08-18${
      format ? `&format=${format}` : ""
    }`,
  )

const invoke = (format?: "xlsx") =>
  GET(request(format), { params: Promise.resolve({ slug: "journal" }) })

describe("GET /api/reports/[slug]", () => {
  beforeEach(() => {
    mocks.getSalesJournal.mockResolvedValue(journal)
    mocks.getVatReport.mockResolvedValue({
      from: "2026-08-18",
      to: "2026-08-18",
      output: 15,
      input: 0,
      net: 15,
      months: [
        { month: "2026-08", label: "August 2026", output: 15, input: 0, net: 15 },
      ],
      counts: { sales: 1, credits: 0, purchases: 0 },
      truncated: false,
    })
  })

  it("keeps CSV as the default and includes every frozen tax column", async () => {
    const response = await invoke()
    const csv = (await response.text()).replace(/^\uFEFF/, "")

    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(response.headers.get("content-disposition")).toContain(
      'filename="kids-corner-journal-2026-08-18-to-2026-08-18.csv"',
    )
    expect(csv.split("\r\n")[0]).toBe(
      "Date,Time,Type,Reference,Against,Customer,Cashier,Method,VAT status,VAT rate,Net,VAT,Gross,Status",
    )
    expect(csv).toContain("Not VAT registered,,115.00,0.00,115.00")
    expect(csv).toContain("VAT registered,15.00%,100.00,15.00,115.00")
  })

  it("returns a true XLSX with the same journal columns and values", async () => {
    const response = await invoke("xlsx")
    const workbook = XLSX.read(await response.arrayBuffer())
    const sheet = workbook.Sheets[workbook.SheetNames[0]!]!
    const values = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
    })

    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    expect(response.headers.get("content-disposition")).toContain(
      'filename="kids-corner-journal-2026-08-18-to-2026-08-18.xlsx"',
    )
    expect(values[0]).toEqual([
      "Date",
      "Time",
      "Type",
      "Reference",
      "Against",
      "Customer",
      "Cashier",
      "Method",
      "VAT status",
      "VAT rate",
      "Net",
      "VAT",
      "Gross",
      "Status",
    ])
    expect(values[1]?.slice(8, 13)).toEqual([
      "Not VAT registered",
      "",
      "115.00",
      "0.00",
      "115.00",
    ])
    expect(values[2]?.slice(8, 13)).toEqual([
      "VAT registered",
      "15.00%",
      "100.00",
      "15.00",
      "115.00",
    ])
  })

  it("does not describe VAT returns using one current purchase rate", async () => {
    const response = await GET(
      new NextRequest(
        "http://test/api/reports/vat?from=2026-08-18&to=2026-08-18",
      ),
      { params: Promise.resolve({ slug: "vat" }) },
    )
    const csv = await response.text()

    expect(csv).not.toContain("derived at")
    expect(csv).not.toContain("configured rate")
  })
})
