import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { StaffPins, waitLeft } from "./staff-pins"
import type { StaffPinState } from "@/lib/pos/actions"

const NOW = Date.parse("2026-08-02T10:00:00.000Z")

const person = (over: Partial<StaffPinState> = {}): StaffPinState => ({
  id: "p1",
  fullName: "Marie Appadoo",
  role: "cashier",
  hasPin: true,
  lockedUntil: null,
  failedAttempts: 0,
  lastUsedAt: null,
  ...over,
})

const render = (staff: StaffPinState[], canManage = true) =>
  renderToStaticMarkup(createElement(StaffPins, { staff, canManage }))

afterEach(() => vi.useRealTimers())

describe("waitLeft", () => {
  it("rounds UP, so nobody is sent back to the keypad early", () => {
    // 61 seconds reported as "1 minute" sends a cashier back a second too soon,
    // to be refused again — which reads as the unlock not having worked.
    vi.useFakeTimers().setSystemTime(NOW)
    expect(waitLeft(new Date(NOW + 61_000).toISOString())).toBe("2 min")
    expect(waitLeft(new Date(NOW + 60_000).toISOString())).toBe("1 min")
    expect(waitLeft(new Date(NOW + 20_000).toISOString())).toBe("20s")
    expect(waitLeft(new Date(NOW + 3_601_000).toISOString())).toBe("2h")
  })

  it("says something rather than a negative when the wait has passed", () => {
    vi.useFakeTimers().setSystemTime(NOW)
    expect(waitLeft(new Date(NOW - 5_000).toISOString())).toBe("moments")
    expect(waitLeft("not a date")).toBe("moments")
  })
})

describe("StaffPins", () => {
  it("shows a PIN that is set, with no alarm", () => {
    const html = render([person()])
    expect(html).toContain("Marie Appadoo")
    expect(html).toContain("PIN set")
    expect(html).not.toContain("Locked")
    expect(html).not.toContain("Unlock")
  })

  it("offers an Unlock button only when somebody is locked out", () => {
    // The whole point: this button's action existed with no caller anywhere in
    // the app, so a cashier locked out mid-shift could only wait.
    vi.useFakeTimers().setSystemTime(NOW)
    const html = render([
      person({ lockedUntil: new Date(NOW + 120_000).toISOString(), failedAttempts: 5 }),
    ])
    expect(html).toContain("Unlock")
    expect(html).toContain("Locked")
    expect(html).toContain("2 min")
    expect(html).toContain("5 wrong tries")
  })

  it("counts a single wrong try in the singular", () => {
    expect(render([person({ failedAttempts: 1 })])).toContain("1 wrong try")
  })

  it("says when somebody has no PIN at all", () => {
    const html = render([person({ hasPin: false })])
    expect(html).toContain("No PIN")
  })

  it("disables every control for a manager, who may not change PINs", () => {
    vi.useFakeTimers().setSystemTime(NOW)
    const html = render(
      [person({ lockedUntil: new Date(NOW + 60_000).toISOString() })],
      false,
    )
    // Both the Unlock and the Set/Change buttons: clearing a lockout removes
    // the only brake on guessing a 4-digit PIN, so it is owner-only too.
    // Counted on the button tags themselves — the Button component also emits
    // data- and aria- variants, so a bare `/disabled/` count would pass on
    // almost any markup and prove nothing.
    const buttons = html.match(/<button\b[^>]*>/g) ?? []
    expect(buttons).toHaveLength(2)
    expect(buttons.every((b) => /\sdisabled(=|\s|>)/.test(b))).toBe(true)
  })

  it("leaves both controls live for an owner", () => {
    vi.useFakeTimers().setSystemTime(NOW)
    const html = render(
      [person({ lockedUntil: new Date(NOW + 60_000).toISOString() })],
      true,
    )
    const buttons = html.match(/<button\b[^>]*>/g) ?? []
    expect(buttons).toHaveLength(2)
    expect(buttons.some((b) => /\sdisabled(=|\s|>)/.test(b))).toBe(false)
  })

  it("says so when there are no staff yet", () => {
    expect(render([])).toContain("No active staff profiles yet")
  })
})
