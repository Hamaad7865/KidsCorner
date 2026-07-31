/**
 * Refuses to build for production without the Supabase configuration.
 *
 * THIS IS A SECURITY GUARD, not a convenience check.
 *
 * `lib/env.ts` deliberately tolerates missing credentials so `npm run dev` is
 * useful before `.env.local` is filled in. The consequence lives in the
 * middleware:
 *
 *     if (!isSupabaseConfigured) return NextResponse.next()
 *
 * Every request is waved through. No login, no role check, no redirect — the
 * whole back office and the till API open to anyone with the URL. That is the
 * right behaviour on a laptop and a catastrophe on kidscorner.mu, and nothing
 * about a build without those variables looks wrong: it succeeds, it deploys,
 * and the site loads.
 *
 * `NEXT_PUBLIC_*` values are inlined by Next at BUILD time, so setting them on
 * the Worker afterwards does not help — the bundle already contains whatever
 * was present when it was built. They have to be in the build environment,
 * which is why this runs there.
 */

const REQUIRED = [
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    check: (v) => /^https:\/\/[^.]+\.supabase\.co\/?$/.test(v),
    hint: "should look like https://abcdefgh.supabase.co",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    alt: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    check: (v) => v.length >= 20,
    hint: "the project's public, RLS-guarded key — at least 20 characters",
  },
]

const problems = []

for (const { name, alt, check, hint } of REQUIRED) {
  const value = process.env[name] ?? (alt ? process.env[alt] : undefined)
  if (!value) {
    problems.push(`${name} is not set — ${hint}`)
    continue
  }
  if (!check(value.trim())) {
    problems.push(`${name} is set but does not look right — ${hint}`)
  }
}

if (problems.length > 0) {
  console.error("\n  Refusing to build for production.\n")
  for (const p of problems) console.error(`    · ${p}`)
  console.error(
    "\n  Without these, the middleware waves every request through: no login,\n" +
      "  no role check, no redirect. The site would deploy and look fine while\n" +
      "  being completely open.\n\n" +
      "  In CI, set them as repository secrets. Locally, put them in .env.local.\n",
  )
  process.exit(1)
}

console.log("preflight: Supabase configuration present — auth will be enforced")
