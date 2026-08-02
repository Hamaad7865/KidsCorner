/**
 * Regenerates supabase/catch-up.sql as a SNAPSHOT of the live schema.
 *
 * The old file was a replay of history — every migration rewritten to be
 * idempotent — and it drifted: it stopped at 025, and even inside its own range
 * its `create_credit_note` was the original six-argument version. Several
 * migrations patch a function body by matching text, so once the base drifts
 * the patches cannot land.
 *
 * A snapshot cannot drift. Whatever is in the database is what comes out.
 *
 *   node scripts/generate-catchup.mjs
 *
 * Run it after applying any migration, and commit the result. The numbered
 * files stay the historical record; this keeps the file people RUN honest.
 */
import { readFileSync, writeFileSync } from "node:fs"
import pg from "pg"

const env = readFileSync("C:/Projects/KidsCorner/.env.local", "utf8")
const url = env.match(/^SUPABASE_DB_UR\w*\s*=\s*"?([^"\r\n]+)"?/m)[1]
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const q = async (sql, params = []) => (await c.query(sql, params)).rows
const out = []
const say = (s = "") => out.push(s)
const rule = (title) => {
  say("")
  say("-- " + "=".repeat(74))
  say(`-- ${title}`)
  say("-- " + "=".repeat(74))
  say("")
}

// ── header ──────────────────────────────────────────────────────────────────
say(`-- ============================================================================
-- Kids Corner — complete schema
--
-- A SNAPSHOT of the live database, generated from its own catalog, not a replay
-- of the migration history. Run it on a fresh Supabase project and you get
-- exactly the schema the shop is running.
--
-- Why a snapshot. The previous version of this file was every migration
-- rewritten to be idempotent, and it drifted twice over: it stopped at 025, so
-- a fresh project was missing the two migrations that keep the shop's takings
-- private (028 pins search_path on every SECURITY DEFINER function; 035 takes
-- EXECUTE away from the publishable key's role). And inside its own range its
-- create_credit_note was still the original six-argument version — so the later
-- migrations, several of which patch a function body by matching on text, had
-- no anchor to find.
--
-- The numbered files in supabase/Migrations/ remain the historical record of
-- what was applied and why. This file is what you RUN.
--
-- Safe to re-run: every object is dropped-if-exists or created-if-not-exists,
-- and the seed rows are ON CONFLICT DO NOTHING.
--
-- It assumes Supabase's own auth and storage schemas already exist, which they
-- do on any real project.
--
-- Generated ${new Date().toISOString().slice(0, 10)} from the live schema.
-- ============================================================================`)

// ── extensions ──────────────────────────────────────────────────────────────
rule("EXTENSIONS")
// Only the two this schema actually calls into: pgcrypto for gen_random_uuid
// and crypt, uuid-ossp alongside it. The others on a Supabase project —
// pg_stat_statements, supabase_vault — belong to the platform, are already
// there, and naming them here would only make this file fail on anything else.
//
// The `extensions` schema exists on any real project; the guard is so the file
// also builds into a bare database.
say("CREATE SCHEMA IF NOT EXISTS extensions;")
for (const e of await q(`
  select extname, n.nspname as schema from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where extname in ('pgcrypto', 'uuid-ossp') order by extname`)) {
  say(`CREATE EXTENSION IF NOT EXISTS "${e.extname}" WITH SCHEMA ${e.schema};`)
}

// ── tables ──────────────────────────────────────────────────────────────────
rule("TABLES")
const tables = (await q(`
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' order by c.relname`)).map((r) => r.relname)

for (const t of tables) {
  const cols = await q(
    `select a.attname,
            format_type(a.atttypid, a.atttypmod) as type,
            a.attnotnull,
            pg_get_expr(d.adbin, d.adrelid) as default_expr,
            a.attidentity,
            a.attgenerated
       from pg_attribute a
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [`public.${t}`],
  )
  const lines = cols.map((col) => {
    // A serial column is an integer whose default is nextval on its own
    // sequence. Emitted as SERIAL so the sequence is created with the table
    // rather than dangling as a separate object nobody owns.
    const serial =
      col.default_expr &&
      /^nextval\(/.test(col.default_expr) &&
      /^(integer|bigint|smallint)$/.test(col.type)
    let type = col.type
    if (serial) type = { integer: "SERIAL", bigint: "BIGSERIAL", smallint: "SMALLSERIAL" }[col.type]
    let line = `    ${col.attname} ${type}`
    // A STORED generated column keeps its expression in pg_attrdef exactly
    // where a default lives, so emitting it as one produces "cannot use column
    // reference in DEFAULT expression" — `purchase_items.line_total` is
    // qty * unit_cost.
    if (col.attgenerated === "s") {
      line += ` GENERATED ALWAYS AS ${col.default_expr} STORED`
    } else {
      if (col.attidentity === "a") line += " GENERATED ALWAYS AS IDENTITY"
      if (col.attidentity === "d") line += " GENERATED BY DEFAULT AS IDENTITY"
      if (!serial && col.default_expr && !col.attidentity) line += ` DEFAULT ${col.default_expr}`
      if (col.attnotnull && !serial) line += " NOT NULL"
    }
    return line
  })
  say(`CREATE TABLE IF NOT EXISTS ${t} (`)
  say(lines.join(",\n"))
  say(");")
  say("")
}

// ── constraints ─────────────────────────────────────────────────────────────
// Added after every table exists, so a foreign key never names a table that has
// not been created yet — which is what an alphabetical CREATE order guarantees
// will otherwise happen.
rule("CONSTRAINTS — primary keys, uniques, checks, then foreign keys")
const cons = await q(`
  select rel.relname as tbl, con.conname, con.contype,
         pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
   where n.nspname = 'public' and con.contype in ('p','u','c','f')
   order by case con.contype when 'p' then 1 when 'u' then 2 when 'c' then 3 else 4 end,
            rel.relname, con.conname`)
for (const k of cons) {
  say(`DO $$ BEGIN
    ALTER TABLE ${k.tbl} ADD CONSTRAINT ${k.conname} ${k.def};
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;`)
}

// ── indexes ─────────────────────────────────────────────────────────────────
rule("INDEXES")
for (const i of await q(`
  select indexdef from pg_indexes
   where schemaname = 'public'
     and indexname not in (
       select con.conname from pg_constraint con
         join pg_class rel on rel.oid = con.conrelid
         join pg_namespace n on n.oid = rel.relnamespace
        where n.nspname = 'public')
   order by tablename, indexname`)) {
  say(i.indexdef.replace(/^CREATE (UNIQUE )?INDEX /, (m, u) => `CREATE ${u ?? ""}INDEX IF NOT EXISTS `) + ";")
}

// ── functions ───────────────────────────────────────────────────────────────
// Straight from pg_get_functiondef, which is the whole point of a snapshot:
// whatever the live function is, that is what comes out, patches and all.
rule("FUNCTIONS")
for (const f of await q(`
  select replace(pg_get_functiondef(p.oid), chr(13)||chr(10), chr(10)) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' order by p.proname, p.pronargs`)) {
  say(f.def.trim() + ";")
  say("")
}

// ── views ───────────────────────────────────────────────────────────────────
rule("VIEWS")
for (const v of await q(`
  select c.relname, pg_get_viewdef(c.oid, true) as def,
         coalesce(array_to_string(c.reloptions, ', '), '') as opts
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' order by c.relname`)) {
  const withOpts = v.opts ? ` WITH (${v.opts})` : ""
  say(`CREATE OR REPLACE VIEW ${v.relname}${withOpts} AS`)
  say(v.def.trim())
  say("")
}

// ── triggers ────────────────────────────────────────────────────────────────
rule("TRIGGERS")
for (const t of await q(`
  select tg.tgname, rel.relname, pg_get_triggerdef(tg.oid) as def
    from pg_trigger tg
    join pg_class rel on rel.oid = tg.tgrelid
    join pg_namespace n on n.oid = rel.relnamespace
   where n.nspname = 'public' and not tg.tgisinternal
   order by rel.relname, tg.tgname`)) {
  say(`DROP TRIGGER IF EXISTS ${t.tgname} ON ${t.relname};`)
  say(t.def + ";")
}

// ── row level security ──────────────────────────────────────────────────────
rule("ROW LEVEL SECURITY")
for (const t of tables) say(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`)
say("")
for (const p of await q(`
  select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies where schemaname = 'public' order by tablename, policyname`)) {
  const roles = p.roles.replace(/[{}]/g, "")
  say(`DROP POLICY IF EXISTS ${p.policyname} ON ${p.tablename};`)
  let s = `CREATE POLICY ${p.policyname} ON ${p.tablename}`
  if (p.permissive === "RESTRICTIVE") s += " AS RESTRICTIVE"
  s += `\n    FOR ${p.cmd === "ALL" ? "ALL" : p.cmd}`
  if (roles && roles !== "public") s += ` TO ${roles}`
  if (p.qual) s += `\n    USING (${p.qual})`
  if (p.with_check) s += `\n    WITH CHECK (${p.with_check})`
  say(s + ";")
  say("")
}

// ── storage ─────────────────────────────────────────────────────────────────
rule("STORAGE — the product-images bucket and its policies")
for (const b of await q(`select id, name, public, file_size_limit, allowed_mime_types from storage.buckets`)) {
  const mimes = b.allowed_mime_types ? `ARRAY[${b.allowed_mime_types.map((m) => `'${m}'`).join(", ")}]` : "NULL"
  say(`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('${b.id}', '${b.name}', ${b.public}, ${b.file_size_limit}, ${mimes})
ON CONFLICT (id) DO UPDATE
   SET public = EXCLUDED.public,
       file_size_limit = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;`)
  say("")
}
for (const p of await q(`
  select policyname, roles, cmd, qual, with_check from pg_policies
   where schemaname = 'storage' and tablename = 'objects' order by policyname`)) {
  const roles = p.roles.replace(/[{}]/g, "")
  say(`DROP POLICY IF EXISTS ${p.policyname} ON storage.objects;`)
  let s = `CREATE POLICY ${p.policyname} ON storage.objects\n    FOR ${p.cmd}`
  if (roles && roles !== "public") s += ` TO ${roles}`
  if (p.qual) s += `\n    USING (${p.qual})`
  if (p.with_check) s += `\n    WITH CHECK (${p.with_check})`
  say(s + ";")
  say("")
}

// ── grants ──────────────────────────────────────────────────────────────────
rule("GRANTS — migration 035, the one that matters most")
say(`-- Supabase grants EXECUTE on everything in public to anon and authenticated
-- by default, and most of this schema is SECURITY DEFINER — which bypasses row
-- level security entirely. \`anon\` is the role the PUBLISHABLE KEY maps to: the
-- key in the browser bundle and inside the Android APK. Left alone, that key
-- can read the day's takings and call complete_sale.
--
-- Nothing in the app needs it. Every call site runs server-side under a signed-in
-- session, and the Android till reaches the database through /api/till/* with a
-- bearer token that resolves to an authenticated session.
DO $$
DECLARE fn RECORD;
BEGIN
    FOR fn IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
        JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public'
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', fn.sig);
    END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;`)

// ── seed data ───────────────────────────────────────────────────────────────
rule("SEED DATA")
const seeds = [
  ["settings", "key"],
  ["sizes", "id"],
  ["colours", "id"],
  ["categories", "id"],
  ["stock_locations", "id"],
  ["module_access", "id"],
]
for (const [table, conflictCol] of seeds) {
  const rows = await q(`select * from ${table} order by 1`)
  if (rows.length === 0) continue
  const cols = Object.keys(rows[0])
  // Typed per column, not guessed from the JavaScript value. `settings.value`
  // is JSONB, and the driver hands a JSON `false` back as a JS boolean — write
  // that as bare FALSE and Postgres refuses it as the wrong type for the column.
  const types = Object.fromEntries(
    (await q(
      `select column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name = $1`, [table],
    )).map((r) => [r.column_name, r.data_type]),
  )
  const lit = (v, col) => {
    if (v === null) return "NULL"
    const json = types[col] === "jsonb" || types[col] === "json"
    if (json) return `'${JSON.stringify(v).replace(/'/g, "''")}'::${types[col]}`
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE"
    if (typeof v === "number") return String(v)
    if (v instanceof Date) return `'${v.toISOString()}'`
    if (Array.isArray(v)) return `ARRAY[${v.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(", ")}]`
    if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
    return `'${String(v).replace(/'/g, "''")}'`
  }
  say(`INSERT INTO ${table} (${cols.join(", ")}) VALUES`)
  say(rows.map((r) => "    (" + cols.map((k) => lit(r[k], k)).join(", ") + ")").join(",\n"))
  say(`ON CONFLICT (${conflictCol}) DO NOTHING;`)
  // A table seeded with explicit ids leaves its sequence behind; the next
  // insert would collide on the primary key.
  if (conflictCol === "id") {
    say(`SELECT setval(pg_get_serial_sequence('${table}', 'id'),
       greatest((SELECT max(id) FROM ${table}), 1));`)
  }
  say("")
}

// ── closing report ──────────────────────────────────────────────────────────
rule("WHAT YOU SHOULD SEE")
say(`-- Run this after the file. The three security figures are the point: any
-- other answer means the publishable key reaches further than it should.
SELECT
    (SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE')      AS tables,
    (SELECT count(*) FROM information_schema.views
      WHERE table_schema = 'public')                                    AS views,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public')                                       AS functions,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')      AS policies,
    -- Must be 0. Migration 035.
    (SELECT count(*) FROM information_schema.role_routine_grants
      WHERE specific_schema = 'public' AND grantee IN ('anon','PUBLIC')) AS anon_can_execute,
    -- Must be 0. Migration 028.
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef
        AND (p.proconfig IS NULL OR NOT EXISTS (
              SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%')))
                                                                        AS definers_unpinned,
    -- Must be 4. Migration 034.
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v'
        AND 'security_invoker=on' = ANY(c.reloptions))                  AS views_with_invoker,
    (SELECT count(*) FROM sizes)      AS sizes,
    (SELECT count(*) FROM colours)    AS colours,
    (SELECT count(*) FROM categories) AS categories,
    (SELECT count(*) FROM settings)   AS settings;`)

writeFileSync("C:/Projects/KidsCorner/supabase/catch-up.sql", out.join("\n") + "\n")
console.log(`written: ${out.join("\n").length / 1024 | 0} KB, ${out.length} lines`)
console.log(`tables ${tables.length}, constraints ${cons.length}`)
await c.end()
