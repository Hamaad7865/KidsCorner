-- ============================================================
-- Kids Corner — migration 006: module access + stock locations
--
-- TWO FEATURES, TWO IMPORTANT CONSTRAINTS.
--
-- 1. MODULE ACCESS is a *visibility* layer, not a security boundary.
--    RLS in 001 is what actually protects data: a cashier cannot write to
--    products because the policy says so, not because a menu item is hidden.
--    This table decides what a role is SHOWN, and the proxy honours it so a
--    hidden page is not reachable by typing the URL. It can only ever restrict
--    further than RLS already does — granting a module here does not grant a
--    single database permission.
--
-- 2. STOCK LOCATIONS are an attribute of each MOVEMENT, not a second set of
--    balances. `product_variants.qty_on_hand` stays the shop-wide total, and
--    per-location figures are DERIVED from the ledger by the view below.
--    Making qty_on_hand per-location would mean rewriting record_stock_movement
--    and complete_sale — both live in 001 and are deliberately untouched. A
--    trigger stamps the default location onto rows those RPCs insert, so every
--    movement is located without either of them knowing locations exist.
--
-- Migrations 001-005 are untouched.
-- ============================================================

-- ===== Module access =====

CREATE TABLE IF NOT EXISTS module_access (
    id        SERIAL PRIMARY KEY,
    role      TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
    module    TEXT NOT NULL,
    can_view  BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (role, module)
);

ALTER TABLE module_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_all ON module_access;
-- Everyone reads it: the nav has to know what to draw for the current user.
CREATE POLICY read_all ON module_access FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS manage ON module_access;
CREATE POLICY manage ON module_access FOR ALL TO authenticated
    USING (current_role_of_user() = 'owner');

-- Defaults reproduce today's behaviour exactly, so applying this migration
-- changes nothing until somebody edits it: owner and manager see the whole back
-- office, cashiers see only the till.
INSERT INTO module_access (role, module, can_view) VALUES
    ('owner','dashboard',TRUE), ('owner','products',TRUE), ('owner','import',TRUE),
    ('owner','stock',TRUE), ('owner','purchases',TRUE), ('owner','suppliers',TRUE),
    ('owner','sales',TRUE), ('owner','reports',TRUE), ('owner','customers',TRUE),
    ('owner','settings',TRUE), ('owner','pos',TRUE),
    ('manager','dashboard',TRUE), ('manager','products',TRUE), ('manager','import',TRUE),
    ('manager','stock',TRUE), ('manager','purchases',TRUE), ('manager','suppliers',TRUE),
    ('manager','sales',TRUE), ('manager','reports',TRUE), ('manager','customers',TRUE),
    ('manager','settings',TRUE), ('manager','pos',TRUE),
    ('cashier','dashboard',FALSE), ('cashier','products',FALSE), ('cashier','import',FALSE),
    ('cashier','stock',FALSE), ('cashier','purchases',FALSE), ('cashier','suppliers',FALSE),
    ('cashier','sales',FALSE), ('cashier','reports',FALSE), ('cashier','customers',FALSE),
    ('cashier','settings',FALSE), ('cashier','pos',TRUE)
ON CONFLICT (role, module) DO NOTHING;

-- The till is not optional for anyone: a role locked out of every module could
-- sign in and reach nothing at all, with no way back short of SQL.
CREATE OR REPLACE FUNCTION guard_pos_access()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.module = 'pos' AND NEW.can_view = FALSE THEN
        RAISE EXCEPTION 'The till cannot be hidden from a role';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_module_access_pos ON module_access;
CREATE TRIGGER trg_module_access_pos
    BEFORE INSERT OR UPDATE ON module_access
    FOR EACH ROW EXECUTE FUNCTION guard_pos_access();

-- ===== Stock locations =====

CREATE TABLE IF NOT EXISTS stock_locations (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- At most one default, enforced by the index rather than by hoping.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_locations_one_default
    ON stock_locations (is_default) WHERE is_default;

ALTER TABLE stock_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_all ON stock_locations;
CREATE POLICY read_all ON stock_locations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS manage ON stock_locations;
CREATE POLICY manage ON stock_locations FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));

INSERT INTO stock_locations (name, is_default) VALUES ('Shop floor', TRUE)
ON CONFLICT (name) DO NOTHING;

-- Additive column: nullable, so every INSERT written before this migration
-- still compiles and runs unchanged.
ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS location_id INT REFERENCES stock_locations(id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_location
    ON stock_movements (location_id, created_at);

-- Stamps the default location on any movement inserted without one. This is
-- what lets record_stock_movement and complete_sale in 001 stay untouched while
-- every row still ends up located.
CREATE OR REPLACE FUNCTION default_movement_location()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.location_id IS NULL THEN
        SELECT id INTO NEW.location_id
        FROM stock_locations WHERE is_default LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_movements_location ON stock_movements;
CREATE TRIGGER trg_stock_movements_location
    BEFORE INSERT ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION default_movement_location();

-- Backfill rows that predate the column, so the view below balances.
UPDATE stock_movements
   SET location_id = (SELECT id FROM stock_locations WHERE is_default LIMIT 1)
 WHERE location_id IS NULL;

-- ===== record_stock_movement_at =====
-- Locations-aware sibling of the 001 RPC. That one is left exactly as it is;
-- this adds a location and is what the app calls when the user picks one.
CREATE OR REPLACE FUNCTION record_stock_movement_at(
    p_variant_id INT,
    p_type TEXT,
    p_qty INT,
    p_location_id INT,
    p_reference_type TEXT DEFAULT NULL,
    p_reference_id BIGINT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_id BIGINT;
BEGIN
    INSERT INTO stock_movements (variant_id, movement_type, qty, location_id,
            reference_type, reference_id, notes, created_by)
    VALUES (p_variant_id, p_type, p_qty, p_location_id,
            p_reference_type, p_reference_id, p_notes, auth.uid())
    RETURNING id INTO v_id;

    -- qty_on_hand stays the shop-wide total, exactly as the 001 RPC maintains
    -- it. Per-location balances are derived, never cached.
    UPDATE product_variants
       SET qty_on_hand = qty_on_hand + p_qty
     WHERE id = p_variant_id;

    RETURN v_id;
END;
$$;

-- ===== transfer_stock =====
-- Moving stock between locations must not change the shop-wide total, so it is
-- a matched pair of movements rather than two independent calls that could
-- half-fail.
CREATE OR REPLACE FUNCTION transfer_stock(
    p_variant_id INT,
    p_qty INT,
    p_from_location INT,
    p_to_location INT,
    p_notes TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'A transfer needs a positive quantity';
    END IF;
    IF p_from_location = p_to_location THEN
        RAISE EXCEPTION 'Pick two different locations';
    END IF;

    -- Out of one, into the other. Net effect on qty_on_hand is zero, which is
    -- correct: the goods have not left the shop.
    INSERT INTO stock_movements (variant_id, movement_type, qty, location_id,
            reference_type, notes, created_by)
    VALUES (p_variant_id, 'adjustment', -p_qty, p_from_location,
            'transfer', coalesce(p_notes, 'Transfer out'), auth.uid());

    INSERT INTO stock_movements (variant_id, movement_type, qty, location_id,
            reference_type, notes, created_by)
    VALUES (p_variant_id, 'adjustment', p_qty, p_to_location,
            'transfer', coalesce(p_notes, 'Transfer in'), auth.uid());
END;
$$;

-- ===== stock_by_location =====
-- Derived balances. security_invoker keeps the caller's RLS in force.
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
          p.id, p.name, s.label, c.name, c.hex_code
-- A location that has netted to zero is not worth a row.
HAVING sum(sm.qty) <> 0;
