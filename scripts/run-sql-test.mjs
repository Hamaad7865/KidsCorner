/**
 * Runs one hand-rolled SQL acceptance test file (supabase/tests/*.sql)
 * against the same database scripts/migrate.mjs migrates.
 *
 *   node scripts/run-sql-test.mjs supabase/tests/exchange_refund.sql
 *
 * Every file in that directory wraps itself in `begin; ... rollback;`, so
 * running it here is non-destructive regardless of which database
 * SUPABASE_DB_URL/SUPABASE_DB_UR points at. A RAISE NOTICE prints as it
 * happens; a failed assertion raises an exception, which this script reports
 * with a non-zero exit code rather than swallowing.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import pg from "pg"

function connectionString() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL
  if (process.env.SUPABASE_DB_UR) return process.env.SUPABASE_DB_UR
  for (const base of ["", "C:/Projects/KidsCorner/"]) {
    const path = resolve(base || process.cwd(), ".env.local")
    if (!existsSync(path)) continue
    const m = readFileSync(path, "utf8").match(/^SUPABASE_DB_UR\w*\s*=\s*"?([^"\r\n]+)"?/m)
    if (m) return m[1]
  }
  return null
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error("usage: node scripts/run-sql-test.mjs <path/to/test.sql>")
    process.exit(1)
  }
  const url = connectionString()
  if (!url) {
    console.error("[sql-test] No database connection string found (SUPABASE_DB_URL or .env.local).")
    process.exit(1)
  }

  const sql = readFileSync(resolve(process.cwd(), file), "utf8")
  const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  db.on("notice", (n) => console.log(`[notice] ${n.message}`))
  await db.connect()
  try {
    await db.query(sql)
    console.log(`[sql-test] PASSED: ${file}`)
  } catch (e) {
    console.error(`[sql-test] FAILED: ${file}\n${e.message}`)
    process.exitCode = 1
  } finally {
    await db.end()
  }
}

main()
