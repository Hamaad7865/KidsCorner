-- ============================================================
-- Kids Corner — migration 046: zero-balance locations stay visible
--
-- THE DEFECT. stock_by_location (006) ended with HAVING sum(sm.qty) <> 0, so
-- a location that netted to exactly zero lost its row. The till and the
-- back office then could not tell "checked and empty" from "never checked":
-- Warehouse read as missing rather than as zero.
--
-- THE FIX. Drop the HAVING clause. A variant+location pair that nets to zero
-- now returns a row with qty_on_hand = 0. Pairs with no movement at all still
-- have no row — the app treats a missing pair as zero explicitly (see
-- lib/pos/stock-check.ts groupStockByLocation), so both cases read as zero
-- rather than as unchecked.
--
-- Migrations 001-045 are untouched.
-- ============================================================

CREATE OR REPLACE VIEW stock_by_location
WITH (security_invoker = on) AS
SELECT sm.location_id,
       sl.name AS location_name,
       sm.variant_id,
       pv.sku,
       p.id   AS product_id,
       p.name AS product_name,
       s.label AS size_label,
       c.name  AS colour_name,
       c.hex_code AS colour_hex,
       sum(sm.qty)::INT AS qty_on_hand
  FROM stock_movements sm
  JOIN stock_locations sl ON sl.id = sm.location_id
  JOIN product_variants pv ON pv.id = sm.variant_id
  JOIN products p ON p.id = pv.product_id
  JOIN sizes s ON s.id = pv.size_id
  JOIN colours c ON c.id = pv.colour_id
 GROUP BY sm.location_id, sl.name, sm.variant_id, pv.sku,
          p.id, p.name, s.label, c.name, c.hex_code;
-- No HAVING: zero-net rows are kept so "empty" stays distinguishable from
-- "never stocked". See 046 header above.
