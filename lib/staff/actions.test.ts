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
    updateUserById: vi.fn(),
    deleteUser: vi.fn(async () => ({ data: {}, error: null })),
    listUsers: vi.fn(async (): Promise<any> => ({
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
const targetRow = {
  current: { full_name: "Diksha Bhewa", role: "owner" } as Record<string, string> | null,
}
const updateSelectRows = { current: [{ id: "u-9" }] as { id: string }[] | null }

const profilesTable = {
  // Self-returning so select().order() chains; results come from profilesResult.
  select: vi.fn(() => profilesTable),
  order: vi.fn(async () => profilesResult),
  // Shared by the target lookup (.eq().maybeSingle()) and the profile write
  // (.update().eq().select()). Awaiting the bare .eq() object (setStaffActive)
  // resolves to something without an error, i.e. success.
  eq: vi.fn(() => ({
    maybeSingle: async () => ({ data: targetRow.current, error: null }),
    select: async () => ({ data: updateSelectRows.current, error: updateError.current }),
  })),
  insert: vi.fn(() => ({ error: insertError.current })),
  update: vi.fn(() => profilesTable),
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => (table === "profiles" ? profilesTable : {}),
  })),
}))

import { IDLE_STATE } from "@/lib/forms"

import { createStaffLogin, listStaffLogins, setStaffActive, updateStaffLogin } from "./actions"

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
  targetRow.current = { full_name: "Diksha Bhewa", role: "owner" }
  updateSelectRows.current = [{ id: "u-9" }]
  mocks.admin.createUser.mockResolvedValue({
    data: { user: { id: "new-1" } },
    error: null,
  })
  mocks.admin.updateUserById.mockResolvedValue({
    data: { user: { id: "u-9" } },
    error: null,
  })
  mocks.admin.listUsers.mockResolvedValue({
    data: { users: [{ id: "u-1", email: "a@x.mu" }] },
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

describe("updateStaffLogin", () => {
  const edit = (over: Record<string, string> = {}) =>
    form({
      profileId: "u-9",
      originalEmail: "",
      fullName: "Diksha Bhewa",
      email: "diksha@kidscorner.mu",
      password: "",
      role: "owner",
      ...over,
    })

  it("reports a blank email on the field, not the form", async () => {
    const result = await updateStaffLogin(IDLE_STATE, edit({ email: "" }))
    expect(result.status).toBe("error")
    expect(result.error).toBeNull()
    expect(result.fieldErrors.email).toContain("valid email")
    expect(mocks.admin.updateUserById).not.toHaveBeenCalled()
  })

  it("still requires a valid email even when it is unchanged", async () => {
    const result = await updateStaffLogin(
      IDLE_STATE,
      edit({ email: "", originalEmail: "" }),
    )
    // Blank email is still invalid even when unchanged — the schema cannot
    // tell "unknown, leave it" from "cleared". The field error says so.
    expect(result.fieldErrors.email).toBeTruthy()
  })

  it("updates the sign-in when the email changed", async () => {
    const result = await updateStaffLogin(IDLE_STATE, edit())
    expect(result.status).toBe("success")
    expect(mocks.admin.updateUserById).toHaveBeenCalledWith(
      "u-9",
      expect.objectContaining({ email: "diksha@kidscorner.mu" }),
    )
  })

  it("translates a taken address into something to do", async () => {
    mocks.admin.updateUserById.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Email address already exists" },
    })
    const result = await updateStaffLogin(IDLE_STATE, edit())
    expect(result.error).toContain("already belongs to another login")
  })

  /**
   * The "{}" regression: GoTrue can fail with a message-less body (a 500 with
   * an empty error object — poisoned auth rows did exactly this), and
   * supabase-js then reports the message as JSON.stringify(body), i.e. the
   * literal string "{}". The dialog rendered it verbatim. Anything without a
   * readable message now becomes a sentence that also states nothing changed.
   */
  it.each([
    ["a missing message", {}],
    ["a literal {}", { message: "{}" }],
    ["a blank message", { message: "   " }],
  ])("never renders %s as the error", async (_label, error) => {
    mocks.admin.updateUserById.mockResolvedValueOnce({ data: { user: null }, error })
    const result = await updateStaffLogin(IDLE_STATE, edit())
    expect(result.status).toBe("error")
    expect(result.error).not.toBe("{}")
    expect(result.error).toContain("nothing was changed")
  })

  it("refuses cleanly when Auth itself is unreachable", async () => {
    mocks.admin.updateUserById.mockRejectedValueOnce(new TypeError("fetch failed"))
    const result = await updateStaffLogin(IDLE_STATE, edit())
    expect(result.status).toBe("error")
    expect(result.error).toContain("nothing was changed")
  })
})

describe("staff directory failures", () => {
  it("still lists staff when the directory errors, flagged", async () => {
    mocks.admin.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: { message: "boom" } })
    const { staff, canCreate, directoryOk } = await listStaffLogins()
    expect(staff).toHaveLength(2)
    expect(canCreate).toBe(true)
    expect(directoryOk).toBe(false)
    // Addresses are unknown, not empty.
    expect(staff[0]?.email).toBeNull()
  })

  it("still lists staff when the directory throws, flagged", async () => {
    mocks.admin.listUsers.mockRejectedValueOnce(new TypeError("fetch failed"))
    const { directoryOk } = await listStaffLogins()
    expect(directoryOk).toBe(false)
  })

  it("reports a message-less create failure as a sentence, not {}", async () => {
    mocks.admin.createUser.mockResolvedValueOnce({ data: { user: null }, error: {} })
    const result = await createStaffLogin(
      IDLE_STATE,
      form({
        fullName: "Rita Appadoo",
        email: "rita@kidscorner.mu",
        password: "long-enough",
        role: "cashier",
      }),
    )
    expect(result.error).not.toBe("{}")
    expect(result.error).toContain("couldn't create the login")
  })
})
