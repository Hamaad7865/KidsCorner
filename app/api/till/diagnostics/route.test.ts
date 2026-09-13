import { beforeEach, describe, expect, it, vi } from "vitest"

const insert = vi.fn()
const session = {
  supabase: {
    from: () => ({ insert }),
  },
}

vi.mock("@/lib/api/till-session", () => ({
  requireTillSession: async () => session,
  apiError: (message: string, status: number) =>
    new Response(JSON.stringify({ ok: false, error: message }), { status }),
}))

const { POST } = await import("./route")

const post = (body: unknown) =>
  POST(
    new Request("http://t/api/till/diagnostics", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ).then((r) => r.json())

describe("POST /api/till/diagnostics", () => {
  beforeEach(() => {
    insert.mockReset()
    insert.mockReturnValue({
      select: () => ({ single: async () => ({ data: { id: 7 }, error: null }) }),
    })
  })

  it("stores the report and answers its id", async () => {
    const json = await post({
      appVersion: "0.20.3 (31)",
      deviceModel: "YEPOS T1",
      androidRelease: "12",
      log: "TillIme: txns opened",
    })
    expect(json).toEqual({ ok: true, id: 7 })
    expect(insert).toHaveBeenCalledOnce()
    const row = insert.mock.calls[0]?.[0]
    expect(row.app_version).toBe("0.20.3 (31)")
    expect(row.device_model).toBe("YEPOS T1")
    expect(row.log).toContain("TillIme")
  })

  it("refuses an oversized log rather than growing the table", async () => {
    const json = await post({ log: "x".repeat(60_001) })
    expect(json.ok).not.toBe(true)
    expect(insert).not.toHaveBeenCalled()
  })

  it("refuses a malformed body", async () => {
    const json = await post({ log: 42 })
    expect(json.ok).not.toBe(true)
    expect(insert).not.toHaveBeenCalled()
  })
})
