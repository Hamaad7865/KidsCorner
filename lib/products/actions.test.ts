import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  updatedValues: undefined as Record<string, unknown> | undefined,
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
vi.mock("@/lib/auth/session", () => ({
  getSessionProfile: vi.fn(async () => ({
    id: "owner-1",
    role: "owner",
    isActive: true,
    fullName: "Owner",
  })),
}))
vi.mock("@/lib/auth/roles", () => ({ canManageCatalog: vi.fn(() => true) }))
vi.mock("@/lib/activity/audit", () => ({
  logAudits: vi.fn(),
  moneyChange: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table !== "products") throw new Error(`Unexpected table: ${table}`)

      return {
        update: vi.fn((values: Record<string, unknown>) => {
          mocks.updatedValues = values
          return {
            eq: vi.fn(() => ({
              select: vi.fn(async () => ({ data: [{ id: 7 }], error: null })),
            })),
          }
        }),
      }
    }),
  })),
}))

import { IDLE_STATE } from "@/lib/forms"

import { saveProduct } from "./actions"

describe("saveProduct", () => {
  beforeEach(() => {
    mocks.updatedValues = undefined
    mocks.revalidatePath.mockClear()
  })

  it("persists the trimmed shelf location on an existing product", async () => {
    const formData = new FormData()
    formData.set("id", "7")
    formData.set("name", "Chemise cotton")
    formData.set("categoryId", "1")
    formData.set("gender", "unisex")
    formData.set("shelfLocation", "  A12  ")
    formData.set("isActive", "true")

    const result = await saveProduct(IDLE_STATE, formData)

    expect(result).toMatchObject({ status: "success", message: "Product saved." })
    expect(mocks.updatedValues).toMatchObject({ shelf_location: "A12" })
  })
})
