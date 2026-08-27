# Exchange Refund and Idempotency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the till's Exchange screen settle a negative gap (shop refunds the customer) instead of blocking, fix the raw-SQL "line 332" error message, and close the missing idempotency-key gap on `/api/till/exchange` that let a retried exchange hit that confusing error in the first place.

**Architecture:** One new Postgres migration replaces `create_exchange` and `create_credit_note` (message wording only) and adds `create_exchange_keyed` (mirrors `complete_sale_keyed`, reusing `sales.idempotency_key`). The Next.js route swaps to the keyed RPC and reports the real settled gap back. The Android till drops its "gap must be non-negative" assumption in the UI and ViewModel, and sends a per-attempt idempotency key that only rotates after a confirmed success.

**Tech Stack:** PostgreSQL/plpgsql (Supabase), Next.js route handlers + Zod, Kotlin/Jetpack Compose (Android till), Vitest, JUnit.

**Spec:** `docs/superpowers/specs/2026-08-26-exchange-refund-and-idempotency-design.md`

---

### Task 1: A runner for the SQL acceptance tests

`supabase/tests/*.sql` (4 files today) has never had anything that runs it — the acceptance test this plan adds needs one.

**Files:**
- Create: `scripts/run-sql-test.mjs`

- [ ] **Step 1: Write the script**

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add scripts/run-sql-test.mjs
git commit -m "chore(db): add a runner for the hand-rolled SQL acceptance tests"
```

---

### Task 2: The migration — negative gap, friendly message, idempotency

**Files:**
- Create: `supabase/Migrations/20260826140000_exchange_refund_and_idempotency.sql` (already written during design — verify its content matches this task before running it)
- Create: `supabase/tests/exchange_refund.sql`

- [ ] **Step 1: Confirm the migration file's content**

`supabase/Migrations/20260826140000_exchange_refund_and_idempotency.sql` should already exist with three functions: `create_exchange` (negative-gap guard removed, `tendered` only set when `p_payment_method = 'cash' AND v_gap > 0`, the returnable-quantity error naming the product), `create_credit_note` (same message fix, otherwise identical to migration 021), and the new `create_exchange_keyed` wrapper. If it's missing or differs, write it to match the design spec's Sections 1, 3 and 4 before continuing — the SQL is reproduced there in full.

- [ ] **Step 2: Write the acceptance test**

Create `supabase/tests/exchange_refund.sql`:

```sql
-- Exchange refund + idempotency acceptance test.
--
-- Run after 20260826140000_exchange_refund_and_idempotency.sql has been
-- applied. Every fixture, sale, credit note and stock movement is rolled
-- back.
--
-- What this proves, in order: create_exchange settles a trade-DOWN gap by
-- refunding the difference instead of refusing; the sale_payments row it
-- writes for that leg is negative with no tendered figure; create_exchange
-- still settles a trade-UP gap exactly as before; create_exchange_keyed
-- replays an identical attempt instead of writing a second credit note and
-- sale; and the "already returned" refusal names the product instead of an
-- internal row id.
begin;

select 'public.create_exchange(bigint,int,uuid,jsonb,jsonb,text,numeric,uuid)'::regprocedure;
select 'public.create_exchange_keyed(text,bigint,int,uuid,jsonb,jsonb,text,numeric,uuid)'::regprocedure;
select 'public.create_credit_note(bigint,int,uuid,text,text,jsonb,boolean)'::regprocedure;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'Exchange acceptance failure: %', p_message;
  end if;
end;
$$;

do $$
declare
  v_staff             uuid;
  v_shift             integer;
  v_category          integer;
  v_size              integer;
  v_colour_original   integer;
  v_colour_cheaper    integer;
  v_colour_pricier    integer;
  v_product           integer;
  v_variant_original  integer;
  v_variant_cheaper   integer;
  v_variant_pricier   integer;
  v_sale_a            bigint;
  v_sale_b            bigint;
  v_item_a            bigint;
  v_item_b            bigint;
  v_new_sale          bigint;
  v_replay_sale       bigint;
  v_payment           record;
  v_error             text;
  v_unexpectedly_allowed boolean;
begin
  select id into v_staff from public.profiles where is_active order by created_at limit 1;
  perform pg_temp.assert_true(v_staff is not null, 'fixtures need an active staff profile');

  -- Closed on arrival: shifts_one_open_per_device allows only one OPEN shift
  -- per device, and a real till may already have one going. Neither RPC under
  -- test cares whether its shift is open — that gate lives in the route, not
  -- here — so there is nothing lost by not colliding with it.
  insert into public.shifts (opened_by, opening_float, closed_at)
    values (v_staff, 0, now()) returning id into v_shift;

  insert into public.categories (name) values ('Exchange acceptance category')
    returning id into v_category;
  insert into public.sizes (size_type, label, sort_order) values ('letter_size', 'Acceptance size', 1)
    returning id into v_size;
  insert into public.colours (name, hex_code) values ('Acceptance colour original', '#111111')
    returning id into v_colour_original;
  insert into public.colours (name, hex_code) values ('Acceptance colour cheaper', '#222222')
    returning id into v_colour_cheaper;
  insert into public.colours (name, hex_code) values ('Acceptance colour pricier', '#333333')
    returning id into v_colour_pricier;
  insert into public.products (name, category_id) values ('Acceptance tee', v_category)
    returning id into v_product;

  -- Three colourways of the same product, since (product_id, size_id,
  -- colour_id) is unique — one size shared, one colour per variant.
  insert into public.product_variants (product_id, size_id, colour_id, sku, cost_price, selling_price, qty_on_hand)
    values (v_product, v_size, v_colour_original, 'ACC-ORIG', 50, 200, 10) returning id into v_variant_original;
  insert into public.product_variants (product_id, size_id, colour_id, sku, cost_price, selling_price, qty_on_hand)
    values (v_product, v_size, v_colour_cheaper, 'ACC-CHEAP', 40, 150, 10) returning id into v_variant_cheaper;
  insert into public.product_variants (product_id, size_id, colour_id, sku, cost_price, selling_price, qty_on_hand)
    values (v_product, v_size, v_colour_pricier, 'ACC-PRICEY', 60, 250, 10) returning id into v_variant_pricier;

  -- ── trade-down: the shop pays the customer back ──────────────────────────

  v_sale_a := public.complete_sale_with_discounts(
    v_shift, null, v_staff, 0,
    jsonb_build_array(jsonb_build_object('variant_id', v_variant_original, 'qty', 1, 'unit_price', 200, 'discount', 0)),
    '[{"method":"cash","amount":200,"tendered":200}]'::jsonb
  );
  select id into v_item_a from public.sale_items where sale_id = v_sale_a;

  v_new_sale := public.create_exchange_keyed(
    'exchange-acceptance-tradedown-1',
    v_sale_a, v_shift, v_staff,
    jsonb_build_array(jsonb_build_object('sale_item_id', v_item_a, 'qty', 1)),
    jsonb_build_array(jsonb_build_object('variant_id', v_variant_cheaper, 'qty', 1)),
    'cash', null, null
  );

  perform pg_temp.assert_true(
    (select total from public.sales where id = v_new_sale) = 150,
    'the replacement sale should total the cheaper item''s list price'
  );

  select * into v_payment from public.sale_payments where sale_id = v_new_sale;
  perform pg_temp.assert_true(found, 'a trade-down exchange should still write one settlement row');
  perform pg_temp.assert_true(
    v_payment.amount = -50,
    format('a 200 credit against a 150 replacement should refund 50, not %s', v_payment.amount)
  );
  perform pg_temp.assert_true(
    v_payment.tendered is null,
    'a refund leg carries no tendered figure - there is nothing to compute change from'
  );

  perform pg_temp.assert_true(
    (select refund_method from public.credit_notes where sale_id = v_sale_a) = 'exchange',
    'an exchange credit note keeps its exchange marker regardless of which way the gap ran'
  );

  -- ── replay: the same key must not write a second document ───────────────

  v_replay_sale := public.create_exchange_keyed(
    'exchange-acceptance-tradedown-1',
    v_sale_a, v_shift, v_staff,
    jsonb_build_array(jsonb_build_object('sale_item_id', v_item_a, 'qty', 1)),
    jsonb_build_array(jsonb_build_object('variant_id', v_variant_cheaper, 'qty', 1)),
    'cash', null, null
  );
  perform pg_temp.assert_true(
    v_replay_sale = v_new_sale, 'replaying the same key must return the original sale, not a new one'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.credit_notes where sale_id = v_sale_a) = 1,
    'a replay must not write a second credit note'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.sales where exchange_note_id =
       (select id from public.credit_notes where sale_id = v_sale_a)) = 1,
    'a replay must not write a second replacement sale'
  );

  -- ── the line really is exhausted now, and says so in plain language ──────

  v_unexpectedly_allowed := false;
  begin
    perform public.create_exchange(
      v_sale_a, v_shift, v_staff,
      jsonb_build_array(jsonb_build_object('sale_item_id', v_item_a, 'qty', 1)),
      jsonb_build_array(jsonb_build_object('variant_id', v_variant_cheaper, 'qty', 1)),
      'cash', null, null
    );
    v_unexpectedly_allowed := true;
  exception
    when others then
      v_error := sqlerrm;
  end;
  perform pg_temp.assert_true(
    not v_unexpectedly_allowed, 'a fully exchanged line must still refuse a further exchange'
  );
  perform pg_temp.assert_true(
    v_error = 'Only 0 left of "Acceptance tee" to exchange (1 sold, 1 already returned)',
    format('unexpected refusal wording: %s', v_error)
  );

  -- ── trade-up: unchanged behaviour, still a live path ─────────────────────

  v_sale_b := public.complete_sale_with_discounts(
    v_shift, null, v_staff, 0,
    jsonb_build_array(jsonb_build_object('variant_id', v_variant_original, 'qty', 1, 'unit_price', 200, 'discount', 0)),
    '[{"method":"cash","amount":200,"tendered":200}]'::jsonb
  );
  select id into v_item_b from public.sale_items where sale_id = v_sale_b;

  v_new_sale := public.create_exchange_keyed(
    'exchange-acceptance-tradeup-1',
    v_sale_b, v_shift, v_staff,
    jsonb_build_array(jsonb_build_object('sale_item_id', v_item_b, 'qty', 1)),
    jsonb_build_array(jsonb_build_object('variant_id', v_variant_pricier, 'qty', 1)),
    'cash', 300, null
  );

  select * into v_payment from public.sale_payments where sale_id = v_new_sale;
  perform pg_temp.assert_true(
    v_payment.amount = 50,
    format('a 200 credit against a 250 replacement should take 50, not %s', v_payment.amount)
  );
  perform pg_temp.assert_true(
    v_payment.tendered = 300,
    'a paying customer''s tendered cash is still recorded, for change'
  );

  raise notice 'exchange refund + idempotency: all acceptance checks passed';
end $$;

rollback;
```

- [ ] **Step 3: Run the test BEFORE the migration, to see it fail against the old behaviour**

```bash
node scripts/run-sql-test.mjs supabase/tests/exchange_refund.sql
```

Expected: FAIL — either `create_exchange_keyed does not exist` (if migration 20260826140000 has not been applied yet) or, if it somehow has, the trade-down assertion failing under the *old* `create_exchange` with something like `The replacement items cost MUR 50 less...`. Either failure confirms the test is actually exercising the old, blocking behaviour.

- [ ] **Step 4: Apply the migration**

```bash
node scripts/migrate.mjs
```

Expected: `[migrate] applying 20260826140000_exchange_refund_and_idempotency.sql …` followed by `[migrate] Applied 1 migration(s).` (or more, if other pending migrations exist).

- [ ] **Step 5: Run the test again, expect it to pass**

```bash
node scripts/run-sql-test.mjs supabase/tests/exchange_refund.sql
```

Expected: `[sql-test] PASSED: supabase/tests/exchange_refund.sql`, with a `[notice] exchange refund + idempotency: all acceptance checks passed` line above it.

- [ ] **Step 6: Commit**

```bash
git add supabase/Migrations/20260826140000_exchange_refund_and_idempotency.sql supabase/tests/exchange_refund.sql
git commit -m "feat(db): exchanges settle either way and can't double-fire

create_exchange no longer refuses when the replacement costs less than
the credit - it refunds the difference through the same settle method,
same as a plain return would. create_exchange_keyed adds the same
retry-safe idempotency key complete_sale_keyed already has, closing the
gap that let a lost response turn into a confusing double-submit. Also
fixes the returnable-quantity refusal (shared with create_credit_note)
to name the product instead of an internal row id."
```

---

### Task 3: The route — keyed RPC, real gap in the response

**Files:**
- Modify: `app/api/till/exchange/route.ts`
- Create: `app/api/till/exchange/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/till/exchange/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The exchange route's settlement and idempotency plumbing.
 *
 * Worth a test because both are invisible from either side on their own: the
 * gap this route reports back is read from sale_payments after the RPC
 * commits, not computed here, and the idempotency key it forwards is what
 * makes a retried exchange safe rather than a second one.
 */

const session = {
  supabase: { rpc: vi.fn(), from: vi.fn() },
  user: { id: "cashier-1", name: "Marie", role: "cashier" },
}

let shiftGate: { ok: true } | { ok: false; error: string } = { ok: true }
let approvalResult: { managerId: string } | { error: string } = { managerId: "mgr-1" }
let paymentRows: { amount: number }[] = [{ amount: 60 }]

vi.mock("@/lib/api/till-session", () => ({
  requireTillSession: async () => session,
  apiError: (message: string, status: number) =>
    new Response(JSON.stringify({ ok: false, error: message }), { status }),
}))
vi.mock("@/lib/pos/shift-core", () => ({
  assertShiftOpenFor: async () => shiftGate,
}))
vi.mock("@/lib/pos/sale-core", () => ({
  verifyApproval: async () => approvalResult,
}))

const { POST } = await import("./route")

const body = (over: Record<string, unknown> = {}) => ({
  saleId: 7,
  shiftId: 15,
  paymentMethod: "cash",
  tendered: 60,
  idempotencyKey: "exchange-key-1",
  returnItems: [{ saleItemId: 162, qty: 1 }],
  newItems: [{ variantId: 34, qty: 1 }],
  ...over,
})

const post = async (payload: Record<string, unknown>) => {
  const response = await POST(
    new Request("http://t/api/till/exchange", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  )
  return response.json()
}

beforeEach(() => {
  shiftGate = { ok: true }
  approvalResult = { managerId: "mgr-1" }
  paymentRows = [{ amount: 60 }]
  session.supabase.rpc = vi.fn().mockResolvedValue({ data: 21, error: null })
  // Two tables get read: `sales`, for the 7-day-window age check (via
  // .maybeSingle()), and `sale_payments`, for the settled-gap readback (via a
  // bare, thenable .eq()). A recent sale_date here keeps every test below the
  // manager-approval branch unless it says otherwise.
  session.supabase.from = vi.fn().mockImplementation((table: string) => {
    if (table === "sales") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { sale_date: new Date().toISOString() } }),
          }),
        }),
      }
    }
    return {
      select: () => ({
        eq: async () => ({ data: paymentRows, error: null }),
      }),
    }
  })
})

describe("the idempotency key", () => {
  it("forwards it to create_exchange_keyed as p_key", async () => {
    await post(body())
    expect(session.supabase.rpc).toHaveBeenCalledWith(
      "create_exchange_keyed",
      expect.objectContaining({ p_key: "exchange-key-1" }),
    )
  })

  it("still works when an older client sends none at all", async () => {
    const json = await post(body({ idempotencyKey: undefined }))
    expect(json.ok).toBe(true)
    expect(session.supabase.rpc).toHaveBeenCalledWith(
      "create_exchange_keyed",
      expect.objectContaining({ p_key: null }),
    )
  })
})

describe("the settled gap", () => {
  it("reports a trade-up gap as a positive number", async () => {
    paymentRows = [{ amount: 60 }]
    const json = await post(body())
    expect(json).toEqual({ ok: true, saleId: 21, gap: 60 })
  })

  it("reports a trade-down refund as a negative number", async () => {
    paymentRows = [{ amount: -50 }]
    const json = await post(body({ paymentMethod: "cash", tendered: null }))
    expect(json).toEqual({ ok: true, saleId: 21, gap: -50 })
  })
})

describe("cash without a tendered figure", () => {
  it("is no longer rejected before reaching the database", async () => {
    // The route cannot know ahead of the RPC whether this settles as a
    // trade-up (needs tendered) or a refund (does not) without duplicating
    // create_exchange's own pricing - so it stops guessing and lets the RPC
    // default it.
    const json = await post(body({ paymentMethod: "cash", tendered: null }))
    expect(json.ok).toBe(true)
    expect(session.supabase.rpc).toHaveBeenCalled()
  })
})

describe("manager approval, unchanged", () => {
  it("never reaches the database when approval fails", async () => {
    approvalResult = { error: "Wrong PIN." }
    // ageDays > 7 is required to trigger the approval branch; simulate it by
    // having the sale-age lookup (session.supabase.from("sales")...) return an
    // old date instead of the payment-rows shape used elsewhere.
    session.supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === "sales") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { sale_date: "2020-01-01T00:00:00Z" } }),
            }),
          }),
        }
      }
      return { select: () => ({ eq: async () => ({ data: paymentRows, error: null }) }) }
    })

    const json = await post(body())
    expect(json).toEqual({
      ok: false,
      error: "Wrong PIN.",
      needsApproval: true,
    })
    expect(session.supabase.rpc).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run app/api/till/exchange/route.test.ts
```

Expected: FAIL — `create_exchange_keyed` is never called (the route still calls `create_exchange`), the response has no `gap`, and the "cash without tendered" test gets a 400 instead of `ok: true`.

- [ ] **Step 3: Update the route**

Modify `app/api/till/exchange/route.ts`:

Replace the body schema's `tendered` line and add `idempotencyKey` right after it:

```ts
  /** Cash handed over for the gap; change given from it. Cash only. */
  tendered: z.number().nonnegative().nullish().transform((v) => v ?? null),
  /** Names this attempt so a retry replays instead of settling twice. */
  idempotencyKey: z.string().trim().min(1).nullish().transform((v) => v ?? null),
```

Delete the early cash-tendered check — it can no longer tell a trade-up from a refund without re-running pricing that only `create_exchange` is allowed to own:

```ts
  if (paymentMethod === "cash" && (tendered === null || tendered === undefined)) {
    return apiError("Cash needs an amount tendered.", 400)
  }

```

Update the destructure to include the new field:

```ts
  const { saleId, shiftId, deviceId, paymentMethod, tendered, approval, returnItems, newItems, idempotencyKey } = parsed.data
```

Replace the RPC call and everything after it:

```ts
  // The migration ships in the same deploy that carries this route (the
  // pipeline applies migrations first), but the generated types only know
  // functions from their last regeneration — so the name is widened here.
  const { data, error } = await session.supabase.rpc("create_exchange_keyed" as Parameters<
    typeof session.supabase.rpc
  >[0], {
    p_key: idempotencyKey,
    p_sale_id: saleId,
    p_shift_id: shiftId,
    p_cashier_id: session.user.id,
    p_return_items: [...mergedReturns].map(([sale_item_id, qty]) => ({ sale_item_id, qty })),
    p_new_items: newItems.map(({ variantId, qty }) => ({ variant_id: variantId, qty })),
    p_payment_method: paymentMethod,
    p_tendered: paymentMethod === "cash" ? tendered : null,
    p_approved_by: approvedBy,
  } as never)

  if (error) {
    // The RPC's RAISE messages are written for a person at a till — pass them
    // through untouched, exactly as the refund route does.
    return NextResponse.json({ ok: false, error: error.message })
  }

  const newSaleId = typeof data === "number" ? data : null
  if (newSaleId === null) {
    return NextResponse.json({ ok: false, error: "The exchange did not complete." })
  }

  // The gap this exchange actually settled — signed, so the till can tell a
  // trade-up ("Rs X taken") from a trade-down ("Rs X given back") apart. One
  // settlement row is always written for it, whichever direction it ran.
  const { data: settlement } = await session.supabase
    .from("sale_payments")
    .select("amount")
    .eq("sale_id", newSaleId)

  const gap = (settlement ?? []).reduce((sum, row) => sum + Number(row.amount), 0)

  return NextResponse.json({ ok: true, saleId: newSaleId, gap })
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run app/api/till/exchange/route.test.ts
```

Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add app/api/till/exchange/route.ts app/api/till/exchange/route.test.ts
git commit -m "feat(api): exchange route carries an idempotency key and reports the real gap"
```

---

### Task 4: Android — carry the idempotency key on the wire

**Files:**
- Modify: `till-android/app/src/main/java/mu/kidscorner/till/data/SaleHistory.kt:210-221`

- [ ] **Step 1: Add the field**

In `SaleHistory.kt`, change:

```kotlin
@Serializable
data class ExchangeRequest(
    val saleId: Int,
    val shiftId: Int? = null,
    /** Cash handed over for the gap; the server computes change from it. */
    val tendered: Double? = null,
    val paymentMethod: String,
    val returnItems: List<RefundItem>,
    val newItems: List<ExchangeItem>,
    val deviceId: Int? = null,
    /** Sent only when a sale past the 7-day window needs a manager. */
    val approval: Approval? = null,
)
```

to:

```kotlin
@Serializable
data class ExchangeRequest(
    val saleId: Int,
    val shiftId: Int? = null,
    /** Cash handed over for the gap; the server computes change from it. */
    val tendered: Double? = null,
    val paymentMethod: String,
    val returnItems: List<RefundItem>,
    val newItems: List<ExchangeItem>,
    val deviceId: Int? = null,
    /** Sent only when a sale past the 7-day window needs a manager. */
    val approval: Approval? = null,
    /** Names this attempt so a retry after a lost response replays it. */
    val idempotencyKey: String,
)
```

Also update the doc comment on `ExchangeResponse.gap` two lines below (it currently says "Never negative: see create_exchange", which is no longer true):

```kotlin
    /** What the customer paid (positive) or was given back (negative). */
    val gap: Double? = null,
```

- [ ] **Step 2: Compile**

```bash
cd till-android && ./gradlew compileDebugKotlin
```

Expected: FAILS — `TillViewModel.kt` constructs `ExchangeRequest` without the new required `idempotencyKey` field. This confirms the field is wired into the type; Task 5 supplies the value.

- [ ] **Step 3: Commit is deferred to the end of Task 5**, since this change alone doesn't compile.

---

### Task 5: Android — the exchange attempt gets a stable key

**Files:**
- Modify: `till-android/app/src/main/java/mu/kidscorner/till/TillViewModel.kt`

- [ ] **Step 1: Add the key field**

Insert immediately before `fun openExchange` (around line 2100):

```kotlin
    /**
     * Names one exchange attempt so a lost response can be retried safely —
     * the same pattern as `saleKey`. Rotated only after a confirmed success;
     * a business-rule refusal never wrote a row under it (create_exchange
     * raises before writing anything), so retrying with the same key on
     * corrected input is exactly as safe as retrying with a new one.
     */
    private var exchangeKey: String = UUID.randomUUID().toString()

```

- [ ] **Step 2: Reset it when a fresh exchange screen opens**

In `openExchange`, change:

```kotlin
    fun openExchange(saleId: Int) = viewModelScope.launch {
        val cashier = cashierOf(_state.value.screen) ?: return@launch
        _state.update { it.copy(saleDetailLoading = true, historyError = null) }
```

to:

```kotlin
    fun openExchange(saleId: Int) = viewModelScope.launch {
        val cashier = cashierOf(_state.value.screen) ?: return@launch
        exchangeKey = UUID.randomUUID().toString()
        _state.update { it.copy(saleDetailLoading = true, historyError = null) }
```

- [ ] **Step 3: Send the key**

In `submitExchange`, change:

```kotlin
        postExchange(
            ExchangeRequest(
                saleId = sale.id,
                shiftId = _state.value.shop?.shift?.id,
                tendered = tendered,
                paymentMethod = method,
                returnItems = items,
                newItems = newItems.map { (variantId, qty) -> ExchangeItem(variantId, qty) },
                deviceId = _state.value.deviceId,
            ),
        )
```

to:

```kotlin
        postExchange(
            ExchangeRequest(
                saleId = sale.id,
                shiftId = _state.value.shop?.shift?.id,
                tendered = tendered,
                paymentMethod = method,
                returnItems = items,
                newItems = newItems.map { (variantId, qty) -> ExchangeItem(variantId, qty) },
                deviceId = _state.value.deviceId,
                idempotencyKey = exchangeKey,
            ),
        )
```

- [ ] **Step 4: Rotate the key on success, and word the toast for both directions**

In `postExchange`, change the success branch:

```kotlin
                    } else {
                        it.copy(
                            busy = false,
                            screen = TillScreen.Selling(cashier),
                            selectedSale = null,
                            pendingExchange = null,
                            needsApproval = false,
                            toast = "Exchanged — ${formatRs(response.gap ?: 0.0)} taken",
                        )
                    }
```

to:

```kotlin
                    } else {
                        exchangeKey = UUID.randomUUID().toString()
                        it.copy(
                            busy = false,
                            screen = TillScreen.Selling(cashier),
                            selectedSale = null,
                            pendingExchange = null,
                            needsApproval = false,
                            toast = exchangeToast(response.gap),
                        )
                    }
```

Add the helper directly below `postExchange`'s closing `}`:

```kotlin

    /** "Rs X taken" trading up, "Rs X given back" trading down, an even swap otherwise. */
    private fun exchangeToast(gap: Double?): String = when {
        gap == null || gap == 0.0 -> "Exchanged — even swap"
        gap > 0 -> "Exchanged — ${formatRs(gap)} taken"
        else -> "Exchanged — ${formatRs(-gap)} given back"
    }
```

- [ ] **Step 5: Compile**

```bash
cd till-android && ./gradlew compileDebugKotlin
```

Expected: PASS.

- [ ] **Step 6: Commit (covers Task 4 and Task 5 together, since Task 4 alone didn't compile)**

```bash
git add till-android/app/src/main/java/mu/kidscorner/till/data/SaleHistory.kt till-android/app/src/main/java/mu/kidscorner/till/TillViewModel.kt
git commit -m "feat(till): exchange attempts carry a retry-safe idempotency key"
```

---

### Task 6: Android — ExchangeScreen settles either direction

**Files:**
- Modify: `till-android/app/src/main/java/mu/kidscorner/till/ui/ExchangeScreen.kt`

- [ ] **Step 1: Update the file doc comment**

Change:

```kotlin
 * Nothing here decides money. `create_exchange` re-prices both sides: the
 * return at what the customer actually paid, the replacements at today's
 * list price read from `product_variants`. The figure on this screen is a
 * quote. It also never goes negative: when the credit beats the replacements,
 * the server refuses and the difference goes back through Returns instead.
 */
```

to:

```kotlin
 * Nothing here decides money. `create_exchange` re-prices both sides: the
 * return at what the customer actually paid, the replacements at today's
 * list price read from `product_variants`. The figure on this screen is a
 * quote — and it settles in either direction: the customer pays when the
 * replacements cost more, the shop pays back when they cost less, through
 * whichever method is picked below.
 */
```

- [ ] **Step 2: Drop the non-negative requirement from `ready`**

Change:

```kotlin
    val ready = creditTotal > 0 && newItems.value.isNotEmpty() && gap >= 0 && !busy
```

to:

```kotlin
    val ready = creditTotal > 0 && newItems.value.isNotEmpty() && !busy
```

- [ ] **Step 3: Dynamic label and an unsigned figure**

Change:

```kotlin
            Text(
                "CUSTOMER PAYS",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.1.sp,
                color = if (gap != 0.0 && count > 0) Handoff.ChangeLabel else Handoff.Muted3,
            )
            Text(
                formatRs(gap.coerceAtLeast(0.0)),
                fontFamily = PlexMono,
                fontSize = 44.sp,
                lineHeight = 48.4.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-1.76).sp,
                color = if (ready) Handoff.ChangeFigure else Handoff.Faint,
                modifier = Modifier.padding(top = 2.dp),
            )
```

to:

```kotlin
            Text(
                if (gap < 0) "REFUND TO CUSTOMER" else "CUSTOMER PAYS",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.1.sp,
                color = if (gap != 0.0 && count > 0) Handoff.ChangeLabel else Handoff.Muted3,
            )
            Text(
                formatRs(kotlin.math.abs(gap)),
                fontFamily = PlexMono,
                fontSize = 44.sp,
                lineHeight = 48.4.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-1.76).sp,
                color = if (ready) Handoff.ChangeFigure else Handoff.Faint,
                modifier = Modifier.padding(top = 2.dp),
            )
```

- [ ] **Step 4: Delete the now-obsolete warning block**

Delete this entire block (it directly follows the "N items back · M going out" `Text` and precedes the "SETTLE THE GAP BY" `Text`):

```kotlin
            if (gap < 0) {
                Text(
                    "The credit is bigger than the replacements. Give the change back through Return instead.",
                    fontSize = 12.sp,
                    lineHeight = 17.sp,
                    color = Handoff.Danger,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }

```

- [ ] **Step 5: "CASH GIVEN" only makes sense when the customer is paying**

Change:

```kotlin
            if (method == "cash") {
```

to:

```kotlin
            if (method == "cash" && gap > 0) {
```

(This is the block starting the "CASH GIVEN" row — leave its contents and closing brace untouched.)

Inside that same block, simplify the now-guaranteed-positive fallback text. Change:

```kotlin
                                if (tenderedText.isEmpty()) {
                                    Text(gap.coerceAtLeast(0.0).toString(), fontSize = 15.sp, color = Handoff.Fainter)
                                }
```

to:

```kotlin
                                if (tenderedText.isEmpty()) {
                                    Text(gap.toString(), fontSize = 15.sp, color = Handoff.Fainter)
                                }
```

- [ ] **Step 6: Only treat cash as "tendered" when the customer is actually paying**

Change:

```kotlin
                    onClick = {
                        val tendered = if (method == "cash") tenderedText.toDoubleOrNull() ?: gap else null
                        onExchange(
```

to:

```kotlin
                    onClick = {
                        val tendered = if (method == "cash" && gap > 0) tenderedText.toDoubleOrNull() ?: gap else null
                        onExchange(
```

- [ ] **Step 7: The button's figure is always unsigned**

Change:

```kotlin
                        Text(
                            formatRs(gap.coerceAtLeast(0.0)),
                            fontFamily = PlexMono,
                            fontSize = 21.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
```

to:

```kotlin
                        Text(
                            formatRs(kotlin.math.abs(gap)),
                            fontFamily = PlexMono,
                            fontSize = 21.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
```

- [ ] **Step 8: Drop the now-unreachable blocked-state message**

Change:

```kotlin
                        Text(
                            when {
                                creditTotal <= 0 -> "Pick what is coming back"
                                newItems.value.isEmpty() -> "Add what is going out"
                                else -> "Replacements cost less than the credit"
                            },
                            fontSize = 15.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Handoff.BlockedText,
                        )
```

to:

```kotlin
                        Text(
                            if (creditTotal <= 0) "Pick what is coming back" else "Add what is going out",
                            fontSize = 15.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Handoff.BlockedText,
                        )
```

(With `ready`'s new definition, this `when`'s third branch could only be reached while `busy` — which is already handled by the sibling `if (busy) { ... } else { ... }` one level up — so it was dead code once `ready` dropped the gap check.)

- [ ] **Step 9: Compile**

```bash
cd till-android && ./gradlew compileDebugKotlin
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add till-android/app/src/main/java/mu/kidscorner/till/ui/ExchangeScreen.kt
git commit -m "feat(till): exchange screen settles a refund, not just a top-up"
```

---

### Task 7: Receipt — a refund leg prints as a refund, not a negative figure

**Files:**
- Modify: `till-android/app/src/main/java/mu/kidscorner/till/print/ReceiptBuilder.kt:211-227`
- Modify: `till-android/app/src/test/java/mu/kidscorner/till/ReceiptTest.kt`

- [ ] **Step 1: Write the failing test**

In `ReceiptTest.kt`, add this test right after `` `a refunded sale says so on its own face` `` (after line 219's closing `}`):

```kotlin

    @Test
    fun `a cash refund on an exchange prints as REFUND, not a negative figure`() {
        val text = buildReceipt(
            sale(payments = listOf(SaleDetailPayment(id = 1, method = "cash", amount = -100.0, tendered = null))),
            shop,
            PaperWidth.Mm80,
        ).toPlainText(PaperWidth.Mm80)

        assertTrue("expected a REFUND line:\n$text", text.contains("CASH REFUND"))
        assertTrue("printed a bare negative figure:\n$text", !text.contains("-100.00"))
        assertTrue("the refunded amount should read positive:\n$text", text.contains("100.00"))
    }
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd till-android && ./gradlew testDebugUnitTest --tests "mu.kidscorner.till.ReceiptTest"
```

Expected: FAIL — the new test's `text.contains("CASH REFUND")` assertion fails (today it prints `1   CASH : Rs -100.00`).

- [ ] **Step 3: Fix the tender loop**

In `ReceiptBuilder.kt`, change:

```kotlin
    if (sale.status == "completed") {
        sale.payments
            .groupBy { methodLabel(it.method).uppercase() }
            .forEach { (label, group) ->
                add(
                    ReceiptLine.Text(
                        "${group.size}   $label : " +
                            suffixed(group.sumOf { it.amount }, currency),
                        bold = true,
                    ),
                )
            }
        val change = sale.payments.sumOf { (it.tendered ?: it.amount) - it.amount }
        if (change > 0) {
            add(ReceiptLine.Columns("    Change :", plainAmount(change)))
        }
        add(ReceiptLine.Rule)
    }
```

to:

```kotlin
    if (sale.status == "completed") {
        sale.payments
            .groupBy { methodLabel(it.method).uppercase() }
            .forEach { (label, group) ->
                val amount = group.sumOf { it.amount }
                // A negative settlement is money that LEFT the shop — the
                // exchange screen's refund leg — and reads as a mistake if
                // printed as a plain negative currency figure.
                val text = if (amount < 0) {
                    "${group.size}   $label REFUND : " + suffixed(-amount, currency)
                } else {
                    "${group.size}   $label : " + suffixed(amount, currency)
                }
                add(ReceiptLine.Text(text, bold = true))
            }
        val change = sale.payments.sumOf { (it.tendered ?: it.amount) - it.amount }
        if (change > 0) {
            add(ReceiptLine.Columns("    Change :", plainAmount(change)))
        }
        add(ReceiptLine.Rule)
    }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd till-android && ./gradlew testDebugUnitTest --tests "mu.kidscorner.till.ReceiptTest"
```

Expected: PASS, all `ReceiptTest` cases green (confirms the change didn't break the existing positive-amount formatting either).

- [ ] **Step 5: Commit**

```bash
git add till-android/app/src/main/java/mu/kidscorner/till/print/ReceiptBuilder.kt till-android/app/src/test/java/mu/kidscorner/till/ReceiptTest.kt
git commit -m "fix(till): a refunded settlement prints as REFUND, not a negative figure"
```

---

### Task 8: Manual verification (hand this to the user)

Not automatable — needs the emulator and a live backend. After Tasks 1–7 are committed:

1. Run the full Android unit test suite once, to catch any cross-file break: `cd till-android && ./gradlew testDebugUnitTest`. Expected: all green.
2. Run the full Vitest suite: `npx vitest run`. Expected: all green.
3. In the emulator: ring up a sale, then exchange one line for a *cheaper* variant. Confirm: the panel reads "REFUND TO CUSTOMER", the figure is positive, "CASH GIVEN" is not shown for cash, and the exchange completes with a toast reading "… given back". Reprint the receipt and confirm the tender line reads "CASH REFUND", not a negative number.
4. Do the same for a *pricier* replacement — confirm "CUSTOMER PAYS" still shows, "CASH GIVEN" still appears for cash, and the toast reads "… taken" (regression check).
5. Simulate the original bug: start an exchange, and before confirming, turn on the emulator's airplane mode, tap Exchange (it will fail/spin), turn airplane mode back off, and tap Exchange again with the same selection. Confirm it either completes cleanly or — if the first attempt actually got through — replays to the same result instead of raising the old "Only 0 left…" error.
