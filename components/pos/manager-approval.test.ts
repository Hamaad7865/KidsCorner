import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ManagerApproval } from "./manager-approval"
import type { Cashier } from "@/lib/pos/sale-core"

/**
 * The keypad a manager types a PIN into to authorise an override.
 *
 * Deliberately NOT asserting that its keys carry type="button". That test was
 * written and then deleted the same hour: Base UI's ButtonPrimitive emits
 * type="button" itself, so the assertion held no matter what this file said
 * and could never have failed. A test that cannot fail is worse than none —
 * it reads as coverage.
 *
 * What is left is what this component actually decides: which of its three
 * states to show, and whether it says anything useful in the one where the
 * shop has not set up a PIN for anybody.
 */

const manager = (over: Partial<Cashier> = {}): Cashier => ({
  id: "11111111-1111-4111-8111-111111111111",
  fullName: "Priya Ramdin",
  role: "manager",
  hasPin: true,
  ...over,
})

const render = (managers: Cashier[]) =>
  renderToStaticMarkup(
    createElement(ManagerApproval, {
      managers,
      reason: "return",
      pending: false,
      onApprove: () => {},
      onCancel: () => {},
    }),
  )

/** Every <button> in the markup, with its type attribute if it has one. */
const buttonCount = (html: string) => [...html.matchAll(/<button\b/g)].length

describe("ManagerApproval", () => {
  it("renders a keypad once a manager is picked", () => {
    // One manager is preselected, so the digits are on screen immediately.
    // Ten digits plus a clear and a backspace: enough to tell the keypad
    // apart from the picker, which is the branch this is checking.
    expect(buttonCount(render([manager()]))).toBeGreaterThan(9)
  })

  it("says what to do when nobody has a PIN, rather than showing dead keys", () => {
    const html = render([manager({ hasPin: false })])
    expect(html).toContain("no owner or manager has a PIN set")
    expect(html).toContain("Staff PINs")
  })

  it("names what is being authorised, because the manager is asked to judge it", () => {
    expect(render([manager()])).toContain("return")
  })
})
