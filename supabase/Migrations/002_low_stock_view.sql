-- ============================================================
-- Kids Corner — migration 002: low stock view
--
-- Why this exists: the low-stock tab needs `qty_on_hand <= reorder_level`,
-- which compares two columns. PostgREST filters only compare a column to a
-- literal, so without this the app would have to download every variant and
-- filter in JS — and an unfiltered select is silently capped at max-rows
-- (1000 on Supabase), so the tab would quietly go wrong on a real catalog.
--
-- Migration 001 is left untouched, per the project conventions.
--
-- `security_invoker = on` matters: without it the view would run with the
-- owner's rights and bypass the RLS on product_variants. With it, the caller's
-- policies still apply, so the view is exactly as safe as a direct query.
-- ============================================================

CREATE OR REPLACE VIEW low_stock_variants
WITH (security_invoker = on) AS
SELECT
    pv.id            AS variant_id,
    pv.product_id,
    pv.sku,
    pv.barcode,
    pv.qty_on_hand,
    pv.reorder_level,
    pv.selling_price,
    pv.cost_price,
    p.name           AS product_name,
    s.label          AS size_label,
    s.size_type,
    c.name           AS colour_name,
    c.hex_code       AS colour_hex
FROM product_variants pv
JOIN products p ON p.id = pv.product_id
JOIN sizes    s ON s.id = pv.size_id
JOIN colours  c ON c.id = pv.colour_id
WHERE pv.is_active
  AND p.is_active
  AND pv.qty_on_hand <= pv.reorder_level;
