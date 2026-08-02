/**
 * Does what the till does actually show up in the back office?
 *
 *   npm run check:consistency
 *
 * Every check below is a claim a screen makes, tested against the rows that
 * screen would read. Reading the code proves the query compiles; this proves
 * the rows are where the query expects to find them.
 *
 * Read-only — it never writes. Safe to run against the live shop, and worth
 * running after any migration that touches sales, stock or shifts: these are
 * the invariants that no single RPC is responsible for holding, so nothing
 * else would notice them breaking.
 */
import { readFileSync } from "node:fs"
import pg from "pg"

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
const url = env.match(/^SUPABASE_DB_UR\w*\s*=\s*"?([^"\r\n]+)"?/m)[1]
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()

const checks = []
const check = async (name, sql, verdict) => {
  try {
    const { rows } = await db.query(sql)
    const bad = verdict(rows)
    checks.push({ name, ok: !bad, detail: bad || `${rows.length} row(s)` })
  } catch (e) {
    checks.push({ name, ok: false, detail: `QUERY FAILED: ${e.message.slice(0, 120)}` })
  }
}

// ── the sale ───────────────────────────────────────────────────────────────
await check(
  "every completed sale has at least one line",
  `select s.id from sales s
     left join sale_items si on si.sale_id = s.id
    where s.status = 'completed'
    group by s.id having count(si.id) = 0`,
  (r) => r.length && `${r.length} empty sale(s): ${r.slice(0, 5).map((x) => x.id)}`,
)

await check(
  "every completed sale is paid in full (payments = total)",
  `select s.id, s.total, coalesce(sum(p.amount),0) paid
     from sales s left join sale_payments p on p.sale_id = s.id
    where s.status = 'completed'
    group by s.id, s.total
   having round(coalesce(sum(p.amount),0)::numeric,2) <> round(s.total::numeric,2)`,
  (r) =>
    r.length &&
    `${r.length} unbalanced: ${r.slice(0, 3).map((x) => `#${x.id} total ${x.total} paid ${x.paid}`).join("; ")}`,
)

await check(
  "sale totals equal the sum of their lines less the basket discount",
  `select s.id, s.total, s.discount,
          round(sum(si.line_total)::numeric,2) lines
     from sales s join sale_items si on si.sale_id = s.id
    where s.status = 'completed'
    group by s.id, s.total, s.discount
   having round(sum(si.line_total)::numeric,2)
        - round(coalesce(s.discount,0)::numeric,2)
       <> round(s.total::numeric,2)`,
  (r) =>
    r.length &&
    `${r.length} mismatched: ${r.slice(0, 3).map((x) => `#${x.id} lines ${x.lines} - disc ${x.discount} != ${x.total}`).join("; ")}`,
)

// ── the stock ledger ───────────────────────────────────────────────────────
await check(
  "every sold line wrote a stock movement",
  `select si.id, si.sale_id
     from sale_items si
     join sales s on s.id = si.sale_id
    where s.status = 'completed' and si.variant_id is not null
      and not exists (
        select 1 from stock_movements m
         where m.movement_type = 'sale' and m.reference_id = s.id
           and m.variant_id = si.variant_id)`,
  (r) => r.length && `${r.length} line(s) sold with no ledger entry: sale ${r.slice(0, 5).map((x) => x.sale_id)}`,
)

await check(
  "qty_on_hand agrees with the movement ledger",
  `select v.id, v.qty_on_hand, coalesce(sum(m.qty),0) ledger
     from product_variants v
     left join stock_movements m on m.variant_id = v.id
    group by v.id, v.qty_on_hand
   having v.qty_on_hand <> coalesce(sum(m.qty),0)`,
  (r) =>
    r.length &&
    `${r.length} variant(s) drifted: ${r.slice(0, 5).map((x) => `#${x.id} says ${x.qty_on_hand}, ledger ${x.ledger}`).join("; ")}`,
)

// ── the drawer ─────────────────────────────────────────────────────────────
await check(
  "every cash movement belongs to a shift the back office can show",
  `select cm.id from till_movements cm
    where cm.shift_id is null
       or not exists (select 1 from shifts s where s.id = cm.shift_id)`,
  (r) => r.length && `${r.length} orphaned cash movement(s)`,
)

await check(
  "every completed sale falls inside a shift",
  `select s.id, s.sale_date from sales s
    where s.status = 'completed'
      and s.shift_id is null`,
  (r) => r.length && `${r.length} sale(s) with no shift — invisible to the Z and the shift report`,
)

// ── refunds ────────────────────────────────────────────────────────────────
await check(
  "every credit note points at a real sale and has lines",
  `select cn.id from credit_notes cn
    where not exists (select 1 from sales s where s.id = cn.sale_id)
       or not exists (select 1 from credit_note_items i where i.credit_note_id = cn.id)`,
  (r) => r.length && `${r.length} broken credit note(s)`,
)

await check(
  "no credit note returns more than was sold",
  `select cn.id, i.variant_id, sum(i.qty) returned, max(si.qty) sold
     from credit_notes cn
     join credit_note_items i on i.credit_note_id = cn.id
     join sale_items si on si.sale_id = cn.sale_id and si.variant_id = i.variant_id
    group by cn.id, i.variant_id
   having sum(i.qty) > max(si.qty)`,
  (r) => r.length && `${r.length} over-refund(s)`,
)

// ── the catalogue the till is handed ───────────────────────────────────────
await check(
  "no two variants share a barcode",
  `select barcode, count(*) from product_variants
    where barcode is not null and barcode <> ''
    group by barcode having count(*) > 1`,
  (r) => r.length && `${r.length} duplicated barcode(s) — a scan would be ambiguous`,
)

await check(
  "every variant the till can sell has a price",
  `select v.id from product_variants v
     join products p on p.id = v.product_id
    where p.is_active and (v.selling_price is null or v.selling_price <= 0)`,
  (r) => r.length && `${r.length} sellable variant(s) priced at zero or null`,
)

console.log("\n  correspondence: till → back office\n")
let failed = 0
for (const c of checks) {
  if (!c.ok) failed++
  console.log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.name}`)
  if (!c.ok) console.log(`        ${c.detail}`)
}
console.log(`\n  ${checks.length - failed}/${checks.length} pass\n`)
await db.end()
process.exitCode = failed ? 1 : 0
