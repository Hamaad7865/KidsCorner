/**
 * Contrast of every pair the two apps actually paint.
 *
 *   npm run check:contrast
 *
 * A palette change is the easiest way to break legibility without breaking a
 * test, a type or a build. Nothing else in this repo would notice: the page
 * renders, the app compiles, and a figure a shopkeeper has to read across a
 * counter has quietly gone to 3.6:1.
 *
 * Both palettes are read from source rather than restated here — globals.css
 * for the web, Handoff.kt and Color.kt for the till — so this measures what
 * ships, not a copy of it that can drift.
 *
 * The bar is WCAG AA, 4.5:1, for anything carrying text. Hairlines and
 * disabled controls have their own, lower bars and their own reasons, listed
 * in EXEMPT below. Nothing is silently excused: an exemption without a reason
 * is a failure.
 */
import { readFileSync } from "node:fs"

const ROOT = new URL("..", import.meta.url)
const read = (p) => readFileSync(new URL(p, ROOT), "utf8")

// ── colour maths ───────────────────────────────────────────────────────────
const gamma = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
const linear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

/** oklch(L C H) -> [r,g,b] 0-255, clamped the way a browser clamps. */
function oklch(L, C, H) {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.round(Math.max(0, Math.min(1, gamma(v))) * 255))
}

const luminance = ([r, g, b]) =>
  0.2126 * linear(r / 255) + 0.7152 * linear(g / 255) + 0.0722 * linear(b / 255)

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()

/**
 * `bg-destructive/10` is a 10% wash over the card beneath it, and that
 * composite is what the eye measures — not the token. Straight alpha over an
 * opaque backdrop.
 *
 * Tailwind v4 emits the modifier as `color-mix(in oklab, … 10%, transparent)`,
 * so a browser lands a fraction lighter than this does — 4.69:1 against the
 * 4.56:1 below. The difference is small and this side of it, so the stricter
 * reading is the one worth failing on.
 */
const over = (fg, bg, alpha) =>
  fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)))

// ── the web palette, out of :root in globals.css ───────────────────────────
function webTokens() {
  const css = read("app/globals.css")
  // Both bounds searched FROM the start of :root. `[data-density=` also appears
  // in a comment above it, explaining why the density tokens have to live in
  // `@theme inline` — searching the whole file finds that one, slices
  // backwards, and yields an empty block whose tokens all read as missing.
  const start = css.indexOf(":root {")
  const root = css.slice(start, css.indexOf("[data-density=", start))
  const raw = new Map()
  for (const m of root.matchAll(/(--[\w-]+):\s*([^;]+);/g)) raw.set(m[1], m[2].trim())

  const resolve = (value, depth = 0) => {
    if (depth > 6) return null
    const varRef = value.match(/^var\((--[\w-]+)\)$/)
    if (varRef) return resolve(raw.get(varRef[1]) ?? "", depth + 1)
    const ok = value.match(/^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/)
    if (ok) return oklch(+ok[1], +ok[2], +ok[3])
    return null
  }

  const out = new Map()
  for (const [k, v] of raw) {
    const rgb = resolve(v)
    if (rgb) out.set(k, rgb)
  }
  return out
}

// ── the till palette, out of the two Kotlin files ──────────────────────────
function tillTokens() {
  const src =
    read("till-android/app/src/main/java/mu/kidscorner/till/ui/theme/Handoff.kt") +
    read("till-android/app/src/main/java/mu/kidscorner/till/ui/theme/Color.kt")
  const direct = new Map()
  const alias = new Map()
  for (const m of src.matchAll(/val\s+(\w+)\s*=\s*Color\(0x[0-9A-Fa-f]{2}([0-9A-Fa-f]{6})\)/g)) {
    const h = m[2]
    direct.set(m[1], [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)))
  }
  for (const m of src.matchAll(/val\s+(\w+)\s*=\s*(\w+)\s*$/gm)) {
    if (!direct.has(m[1])) alias.set(m[1], m[2])
  }
  const get = (name, depth = 0) =>
    depth > 6 ? null : direct.get(name) ?? (alias.has(name) ? get(alias.get(name), depth + 1) : null)

  const out = new Map()
  for (const name of [...direct.keys(), ...alias.keys()]) {
    const rgb = get(name)
    if (rgb) out.set(name, rgb)
  }
  return out
}

// ── what each app actually paints ──────────────────────────────────────────
const WEB = [
  ["--foreground", "--background", "body text"],
  ["--muted-foreground", "--background", "secondary text"],
  ["--muted-foreground", "--muted", "text in a muted well"],
  ["--primary-foreground", "--primary", "white on a brand button"],
  ["--accent-foreground", "--accent", "brand text on its tint"],
  ["--secondary-foreground", "--secondary", "a secondary button"],
  ["--success", "--background", "success text"],
  ["--success", "--success-muted", "success on its chip"],
  ["--warning", "--background", "warning text"],
  ["--warning", "--muted", "warning in a well"],
  ["--warning-foreground", "--warning-muted", "warning chip ink"],
  ["--sidebar-accent-foreground", "--sidebar-accent", "the active nav item"],
]

/** Pairs where the ground is a wash of the ink over a backdrop. */
const WEB_WASHED = [
  ["--destructive", "--card", 0.1, "destructive button (bg-destructive/10)"],
  ["--destructive", "--card", 0, "destructive text"],
]

const TILL = [
  ["Ink", "Surface", "body text"],
  ["InkFigure", "Surface", "a money figure"],
  ["InkStrong", "Surface", "a secondary button's label"],
  ["Muted", "Surface", "secondary text"],
  ["Muted2", "Surface", "tertiary text"],
  ["Muted3", "Surface", "a label under a heading"],
  ["Muted3", "Well", "a label in an inset well"],
  ["Muted3", "FieldWell", "a label in a typed field"],
  ["AccentSolid", "Surface", "the TOTAL figure"],
  ["AccentText", "AccentTint", "accent text on its tint"],
  ["PinOnAccent", "AccentSolid", "white on PAY"],
  ["Danger", "Surface", "an error message"],
  ["Danger", "DangerTint", "danger text on its tint"],
  ["WarnText", "WarnTint", "a discount badge, the offline pill"],
  ["WarnText", "Surface", "an amber figure"],
  ["ChangeFigure", "ChangeTint", "change due"],
  ["ChangeLabel", "ChangeTint", "the CHANGE DUE label"],
  ["PinText", "PinPanel", "the PIN heading"],
  ["PinTextSoft", "PinGround", "the shop line on the lock screen"],
  ["PinTextSoft", "PinGround", "the lock screen's instructions, and who cannot sign in offline"],
  ["WarnText", "PinGround", "the lock screen saying the shop's line is down"],
  ["PinTextFaint", "PinPanel", "the '4-digit PIN' caption under the picked name"],
  ["ScanGlyph", "ScanButton", "the barcode glyph"],
  ["ToastInk", "ScanButton", "a toast"],
]

/**
 * Pairs held to a lower bar, each with the reason. An entry here is a decision
 * somebody took; an entry without a reason would be a decision nobody took.
 */
const EXEMPT = [
  {
    app: "till", ink: "BlockedText", ground: "Blocked", min: 1.8,
    why: "a disabled control — WCAG 1.4.3 exempts inactive components, and it should look inactive",
  },
  {
    app: "till", ink: "Muted4", ground: "Surface", min: 3,
    why: "mostly an icon; 3:1 is the UI-component bar. Raising it collapses the grey ladder",
  },
  {
    app: "till", ink: "Faint", ground: "Surface", min: 2.5,
    why: "placeholder text, deliberately recessive so a hint never reads as an entered value",
  },
  {
    app: "till", ink: "Fainter", ground: "Surface", min: 2.2,
    why: "the empty photo slot's own label, on a tile that is itself a placeholder",
  },
  {
    app: "till", ink: "Line", ground: "Surface", min: 1.2,
    why: "a hairline — it needs to be seen, not read",
  },
  {
    app: "till", ink: "LineSoft", ground: "Surface", min: 1.2,
    why: "a hairline",
  },
  {
    app: "till", ink: "Ghost", ground: "Surface", min: 1.4,
    why: "the empty-cart glyph, which is decoration beside its own caption",
  },
  {
    app: "web", ink: "--border", ground: "--background", min: 1.2,
    why: "a hairline",
  },
]

const AA = 4.5
const results = []
const push = (app, label, ink, ground, r, min) =>
  results.push({ app, label, ink, ground, r, min, ok: r >= min })

const web = webTokens()
const till = tillTokens()

for (const [f, b, label] of WEB) {
  const a = web.get(f)
  const c = web.get(b)
  if (!a || !c) { push("web", `${label} (UNRESOLVED ${f}/${b})`, null, null, 0, AA); continue }
  push("web", label, a, c, contrast(a, c), AA)
}
for (const [f, b, alpha, label] of WEB_WASHED) {
  const a = web.get(f)
  const c = web.get(b)
  if (!a || !c) { push("web", `${label} (UNRESOLVED)`, null, null, 0, AA); continue }
  const ground = alpha > 0 ? over(a, c, alpha) : c
  push("web", label, a, ground, contrast(a, ground), AA)
}
for (const [f, b, label] of TILL) {
  const a = till.get(f)
  const c = till.get(b)
  if (!a || !c) { push("till", `${label} (UNRESOLVED ${f}/${b})`, null, null, 0, AA); continue }
  push("till", label, a, c, contrast(a, c), AA)
}
for (const e of EXEMPT) {
  const set = e.app === "web" ? web : till
  const a = set.get(e.ink)
  const c = set.get(e.ground)
  if (!a || !c) { push(e.app, `${e.ink} on ${e.ground} (UNRESOLVED)`, null, null, 0, e.min); continue }
  push(e.app, `${e.ink} on ${e.ground} — ${e.why}`, a, c, contrast(a, c), e.min)
}

let failed = 0
for (const app of ["web", "till"]) {
  console.log(`\n  ${app}\n`)
  for (const r of results.filter((x) => x.app === app)) {
    if (!r.ok) failed++
    const bar = r.min === AA ? "" : `  (bar ${r.min})`
    const where = r.ink ? `  ${hex(r.ink)} on ${hex(r.ground)}` : ""
    console.log(
      `  ${r.r.toFixed(2).padStart(6)}:1  ${(r.ok ? "ok" : "FAIL").padEnd(5)} ${r.label}${bar}${where}`,
    )
  }
}
const total = results.length
console.log(
  `\n  ${total - failed}/${total} pass — text needs ${AA}:1; anything below it is` +
    ` listed above with the reason.\n`,
)
process.exitCode = failed ? 1 : 0
