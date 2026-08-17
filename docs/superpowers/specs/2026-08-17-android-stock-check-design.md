# Android Stock Check and Shelf Location Design

## Goal

Add a **Stock check** workflow to the Android till and introduce one optional shelf-location field for each product. A staff member can type a product name, SKU, or barcode, or scan a barcode, then see the product’s variants, shelf location, shop-wide total, and live stock at every active stock location.

## Scope

This change includes:

- a product-level `shelf_location` text field;
- the Excel template, validation, preview, and import write path;
- New Product, product editing, product details, and catalogue queries;
- the authenticated Android catalogue and stock-check APIs;
- the Android Stock Check button, search/scan screen, and result display.

It does not create another stock-location table, change stock movement rules, put shelf locations on receipts or customer price labels, or assign separate shelf locations to size/colour variants.

## Shelf-location data model

`products.shelf_location` is an optional trimmed text value. Examples include `A12`, `Shelf B3`, and `Front wall`. It applies to every variant of the product.

Existing products remain valid with a null shelf location. Existing spreadsheets remain valid because the new import column is optional. Empty spreadsheet cells import as null.

The Excel template has one row per variant, so a product’s shelf value repeats across its rows. Blank rows do not conflict with a non-empty value for the same product, and the non-empty value is used. Validation rejects a spreadsheet that gives the same product two different non-empty shelf locations; it does not silently pick the first or last value.

The New Product form collects shelf location with the other product-level details. The same field is editable on the product details page. Product queries carry the field to the product list/details and the till catalogue. Blank values render as **Not set** only where a shelf value is expected, such as Stock Check; dense general lists may leave the secondary line blank.

## Stock Check behaviour

The Android selling screen gains a labelled **Stock check** button beside the existing scan/custom controls. Opening it switches to a separate Compose screen while leaving the active basket, customer, discounts, and note untouched.

The screen focuses a search field that accepts product name, SKU, or barcode. A hardware barcode scanner behaves as a keyboard; Enter selects the product containing the exact barcode. Name and SKU matching use the catalogue already cached on the tablet, so results appear immediately.

Selecting a product displays:

- product name and shelf location;
- every active size/colour variant with SKU;
- the cached shop-wide total for each variant;
- current quantity at every active stock location, including `0` where the location view has no row.

The Back action returns to the unchanged selling session.

## Server data flow

The Android app continues to call only the authenticated Next.js till API.

`GET /api/till/catalog` includes `shelfLocation` in each cached variant. The value is repeated per variant because the Android Room catalogue is variant-shaped. The Room database version is incremented and a non-destructive migration adds a nullable `shelfLocation` column to the cached catalogue table, preserving the offline catalogue and queued sales.

`GET /api/till/stock-check?productId=<id>` accepts only a positive integer product id. It authenticates through `requireTillSession`, then reads:

- active `stock_locations`, default first and then alphabetical;
- `stock_by_location` rows filtered to the selected product.

The endpoint is read-only and available to every authenticated till role, matching catalogue access. It returns every active location, even when that location has no balance rows. The Android UI cross-references each selected variant with each location and displays zero when a balance row is absent.

No service-role key or direct Supabase access is added to Android. No stock schema or movement RPC changes are required.

## Error and offline behaviour

An invalid product id returns HTTP 400 with the till API’s normal JSON error shape. Authentication failures retain the existing token-refresh and session-ended behaviour.

If the live stock request fails, Stock Check keeps the selected product and cached shop-wide totals visible. It states that per-location figures need a connection and offers Retry. It never presents cached total stock as though it were a live location balance.

If the catalogue has no matching product, the screen shows a clear no-results state and keeps the search field ready for another scan or query.

## Database migration and generated types

A new numbered Supabase migration adds:

```sql
ALTER TABLE products ADD COLUMN shelf_location TEXT;
```

The migration is additive and nullable. Current Supabase-generated TypeScript database types and the catch-up schema are updated to include the field. No new RLS policy is needed because access remains governed by the existing `products` policies.

## Testing and verification

Tests are written before production changes and observed failing for the missing behaviour.

Vitest covers:

- shelf-location import header/normalization;
- conflicting shelf values for one product;
- product create/update payload mapping;
- stock-location grouping and route validation;
- catalogue mapping of `shelfLocation`.

JUnit covers:

- case-insensitive product-name and SKU search;
- exact-barcode product selection;
- blank/no-match behaviour;
- missing location quantities resolving to zero.

Completion requires the full web test, typecheck, and lint commands plus Android unit tests and a debug APK build. The debug APK is installed and launched in an emulator against the local Next.js API. The emulator check opens Stock Check, exercises a typed or scan-equivalent query, verifies shelf/location quantities are visible, returns to Selling, and confirms the basket was not changed.
