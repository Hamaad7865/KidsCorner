import { describe, expect, it } from "vitest"

import {
  DEVICE_VERIFIER_PATTERN,
  deviceVerifierMatches,
  mintDeviceVerifier,
} from "./device-verifier"
import { hashPin } from "./pin"

/**
 * The hash a till is allowed to hold.
 *
 * Two things are worth pinning here and nothing else is. First, that this and
 * the Android `PinHasher` derive the same bytes — they are two implementations
 * of one agreement, in different languages, and nothing else in either build
 * would notice them drifting apart. Second, that a `pin_code` can never be
 * mistaken for a verifier, which is the whole reason the two formats differ.
 */

/**
 * Minted by node:crypto and checked, byte for byte, by PinSecurityTest.kt.
 * If you change this line, change it there.
 *
 * 1000 iterations, not the 310,000 this actually ships with: the vector is
 * proving that two languages agree on PBKDF2-HMAC-SHA256 — the salt encoding,
 * the 32-byte output, the UTF-8 of the PIN — and none of that is a function of
 * the iteration count. A vector at full cost would add a second to every run
 * of both suites to prove exactly the same thing. The cost that ships is
 * pinned separately, below.
 */
export const SHARED_VECTOR = {
  pin: "4271",
  verifier:
    "pbkdf2:sha256:1000:S2lkc0Nvcm5lclRpbGwhIQ==:AC4CSs7AfaJLrvK/10tjh3K/JebHyW4cydmO8KKHW8A=",
}

describe("device verifier", () => {
  it("agrees with the Android PinHasher on a shared vector", async () => {
    expect(await deviceVerifierMatches(SHARED_VECTOR.pin, SHARED_VECTOR.verifier)).toBe(true)
    expect(await deviceVerifierMatches("4272", SHARED_VECTOR.verifier)).toBe(false)
  })

  it("mints at the cost it claims, and a different salt every time", async () => {
    const [a, b] = [await mintDeviceVerifier("1234"), await mintDeviceVerifier("1234")]
    // 100k, the most Cloudflare Workers' Web Crypto will do: a higher count
    // throws NotSupportedError at mint time and 500s the sign-in. Lower still and
    // every shipped verifier gets cheaper to grind, and nothing else would fail.
    expect(a.startsWith("pbkdf2:sha256:100000:")).toBe(true)
    expect(a).not.toEqual(b)
    expect(await deviceVerifierMatches("1234", a)).toBe(true)
    expect(await deviceVerifierMatches("1234", b)).toBe(true)
  })

  it("never mints above the Workers PBKDF2 ceiling", async () => {
    // The whole bug in one line: Workers rejects >100000, so the minted count
    // must never exceed it, or a correct PIN 500s on the deployed till.
    const count = Number((await mintDeviceVerifier("1234")).split(":")[2])
    expect(count).toBeLessThanOrEqual(100_000)
  })

  it("rejects an over-ceiling stored verifier instead of throwing", async () => {
    // A legacy 310k verifier cannot be recomputed on Workers. It must read as
    // "does not match" — which makes the caller re-mint a fresh, supported one —
    // rather than throwing NotSupportedError mid-sign-in.
    const legacy =
      "pbkdf2:sha256:310000:S2lkc0Nvcm5lclRpbGwhIQ==:AC4CSs7AfaJLrvK/10tjh3K/JebHyW4cydmO8KKHW8A="
    expect(await deviceVerifierMatches("4271", legacy)).toBe(false)
  })

  it("refuses a pin_code, which is the other hash entirely", async () => {
    // The two live in adjacent columns and describe the same four digits. The
    // formats differ so that handing one to the other fails closed instead of
    // quietly succeeding: a till must never be able to verify against the
    // value the server authenticates with.
    const serverHash = await hashPin("1234")
    expect(DEVICE_VERIFIER_PATTERN.test(serverHash)).toBe(false)
    expect(await deviceVerifierMatches("1234", serverHash)).toBe(false)
  })

  it("verifies nothing when there is nothing to verify against", async () => {
    for (const stored of [
      null,
      undefined,
      "",
      "pbkdf2:sha256:0:AA==:AA==", // no work at all
      "pbkdf2:sha256:x:AA==:AA==", // iterations not a number
      "pbkdf2:sha512:1000:AA==:AA==", // a digest this does not implement
      "pbkdf2:sha256:1000::AA==", // no salt
      "pbkdf2:sha256:1000:AA==", // truncated
    ]) {
      expect(await deviceVerifierMatches("1234", stored)).toBe(false)
    }
  })
})
