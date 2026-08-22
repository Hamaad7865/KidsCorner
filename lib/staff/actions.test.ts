import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  logAudit: vi.fn(async () => undefined),
  session: {
    profile: {
      id: "owner-1",
      role: "owner",
      isActive: true,
      fullName: "Owner",
    } as { id: string; role: string; isActive: boolean } | null,
  },
  serviceConfigured: true,
  admin: {
    createUser: vi.fn(),
    deleteUser: vi.fn(async () => ({ data: {}, error: null })),
    listUsers: vi.fn(async () => ({
      data: { users: [{ id: "u-1", email: "a@x.mu" }] },
      error: null,
    })),
  },
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/activity/audit", () => ({ logAudit: mocks.logAudit }))
vi.mock("@/lib/auth/session", () => ({
  getSessionProfile: vi.fn(async () => mocks.session.profile),
}))
vi.mock("@/lib/env", () => ({
  // A getter, so tests can flip the flag: the mock factory's plain value would
  // be captured once at first import.
  get isServiceRoleConfigured() {
    return mocks.serviceConfigured
  },
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: mocks.admin } }),
}))

const profilesResult = {
  data: [
    { id: "u-1", full_name: "Ada", role: "manager", is_active: true },
    { id: "u-2", full_name: "Ben", role: "cashier", is_active: false },
  ] as { id: string; full_name: string; role: string; is_active: boolean }[] | null,
  error: null as { message: string } | null,
}

const insertError = { current: null as { message: string } | null }
const updateError = { current: null as { message: string } | null }

const profilesTable = {
  // Self-returning so select().order() chains; results come from profilesResult.
  select: vi.fn(() => profilesTable),
  order: vi.fn(async () => profilesResult),
  insert: vi.fn(() => ({ error: insertError.current })),
  update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: updateError.current })) })),
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => (table === "profiles" ? profilesTable : {}),
  })),
}))

import { IDLE_STATE } from "@/lib/forms"

import { createStaffLogin, listStaffLogins, setStaffActive } from "./actions"

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.serviceConfigured = true
  mocks.session.profile = {
    id: "owner-1",
    role: "owner",
    isActive: true,
  }
  profilesResult.data = [
    { id: "u-1", full_name: "Ada", role: "manager", is_active: true },
    { id: "u-2", full_name: "Ben", role: "cashier", is_active: false },
  ]
  profilesResult.error = null
  insertError.current = null
  updateError.current = null
  mocks.admin.createUser.mockResolvedValue({
    data: { user: { id: "new-1" } },
    error: null,
  })
})

describe("createStaffLogin", () => {
  const valid = {
    fullName: "Rita Appadoo",
    email: "rita@kidscorner.mu",
    password: "long-enough",
    role: "cashier",
  }

  it("refuses anybody but the owner", async () => {
    mocks.session.profile = { id: "m-1", role: "manager", isActive: true }
    const result = await createStaffLogin(IDLE_STATE, form(valid))
    expect(result.error).toContain("Only the owner")
    expect(mocks.admin.createUser).not.toHaveBeenCalled()
  })

  it("explains a missing service key rather than failing opaquely", async () => {
    mocks.serviceConfigured = false
    const result = await createStaffLogin(IDLE_STATE, form(valid))
    expect(result.error).toContain("SUPABASE_SERVICE_ROLE_KEY")
  })

  it("validates the fields and reports per-field errors", async () => {
    const result = await createStaffLogin(
      IDLE_STATE,
      form({ ...valid, email: "nope", password: "short" }),
    )
    expect(result.fieldErrors.email).toBeTruthy()
    expect(result.fieldErrors.password).toBeTruthy()
  })

  it("creates the auth user, then the profile that names them", async () => {
    const result = await createStaffLogin(IDLE_STATE, form(valid))
    expect(result.status).toBe("success")
    expect(mocks.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "rita@kidscorner.mu",
        password: "long-enough",
        email_confirm: true,
      }),
    )
    expect(profilesTable.insert).toHaveBeenCalledWith({
      id: "new-1",
      full_name: "Rita Appadoo",
      role: "cashier",
      is_active: true,
    })
  })

  it("translates an address already registered into something to do", async () => {
    mocks.admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered" },
    })
    const result = await createStaffLogin(IDLE_STATE, form(valid))
    expect(result.error).toContain("already has a login")
  })

  it("rolls the auth user back when the profile half fails", async () => {
    insertError.current = { message: "check constraint" }
    const result = await createStaffLogin(IDLE_STATE, form(valid))
    expect(result.status).toBe("error")
    expect(mocks.admin.deleteUser).toHaveBeenCalledWith("new-1")
  })
})

describe("listStaffLogins", () => {
  it("merges emails onto profiles for an owner", async () => {
    const { staff, canCreate } = await listStaffLogins()
    expect(canCreate).toBe(true)
    expect(staff).toHaveLength(2)
    expect(staff[0]).toMatchObject({ fullName: "Ada", email: "a@x.mu" })
    // Ben's auth row was not in the stubbed directory.
    expect(staff[1].email).toBeNull()
  })

  it("gives a manager neither the list nor the create button", async () => {
    mocks.session.profile = { id: "m-1", role: "manager", isActive: true }
    const { staff, canCreate } = await listStaffLogins()
    expect(staff).toEqual([])
    expect(canCreate).toBe(false)
  })
})

describe("setStaffActive", () => {
  it("refuses an owner deactivating themselves", async () => {
    const result = await setStaffActive("owner-1", false)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("own login")
  })

  it("records the flip and revalidates settings", async () => {
    const result = await setStaffActive("u-2", false)
    expect(result.ok).toBe(true)
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings")
  })
})
