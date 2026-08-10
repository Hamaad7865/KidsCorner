# KidsCorner Storefront Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Use `superpowers:test-driven-development` for each feature task and `superpowers:verification-before-completion` before claiming any release slice complete.

**Goal:** Add a modern, mobile-first KidsCorner storefront to the existing Next.js/Supabase system, with safe public catalogue reads, guest-first doorstep checkout, optional customer accounts, online-payment readiness, immutable payment history, and back-office fulfilment without breaking POS, stock, or till reporting.

**Architecture:** Keep one Next.js application and one Supabase catalogue/stock truth. Public pages use a stateless anon client and narrowly granted storefront RPCs; they never reuse back-office catalogue DTOs. Multi-row commerce work stays in additive, pinned `SECURITY DEFINER` RPCs. Physical stock remains `stock_movements`; reservations are a separate claim on location stock. The storefront payment journal and order event stream are append-only. Staff, customer, and anonymous authorization paths are explicitly separated.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS 4, Base UI/shadcn components, Supabase Postgres/Auth/Storage, Zod, Zustand, Vitest, Playwright, axe-core, OpenNext for Cloudflare Workers.

---

## Implementation decisions fixed by this plan

1. Public search keeps the approved `/search` URL. The existing staff search moves from `/search` to `/dashboard/search`; all back-office search links and tests move with it.
2. `/login` is the staff auth entry and redirects an already signed-in staff member home. Storefront routes remain browsable by anonymous visitors, customer accounts, and signed-in staff.
3. Customer Auth users never receive a `profiles` row. A new `customer_accounts` table links `auth.users` to `customers` only after verification.
4. Guest checkout does not deduplicate or auto-link by an unverified email/phone. The immutable order snapshot is enough for a guest order. A verified claim creates or reuses only the customer record already linked to that authenticated account.
5. Payment event semantics are exact:
   - `initiated`, `authorised`, and `failed` have signed amount `0`;
   - `captured` and `collected` have positive amounts;
   - `refunded`, `reversed`, and `chargeback` have negative amounts and reference a prior positive entry;
   - `correction` may be positive or negative, must reference an earlier entry, and requires a reason;
   - paid/due/refunded figures are derived, never stored as authoritative mutable state.
6. A capture received after reservation expiry is still journalled. The callback atomically tries to reacquire stock. If it cannot, the order enters `payment_resolution_required`; dispatch is blocked until staff either refunds it or resolves stock. Payment truth is never hidden to make the order look tidy.
7. Doorstep dispatch consumes the source reservation and transfers physical units to a configured in-transit location. Successful delivery appends `collected`, creates the fiscal sale/payment exactly once, and stocks out from in-transit. Failed delivery transfers the units back and either recreates a hold for reattempt or cancels.
8. Online-paid dispatch creates the fiscal sale and stocks out at the fulfilment location. A failed delivery returning to the shop records stock back in; cancellation requires a compensating provider refund entry.
9. The storefront has server-controlled release modes: `off`, `browse`, `doorstep`, and `live`. Online payment remains hidden unless a real provider adapter, secrets, callback verification, sandbox smoke, and reconciliation smoke all pass.
10. Existing Android till changes are outside scope. Stage and commit only the exact web/database files named by each task.

## Current verified baseline

- Branch: `main` at `fa64122` when this plan was written.
- Unrelated Android till files are dirty and must be preserved.
- `npm test`: 26 files, 278 tests passing (required a non-sandboxed retry because Windows blocked Vite child-process spawn with `EPERM`).
- `npm run typecheck`: passing.
- `npm run lint`: passing.
- `npm run build`: passing after allowing Next to fetch its existing Google fonts.
- Latest numbered migration is `040_bank_transfer.sql`; there is no `039`.
- `supabase/catch-up.sql` is stale relative to migrations 038 and 040. Do not use it as a fresh-install proof until it has been regenerated from a disposable/test database containing the complete migration chain.

## Release slices and gates

| Slice | Deliverable | Gate before enabling |
| --- | --- | --- |
| A | Security boundary, schema harness, public catalogue RPCs | customer-token isolation, anon projection tests, POS regression suite |
| B | Browse-only home, collections, search, PDP, gallery, SEO | responsive/keyboard/axe tests, no forbidden catalogue fields |
| C | Doorstep pilot, reservations, tracking, email, online-order operations | final-unit race tests, retry/idempotency tests, real staff fulfilment rehearsal |
| D | Customer accounts | active-staff RLS/RPC hardening tests and verified-link tests |
| E | Online payment and public launch | chosen provider, secrets, signed webhook, capture/refund/replay/reconciliation smoke |

Do not combine gates. A polished browse experience is allowed to launch in `browse` mode while checkout or online payment remains disabled.

---

### Task 1: Add storefront verification infrastructure without changing behaviour

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.ts`
- Create: `tests/e2e/storefront-baseline.spec.ts`
- Create: `scripts/test-storefront-db.mjs`
- Create: `supabase/tests/storefront/_assertions.sql`
- Create: `.env.test.example`
- Modify: `.gitignore`
- Create: `docs/storefront/verification.md`

**Step 1: Add the failing browser smoke first**

Create a Playwright test which records the current contract before the root route changes:

```ts
import { expect, test } from "@playwright/test"

test("staff login remains available", async ({ page }) => {
  await page.goto("/login")
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible()
})
```

Run `npx playwright test tests/e2e/storefront-baseline.spec.ts`. Expected: fail because Playwright is not installed/configured.

**Step 2: Install and configure the test tools**

Run:

```bash
npm install --save-dev @playwright/test @axe-core/playwright
npx playwright install chromium
```

Add scripts:

```json
"test:e2e": "playwright test",
"test:db": "node scripts/test-storefront-db.mjs",
"verify:storefront": "npm test && npm run typecheck && npm run lint && npm run test:e2e"
```

Configure `webServer.command = "npm run dev"`, `baseURL = "http://127.0.0.1:3000"`, Chromium desktop plus a 375x812 mobile project, traces on first retry, and no automatic browser install in CI.

**Step 3: Add a guarded database test runner**

`scripts/test-storefront-db.mjs` must:

- require `SUPABASE_TEST_DB_URL`;
- refuse to run if it equals `SUPABASE_DB_URL` or contains the production project ref;
- refuse a hostname not explicitly allowed by `STOREFRONT_TEST_DB_HOST_ALLOWLIST`;
- execute selected files under `supabase/tests/storefront/` through the existing `pg` dependency;
- wrap fixture writes in `BEGIN`/`ROLLBACK`;
- print each assertion name and exit non-zero on failure;
- never reset, drop, truncate, or migrate a database on its own.

The first assertion file should provide SQL helpers that raise on false conditions. Put only disposable Supabase branch/project values in `.env.test.local`, which is ignored.

**Step 4: Document the migration rehearsal**

In `docs/storefront/verification.md`, document two human-approved database targets:

1. an upgrade clone at migration 040 for applying 041+; and
2. an empty disposable Supabase project for applying the regenerated `catch-up.sql`.

Explicitly state: never apply, reset, or regenerate from production as part of an automated test.

**Step 5: Run the baseline**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e -- tests/e2e/storefront-baseline.spec.ts
```

Expected: all pass. If Vitest reports `spawn EPERM`, retry in the permitted Windows environment before treating it as an application defect.

**Step 6: Commit only these files**

```bash
git add package.json package-lock.json playwright.config.ts tests/e2e/storefront-baseline.spec.ts scripts/test-storefront-db.mjs supabase/tests/storefront/_assertions.sql .env.test.example .gitignore docs/storefront/verification.md
git commit -m "test(storefront): add browser and database verification harness"
```

---

### Task 2: Separate storefront, staff-login, and back-office route contracts

**Files:**

- Modify: `lib/routes.ts`
- Create: `lib/routes.test.ts`
- Modify: `middleware.ts`
- Move: `app/(admin)/search/page.tsx` -> `app/(admin)/dashboard/search/page.tsx`
- Modify: `components/admin/global-search.tsx`
- Modify: `lib/access/modules.ts`
- Modify: `tests/e2e/storefront-baseline.spec.ts`

**Step 1: Write failing route-classification tests**

Test these exact cases:

```ts
expect(isStorefrontPath("/")).toBe(true)
expect(isStorefrontPath("/product/linen-set-42")).toBe(true)
expect(isStorefrontPath("/api/storefront/orders")).toBe(true)
expect(isStaffAuthPath("/login")).toBe(true)
expect(isAdminPath("/dashboard/search")).toBe(true)
expect(isAdminPath("/search")).toBe(false)
expect(isStorefrontPath("/dashboard")).toBe(false)
```

Run `npm test -- lib/routes.test.ts`. Expected: fail because the new predicates do not exist.

**Step 2: Implement distinct route lists**

Use prefix-aware constants with these meanings:

```ts
export const STAFF_AUTH_PATHS = ["/login"] as const
export const STOREFRONT_PATHS = [
  "/", "/shop", "/search", "/product", "/cart", "/checkout",
  "/order", "/account", "/delivery", "/returns", "/privacy", "/terms",
  "/api/storefront",
] as const
```

Do not put `/login` into `STOREFRONT_PATHS`. Do not make `/api/till` public; its bearer-token bypass remains separate.

**Step 3: Update middleware behaviour**

Order the middleware checks as follows:

1. `/api/till/*` passes to its bearer-token handler.
2. storefront routes and `/api/storefront/*` always proceed through session-cookie refresh but never require a staff `profiles` row and never redirect signed-in staff away.
3. `/login` proceeds for anonymous visitors but redirects an active staff session to its role landing page.
4. every other path keeps the current staff profile/module rules.

Do not classify payment webhooks by a broad `/api` exemption; only the exact storefront API prefix is public, and every handler still validates its own contract.

**Step 4: Move staff search**

Move the page to `/dashboard/search`. Change both the HTML form action and `router.push` in `GlobalSearch`. Keep `lib/search/queries.ts` private/back-office only. `/search` must no longer call it.

**Step 5: Verify**

Run:

```bash
npm test -- lib/routes.test.ts
npm run typecheck
npm run lint
npm run build
```

Add Playwright assertions that anonymous `/dashboard/search` redirects to `/login`, while a signed-in staff fixture can visit both `/dashboard/search` and `/` without being bounced between them.

**Step 6: Commit**

```bash
git add lib/routes.ts lib/routes.test.ts middleware.ts "app/(admin)/search/page.tsx" "app/(admin)/dashboard/search/page.tsx" components/admin/global-search.tsx lib/access/modules.ts tests/e2e/storefront-baseline.spec.ts
git commit -m "refactor(routes): reserve public search for storefront"
```

---

### Task 3: Harden the authenticated database role before customer Auth exists

**Files:**

- Create: `supabase/Migrations/041_storefront_auth_boundary.sql`
- Create: `supabase/tests/storefront/041_auth_boundary.sql`
- Modify: `lib/supabase/database.types.ts`
- Modify: `README.md`
- Modify: `docs/storefront/verification.md`

**Step 1: Write failing database assertions**

Using a Supabase test user with no `profiles` row, assert that the token cannot:

- select raw `product_variants.cost_price`, `barcode`, or `qty_on_hand`;
- select `customers`, `profiles`, `sales`, `sale_payments`, `settings`, stock, audit, report, discount, shift, purchase, device, or receipt tables/views;
- call `complete_sale_keyed`, stock-movement/transfer functions, purchase receipt, credit-note, report/Z, PIN, barcode, audit, receipt-print, or device-registration entry points.

Using owner/manager/cashier fixtures, assert their existing allowed reads and RPC calls still have the same result.

Run `npm run test:db -- 041_auth_boundary`. Expected: customer-token assertions fail on the migration-040 database.

**Step 2: Add an active-staff predicate**

Create a pinned function in a non-exposed `private` schema:

```sql
create function private.is_active_staff(p_user uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = p_user and is_active = true
      and role in ('owner','manager','cashier')
  )
$$;
```

Recreate every existing staff-facing RLS policy so `authenticated` reads and writes require an active staff profile. This includes the currently broad customer insert and shift policies, not only policies named `read_all`. Preserve the stricter owner/manager checks already present, and update `current_role_of_user()` so an inactive profile returns no role. Customer-owned storefront policies are not added in this migration.

**Step 3: Remove generic authenticated access to privileged definers**

Revoke `EXECUTE` on all public functions from `anon`, `authenticated`, and `PUBLIC`. Keep trigger/internal helpers ungranted. For each RPC called directly by current TypeScript, expose a same-signature public wrapper that:

1. calls a pinned `private.require_active_staff()` guard;
2. calls the preserved internal implementation; and
3. is explicitly granted only to `authenticated`.

Cover the call sites found in the repository: stock movement/transfer, barcode allocation/scheme, audit log, discount report, purchase receipt, credit note, receipt print, till movement, shift totals/close, daily summary, PIN lock/attempt/clear, `complete_sale_keyed`, and POS-device registration. Pure trigger helpers and document-number helpers remain ungranted.

Do not rely on middleware as a database boundary. Do not grant raw tables to `anon`.

**Step 4: Prove upgrade compatibility**

Apply 041 to the disposable migration-040 clone. Run the full existing web/POS unit suite and a till API smoke against owner/manager/cashier fixtures. Confirm function signatures consumed by `lib/supabase/database.types.ts` are unchanged.

**Step 5: Regenerate types from the test project**

Regenerate `lib/supabase/database.types.ts` for schema `public`, review that no private implementation appears, and run `npm run typecheck`.

Do not regenerate `catch-up.sql` yet; it is regenerated after all storefront migrations are applied to the disposable project.

**Step 6: Commit**

```bash
git add supabase/Migrations/041_storefront_auth_boundary.sql supabase/tests/storefront/041_auth_boundary.sql lib/supabase/database.types.ts README.md docs/storefront/verification.md
git commit -m "security(db): isolate customer auth from staff data"
```

---

### Task 4: Add storefront catalogue, slugs, galleries, campaigns, and safe public RPCs

**Files:**

- Create: `supabase/Migrations/042_storefront_catalog.sql`
- Create: `supabase/tests/storefront/042_catalog.sql`
- Modify: `lib/supabase/database.types.ts`
- Modify: `lib/db-enums.ts`

**Step 1: Write the failing schema/contract tests**

Assert:

- every product/category gets a unique, non-empty stable slug after upgrade;
- a changed slug records a redirect to the same object;
- one product can have ordered images, at most one primary image, and non-empty alt text;
- a legacy `products.image_url` is represented as primary gallery fallback without losing compatibility;
- campaign start/end/active rules select at most one highest-priority active hero;
- anon can execute only the named storefront catalogue RPCs;
- forbidden keys never appear anywhere in returned JSON: `cost_price`, `barcode`, `sku`, `qty_on_hand`, `reorder_level`, `supplier`, `stock_movements`;
- result limits are capped at 48 and invalid sort/filter inputs are rejected.

**Step 2: Add content schema**

Migration 042 adds:

- `products.storefront_slug`, `products.storefront_published_at`;
- `categories.storefront_slug`, `categories.storefront_visible`, `categories.storefront_sort`;
- `storefront_slug_redirects(kind, old_slug, target_id, created_at)` with unique `(kind, old_slug)`;
- `product_images(id, product_id, image_url, alt_text, position, is_primary, created_at)` with unique `(product_id, position)` and a partial unique primary index;
- `storefront_campaigns(id, placement, headline, body, target_url, desktop_image_url, mobile_image_url, starts_at, ends_at, priority, is_active)`;
- `storefront_settings` as a single typed row containing `release_mode`, fulfilment and in-transit location IDs, reservation durations, collection flags/copy, WhatsApp URL, and default SEO copy.

Backfill slugs deterministically as normalized name plus `-<id>` so duplicates cannot collide and ordinary name edits do not silently change URLs.

**Step 3: Add public catalogue RPCs**

Create pinned, bounded functions:

- `storefront_home()`;
- `storefront_catalog(p_query, p_category_slug, p_size_ids, p_colour_ids, p_min_price, p_max_price, p_available_only, p_sort, p_cursor, p_limit)`;
- `storefront_product(p_slug)`;
- `storefront_categories()`;
- `storefront_resolve_slug(p_kind, p_slug)`.

Return public JSON DTOs only. Availability is `in_stock`, `low_stock`, or `out_of_stock`; never return the internal quantity. Grant execute explicitly to `anon` and `authenticated`, because staff browsing the public shop must receive the same curated result. Keep raw table grants revoked.

**Step 4: Add staff-only gallery/content policies**

Owner/manager may write gallery and campaigns. Cashier, customer, and anon cannot. Public image bytes remain readable through the existing `product-images` storage policy.

**Step 5: Run tests and regenerate types**

Run:

```bash
npm run test:db -- 042_catalog
npm test
npm run typecheck
```

Review generated types and extend `lib/db-enums.ts` with `StorefrontReleaseMode` and `StorefrontAvailability`; do not edit historical enums in migration 001.

**Step 6: Commit**

```bash
git add supabase/Migrations/042_storefront_catalog.sql supabase/tests/storefront/042_catalog.sql lib/supabase/database.types.ts lib/db-enums.ts
git commit -m "feat(storefront): add safe public catalog schema"
```

---

### Task 5: Build the public catalogue TypeScript boundary

**Files:**

- Create: `lib/supabase/public.ts`
- Create: `lib/storefront/catalog/types.ts`
- Create: `lib/storefront/catalog/params.ts`
- Create: `lib/storefront/catalog/params.test.ts`
- Create: `lib/storefront/catalog/queries.ts`
- Create: `lib/storefront/catalog/queries.test.ts`
- Create: `lib/storefront/catalog/forbidden-fields.ts`

**Step 1: Write failing parser and projection tests**

Test URL parsing for repeated size/colour IDs, bad prices, invalid sorts, category slugs, availability, and cursor/limit bounds. Test a recursive forbidden-key guard against representative RPC fixtures.

```ts
expect(() => assertPublicCatalogShape({ selling_price: 450, cost_price: 200 }))
  .toThrow(/cost_price/)
```

**Step 2: Create a stateless public client**

`lib/supabase/public.ts` uses the public Supabase URL/key without request cookies and disables session persistence/refresh. It must never accept or import the service-role key. Public pages therefore run as anon even when a staff cookie exists.

**Step 3: Define public DTOs**

Use camel-case types for:

- `StorefrontProductCard`;
- `StorefrontProductDetail`;
- `StorefrontVariantOption`;
- `StorefrontImage`;
- `StorefrontCollectionPage`;
- `StorefrontHomeContent`.

There is deliberately no cost, barcode, internal SKU, reorder level, supplier, or exact-stock member.

**Step 4: Map and validate RPC results**

Use Zod to validate unknown RPC JSON before mapping. Call `assertPublicCatalogShape` in tests and development. Convert numeric strings at the boundary and preserve MUR two-decimal values.

**Step 5: Verify**

Run `npm test -- lib/storefront/catalog`, `npm run typecheck`, and `npm run lint`.

**Step 6: Commit**

```bash
git add lib/supabase/public.ts lib/storefront/catalog/types.ts lib/storefront/catalog/params.ts lib/storefront/catalog/params.test.ts lib/storefront/catalog/queries.ts lib/storefront/catalog/queries.test.ts lib/storefront/catalog/forbidden-fields.ts
git commit -m "feat(storefront): add public catalog data boundary"
```

---

### Task 6: Create the scoped Playful Edit storefront shell

**Files:**

- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Move/Replace: `app/page.tsx` -> `app/(storefront)/page.tsx`
- Create: `app/(storefront)/layout.tsx`
- Create: `app/(storefront)/loading.tsx`
- Create: `app/(storefront)/error.tsx`
- Create: `app/(storefront)/not-found.tsx`
- Create: `components/storefront/storefront-header.tsx`
- Create: `components/storefront/storefront-footer.tsx`
- Create: `components/storefront/announcement-bar.tsx`
- Create: `components/storefront/turned-corner-frame.tsx`
- Create: `components/ui/sheet.tsx`
- Create: `components/ui/textarea.tsx`
- Create: `components/ui/checkbox.tsx`
- Modify: `components/ui/button.tsx`
- Modify: `next.config.ts`
- Modify: `scripts/check-contrast.mjs`
- Create: `tests/e2e/storefront-shell.spec.ts`

**Step 1: Write the failing shell tests**

At 375x812 and desktop widths, assert:

- header, search, bag, announcement, main landmark, and footer exist;
- every visible header control is at least 44x44;
- keyboard focus is visible and returns from the menu sheet;
- no horizontal overflow occurs;
- staff `/login`, `/dashboard`, and `/pos` retain their current scoped shells.

**Step 2: Scope fonts and tokens**

Load Bricolage Grotesque and Instrument Sans through `next/font` in the storefront segment. Keep the existing Geist variables for admin/POS. Add storefront-scoped variables for cherry, plum, pool, mango, petal, sky, leaf, and paper, plus the turned-corner radius. Do not reuse destructive red as decoration.

Add `touch` and `icon-touch` button sizes rather than globally enlarging 32px back-office controls.

**Step 3: Replace the root staff router with storefront home**

The public `/` now renders the storefront. Staff entry remains explicit at `/login`; login still lands staff on `/dashboard` or `/pos`. Respect release mode: `off` renders a branded, index-safe holding page; all later commerce calls also check mode server-side.

**Step 4: Configure images**

Allow the configured Supabase public storage hostname in `next.config.ts`. Storefront gallery images use responsive `sizes` and reserved aspect ratios. A legacy external `image_url` may render unoptimized as fallback, but managed gallery images must use Next image optimization.

**Step 5: Extend contrast checks**

Add measured pairs for plum/paper, white/cherry, white/pool, focus ring/paper, subdued text/paper, and destructive text/surface.

**Step 6: Verify and commit**

Run `npm test`, `npm run check:contrast`, `npm run test:e2e -- storefront-shell`, `npm run typecheck`, `npm run lint`, and `npm run build`.

```bash
git add app/page.tsx app/layout.tsx app/globals.css "app/(storefront)/page.tsx" "app/(storefront)/layout.tsx" "app/(storefront)/loading.tsx" "app/(storefront)/error.tsx" "app/(storefront)/not-found.tsx" components/storefront/storefront-header.tsx components/storefront/storefront-footer.tsx components/storefront/announcement-bar.tsx components/storefront/turned-corner-frame.tsx components/ui/button.tsx components/ui/sheet.tsx components/ui/textarea.tsx components/ui/checkbox.tsx next.config.ts scripts/check-contrast.mjs tests/e2e/storefront-shell.spec.ts
git commit -m "feat(storefront): add Playful Edit public shell"
```

---

### Task 7: Build the home page from live catalogue content

**Files:**

- Modify: `app/(storefront)/page.tsx`
- Create: `components/storefront/seasonal-hero.tsx`
- Create: `components/storefront/department-card.tsx`
- Create: `components/storefront/product-card.tsx`
- Create: `components/storefront/product-grid.tsx`
- Create: `components/storefront/occasionwear-feature.tsx`
- Create: `components/storefront/reassurance-strip.tsx`
- Create: `components/storefront/home.test.ts`
- Create: `tests/e2e/storefront-home.spec.ts`

**Step 1: Write failing fallback tests**

Render server-component data through pure presentational components and prove:

- an active campaign gets one dominant CTA and one subordinate link;
- no active campaign falls back to new arrivals instead of a broken hero;
- Girls, Boys, Baby, and Shoes cards point at URL-backed collections;
- product cards show price/range and colour count, not a misleading single-size stock state.

**Step 2: Implement the ordered home sections**

Use the approved sequence: announcement, hero, departments, new arrivals, occasionwear, reassurance, footer. Do not hardcode supplier or mock product prices. If the live catalogue has no imagery, use the coloured category field/fallback initials and keep layout stable.

**Step 3: Add accessible, responsive behaviour**

Meaningful image alt text comes from `product_images.alt_text`. Decorative edge shapes are hidden. Hover motion has a reduced-motion fallback.

**Step 4: Verify and commit**

Run unit, mobile/desktop Playwright, axe, typecheck, lint, and build.

```bash
git add "app/(storefront)/page.tsx" components/storefront/seasonal-hero.tsx components/storefront/department-card.tsx components/storefront/product-card.tsx components/storefront/product-grid.tsx components/storefront/occasionwear-feature.tsx components/storefront/reassurance-strip.tsx components/storefront/home.test.ts tests/e2e/storefront-home.spec.ts
git commit -m "feat(storefront): build catalog-driven home page"
```

---

### Task 8: Build collections and public search with URL-backed filters

**Files:**

- Create: `app/(storefront)/shop/page.tsx`
- Create: `app/(storefront)/shop/[category]/page.tsx`
- Create: `app/(storefront)/search/page.tsx`
- Create: `components/storefront/collection-filters.tsx`
- Create: `components/storefront/mobile-filter-sheet.tsx`
- Create: `components/storefront/applied-filter-chips.tsx`
- Create: `components/storefront/search-form.tsx`
- Create: `tests/e2e/storefront-collections.spec.ts`

**Step 1: Write failing URL and accessibility tests**

Cover shared filter URLs, back/forward restoration, clear-all, removable chips, mobile Apply semantics, sort, empty state, and focus return. Public search must not expose barcode/SKU/supplier/customer matches.

**Step 2: Implement server-first result pages**

Parse search params with Task 5 helpers, query the curated RPC, and render pagination/cursor links. Desktop uses a sidebar. Mobile uses the sheet and does not mutate the URL until Apply.

**Step 3: Restore product-return context**

Preserve the current query string in product links and restore scroll position through a small client helper keyed by URL. Do not put filter truth only in React state.

**Step 4: Verify and commit**

Run unit tests, Playwright at 375px and desktop, typecheck, lint, and build.

```bash
git add "app/(storefront)/shop/page.tsx" "app/(storefront)/shop/[category]/page.tsx" "app/(storefront)/search/page.tsx" components/storefront/collection-filters.tsx components/storefront/mobile-filter-sheet.tsx components/storefront/applied-filter-chips.tsx components/storefront/search-form.tsx tests/e2e/storefront-collections.spec.ts
git commit -m "feat(storefront): add collections and public search"
```

---

### Task 9: Build product details and back-office gallery management

**Files:**

- Create: `app/(storefront)/product/[slug]/page.tsx`
- Create: `components/storefront/product-gallery.tsx`
- Create: `components/storefront/variant-picker.tsx`
- Create: `components/storefront/size-guide.tsx`
- Create: `components/storefront/sticky-add-bar.tsx`
- Create: `components/storefront/variant-picker.test.ts`
- Modify: `lib/products/schemas.ts`
- Modify: `lib/products/queries.ts`
- Modify: `lib/products/actions.ts`
- Modify: `lib/products/image-actions.ts`
- Modify: `components/products/product-form.tsx`
- Create: `components/products/product-gallery-manager.tsx`
- Modify: `app/(admin)/products/[id]/page.tsx`
- Create: `tests/e2e/storefront-product.spec.ts`

**Step 1: Write failing variant-resolution tests**

Test colour/size combinations, unavailable states, low-stock text, quantity bounds, disabled Add to bag before a concrete variant, and accessible selected-state labels.

**Step 2: Implement the PDP**

Render gallery, product/category/brand, VAT-inclusive price, accessible colour/size selectors, size guide, delivery/returns summary, WhatsApp help, quantity, and sticky mobile action. The selected variant ID is the only sellable unit added to the bag.

**Step 3: Add gallery management**

Managers can upload, order, describe, choose primary, and remove gallery images. Keep `products.image_url` synchronized to the primary image for POS compatibility. Removing metadata does not silently delete a shared storage object; add explicit orphan cleanup later if needed.

**Step 4: Verify and commit**

Run product/admin tests, Playwright keyboard/mobile checks, typecheck, lint, and build.

```bash
git add "app/(storefront)/product/[slug]/page.tsx" components/storefront/product-gallery.tsx components/storefront/variant-picker.tsx components/storefront/size-guide.tsx components/storefront/sticky-add-bar.tsx components/storefront/variant-picker.test.ts components/products/product-gallery-manager.tsx lib/products/schemas.ts lib/products/queries.ts lib/products/actions.ts lib/products/image-actions.ts components/products/product-form.tsx "app/(admin)/products/[id]/page.tsx" tests/e2e/storefront-product.spec.ts
git commit -m "feat(storefront): add product detail and gallery tools"
```

---

### Task 10: Add the persistent customer bag with no trusted local price/stock

**Files:**

- Create: `lib/storefront/cart/types.ts`
- Create: `lib/storefront/cart/store.ts`
- Create: `lib/storefront/cart/totals.ts`
- Create: `lib/storefront/cart/cart.test.ts`
- Create: `components/storefront/cart-provider.tsx`
- Create: `components/storefront/cart-drawer.tsx`
- Create: `components/storefront/cart-line.tsx`
- Create: `components/storefront/bag-button.tsx`
- Create: `app/(storefront)/cart/page.tsx`
- Modify: `components/storefront/storefront-header.tsx`
- Modify: `components/storefront/variant-picker.tsx`
- Create: `tests/e2e/storefront-cart.spec.ts`

**Step 1: Write failing pure cart tests**

Cover versioned hydration, malformed local data removal, duplicate-line merging, quantity bounds, money rounding, removal, count, and stale display snapshots. Store only variant ID plus display snapshot; label local price as display-only in code comments.

**Step 2: Implement the Zustand store**

Use `persist` with an explicit version/migration and sanitized hydration. Do not reuse `lib/pos/cart-store.ts` and do not carry internal SKU, cost, cashier, shift, or discount state.

**Step 3: Implement drawer and page fallback**

Adding opens the drawer and returns focus correctly when closed. `/cart` renders identical line semantics. Delivery says calculated from address. No fictional flat fee appears.

**Step 4: Verify and commit**

Run unit tests, Playwright persistence/focus/mobile tests, typecheck, lint, build.

```bash
git add lib/storefront/cart/types.ts lib/storefront/cart/store.ts lib/storefront/cart/totals.ts lib/storefront/cart/cart.test.ts components/storefront/cart-provider.tsx components/storefront/cart-drawer.tsx components/storefront/cart-line.tsx components/storefront/bag-button.tsx components/storefront/storefront-header.tsx components/storefront/variant-picker.tsx "app/(storefront)/cart/page.tsx" tests/e2e/storefront-cart.spec.ts
git commit -m "feat(storefront): add persistent guest bag"
```

---

### Task 11: Add orders, delivery quotes, reservations, and shared stock locking

**Files:**

- Create: `supabase/Migrations/043_storefront_orders.sql`
- Create: `supabase/tests/storefront/043_orders.sql`
- Create: `supabase/tests/storefront/043_order_races.mjs`
- Modify: `lib/supabase/database.types.ts`
- Modify: `lib/db-enums.ts`

**Step 1: Write failing database tests**

Cover:

- deterministic locality-first then district delivery-zone matching;
- expired/forged quote rejection and fee recomputation;
- idempotent placement returning the original order;
- immutable item/contact/address snapshots;
- append-only events and address revisions;
- tracking lookup by SHA-256 hash, never order number/email;
- reservation expiry/release/hold/consume;
- storefront/storefront and POS/storefront races for the final unit;
- negative location stock rejection across sale, adjustment, and transfer paths.

Run against the migration-042 test clone. Expected: fail because the schema/RPCs do not exist.

**Step 2: Add commerce schema**

Migration 043 creates:

- `delivery_zones` and `delivery_zone_areas`;
- `storefront_delivery_quotes` with expiry and cart/address fingerprint;
- `storefront_orders` with unique order number/idempotency key, immutable contact/address snapshot, currency/totals, payment mode, fulfilment/source location, tracking hash, cached status, and timestamps;
- `storefront_order_items` with immutable product/variant/name/SKU/size/colour/price/discount/tax/quantity/total snapshots;
- append-only `storefront_order_events`;
- append-only `storefront_address_revisions`;
- `stock_reservations` with location, qty, expiry, released/consumed timestamps and unique order/variant/location; and
- `module_access` seed rows for `online_orders` (owner/manager true, cashier false), so the later UI task does not rewrite an applied migration.

Foreign keys from financial/history rows use `RESTRICT`/`NO ACTION`, not cascade.

**Step 3: Add one shared stock-lock rule**

Every order-placement, reservation transition, transfer, and stock-decrement path locks the same `product_variants` row `FOR UPDATE`. Replace the current transfer implementation so it uses that row lock before source-location checks. Add a guarded negative-movement check so POS cannot sell units actively reserved at its location.

Available-to-sell is:

```sql
physical location movement sum
- active, unexpired, unreleased, unconsumed reservation sum
```

Reservations are not stock movements and never change `qty_on_hand`.

**Step 4: Add narrow RPCs**

Create and explicitly grant only:

- anon/authenticated: `quote_storefront_delivery`, `place_storefront_order`, `track_storefront_order`;
- authenticated staff wrappers: `transition_storefront_order`, `revise_storefront_address`, `release_expired_storefront_reservations`.

Placement rereads active product/variant, public-safe discounts, price, VAT, quote, and ATS in one transaction. It accepts an idempotency key and tracking hash, never a trusted total.

**Step 5: Run race and regression tests**

Run two database connections concurrently against the final unit. Exactly one competing sale/order succeeds. Then run the existing POS unit/till API suite to prove normal unreserved sales still work.

**Step 6: Regenerate types and commit**

```bash
git add supabase/Migrations/043_storefront_orders.sql supabase/tests/storefront/043_orders.sql supabase/tests/storefront/043_order_races.mjs lib/supabase/database.types.ts lib/db-enums.ts
git commit -m "feat(storefront): add atomic orders and stock reservations"
```

---

### Task 12: Add server-authoritative cart validation, delivery quote, and order APIs

**Files:**

- Create: `lib/storefront/checkout/schema.ts`
- Create: `lib/storefront/checkout/schema.test.ts`
- Create: `lib/storefront/orders/tokens.ts`
- Create: `lib/storefront/orders/tokens.test.ts`
- Create: `lib/storefront/orders/queries.ts`
- Create: `lib/storefront/orders/service.ts`
- Create: `lib/storefront/orders/service.test.ts`
- Create: `app/api/storefront/cart/validate/route.ts`
- Create: `app/api/storefront/delivery/quote/route.ts`
- Create: `app/api/storefront/orders/route.ts`

**Step 1: Write failing validation/service tests**

Test Mauritian phone normalization, required address parts, district/locality validation, quantity caps, unsupported payment/fulfilment modes, idempotency replay, tracking-token entropy/hash, stale cart price/stock responses, and error-to-HTTP mapping.

**Step 2: Generate secrets correctly**

Tracking tokens use at least 256 bits from Web Crypto and URL-safe base64. Store only SHA-256. Return plaintext once in the placement response and private tracking URL; never log it.

**Step 3: Implement thin route handlers**

Routes parse with Zod, call the public RPC through `lib/supabase/public.ts`, set `Cache-Control: no-store`, return typed errors, and never calculate authoritative money in JavaScript. Placement uses a stable client idempotency key and server-generated tracking token.

**Step 4: Add abuse hooks**

Define a `CheckoutChallengeVerifier` interface with a local-test implementation. Production `doorstep`/`live` mode must fail closed unless the configured Turnstile/rate-limit verifier is healthy. Do not hardcode a bypass based on host headers.

**Step 5: Verify and commit**

Run targeted route/service tests, typecheck, lint, and build.

```bash
git add lib/storefront/checkout/schema.ts lib/storefront/checkout/schema.test.ts lib/storefront/orders/tokens.ts lib/storefront/orders/tokens.test.ts lib/storefront/orders/queries.ts lib/storefront/orders/service.ts lib/storefront/orders/service.test.ts app/api/storefront/cart/validate/route.ts app/api/storefront/delivery/quote/route.ts app/api/storefront/orders/route.ts
git commit -m "feat(storefront): add authoritative guest order API"
```

---

### Task 13: Build guest checkout, confirmation, and private tracking

**Files:**

- Create: `app/(storefront)/checkout/page.tsx`
- Create: `components/storefront/checkout-form.tsx`
- Create: `components/storefront/checkout-contact.tsx`
- Create: `components/storefront/checkout-address.tsx`
- Create: `components/storefront/checkout-fulfilment.tsx`
- Create: `components/storefront/checkout-payment.tsx`
- Create: `components/storefront/order-summary.tsx`
- Create: `app/(storefront)/order/[trackingToken]/page.tsx`
- Create: `components/storefront/order-status-timeline.tsx`
- Create: `tests/e2e/storefront-checkout.spec.ts`

**Step 1: Write failing journey tests**

At 375px and desktop, cover blur/submit validation, first-error focus, retained inputs after recoverable failure, quote refresh, stale cart correction, doorstep success, replayed submit, direct invalid token, private page headers, and Continue shopping.

**Step 2: Implement the progressive single page**

Render contact, address, fulfilment, payment, and summary in the approved order. Rose Hill collection is not rendered unless enabled with instructions/hours. Online payment is not rendered unless release mode is `live` and the provider health gate is true.

**Step 3: Implement private tracking**

The tracking page looks up only the token hash and sends:

- `Cache-Control: private, no-store`;
- `X-Robots-Tag: noindex, nofollow`;
- `Referrer-Policy: no-referrer`.

Show order number, state, destination, payment due/paid, items, and append-only timeline without exposing internal notes.

**Step 4: Verify and commit**

Run checkout unit tests, Playwright mobile/desktop/axe, typecheck, lint, build.

```bash
git add "app/(storefront)/checkout/page.tsx" components/storefront/checkout-form.tsx components/storefront/checkout-contact.tsx components/storefront/checkout-address.tsx components/storefront/checkout-fulfilment.tsx components/storefront/checkout-payment.tsx components/storefront/order-summary.tsx "app/(storefront)/order/[trackingToken]/page.tsx" components/storefront/order-status-timeline.tsx tests/e2e/storefront-checkout.spec.ts
git commit -m "feat(storefront): add guest doorstep checkout and tracking"
```

---

### Task 14: Add the immutable payment journal and fiscal posting invariants

**Files:**

- Create: `supabase/Migrations/044_storefront_payments_and_fulfilment.sql`
- Create: `supabase/tests/storefront/044_payments.sql`
- Create: `supabase/tests/storefront/044_fulfilment.sql`
- Modify: `lib/supabase/database.types.ts`
- Modify: `lib/db-enums.ts`
- Modify: `scripts/check-consistency.mjs`

**Step 1: Write failing immutability tests**

Prove:

- browser roles cannot insert payment entries directly;
- `UPDATE` and `DELETE` fail even when attempted through a definer/privileged application function;
- order/payment and sale/payment foreign keys cannot cascade history away;
- duplicate idempotency key or `(provider, environment, provider_event_id)` replays return the original entry;
- sign/type/reference constraints reject malformed entries;
- authorisation does not count as paid;
- capture plus authorisation counts once;
- refund/reversal/chargeback reduce the derived balance;
- one captured/collected entry can post to `sale_payments` only once.

**Step 2: Create the journal**

Add `storefront_payment_entries` with order, optional sale, type, signed amount, currency, method, provider/environment, idempotency key, provider event/transaction IDs, original entry, source, actor, reason, safe metadata, and timestamp. Add a `BEFORE UPDATE OR DELETE` trigger that always raises. Grant no direct insert/update/delete to anon/authenticated.

Expose read-only derived views/RPCs for gross collected, refunded, net paid, and due. Reports must never sum both the storefront journal and fiscal `sale_payments`.

**Step 3: Harden fiscal tables**

- change `sale_payments.sale_id` from `ON DELETE CASCADE` to `RESTRICT`/`NO ACTION`;
- add the same update/delete rejection trigger to `sale_payments`;
- add nullable unique `source_storefront_payment_entry_id`;
- add `sales.source` default `pos` and unique nullable `storefront_order_id`;
- enforce POS sales have a shift and storefront sales do not;
- preserve every historical `myt_money` row while current offered methods stay cash/card/juice/bank.

**Step 4: Add idempotent fulfilment RPCs**

Create pinned staff/internal operations for confirm, prepare, dispatch, failed-delivery return, cancel, doorstep collect/deliver, online-paid dispatch, and stock return. Every operation locks order + variants, validates a transition, appends an event, and is replay-safe.

Doorstep delivery atomically appends `collected`, creates the source-linked fiscal payment/sale, stocks out from in-transit, consumes custody, and marks delivered. There is no till shift and doorstep cash never enters drawer/Z totals.

**Step 5: Make consistency checks source-aware**

Change “every completed sale falls inside a shift” to require a shift only for `source='pos'`. Add checks for storefront order-to-sale uniqueness, one fiscal posting per financial source entry, journal immutability trigger presence, reservation/custody balance, and no doorstep payment in a till shift.

**Step 6: Verify and commit**

Run DB tests, full unit suite, consistency against the test database, typecheck, lint, and build.

```bash
git add supabase/Migrations/044_storefront_payments_and_fulfilment.sql supabase/tests/storefront/044_payments.sql supabase/tests/storefront/044_fulfilment.sql lib/supabase/database.types.ts lib/db-enums.ts scripts/check-consistency.mjs
git commit -m "feat(storefront): add immutable payments and fulfilment ledger"
```

---

### Task 15: Add Online orders to the back office

**Files:**

- Modify: `lib/access/modules.ts`
- Modify: `components/admin/nav.ts`
- Modify: `components/settings/access-panel.tsx`
- Create: `lib/storefront/admin/queries.ts`
- Create: `lib/storefront/admin/actions.ts`
- Create: `lib/storefront/admin/actions.test.ts`
- Create: `app/(admin)/online-orders/page.tsx`
- Create: `app/(admin)/online-orders/[id]/page.tsx`
- Create: `app/(admin)/online-orders/[id]/pick-list/page.tsx`
- Create: `components/online-orders/order-board.tsx`
- Create: `components/online-orders/order-table.tsx`
- Create: `components/online-orders/order-detail.tsx`
- Create: `components/online-orders/order-actions.tsx`
- Modify: `app/(admin)/dashboard/page.tsx`
- Modify: `lib/sales/queries.ts`
- Modify: `app/(admin)/stock/page.tsx`
- Modify: `lib/stock/queries.ts`
- Create: `tests/e2e/online-orders.spec.ts`

**Step 1: Write failing permission/transition tests**

Owner/manager may view and act; cashier defaults to hidden/denied. Invalid transitions, missing reason, duplicate action, and collection without payment fail. Valid replay returns the original outcome.

**Step 2: Add module/navigation**

Add `online_orders` to module keys, path map, labels, sidebar, and access matrix, and verify the seed rows already created by migration 043. This visibility supplements RLS/RPC checks.

**Step 3: Build board, table, detail, and pick list**

Show contact/address snapshots, latest revision, items, payment derived balance, reservation/custody, timeline, notes, and printable pick list. Never make the payment ledger editable.

**Step 4: Add dashboard and stock signals**

Dashboard shows new orders and overdue preparation. Stock shows physical, reserved, and available separately, without changing `qty_on_hand` semantics.

**Step 5: Verify and commit**

Run admin unit/Playwright tests, typecheck, lint, build, and POS smoke.

```bash
git add lib/access/modules.ts components/admin/nav.ts components/settings/access-panel.tsx lib/storefront/admin/queries.ts lib/storefront/admin/actions.ts lib/storefront/admin/actions.test.ts "app/(admin)/online-orders/page.tsx" "app/(admin)/online-orders/[id]/page.tsx" "app/(admin)/online-orders/[id]/pick-list/page.tsx" components/online-orders/order-board.tsx components/online-orders/order-table.tsx components/online-orders/order-detail.tsx components/online-orders/order-actions.tsx "app/(admin)/dashboard/page.tsx" lib/sales/queries.ts "app/(admin)/stock/page.tsx" lib/stock/queries.ts tests/e2e/online-orders.spec.ts
git commit -m "feat(backoffice): add online order operations"
```

---

### Task 16: Add owner-managed storefront content and delivery settings

**Files:**

- Create: `lib/storefront/admin/settings-queries.ts`
- Create: `lib/storefront/admin/settings-actions.ts`
- Create: `lib/storefront/admin/settings-actions.test.ts`
- Create: `components/settings/storefront-settings.tsx`
- Create: `components/settings/storefront-campaigns-panel.tsx`
- Create: `components/settings/delivery-zones-panel.tsx`
- Create: `components/settings/collection-settings.tsx`
- Modify: `app/(admin)/settings/page.tsx`
- Create: `tests/e2e/storefront-settings.spec.ts`

**Step 1: Write failing authorization and validation tests**

Prove only the owner can change release mode, fulfilment/in-transit locations, reservation durations, collection settings, delivery zones, campaign schedules, support URL, and SEO defaults. Reject identical source/in-transit locations, negative fees/durations, invalid campaign windows/targets, overlapping equal-priority delivery rules, and `live` mode when provider/email health gates fail.

**Step 2: Implement typed settings actions**

Use Zod, `useActionState`, existing `FormState`, audit events, and explicit revalidation. All actions call narrow staff RPCs so a silent RLS no-op cannot be reported as success. Campaign/gallery writes retain immutable order/payment boundaries and never accept raw HTML.

**Step 3: Build settings panels**

Add a Storefront section to the existing Settings page for release mode, fulfilment, doorstep/collection, reservation windows, WhatsApp/support, campaigns, and delivery zones/areas. Explain that `browse` publishes no checkout, `doorstep` enables guest doorstep orders, and `live` additionally requires healthy real providers.

**Step 4: Verify configuration reaches the storefront**

Change a campaign/zone on the test project and prove home/quote output updates after revalidation. Verify manager/cashier denial, keyboard operation, and mobile layout.

**Step 5: Commit**

```bash
git add lib/storefront/admin/settings-queries.ts lib/storefront/admin/settings-actions.ts lib/storefront/admin/settings-actions.test.ts components/settings/storefront-settings.tsx components/settings/storefront-campaigns-panel.tsx components/settings/delivery-zones-panel.tsx components/settings/collection-settings.tsx "app/(admin)/settings/page.tsx" tests/e2e/storefront-settings.spec.ts
git commit -m "feat(backoffice): add storefront content and delivery settings"
```

---

### Task 17: Add idempotent transactional notification infrastructure

**Files:**

- Create: `supabase/Migrations/045_storefront_notifications.sql`
- Create: `supabase/tests/storefront/045_notifications.sql`
- Modify: `lib/supabase/database.types.ts`
- Create: `lib/storefront/email/types.ts`
- Create: `lib/storefront/email/console-adapter.ts`
- Create: `lib/storefront/email/registry.ts`
- Create: `lib/storefront/email/send.ts`
- Create: `lib/storefront/email/send.test.ts`
- Create: `lib/storefront/email/templates/order-confirmation.tsx`
- Create: `lib/storefront/email/templates/order-status.tsx`
- Modify: `.env.example`
- Modify: `scripts/preflight.mjs`

**Step 1: Write failing idempotency/redaction tests**

Test one send per message key, safe retry after provider timeout, no tracking token/provider secret in logs, and fail-closed production mode without a configured adapter/sender.

**Step 2: Add an append-only outbox**

Migration 045 adds `storefront_notifications` with unique message key, order, kind, recipient snapshot, provider, provider message ID, attempt event rows, and timestamps. Do not mutate a sent message into a new truth; append attempts/events.

**Step 3: Implement the adapter contract**

```ts
export interface TransactionalEmailAdapter {
  send(input: { messageKey: string; to: string; subject: string; html: string }): Promise<{
    providerMessageId: string
  }>
}
```

Console adapter is development/test only. Production release modes fail closed until a real adapter, verified sender domain, and smoke test are configured. Provider-specific implementation is a separate bounded task once selected.

**Step 4: Hook order events**

Send confirmation and selected status changes idempotently after database success. A notification failure does not roll back an order/payment; it remains retryable in the outbox.

**Step 5: Verify and commit**

```bash
git add supabase/Migrations/045_storefront_notifications.sql supabase/tests/storefront/045_notifications.sql lib/supabase/database.types.ts lib/storefront/email/types.ts lib/storefront/email/console-adapter.ts lib/storefront/email/registry.ts lib/storefront/email/send.ts lib/storefront/email/send.test.ts lib/storefront/email/templates/order-confirmation.tsx lib/storefront/email/templates/order-status.tsx .env.example scripts/preflight.mjs
git commit -m "feat(storefront): add idempotent order email outbox"
```

---

### Task 18: Add verified customer accounts without entering the staff model

**Files:**

- Create: `supabase/Migrations/046_storefront_customer_accounts.sql`
- Create: `supabase/tests/storefront/046_customer_accounts.sql`
- Modify: `lib/supabase/database.types.ts`
- Create: `lib/storefront/accounts/session.ts`
- Create: `lib/storefront/accounts/actions.ts`
- Create: `lib/storefront/accounts/queries.ts`
- Create: `lib/storefront/accounts/actions.test.ts`
- Create: `app/(storefront)/account/sign-in/page.tsx`
- Create: `app/(storefront)/account/callback/route.ts`
- Create: `app/(storefront)/account/orders/page.tsx`
- Create: `app/(storefront)/account/orders/[id]/page.tsx`
- Create: `components/storefront/account-magic-link-form.tsx`
- Create: `components/storefront/create-account-after-order.tsx`
- Create: `tests/e2e/customer-account.spec.ts`

**Step 1: Write failing isolation/link tests**

Prove a customer Auth user has no `profiles` row, cannot read/call staff data/RPCs, sees only orders explicitly linked to their account, and cannot claim by order number/email alone. Replayed claim is harmless.

**Step 2: Add account linkage**

Migration 046 adds `customer_accounts(auth_user_id uuid primary key references auth.users, customer_id unique references customers, created_at)`. Own-order RLS/projections key off `auth.uid()` through this table. Do not broaden raw order table access and do not edit already-applied migration 045.

**Step 3: Implement magic-link and explicit claim**

After tracking-token proof, send a magic link with a short-lived, single-use claim nonce hash. Callback exchanges the verified code, creates the account-linked customer if absent, and links only that proved order. Never infer ownership from matching contact text.

**Step 4: Verify and commit**

Run DB isolation tests, account unit/Playwright tests, staff/POS regression, typecheck, lint, build.

```bash
git add supabase/Migrations/046_storefront_customer_accounts.sql supabase/tests/storefront/046_customer_accounts.sql lib/supabase/database.types.ts lib/storefront/accounts/session.ts lib/storefront/accounts/actions.ts lib/storefront/accounts/queries.ts lib/storefront/accounts/actions.test.ts "app/(storefront)/account/sign-in/page.tsx" "app/(storefront)/account/callback/route.ts" "app/(storefront)/account/orders/page.tsx" "app/(storefront)/account/orders/[id]/page.tsx" components/storefront/account-magic-link-form.tsx components/storefront/create-account-after-order.tsx tests/e2e/customer-account.spec.ts
git commit -m "feat(storefront): add verified customer order accounts"
```

---

### Task 19: Add the online-payment adapter boundary and a deterministic test provider

**Files:**

- Create: `lib/supabase/admin.ts`
- Modify: `lib/env.ts`
- Modify: `.env.example`
- Modify: `scripts/preflight.mjs`
- Create: `lib/storefront/payments/types.ts`
- Create: `lib/storefront/payments/registry.ts`
- Create: `lib/storefront/payments/disabled.ts`
- Create: `lib/storefront/payments/test-provider.ts`
- Create: `lib/storefront/payments/service.ts`
- Create: `lib/storefront/payments/service.test.ts`
- Create: `app/api/storefront/payments/create/route.ts`
- Create: `app/api/storefront/payments/return/[provider]/route.ts`
- Create: `app/api/storefront/payments/webhook/[provider]/route.ts`
- Modify: `components/storefront/checkout-payment.tsx`
- Create: `tests/e2e/storefront-payment.spec.ts`

**Step 1: Write failing provider-contract tests**

The common interface is:

```ts
export interface OnlinePaymentProvider {
  createAttempt(input: PaymentAttemptInput): Promise<PaymentAttemptResult>
  verifyCallback(input: { rawBody: Uint8Array; headers: Headers }): Promise<VerifiedPaymentEvent>
  queryStatus(providerTransactionId: string): Promise<ProviderPaymentStatus>
  refund(input: RefundInput): Promise<VerifiedPaymentEvent>
  health(): Promise<{ ok: boolean; mode: "sandbox" | "live" }>
}
```

Test create, authorise/capture/fail, raw-body signature failure, duplicate callback replay, browser abandonment, refund, chargeback/reversal mapping, and late capture with/without stock.

**Step 2: Add a server-only Supabase admin client**

`lib/supabase/admin.ts` imports `server-only`, reads `SUPABASE_SERVICE_ROLE_KEY`, disables persistence, and is imported only by verified webhook/internal-job code. Never expose or log the key. Public order APIs continue using the anon client.

**Step 3: Implement journal-first service flow**

Create attempt appends `initiated` idempotently before redirect. Webhook reads raw bytes, verifies the provider signature before any DB write, then calls a service-role-only journal/transition RPC. Replays return the original result.

The deterministic test provider is enabled only in automated test/development and must be rejected by `preflight` for `live` release mode.

**Step 4: Keep production online payment disabled**

Until a real provider is selected, the registry returns `disabled`, provider health is false, and checkout does not render the online option. This is complete adapter infrastructure, not a claim that live money can move.

**Step 5: Verify and commit**

Run payment tests, Playwright fake-provider journey, DB ledger tests, typecheck, lint, build.

```bash
git add lib/supabase/admin.ts lib/env.ts .env.example scripts/preflight.mjs lib/storefront/payments/types.ts lib/storefront/payments/registry.ts lib/storefront/payments/disabled.ts lib/storefront/payments/test-provider.ts lib/storefront/payments/service.ts lib/storefront/payments/service.test.ts app/api/storefront/payments/create/route.ts "app/api/storefront/payments/return/[provider]/route.ts" "app/api/storefront/payments/webhook/[provider]/route.ts" components/storefront/checkout-payment.tsx tests/e2e/storefront-payment.spec.ts
git commit -m "feat(storefront): add secure online payment adapter boundary"
```

---

### Task 20: Integrate the selected real payment and email providers

**Files:**

- Create after provider selection: `lib/storefront/payments/live-provider.ts`
- Create: `lib/storefront/payments/live-provider.test.ts`
- Create after provider selection: `lib/storefront/email/live-provider.ts`
- Create: `lib/storefront/email/live-provider.test.ts`
- Modify: `lib/storefront/payments/registry.ts`
- Modify: `lib/storefront/email/registry.ts`
- Modify: `.env.example`
- Modify: `scripts/preflight.mjs`
- Modify: `DEPLOYMENT.md`

**Step 1: Obtain explicit external inputs**

This task cannot start until the user supplies/chooses:

- payment provider and sandbox/live credentials;
- official webhook/signature, settlement, refund, reversal, and chargeback contract;
- email provider, API credential/binding, verified sender/domain;
- public return/callback origins.

Do not guess credentials or enable live mode from a mock.

**Step 2: Write provider tests from official fixtures**

Use provider-supplied signed callback fixtures and official test cards/accounts. Include tampered body/signature, repeated event, out-of-order events, partial/full refund, and status-query reconciliation.

**Step 3: Implement and reconcile**

Map provider events into the fixed ledger semantics without mutating prior rows. Record only safe metadata. Compare provider settlement/status to journal-derived balance and surface mismatches in Online orders.

**Step 4: Run controlled smokes**

In sandbox: pay, abandon, fail, replay, refund. In live with a minimal approved amount: capture, fiscal post, refund, settlement/reconciliation. Verify no double stock/payment/sale under retries.

**Step 5: Commit**

```bash
git add lib/storefront/payments/live-provider.ts lib/storefront/payments/live-provider.test.ts lib/storefront/email/live-provider.ts lib/storefront/email/live-provider.test.ts lib/storefront/payments/registry.ts lib/storefront/email/registry.ts .env.example scripts/preflight.mjs DEPLOYMENT.md
git commit -m "feat(storefront): integrate verified commerce providers"
```

---

### Task 21: Add policies, SEO, structured data, and performance safeguards

**Files:**

- Create: `app/(storefront)/delivery/page.tsx`
- Create: `app/(storefront)/returns/page.tsx`
- Create: `app/(storefront)/privacy/page.tsx`
- Create: `app/(storefront)/terms/page.tsx`
- Create: `app/sitemap.ts`
- Create: `app/robots.ts`
- Create: `app/opengraph-image.tsx`
- Modify: product/collection pages for `generateMetadata`
- Create: `components/storefront/structured-data.tsx`
- Modify: `open-next.config.ts`
- Modify: `wrangler.toml`
- Modify: `DEPLOYMENT.md`
- Create: `tests/e2e/storefront-seo.spec.ts`

**Step 1: Write failing SEO/privacy tests**

Assert canonical URLs, unique title/description, product/breadcrumb JSON-LD, sitemap inclusion of published products/collections, no private tracking/account URLs, robots rules, and noindex/no-store tracking headers.

**Step 2: Add policy pages from approved shop facts**

Render policy copy from reviewed storefront settings/content. Do not invent delivery promises, return windows, legal entity details, or data-retention periods. Keep release mode below `live` until the owner approves the final copy.

**Step 3: Add cache/performance strategy**

Cache only public catalogue/content responses with explicit tags/short TTL; never cache cart, checkout, tracking, account, payment, or staff data. Configure the OpenNext incremental cache binding only if the chosen Cloudflare deployment supports and tests it; otherwise keep server rendering and document CDN/image behaviour honestly.

**Step 4: Verify and commit**

Run Lighthouse/Web Vitals profiling on home, collection, and PDP; Playwright SEO/axe; build and `npm run cf:build`.

```bash
git add "app/(storefront)/delivery/page.tsx" "app/(storefront)/returns/page.tsx" "app/(storefront)/privacy/page.tsx" "app/(storefront)/terms/page.tsx" "app/(storefront)/product/[slug]/page.tsx" "app/(storefront)/shop/page.tsx" "app/(storefront)/shop/[category]/page.tsx" app/sitemap.ts app/robots.ts app/opengraph-image.tsx components/storefront/structured-data.tsx open-next.config.ts wrangler.toml DEPLOYMENT.md tests/e2e/storefront-seo.spec.ts
git commit -m "feat(storefront): add policies SEO and launch performance"
```

---

### Task 22: Regenerate the full schema snapshot and prove upgrade/fresh installs

**Files:**

- Modify: `supabase/catch-up.sql`
- Modify: `lib/supabase/database.types.ts`
- Modify: `README.md`
- Modify: `docs/storefront/verification.md`

**Step 1: Apply migrations only to approved disposable targets**

On the upgrade clone, apply 041-046 in order and run all storefront DB tests. On the empty disposable Supabase project, regenerate `catch-up.sql` from the fully migrated clone, apply the snapshot, and rerun the same tests.

Do not run `supabase db push`, reset, migration repair, or catch-up SQL against production automatically.

**Step 2: Verify snapshot invariants**

The closing report must assert:

- zero unintended anon/public function grants;
- zero unpinned definers;
- only named public storefront functions granted to anon;
- all staff entry wrappers require active staff;
- all append-only triggers exist;
- payment FKs are non-cascading;
- seeded `payment_methods` includes bank and retains historical myt_money constraints;
- migration 038 pin verifier objects are present;
- online-orders module seeds and storefront settings exist.

**Step 3: Regenerate types and run all checks**

Run database tests on both targets, then unit, typecheck, lint, build, consistency (test DB), and e2e.

**Step 4: Commit**

```bash
git add supabase/catch-up.sql lib/supabase/database.types.ts README.md docs/storefront/verification.md
git commit -m "chore(db): refresh storefront schema snapshot"
```

---

### Task 23: Production-readiness rehearsal and staged enablement

**Files:**

- Modify: `DEPLOYMENT.md`
- Create: `docs/storefront/runbook.md`
- Create: `docs/storefront/release-checklist.md`
- Modify: `.github/workflows/deploy.yml` if present/required

**Step 1: Run the full local/CI gate**

```bash
npm test
npm run typecheck
npm run lint
npm run check:contrast
npm run build
npm run cf:build
npm run test:e2e
npm run test:db
npm run check:consistency
```

Record actual output and dates in the release checklist; do not write “pass” without evidence.

**Step 2: Run operational rehearsals**

Exercise:

- anonymous browse and guest doorstep order on a real phone;
- final-unit POS/storefront race;
- prepare/dispatch/deliver/collect retry;
- failed doorstep return and reattempt/cancel;
- expired reservation release;
- stale/forged quote and tracking-token denial;
- customer claim isolation;
- online capture, callback replay, refund, and reconciliation when provider is configured;
- email confirmation/status delivery;
- existing web POS and Android till sale/refund/receipt/Z flows.

**Step 3: Verify hosted state, not just repository state**

Confirm applied migration ledger, deployed commit/SHA, production health, release mode, canonical host/DNS/TLS, Supabase redirect URLs, provider mode, webhook origin, sender-domain records, feature secrets, and live payment setting. Green repo tests alone are not launch approval.

**Step 4: Enable in stages**

1. `off` -> internal holding page and staff routes;
2. `browse` -> public catalogue only;
3. `doorstep` -> internal pilot then public doorstep checkout;
4. customer accounts after isolation evidence;
5. `live` -> online payment only after Task 20 passes.

Each rollback changes release mode first; it does not delete orders, payments, events, or reservations.

**Step 5: Final commit**

```bash
git add DEPLOYMENT.md docs/storefront/runbook.md docs/storefront/release-checklist.md
# If the workflow was actually modified, stage it explicitly as a second command:
git add .github/workflows/deploy.yml
git commit -m "docs(storefront): add launch and recovery runbook"
```

---

## Final acceptance checklist

- Anonymous and customer sessions cannot access internal catalogue fields, PII, staff tables, reports, or privileged RPCs.
- Signed-in staff can browse the public storefront without being redirected away.
- Public `/search` is customer-safe; back-office scanner search works at `/dashboard/search`.
- Cart state is convenient only; server price, discount, quote, tax, and ATS always win.
- POS/storefront and storefront/storefront final-unit races allow one success.
- Physical stock, reservations, in-transit custody, and `qty_on_hand` remain reconcilable.
- Payment and order histories are append-only; `sale_payments` cannot update/delete/cascade.
- Doorstep cash creates no payment until collection and never enters a till shift/Z report.
- A capture/refund/replay cannot duplicate journal entries, fiscal payment, sale, or stock movement.
- Guest tracking requires the private token; order number/email are insufficient.
- Account creation happens after success and only links an explicitly proved order.
- Home, collections, PDP, cart, checkout, and tracking work at 375px, keyboard-only, reduced motion, and 200% zoom.
- Online payment remains disabled until a real provider and production reconciliation pass.
- The deployed SHA, database migration state, provider mode, sender domain, DNS, and health are verified before `live` mode.
