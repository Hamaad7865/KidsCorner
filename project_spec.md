# Kids Corner — POS + Back Office (Project Spec)

Single Next.js app containing a web back office (admin) and a tablet POS,
backed by Supabase. Built for a small kids' clothing & shoe shop in
Mauritius. Currency MUR (Rs), VAT 15% (prices are VAT-inclusive).

## Stack

- Next.js 15+, App Router, TypeScript
- Supabase (Postgres, Auth) via `@supabase/ssr` — server client for
  server components/actions, browser client for the POS
- Tailwind CSS + shadcn/ui
- SheetJS (`xlsx`) for Excel import
- Zustand for POS cart state
- The database schema already exists: `supabase/migrations/001_initial_schema.sql`
  (profiles, catalog, variants, stock_movements, purchases, customers,
  shifts, sales, sale_items, sale_payments, RPCs, RLS). Do NOT redesign
  the schema — build against it. Generate types with `supabase gen types`.

## Core domain model

- `products` are parents; `product_variants` (size × colour) are the
  sellable units, each with its own sku, barcode, cost_price,
  selling_price, qty_on_hand, reorder_level.
- `sizes` covers both clothes (`size_type='age_range'`, e.g. "2-3 yrs")
  and shoes (`size_type='shoe_size'`, e.g. "EU 24").
- Stock truth = `stock_movements`; `qty_on_hand` is a cache kept in sync
  ONLY by the `record_stock_movement` RPC. Never update qty directly.
- All sales go through the `complete_sale` RPC (atomic: sale + items +
  payments + stock out). Purchases are received via `receive_purchase`.

## Auth model (two-tier)

1. Device/user logs into Supabase Auth (email) — owner, manager, or a
   shared "till" account.
2. On the POS, cashiers switch via 4-digit PIN mapped to `profiles.pin_code`
   (store hashed). Every sale records `cashier_id`. PIN switching is
   app-level state on top of the Supabase session.
3. Roles: owner > manager > cashier. Middleware: `(pos)` routes allow all
   roles; `(admin)` routes require owner/manager. Cost prices are only
   rendered for owner/manager (RLS already restricts writes).

## Route structure

```
app/
├── (auth)/login
├── (pos)/pos            # sell screen (fullscreen layout, no sidebar)
│   ├── pay              # payment flow
│   ├── shift            # open/close shift
│   └── pin              # cashier PIN switcher
├── (admin)/             # sidebar layout
│   ├── dashboard
│   ├── products         # list + [id] detail with variant matrix
│   ├── import           # Excel import wizard
│   ├── stock            # movements + adjustments + low-stock tab
│   ├── purchases        # list + new + receive
│   ├── customers
│   ├── sales            # history + [id] detail
│   ├── suppliers
│   └── settings         # shop info, users/PINs, master data (categories,
│                        #   brands, colours, sizes)
```

## Feature specs

### Back office

**Dashboard**: today's sales total, items sold, low-stock count,
top sellers this week, recent movements. Cards + one chart.

**Products**: table (thumbnail, name, category, brand, gender, variant
count, total stock, price range, status), filters by category/brand,
search. Product detail = product form + VARIANT MATRIX: rows are sizes,
columns are colour swatches; cells show qty + price, editable inline;
low-stock cells highlighted. "Generate variants" flow: tick sizes and
colours, app creates all combos with auto-SKUs (pattern:
`{PRODUCTID}-{SIZE}-{COLOUR}` slugified).

**Excel Import (TOP PRIORITY — build early, polish hard)**
3-step wizard:
1. Upload: drag-drop .xlsx + downloadable template. Expected columns:
   Product Name, Category, Brand, Gender, Size/Age Range, Colour,
   Cost Price, Sell Price, Quantity, Barcode. One row = one variant
   (product name repeats across its size/colour rows).
2. Map + preview: parsed rows in a table, column-mapping dropdowns
   (auto-matched by header name), validation per row:
   - unknown category/colour/brand/size → highlight with one-click
     "create new" chip
   - missing/invalid price, negative qty, duplicate barcode (in file or
     in DB) → error row
   Summary bar: "N rows: X ready, Y new masters to create, Z errors".
   Import proceeds with valid rows only; errors listed for download.
3. Result: products created, variants created, total stock added
   (movement_type='import'), skipped rows + reasons, error report
   download. Rows matching an existing variant (same product+size+colour
   or same barcode) UPDATE prices and ADD quantity rather than duplicate.
   Parse client-side with SheetJS; commit via a server action that loops
   inserts + `record_stock_movement` calls; show progress.

**Stock**: movement history (filterable by variant/type/date), manual
adjustment modal (reason required), low-stock tab (qty <= reorder_level).

**Purchases**: list; new purchase = pick supplier, search-add variant
lines (qty + unit cost), save as draft; "Receive" button calls
`receive_purchase`.

**Customers**: list, quick create (name + phone), detail with purchase
history.

**Settings**: shop info, VAT display, payment methods, user management
(create profile, role, set PIN), master data CRUD.

### POS (landscape tablet, 1280x800 first)

**Sell screen**: left ~60% product area — persistent search
("Scan barcode or search…"; barcode scanner acts as keyboard + Enter),
quick-keys grid in category tabs. Right ~40% cart — lines with variant
(size + colour swatch), qty steppers, line discount, remove; footer
subtotal/discount/VAT/TOTAL + big PAY button; toolbar: attach customer,
hold sale, clear.
- Barcode exact-match adds variant straight to cart.
- Search match on product opens VARIANT PICKER modal: size × colour grid,
  cells show price + stock, out-of-stock greyed, one tap adds.
- Held sales: park/resume carts (local state, list modal).

**Payment**: total in huge type; methods Cash / Card / Juice / my.t money;
cash keypad with quick amounts (exact, 100, 500, 1000) + CHANGE DUE large;
split payments (add payment rows until covered). Confirm calls
`complete_sale` RPC. Success screen: change due, Print receipt, New sale
(auto-advance ~5s).

**Shift**: open (float amount) required before selling; close shows totals
by payment method, expected vs counted cash, variance; writes to `shifts`.

**PIN switcher**: avatars + 4-digit pad; fast mid-day switching.

**Resilience**: catalog (products/variants/prices) cached client-side on
shift open and refreshed periodically; cart is fully client-side; network
is only required at `complete_sale`. Subtle offline indicator. If
complete_sale fails, keep cart intact and allow retry.

**Receipt**: HTML receipt page sized for 80mm thermal, print via browser
for now (dedicated thermal driver is phase 2).

## Design system

One design system, two densities. Light theme, white surfaces, soft
coral (#F0645C-ish) or teal accent — pick one and use everywhere.
Admin: comfortable density, dense readable tables, sticky headers.
POS: same tokens but larger type and ≥48px touch targets. Colour
swatches wherever colours appear. Friendly empty states with clear CTAs.
Show cost price/margin only to owner/manager.

## Build order (commit per phase, keep it runnable)

1. Scaffold: Next.js + Tailwind + shadcn + Supabase clients + generated
   types + login + route groups + role middleware
2. Master data CRUD (categories, brands, colours, sizes) in settings
3. Products list + detail + variant matrix + generate-variants flow
4. Excel import wizard (all 3 steps + template download)
5. Stock: movements, adjustments, low-stock
6. Purchases + receive
7. Customers
8. POS: shift open → sell screen → variant picker → payment →
   complete_sale → receipt → PIN switcher → held sales
9. Shift close + dashboard + sales history/reports

## Conventions

- TypeScript strict; zod-validate all server action inputs
- Money as numbers in MUR with a shared `formatRs()` util; never floats
  for arithmetic display issues — round at 2dp at boundaries
- All multi-step DB writes go through the existing RPCs; add new RPCs in
  a new migration file if truly needed (never edit 001)
- Server components for reads, server actions for mutations; POS sell
  screen is a client island
- Keep components small; feature folders under `components/{feature}/`