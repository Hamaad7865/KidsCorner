# Kids Corner

POS and back office for a kids' clothing and shoe shop in Mauritius. One
Next.js app, two faces: a tablet till and a web back office, over Supabase.

Currency MUR (Rs), VAT 15%, prices VAT-inclusive.

See [PROJECT_SPEC.md](project_spec.md) for the full brief — it is the source of
truth. The database schema in
[supabase/migrations/001_initial_schema.sql](supabase/migrations/001_initial_schema.sql)
is fixed; build against it, never edit it.

## Status: all nine phases built

The spec's build order is complete, and several things beyond it are too.

Foundation:

- Next.js 16 (App Router, Turbopack), TypeScript strict, Tailwind v4, shadcn/ui
- Supabase browser / server / proxy clients via `@supabase/ssr`
- Typed schema covering every table and RPC across migrations 001–007
- Login with a zod-validated server action; role-based routing in `middleware.ts`

Back office:

- Master data CRUD — categories, brands, colours, sizes
- Products list, detail, variant matrix, generate-variants
- Excel import wizard — upload, map/validate, commit, error report
- Stock — movements, adjustments, low stock, transfers between locations
- Purchases and suppliers, including `receive_purchase`
- Customers with purchase history
- Sales history, returns and credit notes
- Reports, with CSV export per report
- Settings — shop, master data, discounts, staff PINs, locations, module access,
  barcodes

Till:

- Shift open/close with float, counted cash and variance
- Sell screen — barcode scan, search, variant picker, quick keys, held sales
- Line and cart discounts, including rule-driven offers
- Payment with split tenders, change due, and `complete_sale`
- 80mm receipt, cashier PIN switching, till movements (paid in / paid out)

Beyond the spec: credit notes, discount rules, stock locations and transfers,
per-role module access, till movements, and X/Z reporting.

## Setup

### 1. Run the migration

In the Supabase dashboard, SQL Editor, run
[`supabase/catch-up.sql`](supabase/catch-up.sql). It creates the tables,
constraints, indexes, functions, views, triggers, RLS policies, grants and seed
data (sizes, colours, categories, settings) in one pass, and it is safe to
re-run.

It is a **snapshot of the live schema**, generated from the database's own
catalog rather than assembled by replaying the migration history. That
distinction is the whole point: the previous version was a replay, and it
drifted — it stopped at migration 025, so a fresh project was missing the two
migrations that keep the shop's takings private (**028** pins `search_path` on
every `SECURITY DEFINER` function; **035** takes `EXECUTE` away from `anon`, the
role the *publishable key* maps to). A snapshot cannot drift.

The numbered files in `supabase/Migrations/` remain the historical record of
what was applied and why. This file is what you run.

**After applying any new migration, regenerate it and commit the result:**

```bash
node scripts/generate-catchup.mjs
```

It ends with a SELECT that reports what was built. Expect **30 tables, 4 views,
42 functions, 46 policies** — and, more importantly, `anon_can_execute` **0**,
`definers_unpinned` **0**, `views_with_invoker` **4**. Any other answer on those
three means the publishable key reaches further into the database than it
should.

### 2. Fill in `.env.local`

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key>
```

Both are in Project Settings → API. Newer projects issue a *publishable* key
(`sb_publishable_...`) instead of an anon JWT — either works.

Never put the `service_role` key in a `NEXT_PUBLIC_` variable; anything with
that prefix is inlined into the browser bundle. Nothing here needs it: every
write goes through RLS or a `SECURITY DEFINER` RPC.

Next reads env files at startup only, so restart the dev server after editing.

### 3. Create the first owner

Signing in needs two things: a Supabase Auth user, and a matching row in
`profiles`. There is a chicken-and-egg on the very first one — RLS only lets an
*owner* write `profiles`, and there is no owner yet — so seed it from the SQL
editor, which runs as `postgres` and bypasses RLS.

1. Authentication → Users → Add user. Set an email and password, and tick
   auto-confirm.
2. Copy the new user's UUID, then in the SQL Editor:

```sql
insert into profiles (id, full_name, role)
values ('00000000-0000-0000-0000-000000000000', 'Your Name', 'owner');
```

Later staff get created from Settings → Users once phase 2 lands.

### 4. Run it

```bash
npm run dev
```

Sign in at <http://localhost:3000/login>. An owner or manager lands on
`/dashboard`; a cashier lands on `/pos`.

The dashboard reads `settings.shop_name` and counts the seeded master data, so
it doubles as a connection check — if those numbers appear, session, RLS and
queries all work.

## How auth and routing fit together

Two tiers, per the spec:

1. **Supabase Auth session** — the device or person signed into this browser:
   owner, manager, or a shared till account.
2. **Cashier PIN** (phase 8) — app-level state on top of that session, so
   cashiers can swap mid-shift. Every sale records `cashier_id`.

Routing rules live in [`proxy.ts`](proxy.ts):

| Path | Rule |
| --- | --- |
| `/login` | Public. Redirects to the role's landing page if already signed in. |
| `/pos`, `/pos/*` | Any authenticated role, cashiers included. |
| `/dashboard`, `/products`, `/import`, `/stock`, `/purchases`, `/customers`, `/sales`, `/suppliers`, `/settings` | Owner and manager only. |
| `/` | Redirects to `/dashboard` or `/pos` by role. |

The proxy is a routing convenience, not the security boundary — **RLS is**. Each
layout independently calls `requireProfile()` / `requireAdminProfile()`, so a
page never renders for the wrong role even if a request bypasses the matcher.

### Why `proxy.ts` and not `middleware.ts`

Next 16 renamed the file convention: `middleware.ts` still works but logs a
deprecation warning on every build, and the two cannot coexist. The exported
function must be named `proxy`, and it always runs on the Node.js runtime —
route segment config such as `export const runtime` is rejected in this file.

### Cost of the role lookup

The proxy reads `profiles.role` on every matched request. That is one extra
query per page load — fine at shop scale. If it ever matters, move `role` into a
custom JWT claim with a Supabase auth hook and read it off `getClaims()` instead.

## Barcodes

Supplier goods arrive with a barcode printed on; anything else has none. The
shop issues its own for the blanks, as EAN-13 built from a prefix, a serial and
a computed check digit (`lib/barcodes/ean13.ts`).

Two things worth knowing:

- **The default prefix `6291041` is not a registered GS1 company prefix.** The
  codes are valid EAN-13 and scan correctly on any till, but they are for
  in-store use only and must not go on goods sold on to another retailer.
  Supplier barcodes are never overwritten — this only fills the blanks.
- **Serials are allocated by `allocate_barcode_serials`, not in the app.** It is
  one atomic UPDATE, so two people adding variants at the same moment get
  disjoint blocks. `product_variants.barcode` is UNIQUE, so a collision would be
  a failed insert rather than a cosmetic problem. Winding the counter backwards
  in Settings is refused for the same reason.

Blanks are filled automatically when variants are generated on a product and on
Excel import when the Barcode column is empty. Existing blanks are filled from
the product page, which also prints a sheet of shelf labels — 24 to an A4 page,
one per unit on hand.

## Database types

`lib/supabase/database.types.ts` mirrors migration 001 and is written in exactly
the shape the Supabase generator emits, so regenerating is a drop-in replacement:

```bash
npx supabase login
npx supabase gen types typescript --project-id <your-ref> --schema public > lib/supabase/database.types.ts
```

The schema uses `TEXT ... CHECK (col IN (...))` rather than Postgres enums, so
the generator widens those columns to `string`. The unions (`Role`, `Gender`,
`MovementType`, `PaymentMethod`, …) therefore live in `lib/db-enums.ts`, where a
regen cannot wipe them. Keep that file in step with 001.

## Conventions

- TypeScript strict; zod-validate every server action input
- Server components for reads, server actions for mutations; the POS sell screen
  is a client island
- Money as plain numbers, rounded to 2dp at every boundary, formatted through
  `formatRs()` in `lib/format.ts`
- Multi-step writes go through the existing RPCs (`record_stock_movement`,
  `complete_sale`, `receive_purchase`). New RPCs go in a *new* migration file —
  never edit 001
- Feature components under `components/{feature}/`

## Design system

One token set, two densities. Light theme, white surfaces, soft coral accent
(`--brand-500`, the spec's `#F0645C`).

Solid buttons use `--brand-600` rather than `--brand-500`: the brand coral only
reaches 3.1:1 against white, which fails AA for body-sized text, while
`--brand-600` clears 4.6:1. `--destructive` is pushed to hue 14 so "danger"
never reads as "brand" — coral and red are close neighbours.

The POS sets `data-density="pos"`, which retargets the shared `--density-*`
tokens to touch scale (≥48px controls, larger type) without a second system.

## Scripts

```bash
npm run dev        # dev server on :3000
npm run build      # production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```
