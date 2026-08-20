/**
 * Applies pending database migrations, and records what it applied.
 *
 *   node scripts/migrate.mjs
 *
 * Run in CI right before a deploy (see .github/workflows/deploy.yml) so the
 * live schema can never lag the code that expects it — the failure mode that
 * once showed every back-office page the generic "migration 001 not applied"
 * error because a migration had been written and committed but never run
 * against the database.
 *
 * ## How it decides what to run
 *
 * A `schema_migrations` table records every file that has been applied, by
 * name. On each run:
 *
 *   • files in supabase/Migrations not yet in that table are applied in
 *     filename order, each inside its own transaction, and recorded;
 *   • a file already recorded is skipped.
 *
 * ## Baselining an existing database
 *
 * The live database predates this runner: every migration up to now was applied
 * by hand, so re-running them would fail (several — 036, for one — rebuild a
 * function and are not safe to run twice). So on the FIRST run against a
 * database that already has the app schema (the `products` table exists) and no
 * `schema_migrations` table, every current file is RECORDED as applied without
 * being run. Nothing about the schema changes; only the ledger is written. A
 * genuinely empty database (no `products` table) is treated as fresh and every
 * migration is actually run.
 *
 * ## Connection string
 *
 * `SUPABASE_DB_URL` (the CI secret) if set, else `SUPABASE_DB_UR*` from
 * .env.local for local runs. With neither, the runner WARNS and exits 0 rather
 * than failing — so a deploy is not broken before the secret has been added.
 * Once the secret is present, a real SQL error fails the run and holds the
 * deploy.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import pg from "pg"

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/Migrations")

function connectionString() {
  // Either spelling of the CI secret. The local .env.local key is literally
  // `SUPABASE_DB_UR` (no trailing L), so the GitHub secret may be named to
  // match it or given the fuller `SUPABASE_DB_URL` — accept both so a name
  // mismatch can never quietly leave migrations un-run.
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL
  if (process.env.SUPABASE_DB_UR) return process.env.SUPABASE_DB_UR
  // Local fallback: the same loose pattern the other scripts use to read it
  // out of .env.local.
  for (const base of ["", "C:/Projects/KidsCorner/"]) {
    const path = resolve(base || process.cwd(), ".env.local")
    if (!existsSync(path)) continue
    const m = readFileSync(path, "utf8").match(/^SUPABASE_DB_UR\w*\s*=\s*"?([^"\r\n]+)"?/m)
    if (m) return m[1]
  }
  return null
}

async function main() {
  const url = connectionString()
  if (!url) {
    console.warn(
      "\n[migrate] No database connection string found " +
        "(SUPABASE_DB_URL secret or .env.local). Skipping migrations.\n" +
        "[migrate] Add the SUPABASE_DB_URL secret in GitHub to activate " +
        "automatic migrations on deploy.\n",
    )
    return
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
  if (files.length === 0) {
    console.log("[migrate] No migration files found.")
    return
  }

  const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await db.connect()
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    const applied = new Set(
      (await db.query(`SELECT filename FROM public.schema_migrations`)).rows.map(
        (r) => r.filename,
      ),
    )
    const pending = files.filter((f) => !applied.has(f))

    if (pending.length === 0) {
      console.log(`[migrate] Up to date — ${files.length} migration(s) already applied.`)
      return
    }

    // First run against a database that already has the app schema: adopt it.
    // Record every current file as applied without running any of them.
    const firstRun = applied.size === 0
    const hasAppSchema =
      (await db.query(`SELECT to_regclass('public.products') AS t`)).rows[0].t !== null

    if (firstRun && hasAppSchema) {
      await db.query(
        `INSERT INTO public.schema_migrations (filename)
         SELECT unnest($1::text[])
         ON CONFLICT (filename) DO NOTHING`,
        [files],
      )
      console.log(
        `[migrate] Baselined ${files.length} existing migration(s) — the database ` +
          `already had this schema, so none were re-run. Only new migrations apply from here.`,
      )
      return
    }

    // Normal path (or a genuinely fresh database): run each pending file in its
    // own transaction and record it. A failure rolls that file back and stops,
    // so a half-applied migration can never be recorded as done.
    for (const file of pending) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8")
      console.log(`[migrate] applying ${file} …`)
      try {
        await db.query("BEGIN")
        await db.query(sql)
        await db.query(
          `INSERT INTO public.schema_migrations (filename) VALUES ($1)`,
          [file],
        )
        await db.query("COMMIT")
      } catch (e) {
        await db.query("ROLLBACK")
        console.error(`[migrate] FAILED on ${file}: ${e.message}`)
        throw e
      }
    }
    console.log(`[migrate] Applied ${pending.length} migration(s).`)
  } finally {
    await db.end()
  }
}

main().catch((e) => {
  console.error("[migrate] error:", e.message)
  process.exit(1)
})
