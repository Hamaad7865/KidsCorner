/**
 * The hash of a staff PIN that a till is allowed to hold.
 *
 * `pin_code` (lib/pos/pin.ts) is what the SERVER compares against, and it stays
 * on the server — `listCashiers` reduces it to a boolean for exactly that
 * reason. But the tablet's lock screen has to work with no network, or an
 * outage locks the shop out of its own till while the sale queue sits there
 * unable to receive anything. So a PIN gets a second, separate derivation,
 * and that is what travels.
 *
 * Separate matters. If the tablet held `pin_code` itself, a rooted tablet
 * would hold the value the server authenticates against — the shop's own
 * credential, lifted from the device that is least under anybody's eye. This
 * one is derived with its own salt at its own cost, so compromising the tablet
 * yields a string the server has never seen.
 *
 * What it does NOT buy, and lib/pos/pin.ts is already honest about this: a
 * four-digit PIN is 10,000 values. 100k iterations costs a tablet a fraction of
 * a second per guess and a GPU rather less than that for the whole space. The
 * verifier is not what makes the PIN safe — the throttle at the keypad, the
 * lockout in the database, and the fact that a stolen tablet gets reported
 * are. What this buys is revocation: clear a PIN or deactivate a login in the
 * back office and the verifier stops being served, so the tablet drops it at
 * its next sync without anyone having to touch the device.
 *
 * The count is 100k, not OWASP's 310k, because this runs on Cloudflare Workers,
 * whose Web Crypto rejects PBKDF2 iteration counts ABOVE 100,000 outright:
 * minting at 310k throws `NotSupportedError`, which surfaced as a 500 on every
 * successful till sign-in (a wrong PIN is refused before the mint is reached).
 * Node — where the tests and local dev run — has no such cap, so it went unseen
 * until the till hit the deployed Worker. The Android `PinHasher` reads the
 * count out of the verifier string rather than assuming one, so it verifies
 * whatever is minted; the cross-language vector in device-verifier.test.ts is
 * pinned at 1,000 iterations and is unaffected. lib/pos/pin.ts already sits at
 * this same 100k ceiling.
 */

// Cloudflare Workers' Web Crypto rejects PBKDF2 iteration counts above this.
const MAX_WORKERS_ITERATIONS = 100_000
const ITERATIONS = MAX_WORKERS_ITERATIONS
const KEY_BITS = 256
const SALT_BYTES = 16

/**
 * COLONS, where `pin_code` uses dollars. Deliberate: the two hashes must never
 * be interchangeable by accident, so neither string parses as the other, and a
 * verifier that somehow arrived from the wrong column fails closed.
 */
export const DEVICE_VERIFIER_PATTERN = /^pbkdf2:sha256:[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/

const toBase64 = (bytes: ArrayBuffer): string =>
  Buffer.from(new Uint8Array(bytes)).toString("base64")

async function derive(
  pin: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  const bits = await crypto.subtle.deriveBits(
    // BufferSource: a plain Uint8Array is accepted at runtime.
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    KEY_BITS,
  )
  return toBase64(bits)
}

/** A fresh verifier for a PIN that is, at this moment, known to be correct. */
export async function mintDeviceVerifier(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const dk = await derive(pin, salt, ITERATIONS)
  return `pbkdf2:sha256:${ITERATIONS}:${toBase64(salt.buffer as ArrayBuffer)}:${dk}`
}

/** Constant-time-ish compare, matching lib/pos/pin.ts. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Does the stored verifier already describe this PIN?
 *
 * Asked at a successful sign-in, where the PIN is known good, so the answer
 * decides whether to mint a replacement: no for a staff member whose PIN
 * predates this column, no again after an owner changed the PIN from Settings
 * without the verifier following. Yes means the shop's tills are already
 * carrying the right thing and there is nothing to write.
 */
export async function deviceVerifierMatches(
  pin: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored || !DEVICE_VERIFIER_PATTERN.test(stored)) return false

  const parts = stored.split(":")
  const iterations = Number(parts[2])
  if (!Number.isInteger(iterations) || iterations < 1) return false
  // A verifier minted before this cap existed (e.g. the old 310k) cannot be
  // recomputed on Workers at all. Treat it as non-matching so the caller mints a
  // fresh one at the supported cost, rather than throwing NotSupportedError in
  // the middle of a sign-in.
  if (iterations > MAX_WORKERS_ITERATIONS) return false

  const salt = new Uint8Array(Buffer.from(parts[3], "base64"))
  if (salt.length === 0) return false

  return safeEqual(await derive(pin, salt, iterations), parts[4])
}
