# Android Stock Check and Import Locations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add product shelf locations, location-aware Excel stock imports for Shop and Warehouse, and an Android Stock Check screen that shows shelf and live per-location quantities.

**Architecture:** Product shelf location is stored once on `products` and repeated through variant-shaped catalogue DTOs. Excel rows carry a normalized stock-location label and the server resolves that label to an active database location before calling the existing `record_stock_movement_at` RPC. Android searches its Room-cached catalogue locally, then requests current per-location balances from a read-only authenticated route after a product is selected.

**Tech Stack:** PostgreSQL/Supabase migrations and PostgREST, Next.js 16, TypeScript, Zod, SheetJS, Vitest, Kotlin, Room, Ktor, Jetpack Compose Material 3, JUnit 4, Gradle, Android Emulator/ADB.

**Spec:** `docs/superpowers/specs/2026-08-17-android-stock-check-design.md`

## Global Constraints

- `shelf_location` is optional free text on `products`, shared by every variant.
- Excel **Location** accepts only `Shop` and `Warehouse`, case-insensitively; blank defaults to `Shop`.
- Two import rows may identify the same variant when they allocate quantity to different locations.
- Repeated variant rows must agree on prices, barcode, and shelf location.
- Imported stock must use `record_stock_movement_at`; Android must never query Supabase directly.
- Opening/closing Stock Check must not mutate cart lines, customer, discount, or note.
- Missing live location rows render as zero; failed live requests keep cached total stock visible.
- Existing products, spreadsheets, Room catalogue rows, and queued Android sales must survive migrations.

---

### Task 1: Shelf and stock-location database contract

**Files:**
- Create: `supabase/Migrations/043_product_shelf_and_import_locations.sql`
- Modify: `supabase/catch-up.sql`
- Modify: `lib/supabase/database.types.ts`
- Test: `lib/products/schemas.test.ts`
- Modify: `lib/products/schemas.ts`

**Interfaces:**
- Consumes: existing `products`, `stock_locations`, and current default `Shop floor` row.
- Produces: nullable `products.shelf_location`, active locations named exactly `Shop` and `Warehouse`, and `productSchema.shelfLocation: string | null`.

- [ ] **Step 1: Write the failing product-schema test**

```ts
it("trims an optional shelf location", () => {
  const parsed = productSchema.parse({
    id: null,
    name: "Chemise cotton",
    categoryId: 1,
    brandId: null,
    gender: "unisex",
    description: null,
    imageUrl: null,
    shelfLocation: "  A12  ",
    isActive: true,
  })
  expect(parsed.shelfLocation).toBe("A12")
})
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npm test -- lib/products/schemas.test.ts`

Expected: FAIL because `productSchema` does not expose `shelfLocation`.

- [ ] **Step 3: Add the schema field and migration**

Add `shelfLocation: z.string().trim().max(120).nullable()` to `productSchema`. Create the migration with the Supabase CLI migration command, then put this idempotent SQL in the generated file:

```sql
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS shelf_location TEXT;
UPDATE public.stock_locations
   SET name = 'Shop'
 WHERE name = 'Shop floor'
   AND NOT EXISTS (SELECT 1 FROM public.stock_locations WHERE name = 'Shop');
INSERT INTO public.stock_locations (name, is_default, is_active)
VALUES ('Warehouse', FALSE, TRUE)
ON CONFLICT (name) DO UPDATE SET is_active = TRUE;
```

Update the catch-up schema and generated database type so `products.Row`, `Insert`, and `Update` carry `shelf_location`.

- [ ] **Step 4: Run the schema test to verify GREEN**

Run: `npm test -- lib/products/schemas.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the database contract**

```powershell
git add -- supabase/Migrations/043_product_shelf_and_import_locations.sql supabase/catch-up.sql lib/supabase/database.types.ts lib/products/schemas.ts lib/products/schemas.test.ts
git commit -m "feat(products): add shelf and import stock locations"
```

### Task 2: Product create, edit, and read surfaces

**Files:**
- Modify: `lib/products/actions.ts`
- Modify: `lib/products/queries.ts`
- Modify: `components/products/product-form.tsx`
- Modify: `app/(admin)/products/page.tsx`
- Modify: `app/(admin)/products/[id]/page.tsx`

**Interfaces:**
- Consumes: `productSchema.shelfLocation` and `products.shelf_location` from Task 1.
- Produces: `ProductListRow.shelfLocation`, `ProductDetail.shelfLocation`, a New/Edit Product field named `shelfLocation`, and visible shelf text on product views.

- [ ] **Step 1: Extend the action payload**

Parse `nullableTextOf(formData, "shelfLocation")`, destructure `shelfLocation`, and map it to `shelf_location` in the existing insert/update values:

```ts
const values = {
  name,
  category_id: categoryId,
  brand_id: brandId,
  gender,
  description,
  image_url: imageUrl,
  shelf_location: shelfLocation,
  is_active: isActive,
}
```

- [ ] **Step 2: Carry shelf through product queries**

Select `shelf_location` in `listProducts` and `getProduct`, then map it to `shelfLocation: row.shelf_location` on both public DTOs.

- [ ] **Step 3: Add the form and display**

Add an optional text input with `name="shelfLocation"`, label **Shelf location**, placeholder `e.g. A12 or Shelf B3`, and `defaultValue={product?.shelfLocation ?? ""}`. Display the value under the product name on the list and in the product detail summary; omit the secondary line when blank.

- [ ] **Step 4: Verify product surfaces**

Run: `npm test -- lib/products/schemas.test.ts && npm run typecheck`

Expected: both commands exit 0.

- [ ] **Step 5: Commit product surfaces**

```powershell
git add -- lib/products/actions.ts lib/products/queries.ts components/products/product-form.tsx 'app/(admin)/products/page.tsx' 'app/(admin)/products/[id]/page.tsx'
git commit -m "feat(products): manage shelf locations"
```

### Task 3: Excel template and validation

**Files:**
- Modify: `lib/import/columns.ts`
- Modify: `lib/import/columns.test.ts`
- Modify: `lib/import/validate.ts`
- Modify: `lib/import/validate.test.ts`
- Modify: `components/import/import-wizard.tsx`

**Interfaces:**
- Consumes: spreadsheet headers and one raw row per location allocation.
- Produces: `ImportField` keys `shelfLocation` and `location`, `StockLocationName = "Shop" | "Warehouse"`, `parseStockLocation`, and validated rows carrying both values.

- [ ] **Step 1: Write failing column tests**

```ts
expect(TEMPLATE_HEADERS).toContain("Shelf Location")
expect(TEMPLATE_HEADERS).toContain("Location")
expect(parseStockLocation(undefined)).toBe("Shop")
expect(parseStockLocation(" warehouse ")).toBe("Warehouse")
expect(parseStockLocation("Back room")).toBeNull()
```

- [ ] **Step 2: Run the column tests to verify RED**

Run: `npm test -- lib/import/columns.test.ts`

Expected: FAIL because the fields and parser do not exist.

- [ ] **Step 3: Implement the template contract**

Append **Shelf Location** and **Location** to `IMPORT_FIELDS`, add aliases, implement:

```ts
export type StockLocationName = "Shop" | "Warehouse"
export function parseStockLocation(value: string | undefined): StockLocationName | null {
  const key = normaliseKey(value ?? "")
  if (key === "") return "Shop"
  if (key === "shop" || key === "shop floor") return "Shop"
  if (key === "warehouse") return "Warehouse"
  return null
}
```

Extend every sample row with a shelf and one of the two location labels. Update `ImportWizard.downloadTemplate` column widths so Shelf Location and Location are visible in the downloaded workbook.

- [ ] **Step 4: Run the column tests to verify GREEN**

Run: `npm test -- lib/import/columns.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing validation tests**

Add tests proving blank Location becomes Shop, Warehouse is accepted, unknown values are rejected, duplicate barcode rows for the same product/size/colour are allowed across Shop/Warehouse, different variants still reject duplicate barcodes, and conflicting price or shelf values for a repeated variant are rejected.

- [ ] **Step 6: Run validation tests to verify RED**

Run: `npm test -- lib/import/validate.test.ts`

Expected: FAIL on missing `location`/`shelfLocation` behavior and same-variant duplicate barcodes.

- [ ] **Step 7: Implement validation and preview**

Add `shelfLocation: string | null` and `location: StockLocationName` to `ValidatedRow`. Key repeated variants by normalized category, product, size type/label, and colour. Store barcode sightings as `{ rowNumber, variantKey }`; allow the same barcode only for the same variant key. Post-process repeated variants/products to add explicit conflict errors. Add Shelf and Location columns to preview and error CSV, and include both fields in `CommitRow` conversion.

- [ ] **Step 8: Run import tests to verify GREEN**

Run: `npm test -- lib/import/columns.test.ts lib/import/validate.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the client-side import contract**

```powershell
git add -- lib/import/columns.ts lib/import/columns.test.ts lib/import/validate.ts lib/import/validate.test.ts components/import/import-wizard.tsx
git commit -m "feat(import): map shelf and stock location columns"
```

### Task 4: Location-aware import commit

**Files:**
- Create: `lib/import/actions.test.ts`
- Modify: `lib/import/actions.ts`

**Interfaces:**
- Consumes: `CommitRow.shelfLocation` and `CommitRow.location` from Task 3, active `stock_locations`, and `record_stock_movement_at`.
- Produces: one product/variant for repeated rows and one location-aware stock movement per positive quantity.

- [ ] **Step 1: Write the failing import action test**

Use the existing Vitest Supabase fake pattern to feed two rows for the same variant: Shop quantity 10 and Warehouse quantity 100. Assert the observable result reports one created variant and `stockAdded: 110`, while recorded RPC payloads are:

```ts
[
  ["record_stock_movement_at", expect.objectContaining({ p_qty: 10, p_location_id: 1 })],
  ["record_stock_movement_at", expect.objectContaining({ p_qty: 100, p_location_id: 2 })],
]
```

- [ ] **Step 2: Run the action test to verify RED**

Run: `npm test -- lib/import/actions.test.ts`

Expected: FAIL because the action still calls `record_stock_movement` and ignores the two fields.

- [ ] **Step 3: Implement server-side location resolution**

Extend `CommitRow`, load active `stock_locations` once per chunk, normalize names, and fail the chunk when Shop or Warehouse cannot be resolved. For each positive quantity call:

```ts
await supabase.rpc("record_stock_movement_at", {
  p_variant_id: variantId,
  p_type: "import",
  p_qty: row.quantity,
  p_location_id: locationIds.get(row.location),
  p_reference_type: "excel_import",
  p_notes: `Imported from spreadsheet row ${row.rowNumber}`,
})
```

When resolving products, insert `shelf_location` for new products and update an existing product only when the imported shelf is non-null. Keep the variant lookup before insert so the second location row reuses the first variant.

- [ ] **Step 4: Run import action and client tests to verify GREEN**

Run: `npm test -- lib/import/actions.test.ts lib/import/columns.test.ts lib/import/validate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the import write path**

```powershell
git add -- lib/import/actions.ts lib/import/actions.test.ts
git commit -m "feat(import): allocate stock to Shop or Warehouse"
```

### Task 5: Till catalogue and read-only stock API

**Files:**
- Modify: `lib/pos/queries.ts`
- Create: `lib/pos/stock-check.ts`
- Modify: `lib/pos/stock-check.test.ts`
- Create: `app/api/till/stock-check/route.ts`
- Create: `app/api/till/stock-check/route.test.ts`

**Interfaces:**
- Consumes: `products.shelf_location`, active locations, `stock_by_location`, and authenticated `TillClient`.
- Produces: catalogue `shelfLocation` and `{ ok, productId, locations: [{ id, name, quantities: [{ variantId, qty }] }] }`.

- [ ] **Step 1: Complete the already-red stock grouping test**

The existing test asserts that `groupStockByLocation` keeps Warehouse even when it has no balance row. Extend it to ignore null ids and normalize null quantities to zero.

- [ ] **Step 2: Implement and verify the stock loader**

Create `groupStockByLocation` and `loadProductStock`. Query active locations ordered default-first/name and balance rows filtered by product id. Run `npm test -- lib/pos/stock-check.test.ts` and expect PASS.

- [ ] **Step 3: Write and run failing route tests**

Test that missing, zero, negative, and decimal product ids return 400, an unauthenticated response passes through, and a valid id returns the grouped payload. Run `npm test -- app/api/till/stock-check/route.test.ts` and expect FAIL because the route is absent.

- [ ] **Step 4: Implement the authenticated route**

Authenticate with `requireTillSession`, validate `/^[1-9]\d*$/`, call `loadProductStock(session.supabase, productId)`, and return `apiError("Choose a product to check.", 400)` for invalid input.

- [ ] **Step 5: Add shelf to catalogue mapping**

Select `products.shelf_location`, add `shelfLocation: string | null` to `CatalogVariant`, and map it from the embedded product row.

- [ ] **Step 6: Verify and commit server contracts**

Run: `npm test -- lib/pos/stock-check.test.ts app/api/till/stock-check/route.test.ts && npm run typecheck`

Expected: all commands exit 0.

```powershell
git add -- lib/pos/queries.ts lib/pos/stock-check.ts lib/pos/stock-check.test.ts app/api/till/stock-check/route.ts app/api/till/stock-check/route.test.ts
git commit -m "feat(till): expose shelf and location stock"
```

### Task 6: Android data, Room migration, and local search

**Files:**
- Modify: `till-android/app/src/main/java/mu/kidscorner/till/data/Catalog.kt`
- Modify: `till-android/app/src/main/java/mu/kidscorner/till/data/TillApi.kt`
- Modify: `till-android/app/src/main/java/mu/kidscorner/till/data/TillRepository.kt`
- Modify: `till-android/app/src/main/java/mu/kidscorner/till/TillViewModel.kt`
- Create: `till-android/app/src/main/java/mu/kidscorner/till/ui/StockCheckSearch.kt`
- Create: `till-android/app/src/test/java/mu/kidscorner/till/ui/StockCheckSearchTest.kt`

**Interfaces:**
- Consumes: catalogue/stock API contracts from Task 5.
- Produces: cached `CatalogVariant.shelfLocation`, Room migration 3→4, serializable stock DTOs, repository request, local grouped search, and stock-check ViewModel state.

- [ ] **Step 1: Write failing Android search tests**

Build literal catalogue fixtures and assert: product-name matching groups every variant; SKU substring finds a product; exact barcode returns that product first with `barcodeMatch = true`; blank input returns no groups; and `quantityAt(location, variantId)` returns zero when absent.

- [ ] **Step 2: Run Android tests to verify RED**

Run: `till-android/gradlew.bat :app:testDebugUnitTest --tests mu.kidscorner.till.ui.StockCheckSearchTest`

Expected: FAIL because search/quantity helpers do not exist.

- [ ] **Step 3: Implement local search and quantity lookup**

Create `StockCheckProduct(productId, productName, shelfLocation, variants, barcodeMatch)`, `stockCheckMatches(query, catalog)`, and `quantityAt(location, variantId)`. Exact barcode equality precedes case-insensitive product/SKU/barcode substring matching; cap groups at 30.

- [ ] **Step 4: Run Android tests to verify GREEN**

Run the same Gradle test command and expect PASS.

- [ ] **Step 5: Add Android API and persistence types**

Add nullable/defaulted `shelfLocation` to `CatalogVariant`, increase `TillDatabase` to version 4, and add `MIGRATION_3_4`:

```kotlin
database.execSQL("ALTER TABLE catalog ADD COLUMN shelfLocation TEXT")
```

Register it in the Room builder. Add serializable `StockCheckQuantity`, `StockCheckLocation`, and `StockCheckResponse`, plus `TillApi.stockCheck(token, productId)` and `TillRepository.stockCheck(productId)` through `authed`.

- [ ] **Step 6: Add ViewModel state without touching the basket**

Add `TillScreen.StockCheck(cashier)`, `StockCheckUiState(productId, locations, loading, error)`, and `TillState.stockCheck`. Implement `openStockCheck`, `selectStockProduct`, `retryStockCheck`, and `closeStockCheck`; none may assign `lines`, `customer`, `discount`, or `note`.

- [ ] **Step 7: Compile and commit Android data/state**

Run: `till-android/gradlew.bat :app:testDebugUnitTest :app:compileDebugKotlin`

Expected: BUILD SUCCESSFUL.

```powershell
git add -- till-android/app/src/main/java/mu/kidscorner/till/data/Catalog.kt till-android/app/src/main/java/mu/kidscorner/till/data/TillApi.kt till-android/app/src/main/java/mu/kidscorner/till/data/TillRepository.kt till-android/app/src/main/java/mu/kidscorner/till/TillViewModel.kt till-android/app/src/main/java/mu/kidscorner/till/ui/StockCheckSearch.kt till-android/app/src/test/java/mu/kidscorner/till/ui/StockCheckSearchTest.kt till-android/app/schemas
git commit -m "feat(android): add stock check data flow"
```

### Task 7: Android Stock Check UI and navigation

**Files:**
- Create: `till-android/app/src/main/java/mu/kidscorner/till/ui/StockCheckScreen.kt`
- Modify: `till-android/app/src/main/java/mu/kidscorner/till/ui/SellScreen.kt`
- Modify: `till-android/app/src/main/java/mu/kidscorner/till/MainActivity.kt`
- Modify: `till-android/app/src/debug/java/mu/kidscorner/till/debug/GalleryActivity.kt`

**Interfaces:**
- Consumes: Android state/actions/search from Task 6.
- Produces: the approved labelled button and separate responsive Stock Check screen.

- [ ] **Step 1: Add the selling-screen button**

Add `onOpenStockCheck: () -> Unit` to `SellScreen`. Place a labelled button using the approved burgundy treatment beside scan/custom controls, with Boxes/Inventory icon and text **Stock check**. Update every preview/gallery call site.

- [ ] **Step 2: Implement the screen from the approved canvas**

Create `StockCheckScreen` with Back, title/live state, focused name/SKU/barcode field, Search and Scan actions, selected product summary, shelf location, variant rows, Shop/Warehouse/Total quantities, loading, retryable network error, and no-results state. Use `stockCheckMatches` for local results and `quantityAt` for explicit zeroes.

- [ ] **Step 3: Wire MainActivity navigation**

Pass `vm::openStockCheck` into Selling and render Stock Check with `vm::selectStockProduct`, `vm::retryStockCheck`, and `vm::closeStockCheck` for `TillScreen.StockCheck`.

- [ ] **Step 4: Build and commit the Android UI**

Run: `till-android/gradlew.bat testDebugUnitTest assembleDebug -PapiOrigin=http://10.0.2.2:3001`

Expected: BUILD SUCCESSFUL.

```powershell
git add -- till-android/app/src/main/java/mu/kidscorner/till/ui/StockCheckScreen.kt till-android/app/src/main/java/mu/kidscorner/till/ui/SellScreen.kt till-android/app/src/main/java/mu/kidscorner/till/MainActivity.kt till-android/app/src/debug/java/mu/kidscorner/till/debug/GalleryActivity.kt
git commit -m "feat(android): add Stock Check screen"
```

### Task 8: Test database, full verification, and emulator

**Files:**
- Verify all changed files; no additional planned production code.

**Interfaces:**
- Consumes: completed migration, web app, and debug APK.
- Produces: verified test database schema/data, automated evidence, and an emulator screenshot of the working flow.

- [ ] **Step 1: Run fresh complete web verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build`

Expected: every command exits 0 with zero failed tests and zero lint errors.

- [ ] **Step 2: Run fresh complete Android verification**

Run: `till-android/gradlew.bat clean testDebugUnitTest assembleDebug -PapiOrigin=http://10.0.2.2:3001`

Expected: BUILD SUCCESSFUL with no failed unit tests.

- [ ] **Step 3: Apply and verify the migration on the confirmed test database**

Apply `043_product_shelf_and_import_locations` once through the Supabase migration tool. Then run:

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'products' and column_name = 'shelf_location';
select name, is_default, is_active from public.stock_locations order by name;
```

Expected: one `shelf_location` row and active `Shop`/`Warehouse` locations, with Shop default.

- [ ] **Step 4: Start the local API and check auth boundary**

Start `npm run dev -- -p 3001` on `0.0.0.0`. Request `/api/till/stock-check?productId=1` without a token and expect HTTP 401 JSON, proving the route is reachable and authenticated.

- [ ] **Step 5: Launch and exercise the emulator**

Start an available AVD, wait until `adb shell getprop sys.boot_completed` returns `1`, install the debug APK with `adb install -r`, and launch `mu.kidscorner.till/.MainActivity`. Use the existing test till session, tap **Stock check**, search/scan a real catalogue product, verify shelf plus Shop/Warehouse/Total figures, press Back, and confirm the prior basket remains.

- [ ] **Step 6: Capture evidence and review scope**

Save an emulator screenshot outside the repository, inspect it visually, run `git diff --check`, and confirm `git status --short` contains no secrets, APKs, emulator state, or unrelated files.
