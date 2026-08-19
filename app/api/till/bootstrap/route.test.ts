import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The bootstrap VAT contract.
 *
 * Android decodes these exact fields into its cached policy, so the split
 * between the configured rate (`vatRate`) and the effective rate
 * (`effectiveVatRate`, zero while disabled) is the whole point — a renamed or
 * dropped field is silent until a till tries to price a basket.
 */

const session = {
  supabase: {},
  user: { id: "dev-1", name: "Till 1", role: "cashier" },
}

let currentPolicy = {
  id: 5,
  enabled: false,
  configuredRate: 0.15,
  effectiveRate: 0,
  vatNumber: null as string | null,
  createdAt: "2026-08-18T09:00:00Z",
}

let latestRelease: { versionCode: number; versionName: string; apkUrl: string } | null = null

vi.mock("@/lib/api/till-session", () => ({
  requireTillSession: async () => session,
}))
vi.mock("@/lib/pos/sale-core", () => ({ listCashiersForDevice: async () => [] }))
vi.mock("@/lib/pos/queries", () => ({
  getOpenShift: async () => null,
  getPaymentMethods: async () => ["cash", "card"],
  getShopIdentity: async () => ({ address: "Curepipe", phone: "+230", vatNumber: null }),
  getShopName: async () => "Kids Corner",
}))
vi.mock("@/lib/vat/policy", () => ({
  getCurrentVatPolicy: async () => currentPolicy,
}))
// Real network calls (GitHub) have no business running inside a unit test —
// lib/pos/app-update.test.ts owns proving that module's own behaviour.
vi.mock("@/lib/pos/app-update", () => ({
  getLatestAndroidRelease: async () => latestRelease,
}))

const { GET } = await import("./route")

const get = async () => {
  const response = await GET(new Request("http://t/api/till/bootstrap"))
  return response.json()
}

describe("till bootstrap VAT fields", () => {
  beforeEach(() => {
    currentPolicy = {
      id: 5,
      enabled: false,
      configuredRate: 0.15,
      effectiveRate: 0,
      vatNumber: null,
      createdAt: "2026-08-18T09:00:00Z",
    }
    latestRelease = null
  })

  it("reports disabled with a zero effective rate but the saved configured rate", async () => {
    const json = await get()
    expect(json.vatEnabled).toBe(false)
    expect(json.effectiveVatRate).toBe(0)
    expect(json.vatRate).toBe(0.15)
    expect(json.vatPolicyId).toBe(5)
  })

  it("reports enabled with matching configured and effective rates and the number", async () => {
    currentPolicy = {
      id: 6,
      enabled: true,
      configuredRate: 0.15,
      effectiveRate: 0.15,
      vatNumber: "VAT20123456",
      createdAt: "2026-08-18T10:00:00Z",
    }
    const json = await get()
    expect(json.vatEnabled).toBe(true)
    expect(json.effectiveVatRate).toBe(0.15)
    expect(json.vatRate).toBe(0.15)
    expect(json.vatNumber).toBe("VAT20123456")
    expect(json.vatPolicyId).toBe(6)
  })

  it("still carries the unrelated bootstrap fields", async () => {
    const json = await get()
    expect(json.ok).toBe(true)
    expect(json.shopName).toBe("Kids Corner")
    expect(json.paymentMethods).toEqual(["cash", "card"])
  })
})

describe("till bootstrap update fields", () => {
  beforeEach(() => {
    latestRelease = null
  })

  it("reports null update fields when there is nothing newer published", async () => {
    const json = await get()
    expect(json.latestVersionCode).toBeNull()
    expect(json.latestVersionName).toBeNull()
    expect(json.apkUrl).toBeNull()
  })

  it("passes through a published release exactly as the checker reports it", async () => {
    latestRelease = {
      versionCode: 3,
      versionName: "Till v0.3.0",
      apkUrl: "https://github.com/Hamaad7865/KidsCorner/releases/download/till-v3/till-v3.apk",
    }
    const json = await get()
    expect(json.latestVersionCode).toBe(3)
    expect(json.latestVersionName).toBe("Till v0.3.0")
    expect(json.apkUrl).toBe(
      "https://github.com/Hamaad7865/KidsCorner/releases/download/till-v3/till-v3.apk",
    )
  })
})
