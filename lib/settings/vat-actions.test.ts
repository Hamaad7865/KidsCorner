import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  rpc: vi.fn(async () => ({
    data: 42 as number | null,
    error: null as { message: string } | null,
  })),
  session: {
    profile: {
      id: "owner-1",
      role: "owner",
      isActive: true,
      fullName: "Owner",
    } as { id: string; role: string; isActive: boolean; fullName: string } | null,
  },
  currentPolicy: { enabled: false },
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/auth/session", () => ({
  getSessionProfile: vi.fn(async () => mocks.session.profile),
}))
vi.mock("@/lib/vat/policy", () => ({
  getCurrentVatPolicy: vi.fn(async () => mocks.currentPolicy),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: mocks.rpc })),
}))

import { IDLE_STATE } from "@/lib/forms"

import { saveVatPolicy } from "./vat-actions"

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe("saveVatPolicy", () => {
  beforeEach(() => {
    mocks.revalidatePath.mockClear()
    mocks.rpc.mockClear()
    mocks.rpc.mockResolvedValue({ data: 42, error: null })
    mocks.session.profile = {
      id: "owner-1",
      role: "owner",
      isActive: true,
      fullName: "Owner",
    }
    mocks.currentPolicy = { enabled: false }
  })

  it("rejects an unauthenticated caller before touching the RPC", async () => {
    mocks.session.profile = null
    const result = await saveVatPolicy(IDLE_STATE, form({ intent: "enable", ratePercent: "15" }))
    expect(result.status).toBe("error")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("rejects a non-owner before touching the RPC", async () => {
    mocks.session.profile = { id: "m", role: "manager", isActive: true, fullName: "Mgr" }
    const result = await saveVatPolicy(IDLE_STATE, form({ intent: "enable", ratePercent: "15", vatNumber: "V1" }))
    expect(result.status).toBe("error")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("requires a non-blank VAT number to enable", async () => {
    const result = await saveVatPolicy(
      IDLE_STATE,
      form({ intent: "enable", ratePercent: "15", vatNumber: "   " }),
    )
    expect(result.status).toBe("error")
    expect(result.fieldErrors.vatNumber).toBeTruthy()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("rejects a rate of zero or below", async () => {
    const result = await saveVatPolicy(
      IDLE_STATE,
      form({ intent: "enable", ratePercent: "0", vatNumber: "V1" }),
    )
    expect(result.status).toBe("error")
    expect(result.fieldErrors.ratePercent).toBeTruthy()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("rejects a rate above 100%", async () => {
    const result = await saveVatPolicy(
      IDLE_STATE,
      form({ intent: "enable", ratePercent: "150", vatNumber: "V1" }),
    )
    expect(result.status).toBe("error")
    expect(result.fieldErrors.ratePercent).toBeTruthy()
  })

  it("enables VAT: passes enabled=true, the fraction rate, and the trimmed number", async () => {
    const result = await saveVatPolicy(
      IDLE_STATE,
      form({ intent: "enable", ratePercent: "15", vatNumber: "  VAT20123456  " }),
    )
    expect(result.status).toBe("success")
    expect(mocks.rpc).toHaveBeenCalledWith("set_vat_policy", {
      p_enabled: true,
      p_configured_rate: 0.15,
      p_vat_number: "VAT20123456",
    })
  })

  it("disables VAT: passes enabled=false while retaining rate and number", async () => {
    const result = await saveVatPolicy(
      IDLE_STATE,
      form({ intent: "disable", ratePercent: "15", vatNumber: "VAT20123456" }),
    )
    expect(result.status).toBe("success")
    expect(mocks.rpc).toHaveBeenCalledWith("set_vat_policy", {
      p_enabled: false,
      p_configured_rate: 0.15,
      p_vat_number: "VAT20123456",
    })
  })

  it("save keeps the current disabled status rather than toggling", async () => {
    mocks.currentPolicy = { enabled: false }
    await saveVatPolicy(IDLE_STATE, form({ intent: "save", ratePercent: "18", vatNumber: "V9" }))
    expect(mocks.rpc).toHaveBeenCalledWith("set_vat_policy", {
      p_enabled: false,
      p_configured_rate: 0.18,
      p_vat_number: "V9",
    })
  })

  it("save keeps the current enabled status rather than toggling", async () => {
    mocks.currentPolicy = { enabled: true }
    await saveVatPolicy(IDLE_STATE, form({ intent: "save", ratePercent: "20", vatNumber: "V9" }))
    expect(mocks.rpc).toHaveBeenCalledWith("set_vat_policy", {
      p_enabled: true,
      p_configured_rate: 0.2,
      p_vat_number: "V9",
    })
  })

  it("revalidates settings, dashboard, reports and the till screen after a change", async () => {
    await saveVatPolicy(IDLE_STATE, form({ intent: "enable", ratePercent: "15", vatNumber: "V1" }))
    const paths = mocks.revalidatePath.mock.calls.map((c) => c[0])
    expect(paths).toEqual(
      expect.arrayContaining(["/settings", "/dashboard", "/reports", "/point-of-sale"]),
    )
  })

  it("converts a database privilege error into user-safe text", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Only an active owner can change VAT policy" },
    })
    const result = await saveVatPolicy(
      IDLE_STATE,
      form({ intent: "enable", ratePercent: "15", vatNumber: "V1" }),
    )
    expect(result.status).toBe("error")
    expect(result.error).toBe("Only the owner can change VAT registration.")
    // The raw Postgres phrasing never reaches the owner.
    expect(result.error).not.toContain("VAT policy")
  })
})
