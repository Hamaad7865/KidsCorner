import { createElement } from "react"
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import type { StaffLogin } from "@/lib/staff/actions"

import { StaffLogins } from "./staff-logins"

const person = (over: Partial<StaffLogin> = {}): StaffLogin => ({
  id: "u-1",
  fullName: "Rita Appadoo",
  email: "rita@kidscorner.mu",
  role: "cashier",
  isActive: true,
  ...over,
})

const render = (staff: StaffLogin[], canCreate = true, currentUserId = "owner-1") =>
  renderToStaticMarkup(
    createElement(StaffLogins, { staff, canCreate, currentUserId }),
  )

describe("StaffLogins", () => {
  it("lists each person with their email and role", () => {
    const html = render([
      person(),
      person({ id: "u-2", fullName: "Ben Lucas", email: null, role: "manager" }),
    ])
    expect(html).toContain("Rita Appadoo")
    expect(html).toContain("rita@kidscorner.mu")
    expect(html).toContain("Ben Lucas")
    expect(html).toContain("manager")
    // No address on file degrades to a dash, never an empty cell.
    expect(html).toContain(">—<")
  })

  it("offers creating only when the service key is configured", () => {
    const ready = render([person()], true)
    const notReady = render([person()], false)

    expect(ready).toContain("Add login")
    expect(notReady).toContain('disabled=""')
    // And it says WHY, with the exact variable to set.
    expect(notReady).toContain("SUPABASE_SERVICE_ROLE_KEY")
  })

  it("marks the signed-in owner and disables their own switch", () => {
    const html = render([person({ id: "owner-1", role: "owner" })], true, "owner-1")
    expect(html).toContain("(you)")
    expect(html).toContain('disabled=""')
  })

  it("badges inactive staff rather than hiding them", () => {
    const html = render([person({ isActive: false })])
    expect(html).toContain("inactive")
  })
})
