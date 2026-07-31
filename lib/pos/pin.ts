/**
 * PIN hashing for the POS cashier switcher.
 *
 * `profiles.pin_code` is a single TEXT column and the schema comment says the
 * PIN is "hashed in app", so the salt is packed into the stored string:
 *
 *     pbkdf2$<iterations>$<salt base64>$<hash base64>
 *
 * PBKDF2 via Web Crypto keeps this dependency-free and works on both the Node
 * and Edge runtimes.
 *
 * Be clear-eyed about what this protects: a 4-digit PIN has 10,000 possible
 * values, so a hash is not a serious barrier to anyone who obtains the database.
 * It is not meant to be — the real authentication is the Supabase session, and
 * the PIN only decides which cashier's name goes on a sale in a shop where
 * everyone already shares one logged-in till. Hashing stops a PIN being read
 * casually off the table; it does not make it a password.
 */

const ITERATIONS = 100_000
const KEY_BITS = 256

function toBase64(bytes: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(bytes)).toString("base64")
}

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  const bits = await crypto.subtle.deriveBits(
    // BufferSource: a plain Uint8Array is accepted at runtime.
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    KEY_BITS,
  )
  return toBase64(bits)
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(pin, salt)
  return `pbkdf2$${ITERATIONS}$${toBase64(salt.buffer as ArrayBuffer)}$${hash}`
}

/** Constant-time-ish compare so a wrong PIN can't be narrowed by timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split("$")
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false

  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < 1) return false

  const salt = new Uint8Array(Buffer.from(parts[2], "base64"))
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    KEY_BITS,
  )
  return safeEqual(toBase64(bits), parts[3])
}

export const PIN_PATTERN = /^\d{4}$/
