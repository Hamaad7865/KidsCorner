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
const mockUpdateError = vi.fn<() => { code?: string; message: string } | null>(
  () => null,
)

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table !== "products") throw new Error(`Unexpected table: ${table}`)

      return {
        update: vi.fn((values: Record<string, unknown>) => {
          mocks.updatedValues = values
          return {
            eq: vi.fn(() => ({
              select: vi.fn(async () => {
                const error = mockUpdateError()
                return error ? { data: null, error } : { data: [{ id: 7 }], error: null }
              }),
            })),
          }
        }),
      }
    }),
  })),
}))

import { IDLE_STATE } from "@/lib/forms"

import { saveProduct } from "./actions"

function baseFormData(): FormData {
  const formData = new FormData()
  formData.set("id", "7")
  formData.set("name", "Chemise cotton")
  formData.set("productCode", "PC-1023")
  formData.set("categoryId", "1")
  formData.set("gender", "unisex")
  formData.set("isActive", "true")
  return formData
}

describe("saveProduct", () => {
  beforeEach(() => {
    mocks.updatedValues = undefined
    mocks.revalidatePath.mockClear()
    mockUpdateError.mockReturnValue(null)
  })

  it("persists the trimmed shelf location on an existing product", async () => {
    const formData = baseFormData()
    formData.set("shelfLocation", "  A12  ")

    const result = await saveProduct(IDLE_STATE, formData)

    expect(result).toMatchObject({ status: "success", message: "Product saved." })
    expect(mocks.updatedValues).toMatchObject({ shelf_location: "A12" })
  })

  it("persists the trimmed product code", async () => {
    const formData = baseFormData()
    formData.set("productCode", "  PC-1023  ")

    const result = await saveProduct(IDLE_STATE, formData)

    expect(result).toMatchObject({ status: "success", message: "Product saved." })
    expect(mocks.updatedValues).toMatchObject({ product_code: "PC-1023" })
  })

  it("refuses to save without a product code", async () => {
    const formData = baseFormData()
    formData.delete("productCode")

    const result = await saveProduct(IDLE_STATE, formData)

    expect(result.status).toBe("error")
    expect(mocks.updatedValues).toBeUndefined()
  })

  it("blames the product code, not the SKU, for its own collision", async () => {
    mockUpdateError.mockReturnValue({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "products_product_code_unique_idx"',
    })
    const formData = baseFormData()

    const result = await saveProduct(IDLE_STATE, formData)

    expect(result).toMatchObject({
      status: "error",
      error: "That product code is already used by another product.",
    })
  })
})
