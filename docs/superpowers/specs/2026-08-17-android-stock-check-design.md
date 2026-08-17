# Android Stock Check and Shelf Location Design

## Goal

Add a **Stock check** workflow to the Android till, introduce one optional shelf-location field for each product, and let Excel imports allocate opening stock to either **Shop** or **Warehouse**. A staff member can type a product name, SKU, or barcode, or scan a barcode, then see the product’s variants, shelf location, shop-wide total, and live stock at both locations.

## Scope

This change includes:

- a product-level `shelf_location` text field;
- separate **Shelf Location** and **Location** fields in the Excel template, validation, preview, and import write path;
- the fixed stock locations **Shop** and **Warehouse**;
- New Product, product editing, product details, and catalogue queries;
- the authenticated Android catalogue and stock-check APIs;
- the Android Stock Check button, search/scan screen, and result display.

It does not create another stock-location table, change stock movement rules, put shelf locations on receipts or customer price labels, or assign separate shelf locations to size/colour variants.

## Shelf-location data model

`products.shelf_location` is an optional trimmed text value. Examples include `A12`, `Shelf B3`, and `Front wall`. It applies to every variant of the product.

Existing products remain valid with a null shelf location. Existing spreadsheets remain valid because the new import column is optional. Empty spreadsheet cells import as null.

The Excel template has one row per variant, so a product’s shelf value repeats across its rows. Blank rows do not conflict with a non-empty value for the same product, and the non-empty value is used. Validation rejects a spreadsheet that gives the same product two different non-empty shelf locations; it does not silently pick the first or last value.

The New Product form collects shelf location with the other product-level details. The same field is editable on the product details page. Product queries carry the field to the product list/details and the till catalogue. Blank values render as **Not set** only where a shelf value is expected, such as Stock Check; dense general lists may leave the secondary line blank.

## Excel stock-location field

The template has a separate **Location** column. Its accepted values are `Shop` and `Warehouse`, matched case-insensitively and normalized to those labels. A missing Location defaults to `Shop` so existing spreadsheets remain compatible. Any other non-empty value is rejected before import.

One Quantity belongs to one Location. The same product/size/colour variant may therefore appear twice: once with its Shop quantity and once with its Warehouse quantity. Those rows resolve to one database variant and create separate stock movements at the chosen locations.

Repeated rows for the same variant must agree on category, product name, size, colour, barcode, cost price, selling price, and shelf location. A repeated barcode is allowed only when those fields identify the same variant; contradictory rows are rejected rather than applied in file order.

The import preview and error report show Location. The commit path resolves the selected stock-location row server-side and calls `record_stock_movement_at`, so a client cannot attach stock to an arbitrary or inactive location id.

## Stock Check behaviour

The Android selling screen gains a labelled **Stock check** button beside the existing scan/custom controls. Opening it switches to a separate Compose screen while leaving the active basket, customer, discounts, and note untouched.

The screen focuses a search field that accepts product name, SKU, or barcode. A hardware barcode scanner behaves as a keyboard; Enter selects the product containing the exact barcode. Name and SKU matching use the catalogue already cached on the tablet, so results appear immediately.

Selecting a product displays:

- product name and shelf location;
- every active size/colour variant with SKU;
- the cached shop-wide total for each variant;
- current quantity at **Shop** and **Warehouse**, including `0` where the location view has no row.

The Back action returns to the unchanged selling session.

## Server data flow

The Android app continues to call only the authenticated Next.js till API.

`GET /api/till/catalog` includes `shelfLocation` in each cached variant. The value is repeated per variant because the Android Room catalogue is variant-shaped. The Room database version is incremented and a non-destructive migration adds a nullable `shelfLocation` column to the cached catalogue table, preserving the offline catalogue and queued sales.

`GET /api/till/stock-check?productId=<id>` accepts only a positive integer product id. It authenticates through `requireTillSession`, then reads:

- active `stock_locations`, default first and then alphabetical;
- `stock_by_location` rows filtered to the selected product.

The endpoint is read-only and available to every authenticated till role, matching catalogue access. It returns every active location, even when that location has no balance rows. The Android UI cross-references each selected variant with each location and displays zero when a balance row is absent.

No service-role key or direct Supabase access is added to Android. No stock-balance column or movement RPC change is required; the import uses the existing location-aware RPC.

## Error and offline behaviour

An invalid product id returns HTTP 400 with the till API’s normal JSON error shape. Authentication failures retain the existing token-refresh and session-ended behaviour.

If the live stock request fails, Stock Check keeps the selected product and cached shop-wide totals visible. It states that per-location figures need a connection and offers Retry. It never presents cached total stock as though it were a live location balance.

If the catalogue has no matching product, the screen shows a clear no-results state and keeps the search field ready for another scan or query.

## Database migration and generated types

A new numbered Supabase migration adds the shelf field, renames the existing default location, and creates the warehouse location:

```sql
ALTER TABLE products ADD COLUMN shelf_location TEXT;
UPDATE stock_locations SET name = 'Shop' WHERE name = 'Shop floor';
INSERT INTO stock_locations (name, is_default, is_active)
VALUES ('Warehouse', FALSE, TRUE)
ON CONFLICT (name) DO UPDATE SET is_active = TRUE;
```

The current database has one active default location named `Shop floor`; this was verified before the design was finalized. The rename preserves its id and every existing movement. The migration is otherwise additive and nullable. Current Supabase-generated TypeScript database types and the catch-up schema are updated. No new RLS policy is needed because access remains governed by the existing `products` and `stock_locations` policies.

## Testing and verification

Tests are written before production changes and observed failing for the missing behaviour.

Vitest covers:

- shelf-location import header/normalization;
- Location normalization, invalid values, and the missing-value Shop default;
- two rows for one variant creating separate Shop and Warehouse movements;
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
