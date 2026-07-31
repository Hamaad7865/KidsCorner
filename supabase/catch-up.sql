-- ============================================================
-- Kids Corner — catch-up migration
--
-- Every migration to date, rewritten to be IDEMPOTENT. Run it on a fresh
-- project or on one that is already half set up; it will bring the database to
-- the current schema either way and can be re-run any number of times.
--
-- Currently covers:
--   001_initial_schema.sql
--   002_low_stock_view.sql
--   003_till_and_reporting.sql
--   004_credit_notes.sql
--   005_discounts.sql
--   006_access_and_locations.sql
--   007_barcodes.sql
--   008_barcode_scheme_guard.sql
--   009_stock_floor_and_sale_no.sql
--   010_pin_lockout.sql
--   011_sale_idempotency.sql
--   012_receipt_prints.sql
--
-- When a new migration is added, append it here in the same idempotent style.
-- The numbered files stay the historical record; this file is the one you run.
--
-- How it stays safe to re-run:
--   * CREATE TABLE / INDEX     -> IF NOT EXISTS
--   * CREATE FUNCTION          -> OR REPLACE
--   * ENABLE ROW LEVEL SECURITY-> already idempotent in Postgres
--   * CREATE POLICY            -> has no IF NOT EXISTS, so each one is dropped
--                                 first (DROP POLICY IF EXISTS)
--   * Seed data                -> ON CONFLICT DO NOTHING
--
-- LIMITATION worth knowing: `CREATE TABLE IF NOT EXISTS` does nothing if the
-- table already exists, even when its columns differ. This file will not
-- retro-fit a column onto a table you altered by hand. It is a catch-up, not a
-- reconciler.
--
-- Usage: Supabase dashboard -> SQL Editor -> paste -> Run.
-- ============================================================

-- ===== Profiles (linked to Supabase Auth) =====

CREATE TABLE IF NOT EXISTS profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name   TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'cashier'
                CHECK (role IN ('owner', 'manager', 'cashier')),
    pin_code    TEXT,                    -- 4-digit PIN for POS switching (hashed in app)
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helper: current user's role (used by RLS policies)
CREATE OR REPLACE FUNCTION current_role_of_user()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- ===== Master data =====

CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    parent_id   INT REFERENCES categories(id),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS brands (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sizes (
    id          SERIAL PRIMARY KEY,
    size_type   TEXT NOT NULL CHECK (size_type IN ('age_range', 'shoe_size')),
    label       TEXT NOT NULL,           -- '2-3 yrs', 'EU 24'
    sort_order  INT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (size_type, label)
);

CREATE TABLE IF NOT EXISTS colours (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    hex_code    TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS suppliers (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    phone       TEXT,
    email       TEXT,
    address     TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS customers (
    id          SERIAL PRIMARY KEY,
    full_name   TEXT NOT NULL,
    phone       TEXT UNIQUE,
    email       TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,        -- 'shop_name', 'vat_rate', ...
    value       JSONB NOT NULL
);

INSERT INTO settings (key, value) VALUES
    ('shop_name',       '"Kids Corner"'),
    ('vat_rate',        '0.15'),
    ('currency',        '"MUR"'),
    ('payment_methods', '["cash","card","juice","myt_money"]')
ON CONFLICT (key) DO NOTHING;

-- ===== Catalog =====

CREATE TABLE IF NOT EXISTS products (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    category_id INT NOT NULL REFERENCES categories(id),
    brand_id    INT REFERENCES brands(id),
    gender      TEXT NOT NULL DEFAULT 'unisex'
                CHECK (gender IN ('boy', 'girl', 'unisex')),
    description TEXT,
    image_url   TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_variants (
    id              SERIAL PRIMARY KEY,
    product_id      INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    size_id         INT NOT NULL REFERENCES sizes(id),
    colour_id       INT NOT NULL REFERENCES colours(id),
    sku             TEXT NOT NULL UNIQUE,
    barcode         TEXT UNIQUE,
    cost_price      NUMERIC(10,2) NOT NULL DEFAULT 0,
    selling_price   NUMERIC(10,2) NOT NULL,
    qty_on_hand     INT NOT NULL DEFAULT 0,   -- cached; movements are the truth
    reorder_level   INT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (product_id, size_id, colour_id)
);

CREATE INDEX IF NOT EXISTS idx_variants_barcode ON product_variants (barcode);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id);

-- ===== Stock =====

CREATE TABLE IF NOT EXISTS stock_movements (
    id              BIGSERIAL PRIMARY KEY,
    variant_id      INT NOT NULL REFERENCES product_variants(id),
    movement_type   TEXT NOT NULL CHECK (movement_type IN
                    ('purchase', 'sale', 'adjustment', 'return', 'opening', 'import')),
    qty             INT NOT NULL,        -- positive = in, negative = out
    reference_type  TEXT,
    reference_id    BIGINT,
    notes           TEXT,
    created_by      UUID REFERENCES profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_variant
    ON stock_movements (variant_id, created_at);

-- ===== Purchasing =====

CREATE TABLE IF NOT EXISTS purchases (
    id              SERIAL PRIMARY KEY,
    supplier_id     INT NOT NULL REFERENCES suppliers(id),
    invoice_no      TEXT,
    purchase_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'received', 'cancelled')),
    total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes           TEXT,
    created_by      UUID REFERENCES profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id              SERIAL PRIMARY KEY,
    purchase_id     INT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    variant_id      INT NOT NULL REFERENCES product_variants(id),
    qty             INT NOT NULL CHECK (qty > 0),
    unit_cost       NUMERIC(10,2) NOT NULL,
    line_total      NUMERIC(12,2) GENERATED ALWAYS AS (qty * unit_cost) STORED
);

-- ===== Shifts =====

CREATE TABLE IF NOT EXISTS shifts (
    id              SERIAL PRIMARY KEY,
    opened_by       UUID NOT NULL REFERENCES profiles(id),
    opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    opening_float   NUMERIC(10,2) NOT NULL DEFAULT 0,
    closed_by       UUID REFERENCES profiles(id),
    closed_at       TIMESTAMPTZ,
    counted_cash    NUMERIC(10,2),
    expected_cash   NUMERIC(10,2),
    variance        NUMERIC(10,2),
    notes           TEXT
);

-- ===== Sales =====

CREATE TABLE IF NOT EXISTS sales (
    id              BIGSERIAL PRIMARY KEY,
    sale_no         TEXT NOT NULL UNIQUE,
    shift_id        INT REFERENCES shifts(id),
    customer_id     INT REFERENCES customers(id),
    sale_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
    subtotal        NUMERIC(12,2) NOT NULL,
    discount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    vat_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    total           NUMERIC(12,2) NOT NULL,
    status          TEXT NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('completed', 'refunded', 'void')),
    cashier_id      UUID REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS sale_items (
    id              BIGSERIAL PRIMARY KEY,
    sale_id         BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    variant_id      INT NOT NULL REFERENCES product_variants(id),
    qty             INT NOT NULL CHECK (qty > 0),
    unit_price      NUMERIC(10,2) NOT NULL,
    discount        NUMERIC(10,2) NOT NULL DEFAULT 0,
    line_total      NUMERIC(12,2) NOT NULL
);

-- Split payments: one sale can have multiple payment rows
CREATE TABLE IF NOT EXISTS sale_payments (
    id              BIGSERIAL PRIMARY KEY,
    sale_id         BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method          TEXT NOT NULL CHECK (method IN ('cash', 'card', 'juice', 'myt_money')),
    amount          NUMERIC(12,2) NOT NULL,
    tendered        NUMERIC(12,2),       -- cash given (for change calc)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RPCs (atomic operations — supabase-js can't do transactions)
-- CREATE OR REPLACE is idempotent by definition.
-- ============================================================

-- Record any stock movement + keep qty_on_hand in sync
CREATE OR REPLACE FUNCTION record_stock_movement(
    p_variant_id INT,
    p_type TEXT,
    p_qty INT,
    p_reference_type TEXT DEFAULT NULL,
    p_reference_id BIGINT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_id BIGINT;
BEGIN
    INSERT INTO stock_movements (variant_id, movement_type, qty,
            reference_type, reference_id, notes, created_by)
    VALUES (p_variant_id, p_type, p_qty,
            p_reference_type, p_reference_id, p_notes, auth.uid())
    RETURNING id INTO v_id;

    UPDATE product_variants
    SET qty_on_hand = qty_on_hand + p_qty
    WHERE id = p_variant_id;

    RETURN v_id;
END;
$$;

-- Complete a POS sale atomically: sale + items + payments + stock out
-- p_items:    [{"variant_id":1,"qty":2,"unit_price":250,"discount":0}]
-- p_payments: [{"method":"cash","amount":500,"tendered":1000}]
CREATE OR REPLACE FUNCTION complete_sale(
    p_shift_id INT,
    p_customer_id INT,
    p_cashier_id UUID,
    p_discount NUMERIC,
    p_items JSONB,
    p_payments JSONB
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_sale_id   BIGINT;
    v_subtotal  NUMERIC := 0;
    v_vat_rate  NUMERIC;
    v_total     NUMERIC;
    v_item      JSONB;
    v_line      NUMERIC;
BEGIN
    SELECT (value)::NUMERIC INTO v_vat_rate FROM settings WHERE key = 'vat_rate';

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_line := (v_item->>'qty')::INT * (v_item->>'unit_price')::NUMERIC
                  - COALESCE((v_item->>'discount')::NUMERIC, 0);
        v_subtotal := v_subtotal + v_line;
    END LOOP;

    v_total := v_subtotal - COALESCE(p_discount, 0);

    INSERT INTO sales (sale_no, shift_id, customer_id, subtotal, discount,
            vat_amount, total, cashier_id)
    VALUES (
        'S' || to_char(now(), 'YYMMDD') || '-' || nextval('sales_id_seq'),
        p_shift_id, p_customer_id, v_subtotal, COALESCE(p_discount, 0),
        round(v_total - v_total / (1 + v_vat_rate), 2),  -- VAT-inclusive pricing
        v_total, p_cashier_id
    )
    RETURNING id INTO v_sale_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_line := (v_item->>'qty')::INT * (v_item->>'unit_price')::NUMERIC
                  - COALESCE((v_item->>'discount')::NUMERIC, 0);

        INSERT INTO sale_items (sale_id, variant_id, qty, unit_price, discount, line_total)
        VALUES (v_sale_id, (v_item->>'variant_id')::INT, (v_item->>'qty')::INT,
                (v_item->>'unit_price')::NUMERIC,
                COALESCE((v_item->>'discount')::NUMERIC, 0), v_line);

        PERFORM record_stock_movement(
            (v_item->>'variant_id')::INT, 'sale',
            -(v_item->>'qty')::INT, 'pos_sale', v_sale_id, NULL);
    END LOOP;

    INSERT INTO sale_payments (sale_id, method, amount, tendered)
    SELECT v_sale_id, p->>'method', (p->>'amount')::NUMERIC,
           (p->>'tendered')::NUMERIC
    FROM jsonb_array_elements(p_payments) AS p;

    RETURN v_sale_id;
END;
$$;

-- Receive a purchase: mark received + stock in every line
CREATE OR REPLACE FUNCTION receive_purchase(p_purchase_id INT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_item RECORD;
BEGIN
    UPDATE purchases SET status = 'received' WHERE id = p_purchase_id
        AND status = 'draft';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase % is not in draft status', p_purchase_id;
    END IF;

    FOR v_item IN SELECT variant_id, qty FROM purchase_items
                  WHERE purchase_id = p_purchase_id LOOP
        PERFORM record_stock_movement(v_item.variant_id, 'purchase',
                v_item.qty, 'purchase', p_purchase_id, NULL);
    END LOOP;

    -- update variant cost price to latest purchase cost
    UPDATE product_variants pv
    SET cost_price = pi.unit_cost
    FROM purchase_items pi
    WHERE pi.purchase_id = p_purchase_id AND pi.variant_id = pv.id;
END;
$$;

-- ============================================================
-- Row Level Security
-- ENABLE is idempotent; policies are dropped first because Postgres has no
-- CREATE POLICY IF NOT EXISTS.
-- ============================================================

ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sizes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE colours           ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_payments     ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read catalog + master data
DROP POLICY IF EXISTS read_all ON categories;
CREATE POLICY read_all ON categories       FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON brands;
CREATE POLICY read_all ON brands           FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON sizes;
CREATE POLICY read_all ON sizes            FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON colours;
CREATE POLICY read_all ON colours          FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON products;
CREATE POLICY read_all ON products         FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON product_variants;
CREATE POLICY read_all ON product_variants FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON customers;
CREATE POLICY read_all ON customers        FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON settings;
CREATE POLICY read_all ON settings         FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON profiles;
CREATE POLICY read_all ON profiles         FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON shifts;
CREATE POLICY read_all ON shifts           FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON sales;
CREATE POLICY read_all ON sales            FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON sale_items;
CREATE POLICY read_all ON sale_items       FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON sale_payments;
CREATE POLICY read_all ON sale_payments    FOR SELECT TO authenticated USING (true);

-- Only owner/manager can modify catalog, master data, purchases, suppliers
DROP POLICY IF EXISTS manage ON categories;
CREATE POLICY manage ON categories FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
DROP POLICY IF EXISTS manage ON brands;
CREATE POLICY manage ON brands FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
DROP POLICY IF EXISTS manage ON sizes;
CREATE POLICY manage ON sizes FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
DROP POLICY IF EXISTS manage ON colours;
CREATE POLICY manage ON colours FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
DROP POLICY IF EXISTS manage ON products;
CREATE POLICY manage ON products FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
DROP POLICY IF EXISTS manage ON product_variants;
CREATE POLICY manage ON product_variants FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
DROP POLICY IF EXISTS manage ON suppliers;
CREATE POLICY manage ON suppliers FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
DROP POLICY IF EXISTS read_suppliers ON suppliers;
CREATE POLICY read_suppliers ON suppliers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS manage ON purchases;
CREATE POLICY manage ON purchases FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
DROP POLICY IF EXISTS read_purchases ON purchases;
CREATE POLICY read_purchases ON purchases FOR SELECT TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
DROP POLICY IF EXISTS manage ON purchase_items;
CREATE POLICY manage ON purchase_items FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
DROP POLICY IF EXISTS manage ON settings;
CREATE POLICY manage ON settings FOR ALL TO authenticated
    USING (current_role_of_user() = 'owner');
DROP POLICY IF EXISTS manage_profiles ON profiles;
CREATE POLICY manage_profiles ON profiles FOR ALL TO authenticated
    USING (current_role_of_user() = 'owner');

-- Cashiers can create customers, shifts (open/close), and stock reads
DROP POLICY IF EXISTS create_customers ON customers;
CREATE POLICY create_customers ON customers FOR INSERT TO authenticated
    WITH CHECK (true);
DROP POLICY IF EXISTS manage_shifts ON shifts;
CREATE POLICY manage_shifts ON shifts FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS read_stock ON stock_movements;
CREATE POLICY read_stock ON stock_movements FOR SELECT TO authenticated
    USING (true);

-- Sales/movements are written ONLY through the SECURITY DEFINER RPCs,
-- so no direct INSERT policies on sales/sale_items/sale_payments/stock_movements.

-- ===== Starter seed data =====
-- ON CONFLICT keeps a re-run from duplicating rows or failing on the unique
-- constraints. Rows you have edited since are left exactly as they are.

INSERT INTO sizes (size_type, label, sort_order) VALUES
    ('age_range', '0-3 mths', 1), ('age_range', '3-6 mths', 2),
    ('age_range', '6-12 mths', 3), ('age_range', '1-2 yrs', 4),
    ('age_range', '2-3 yrs', 5), ('age_range', '3-4 yrs', 6),
    ('age_range', '4-5 yrs', 7), ('age_range', '5-6 yrs', 8),
    ('age_range', '7-8 yrs', 9), ('age_range', '9-10 yrs', 10),
    ('shoe_size', 'EU 19', 20), ('shoe_size', 'EU 20', 21),
    ('shoe_size', 'EU 21', 22), ('shoe_size', 'EU 22', 23),
    ('shoe_size', 'EU 23', 24), ('shoe_size', 'EU 24', 25),
    ('shoe_size', 'EU 25', 26), ('shoe_size', 'EU 26', 27),
    ('shoe_size', 'EU 27', 28), ('shoe_size', 'EU 28', 29)
ON CONFLICT (size_type, label) DO NOTHING;

INSERT INTO colours (name, hex_code) VALUES
    ('Red', '#E53935'), ('Blue', '#1E88E5'), ('Navy', '#1A237E'),
    ('Pink', '#EC407A'), ('White', '#FFFFFF'), ('Black', '#212121'),
    ('Yellow', '#FDD835'), ('Green', '#43A047'), ('Grey', '#9E9E9E'),
    ('Purple', '#8E24AA'), ('Orange', '#FB8C00'), ('Beige', '#D7CCC8')
ON CONFLICT (name) DO NOTHING;

INSERT INTO categories (name) VALUES
    ('T-Shirts'), ('Dresses'), ('Trousers'), ('Shorts'),
    ('Pyjamas'), ('Shoes'), ('Sandals'), ('Accessories')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 002 — low stock view
--
-- `qty_on_hand <= reorder_level` compares two columns, which PostgREST filters
-- cannot express. Without this the low-stock tab would have to download every
-- variant, and an unfiltered select is silently capped at max-rows.
--
-- `security_invoker = on` keeps the caller's RLS in force; without it the view
-- would run with the owner's rights and bypass the policies on
-- product_variants. CREATE OR REPLACE VIEW is idempotent.
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

-- ============================================================
-- 003 — till movements + the shift totals aggregator
--
-- Append-only cash ledger and the single aggregator behind the close screen,
-- the X-read and the Z report. Idempotent by construction: CREATE TABLE IF NOT
-- EXISTS, CREATE OR REPLACE FUNCTION, and the trigger/policy are dropped first.
-- ============================================================

-- ===== Till movements: petty cash out (and paid-ins) during a shift =====

CREATE TABLE IF NOT EXISTS till_movements (
    id          BIGSERIAL PRIMARY KEY,
    shift_id    INT NOT NULL REFERENCES shifts(id),
    -- Negative = cash out of the drawer, positive = paid in. Never zero.
    amount      NUMERIC(10,2) NOT NULL CHECK (amount <> 0),
    reason      TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    created_by  UUID REFERENCES profiles(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_till_movements_shift ON till_movements (shift_id, created_at);

-- Append-only. The drawer must always be explainable from its rows, so a
-- correction is a new opposite row rather than a quiet edit of history.
CREATE OR REPLACE FUNCTION forbid_till_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'till_movements is append-only: record a correcting movement instead';
END;
$$;

DROP TRIGGER IF EXISTS trg_till_movements_append_only ON till_movements;
CREATE TRIGGER trg_till_movements_append_only
    BEFORE UPDATE OR DELETE ON till_movements
    FOR EACH ROW EXECUTE FUNCTION forbid_till_mutation();

ALTER TABLE till_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_till_movements ON till_movements;
CREATE POLICY read_till_movements ON till_movements FOR SELECT TO authenticated
    USING (true);
-- No INSERT policy: the RPC below is the only write path, exactly as
-- stock_movements is written only through record_stock_movement.

-- ===== record_till_movement =====
-- The single write path. Refuses to take out more cash than the drawer holds,
-- because a till that reports negative cash cannot be reconciled at close.
CREATE OR REPLACE FUNCTION record_till_movement(
    p_shift_id INT,
    p_amount NUMERIC,          -- positive = paid in, negative = taken out
    p_reason TEXT
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_id            BIGINT;
    v_closed_at     TIMESTAMPTZ;
    v_float         NUMERIC;
    v_cash_in       NUMERIC;
    v_movements     NUMERIC;
    v_available     NUMERIC;
BEGIN
    IF p_amount IS NULL OR p_amount = 0 THEN
        RAISE EXCEPTION 'A till movement needs a non-zero amount';
    END IF;
    IF coalesce(trim(p_reason), '') = '' THEN
        RAISE EXCEPTION 'A reason is required for every till movement';
    END IF;

    SELECT closed_at, opening_float INTO v_closed_at, v_float
    FROM shifts WHERE id = p_shift_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift % does not exist', p_shift_id;
    END IF;
    IF v_closed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Shift % is already closed', p_shift_id;
    END IF;

    SELECT coalesce(sum(sp.amount), 0) INTO v_cash_in
    FROM sale_payments sp
    JOIN sales s ON s.id = sp.sale_id
    WHERE s.shift_id = p_shift_id
      AND s.status = 'completed'
      AND sp.method = 'cash';

    SELECT coalesce(sum(amount), 0) INTO v_movements
    FROM till_movements WHERE shift_id = p_shift_id;

    v_available := v_float + v_cash_in + v_movements;

    IF p_amount < 0 AND (v_available + p_amount) < 0 THEN
        RAISE EXCEPTION 'Only % is in the drawer; cannot take out %',
            v_available, abs(p_amount);
    END IF;

    INSERT INTO till_movements (shift_id, amount, reason, created_by)
    VALUES (p_shift_id, round(p_amount, 2), trim(p_reason), auth.uid())
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- ===== shift_totals =====
-- The ONE aggregator behind the close screen, the X-read and the Z report, so
-- those three can never disagree about the same shift.
--
-- Only 'completed' sales count: a voided or refunded ticket must not be expected
-- in the drawer.
CREATE OR REPLACE FUNCTION shift_totals(p_shift_id INT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
    v_float       NUMERIC;
    v_sale_count  INT;
    v_sales_total NUMERIC;
    v_vat_total   NUMERIC;
    v_discount    NUMERIC;
    v_items       INT;
    v_methods     JSONB;
    v_cashiers    JSONB;
    v_cash_in     NUMERIC;
    v_movements   NUMERIC;
BEGIN
    SELECT opening_float INTO v_float FROM shifts WHERE id = p_shift_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift % does not exist', p_shift_id;
    END IF;

    SELECT count(*), coalesce(sum(total), 0),
           -- Frozen per sale by complete_sale. Never re-derived from the lines:
           -- the stored figure used the rate in force when the sale happened.
           coalesce(sum(vat_amount), 0), coalesce(sum(discount), 0)
      INTO v_sale_count, v_sales_total, v_vat_total, v_discount
      FROM sales WHERE shift_id = p_shift_id AND status = 'completed';

    SELECT coalesce(sum(si.qty), 0) INTO v_items
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
     WHERE s.shift_id = p_shift_id AND s.status = 'completed';

    SELECT coalesce(jsonb_object_agg(method, amount), '{}'::jsonb) INTO v_methods
      FROM (
        SELECT sp.method, sum(sp.amount) AS amount
          FROM sale_payments sp
          JOIN sales s ON s.id = sp.sale_id
         WHERE s.shift_id = p_shift_id AND s.status = 'completed'
         GROUP BY sp.method
      ) m;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'cashier_id', cashier_id,
             'name', full_name,
             'sale_count', sale_count,
             'total', total
           ) ORDER BY total DESC), '[]'::jsonb) INTO v_cashiers
      FROM (
        SELECT s.cashier_id, coalesce(p.full_name, 'Unknown') AS full_name,
               count(*) AS sale_count, sum(s.total) AS total
          FROM sales s
          LEFT JOIN profiles p ON p.id = s.cashier_id
         WHERE s.shift_id = p_shift_id AND s.status = 'completed'
         GROUP BY s.cashier_id, p.full_name
      ) c;

    v_cash_in := coalesce((v_methods->>'cash')::NUMERIC, 0);

    SELECT coalesce(sum(amount), 0) INTO v_movements
      FROM till_movements WHERE shift_id = p_shift_id;

    RETURN jsonb_build_object(
        'shift_id',       p_shift_id,
        'sale_count',     v_sale_count,
        'sales_total',    round(v_sales_total, 2),
        'vat_total',      round(v_vat_total, 2),
        'discount_total', round(v_discount, 2),
        'item_count',     v_items,
        -- Guarded: a shift with no sales must report 0, not divide by zero.
        'average_basket', CASE WHEN v_sale_count > 0
                               THEN round(v_sales_total / v_sale_count, 2)
                               ELSE 0 END,
        'by_method',      v_methods,
        'by_cashier',     v_cashiers,
        'opening_float',  round(v_float, 2),
        'cash_taken',     round(v_cash_in, 2),
        'till_movements', round(v_movements, 2),
        -- What should physically be in the drawer.
        'expected_cash',  round(v_float + v_cash_in + v_movements, 2)
    );
END;
$$;

-- ============================================================
-- 004 — returns and credit notes
--
-- A return is its own document, never a mutation of the original sale. Stock
-- goes back through record_stock_movement; cash refunds reduce expected cash.
-- shift_totals is redefined here (after 003 defined it) so refunds net off.
-- Idempotent: IF NOT EXISTS / OR REPLACE / policies dropped first.
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS credit_note_no_seq;

CREATE TABLE IF NOT EXISTS credit_notes (
    id              BIGSERIAL PRIMARY KEY,
    credit_no       TEXT NOT NULL UNIQUE,
    sale_id         BIGINT NOT NULL REFERENCES sales(id),
    shift_id        INT REFERENCES shifts(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    cashier_id      UUID REFERENCES profiles(id),
    reason          TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    subtotal        NUMERIC(12,2) NOT NULL,
    vat_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    total           NUMERIC(12,2) NOT NULL,
    -- 'exchange' means goods swapped with no money moving; it must not reduce
    -- the cash expected in the drawer.
    refund_method   TEXT NOT NULL CHECK (refund_method IN
                    ('cash', 'card', 'juice', 'myt_money', 'exchange'))
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_sale ON credit_notes (sale_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_shift ON credit_notes (shift_id, created_at);

CREATE TABLE IF NOT EXISTS credit_note_items (
    id              BIGSERIAL PRIMARY KEY,
    credit_note_id  BIGINT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
    sale_item_id    BIGINT NOT NULL REFERENCES sale_items(id),
    variant_id      INT NOT NULL REFERENCES product_variants(id),
    qty             INT NOT NULL CHECK (qty > 0),
    unit_price      NUMERIC(10,2) NOT NULL,
    line_total      NUMERIC(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_note_items_note
    ON credit_note_items (credit_note_id);

ALTER TABLE credit_notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_note_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_all ON credit_notes;
CREATE POLICY read_all ON credit_notes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS read_all ON credit_note_items;
CREATE POLICY read_all ON credit_note_items FOR SELECT TO authenticated USING (true);
-- No INSERT policies: written only through the SECURITY DEFINER RPC below,
-- exactly as sales and stock_movements are.

-- ===== returned_qty helper =====
-- How much of a sale line has already come back. Used by the guard below and by
-- the app to show what is still returnable.
CREATE OR REPLACE FUNCTION returned_qty(p_sale_item_id BIGINT)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT coalesce(sum(qty), 0)::INT
      FROM credit_note_items
     WHERE sale_item_id = p_sale_item_id;
$$;

-- ===== create_credit_note =====
-- p_items: [{"sale_item_id": 12, "qty": 1}, ...]
CREATE OR REPLACE FUNCTION create_credit_note(
    p_sale_id BIGINT,
    p_shift_id INT,
    p_cashier_id UUID,
    p_reason TEXT,
    p_refund_method TEXT,
    p_items JSONB
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_note_id    BIGINT;
    v_sale       sales%ROWTYPE;
    v_item       JSONB;
    v_sale_item  sale_items%ROWTYPE;
    v_qty        INT;
    v_returned   INT;
    v_unit       NUMERIC;
    v_line       NUMERIC;
    v_subtotal   NUMERIC := 0;
    v_vat_rate   NUMERIC;
    v_sold       INT;
    v_back       INT;
BEGIN
    IF coalesce(trim(p_reason), '') = '' THEN
        RAISE EXCEPTION 'A reason is required for a credit note';
    END IF;
    IF jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'A credit note needs at least one line';
    END IF;

    SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
    END IF;
    IF v_sale.status = 'void' THEN
        RAISE EXCEPTION 'Sale % is void and cannot be returned against', p_sale_id;
    END IF;

    SELECT (value)::NUMERIC INTO v_vat_rate FROM settings WHERE key = 'vat_rate';
    v_vat_rate := coalesce(v_vat_rate, 0.15);

    -- First pass: validate every line before writing anything, so a bad line
    -- cannot leave a half-built credit note behind.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_qty := (v_item->>'qty')::INT;
        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION 'Return quantities must be positive';
        END IF;

        SELECT * INTO v_sale_item
          FROM sale_items
         WHERE id = (v_item->>'sale_item_id')::BIGINT
           AND sale_id = p_sale_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Line % does not belong to sale %',
                v_item->>'sale_item_id', p_sale_id;
        END IF;

        v_returned := returned_qty(v_sale_item.id);
        IF v_returned + v_qty > v_sale_item.qty THEN
            RAISE EXCEPTION
                'Only % of line % can still be returned (% sold, % already returned)',
                v_sale_item.qty - v_returned, v_sale_item.id,
                v_sale_item.qty, v_returned;
        END IF;

        -- Refund at what the customer actually paid for that unit, discount
        -- included — refunding the list price would hand back more than was
        -- taken.
        v_unit := (v_sale_item.line_total / v_sale_item.qty);
        v_subtotal := v_subtotal + round(v_unit * v_qty, 2);
    END LOOP;

    INSERT INTO credit_notes (credit_no, sale_id, shift_id, cashier_id, reason,
            subtotal, vat_amount, total, refund_method)
    VALUES (
        'CN' || to_char(now(), 'YYMMDD') || '-' || nextval('credit_note_no_seq'),
        p_sale_id, p_shift_id, p_cashier_id, trim(p_reason),
        v_subtotal,
        -- VAT-inclusive, mirroring complete_sale exactly.
        round(v_subtotal - v_subtotal / (1 + v_vat_rate), 2),
        v_subtotal, p_refund_method
    )
    RETURNING id INTO v_note_id;

    -- Second pass: write the lines and put the stock back.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_qty := (v_item->>'qty')::INT;

        SELECT * INTO v_sale_item
          FROM sale_items
         WHERE id = (v_item->>'sale_item_id')::BIGINT AND sale_id = p_sale_id;

        v_unit := (v_sale_item.line_total / v_sale_item.qty);
        v_line := round(v_unit * v_qty, 2);

        INSERT INTO credit_note_items (credit_note_id, sale_item_id, variant_id,
                qty, unit_price, line_total)
        VALUES (v_note_id, v_sale_item.id, v_sale_item.variant_id,
                v_qty, round(v_unit, 2), v_line);

        -- Positive: the goods are coming back onto the shelf. Same RPC every
        -- other stock change goes through, so qty_on_hand stays a faithful
        -- cache of the ledger.
        PERFORM record_stock_movement(
            v_sale_item.variant_id, 'return', v_qty,
            'credit_note', v_note_id,
            'Returned on ' || (SELECT credit_no FROM credit_notes WHERE id = v_note_id));
    END LOOP;

    -- Mark the sale refunded only when every unit on it has come back. A
    -- partial return leaves it 'completed', which is what the reports expect.
    SELECT coalesce(sum(si.qty), 0), coalesce(sum(returned_qty(si.id)), 0)
      INTO v_sold, v_back
      FROM sale_items si WHERE si.sale_id = p_sale_id;

    IF v_back >= v_sold THEN
        UPDATE sales SET status = 'refunded' WHERE id = p_sale_id;
    END IF;

    RETURN v_note_id;
END;
$$;

-- ===== shift_totals, replaced =====
-- Now nets off refunds. Without this a shift with a cash refund could never
-- reconcile: the money left the drawer but nothing said so.
CREATE OR REPLACE FUNCTION shift_totals(p_shift_id INT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
    v_float       NUMERIC;
    v_sale_count  INT;
    v_sales_total NUMERIC;
    v_vat_total   NUMERIC;
    v_discount    NUMERIC;
    v_items       INT;
    v_methods     JSONB;
    v_cashiers    JSONB;
    v_cash_in     NUMERIC;
    v_movements   NUMERIC;
    v_refunds     NUMERIC;
    v_cash_refund NUMERIC;
    v_refund_ct   INT;
BEGIN
    SELECT opening_float INTO v_float FROM shifts WHERE id = p_shift_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift % does not exist', p_shift_id;
    END IF;

    SELECT count(*), coalesce(sum(total), 0),
           coalesce(sum(vat_amount), 0), coalesce(sum(discount), 0)
      INTO v_sale_count, v_sales_total, v_vat_total, v_discount
      FROM sales WHERE shift_id = p_shift_id AND status IN ('completed', 'refunded');

    SELECT coalesce(sum(si.qty), 0) INTO v_items
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
     WHERE s.shift_id = p_shift_id AND s.status IN ('completed', 'refunded');

    SELECT coalesce(jsonb_object_agg(method, amount), '{}'::jsonb) INTO v_methods
      FROM (
        SELECT sp.method, sum(sp.amount) AS amount
          FROM sale_payments sp
          JOIN sales s ON s.id = sp.sale_id
         WHERE s.shift_id = p_shift_id AND s.status IN ('completed', 'refunded')
         GROUP BY sp.method
      ) m;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'cashier_id', cashier_id, 'name', full_name,
             'sale_count', sale_count, 'total', total
           ) ORDER BY total DESC), '[]'::jsonb) INTO v_cashiers
      FROM (
        SELECT s.cashier_id, coalesce(p.full_name, 'Unknown') AS full_name,
               count(*) AS sale_count, sum(s.total) AS total
          FROM sales s
          LEFT JOIN profiles p ON p.id = s.cashier_id
         WHERE s.shift_id = p_shift_id AND s.status IN ('completed', 'refunded')
         GROUP BY s.cashier_id, p.full_name
      ) c;

    -- Credit notes are attributed to the shift they were RAISED in, not the one
    -- the original sale belongs to: the cash left this drawer, today.
    SELECT count(*), coalesce(sum(total), 0),
           coalesce(sum(total) FILTER (WHERE refund_method = 'cash'), 0)
      INTO v_refund_ct, v_refunds, v_cash_refund
      FROM credit_notes WHERE shift_id = p_shift_id;

    v_cash_in := coalesce((v_methods->>'cash')::NUMERIC, 0);

    SELECT coalesce(sum(amount), 0) INTO v_movements
      FROM till_movements WHERE shift_id = p_shift_id;

    RETURN jsonb_build_object(
        'shift_id',       p_shift_id,
        'sale_count',     v_sale_count,
        'sales_total',    round(v_sales_total, 2),
        'vat_total',      round(v_vat_total, 2),
        'discount_total', round(v_discount, 2),
        'item_count',     v_items,
        'average_basket', CASE WHEN v_sale_count > 0
                               THEN round(v_sales_total / v_sale_count, 2)
                               ELSE 0 END,
        'by_method',      v_methods,
        'by_cashier',     v_cashiers,
        'refund_count',   v_refund_ct,
        'refund_total',   round(v_refunds, 2),
        'cash_refunds',   round(v_cash_refund, 2),
        'net_total',      round(v_sales_total - v_refunds, 2),
        'opening_float',  round(v_float, 2),
        'cash_taken',     round(v_cash_in, 2),
        'till_movements', round(v_movements, 2),
        -- Cash refunds come straight out of the drawer, so they reduce what
        -- should be in it. Card/Juice/exchange refunds do not.
        'expected_cash',  round(v_float + v_cash_in + v_movements - v_cash_refund, 2)
    );
END;
$$;

-- ============================================================
-- 005 — the discount engine
--
-- Named reusable rules plus a frozen ledger of what was actually given away.
-- complete_sale (001) is untouched; a wrapper commits the sale and its
-- discount rows together. Idempotent: IF NOT EXISTS / OR REPLACE / policies
-- dropped first.
-- ============================================================

CREATE TABLE IF NOT EXISTS discounts (
    id                SERIAL PRIMARY KEY,
    name              TEXT NOT NULL,
    -- Optional short code a cashier can type at the till.
    code              TEXT UNIQUE,
    kind              TEXT NOT NULL CHECK (kind IN ('percent', 'amount')),
    value             NUMERIC(10,2) NOT NULL CHECK (value > 0),
    -- 'sale' comes off the basket total; 'line' off a single line.
    scope             TEXT NOT NULL DEFAULT 'sale'
                      CHECK (scope IN ('sale', 'line')),
    -- When set, only applies to lines in this category.
    category_id       INT REFERENCES categories(id),
    min_spend         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (min_spend >= 0),
    -- Ceiling for percentage discounts: "10% off, up to Rs 200".
    max_amount        NUMERIC(10,2) CHECK (max_amount IS NULL OR max_amount > 0),
    starts_on         DATE,
    ends_on           DATE,
    requires_manager  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A percentage over 100 would pay the customer to take the goods.
    CONSTRAINT discounts_percent_sane
        CHECK (kind <> 'percent' OR value <= 100),
    CONSTRAINT discounts_window_sane
        CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_discounts_active ON discounts (is_active, scope);

-- What was actually given away, frozen. `discount_id` is kept for reporting but
-- the label/kind/value are copied so a later edit to the rule cannot restate a
-- past sale.
CREATE TABLE IF NOT EXISTS sale_discounts (
    id           BIGSERIAL PRIMARY KEY,
    sale_id      BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    discount_id  INT REFERENCES discounts(id),
    label        TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('percent', 'amount')),
    value        NUMERIC(10,2) NOT NULL,
    -- The money actually taken off, after any cap.
    amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    approved_by  UUID REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_sale_discounts_sale ON sale_discounts (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_discounts_discount ON sale_discounts (discount_id);

ALTER TABLE discounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_discounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_all ON discounts;
CREATE POLICY read_all ON discounts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS manage ON discounts;
CREATE POLICY manage ON discounts FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));

DROP POLICY IF EXISTS read_all ON sale_discounts;
CREATE POLICY read_all ON sale_discounts FOR SELECT TO authenticated USING (true);
-- No INSERT policy: written only through the RPC below, like everything else
-- that touches a sale.

-- ===== discount_amount_for =====
-- The single authority on what a rule is worth against a given base. The till
-- and the reports both call it, so a cashier can never be shown one figure
-- while another is recorded.
CREATE OR REPLACE FUNCTION discount_amount_for(
    p_kind TEXT,
    p_value NUMERIC,
    p_base NUMERIC,
    p_max_amount NUMERIC DEFAULT NULL
) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT greatest(
        0,
        least(
            CASE WHEN p_kind = 'percent'
                 THEN round(coalesce(p_base, 0) * coalesce(p_value, 0) / 100.0, 2)
                 ELSE round(coalesce(p_value, 0), 2) END,
            -- Never more than the base: a discount must not make a total
            -- negative, and never more than its own cap.
            coalesce(p_base, 0),
            coalesce(p_max_amount, 1e12)
        )
    );
$$;

-- ===== complete_sale_with_discounts =====
-- Thin wrapper so the sale and the record of what was discounted commit
-- together. complete_sale in 001 stays exactly as it was.
--
-- p_discounts: [{"discount_id":3,"label":"Staff 10%","kind":"percent",
--                "value":10,"amount":42.50,"approved_by":null}]
CREATE OR REPLACE FUNCTION complete_sale_with_discounts(
    p_shift_id INT,
    p_customer_id INT,
    p_cashier_id UUID,
    p_discount NUMERIC,
    p_items JSONB,
    p_payments JSONB,
    p_discounts JSONB DEFAULT '[]'::jsonb
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_sale_id BIGINT;
BEGIN
    v_sale_id := complete_sale(p_shift_id, p_customer_id, p_cashier_id,
                              p_discount, p_items, p_payments);

    INSERT INTO sale_discounts (sale_id, discount_id, label, kind, value,
            amount, approved_by)
    SELECT v_sale_id,
           NULLIF(d->>'discount_id', '')::INT,
           d->>'label',
           d->>'kind',
           (d->>'value')::NUMERIC,
           (d->>'amount')::NUMERIC,
           NULLIF(d->>'approved_by', '')::UUID
      FROM jsonb_array_elements(coalesce(p_discounts, '[]'::jsonb)) AS d;

    RETURN v_sale_id;
END;
$$;

-- ===== discount reporting =====
-- What was given away over a period, by rule. The one question the old bare
-- number could not answer.
CREATE OR REPLACE FUNCTION discount_report(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (
    discount_id  INT,
    label        TEXT,
    times_used   BIGINT,
    total_given  NUMERIC
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT sd.discount_id,
           -- Grouped by the frozen label, so a renamed rule does not merge two
           -- historically different offers into one line.
           sd.label,
           count(*) AS times_used,
           round(sum(sd.amount), 2) AS total_given
      FROM sale_discounts sd
      JOIN sales s ON s.id = sd.sale_id
     WHERE s.status IN ('completed', 'refunded')
       AND s.sale_date >= p_from
       AND s.sale_date <= p_to
     GROUP BY sd.discount_id, sd.label
     ORDER BY sum(sd.amount) DESC;
$$;

-- ============================================================
-- 006 — module access + stock locations
--
-- Module access is a VISIBILITY layer only; RLS remains the security boundary.
-- Stock locations are an attribute of each movement, with per-location balances
-- DERIVED by a view — qty_on_hand stays the shop-wide total and the 001 RPCs
-- are untouched. Idempotent: IF NOT EXISTS / OR REPLACE / ON CONFLICT /
-- triggers and policies dropped first.
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

-- ============================================================
-- 007_barcodes.sql
-- ============================================================

-- ===== Barcode scheme settings =====
-- DO NOTHING on conflict so re-running this file never winds a live shop's
-- counter back to 1 and starts re-issuing codes that are already on shelves.
INSERT INTO settings (key, value) VALUES
    ('barcode_auto',   'true'),
    ('barcode_prefix', '"6291041"'),
    ('barcode_next',   '1')
ON CONFLICT (key) DO NOTHING;

-- ===== allocate_barcode_serials =====
-- Reserves a block of serials atomically and returns the first. SECURITY
-- DEFINER because `settings` is owner-only under RLS, but a *manager* creating
-- a variant needs a number; the role check below is what that hole is narrowed
-- to. The single UPDATE holds its row lock for the statement, so two callers
-- racing get disjoint blocks rather than the same serial — which matters
-- because product_variants.barcode is UNIQUE.
CREATE OR REPLACE FUNCTION allocate_barcode_serials(p_count INT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_next INT;
BEGIN
    IF p_count IS NULL OR p_count < 1 THEN
        RAISE EXCEPTION 'Ask for at least one barcode';
    END IF;
    IF p_count > 10000 THEN
        RAISE EXCEPTION 'Too many barcodes in one go (limit 10000)';
    END IF;

    IF current_role_of_user() NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Only an owner or manager can issue barcodes';
    END IF;

    UPDATE settings
       SET value = to_jsonb(((value #>> '{}')::INT) + p_count)
     WHERE key = 'barcode_next'
    RETURNING ((value #>> '{}')::INT) - p_count INTO v_next;

    IF v_next IS NULL THEN
        RAISE EXCEPTION 'The barcode_next setting is missing — re-run migration 007';
    END IF;

    RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION allocate_barcode_serials(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION allocate_barcode_serials(INT) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_variants_without_barcode
    ON product_variants (product_id) WHERE barcode IS NULL;

-- ============================================================
-- 008_barcode_scheme_guard.sql
-- ============================================================

-- ===== set_barcode_scheme =====
-- Saving the barcode scheme used to read the counter, check it in JavaScript,
-- then write it back — and an allocation landing in that gap was silently
-- rolled back, re-issuing serials already printed on shelf labels. The read,
-- the check and the write happen here in one transaction instead, holding a
-- lock on the counter row that allocate_barcode_serials also takes.
--
-- Returns the counter in force afterwards rather than raising on a rewind: the
-- caller compares it with what it asked for, so the refusal needs no exception
-- string parsing to recover the number for its error message.
CREATE OR REPLACE FUNCTION set_barcode_scheme(
    p_auto   BOOLEAN,
    p_prefix TEXT,
    p_next   INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current INT;
BEGIN
    IF current_role_of_user() <> 'owner' THEN
        RAISE EXCEPTION 'Only the owner can change the barcode scheme';
    END IF;

    -- Mirrors prefixProblem() in lib/barcodes/ean13.ts. Checked here too: this
    -- function is reachable from any authenticated client, not just that form.
    IF p_prefix IS NULL OR p_prefix !~ '^[0-9]{1,9}$' THEN
        RAISE EXCEPTION 'The shop prefix must be 1 to 9 digits';
    END IF;

    IF p_next IS NULL OR p_next < 0 THEN
        RAISE EXCEPTION 'The next number cannot be negative';
    END IF;

    SELECT (value #>> '{}')::INT INTO v_current
      FROM settings
     WHERE key = 'barcode_next'
       FOR UPDATE;

    IF v_current IS NULL THEN
        RAISE EXCEPTION 'The barcode_next setting is missing — re-run migration 007';
    END IF;

    -- Refused, and nothing is written: auto and prefix are not saved either, so
    -- the form comes back as the shop left it rather than half-applied.
    IF p_next < v_current THEN
        RETURN v_current;
    END IF;

    UPDATE settings SET value = to_jsonb(p_next)   WHERE key = 'barcode_next';
    UPDATE settings SET value = to_jsonb(p_prefix) WHERE key = 'barcode_prefix';
    UPDATE settings SET value = to_jsonb(p_auto)   WHERE key = 'barcode_auto';

    RETURN p_next;
END;
$$;

REVOKE ALL ON FUNCTION set_barcode_scheme(BOOLEAN, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_barcode_scheme(BOOLEAN, TEXT, INT) TO authenticated;

-- ============================================================
-- 009_stock_floor_and_sale_no.sql
-- ============================================================

-- ===== Stock floor =====
-- record_stock_movement adds a delta with no floor, so two tills selling the
-- last unit at the same moment both succeeded and left the variant at -1. An
-- application check cannot close that: between its read and its write the other
-- till has already sold the item. Only the database can hold this.
--
-- Unlike the rest of this file, adding a constraint is not automatically safe to
-- re-run against dirty data — a pre-existing negative would make it fail to
-- validate and abort everything after it. Checked first, and reported plainly.
DO $$
DECLARE
    v_bad INT;
BEGIN
    SELECT count(*) INTO v_bad FROM product_variants WHERE qty_on_hand < 0;
    IF v_bad > 0 THEN
        RAISE EXCEPTION
            'Cannot add the stock floor: % variant(s) are already negative. '
            'Correct them with an adjustment first, then re-run.', v_bad;
    END IF;
END $$;

ALTER TABLE product_variants
    DROP CONSTRAINT IF EXISTS qty_on_hand_non_negative;

ALTER TABLE product_variants
    ADD CONSTRAINT qty_on_hand_non_negative CHECK (qty_on_hand >= 0);

-- ===== complete_sale, with sale_no derived from the id =====
-- The 001 version built sale_no from nextval('sales_id_seq') while the row's own
-- BIGSERIAL default called nextval on the SAME sequence: two values burned per
-- sale, and a printed number that never matched the row id. Receipts read
-- S260728-2, -4, -6. Everything else below is the 001 body unchanged.
CREATE OR REPLACE FUNCTION complete_sale(
    p_shift_id INT,
    p_customer_id INT,
    p_cashier_id UUID,
    p_discount NUMERIC,
    p_items JSONB,
    p_payments JSONB
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_sale_id   BIGINT;
    v_subtotal  NUMERIC := 0;
    v_vat_rate  NUMERIC;
    v_total     NUMERIC;
    v_item      JSONB;
    v_line      NUMERIC;
BEGIN
    SELECT (value)::NUMERIC INTO v_vat_rate FROM settings WHERE key = 'vat_rate';

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_line := (v_item->>'qty')::INT * (v_item->>'unit_price')::NUMERIC
                  - COALESCE((v_item->>'discount')::NUMERIC, 0);
        v_subtotal := v_subtotal + v_line;
    END LOOP;

    v_total := v_subtotal - COALESCE(p_discount, 0);

    -- A throwaway unique value first: sale_no is NOT NULL UNIQUE, so it needs
    -- something on insert and two concurrent sales must not collide on it. The
    -- real number is stamped on immediately below, in the same transaction, so
    -- no caller ever observes the placeholder.
    INSERT INTO sales (sale_no, shift_id, customer_id, subtotal, discount,
            vat_amount, total, cashier_id)
    VALUES (
        'pending-' || gen_random_uuid()::TEXT,
        p_shift_id, p_customer_id, v_subtotal, COALESCE(p_discount, 0),
        round(v_total - v_total / (1 + v_vat_rate), 2),  -- VAT-inclusive pricing
        v_total, p_cashier_id
    )
    RETURNING id INTO v_sale_id;

    UPDATE sales
       SET sale_no = 'S' || to_char(now(), 'YYMMDD') || '-' || v_sale_id
     WHERE id = v_sale_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_line := (v_item->>'qty')::INT * (v_item->>'unit_price')::NUMERIC
                  - COALESCE((v_item->>'discount')::NUMERIC, 0);

        INSERT INTO sale_items (sale_id, variant_id, qty, unit_price, discount, line_total)
        VALUES (v_sale_id, (v_item->>'variant_id')::INT, (v_item->>'qty')::INT,
                (v_item->>'unit_price')::NUMERIC,
                COALESCE((v_item->>'discount')::NUMERIC, 0), v_line);

        PERFORM record_stock_movement(
            (v_item->>'variant_id')::INT, 'sale',
            -(v_item->>'qty')::INT, 'pos_sale', v_sale_id, NULL);
    END LOOP;

    INSERT INTO sale_payments (sale_id, method, amount, tendered)
    SELECT v_sale_id, p->>'method', (p->>'amount')::NUMERIC,
           (p->>'tendered')::NUMERIC
    FROM jsonb_array_elements(p_payments) AS p;

    RETURN v_sale_id;
END;
$$;

-- ============================================================
-- 010_pin_lockout.sql
-- ============================================================

-- On the Android till the device stays signed in permanently and the PIN
-- becomes the only thing between a stranger and the drawer. Four digits is
-- 10,000 guesses — an evening by hand, seconds for a script — and hashing does
-- not help, because the attacker is guessing at the front door rather than
-- reading the database. So the count is kept here, where restarting the app
-- cannot reset it.
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS pin_failed_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pin_last_used_at TIMESTAMPTZ;

-- ===== pin_lock_state =====
-- Seconds a profile must still wait. Readable so the keypad can show the wait
-- without spending an attempt to discover it.
CREATE OR REPLACE FUNCTION pin_lock_state(p_profile_id UUID)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT GREATEST(
        0,
        COALESCE(EXTRACT(EPOCH FROM (pin_locked_until - now()))::INT, 0)
    )
    FROM profiles
    WHERE id = p_profile_id;
$$;

-- ===== register_pin_attempt =====
-- The app verifies the hash — PBKDF2 lives in application code — and reports the
-- verdict here. Safe because this only counts: a caller lying about p_ok already
-- holds a valid session and could simply not call it. What it buys is a counter
-- that survives app restarts and is shared across every till in the shop.
--
-- Three misses are free, because a keypad in a busy shop gets mistyped. After
-- that the wait doubles to a five-minute cap: twenty wrong guesses already costs
-- over an hour, putting the full 10,000 out of reach without ever locking a real
-- cashier out for long.
CREATE OR REPLACE FUNCTION register_pin_attempt(p_profile_id UUID, p_ok BOOLEAN)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_failed INT;
    v_wait   INT := 0;
BEGIN
    IF p_ok THEN
        UPDATE profiles
           SET pin_failed_count = 0,
               pin_locked_until = NULL,
               pin_last_used_at = now()
         WHERE id = p_profile_id;
        RETURN 0;
    END IF;

    UPDATE profiles
       SET pin_failed_count = pin_failed_count + 1
     WHERE id = p_profile_id
    RETURNING pin_failed_count INTO v_failed;

    IF v_failed IS NULL THEN
        RETURN 0;
    END IF;

    IF v_failed > 3 THEN
        v_wait := LEAST(300, 5 * POWER(2, v_failed - 4)::INT);
        UPDATE profiles
           SET pin_locked_until = now() + make_interval(secs => v_wait)
         WHERE id = p_profile_id;
    END IF;

    RETURN v_wait;
END;
$$;

REVOKE ALL ON FUNCTION pin_lock_state(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_pin_attempt(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pin_lock_state(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION register_pin_attempt(UUID, BOOLEAN) TO authenticated;

-- ===== clear_pin_lock =====
-- An owner or manager can free a locked-out cashier without waiting out the
-- clock, which is the difference between a security control and an operational
-- problem in the middle of a Saturday queue.
CREATE OR REPLACE FUNCTION clear_pin_lock(p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF current_role_of_user() NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Only an owner or manager can clear a PIN lock';
    END IF;

    UPDATE profiles
       SET pin_failed_count = 0,
           pin_locked_until = NULL
     WHERE id = p_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION clear_pin_lock(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clear_pin_lock(UUID) TO authenticated;

-- ============================================================
-- 011_sale_idempotency.sql
-- ============================================================

-- complete_sale has always been atomic, which is not the same as safe to
-- retry. If it commits and the response is lost — a dropped line at exactly
-- the moment this app is most used — the till shows a failure over a sale that
-- happened, and the spec then tells the cashier to press Confirm again. That
-- wrote a second sale and deducted the stock twice. Atomicity cannot fix it,
-- because nothing is wrong inside the transaction; the fix is naming the
-- attempt.
ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_idempotency_key
    ON sales (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- The advisory lock rather than catching a unique violation: check-then-insert
-- races, and in plpgsql an exception block rolls back everything inside it,
-- including the sale we would then want to return.
CREATE OR REPLACE FUNCTION complete_sale_keyed(
    p_key         TEXT,
    p_shift_id    INT,
    p_customer_id INT,
    p_cashier_id  UUID,
    p_discount    NUMERIC,
    p_items       JSONB,
    p_payments    JSONB,
    p_discounts   JSONB DEFAULT '[]'::jsonb
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing BIGINT;
    v_sale_id  BIGINT;
BEGIN
    IF p_key IS NULL OR btrim(p_key) = '' THEN
        RETURN complete_sale_with_discounts(p_shift_id, p_customer_id, p_cashier_id,
                                            p_discount, p_items, p_payments, p_discounts);
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_key));

    SELECT id INTO v_existing FROM sales WHERE idempotency_key = p_key;
    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    v_sale_id := complete_sale_with_discounts(p_shift_id, p_customer_id, p_cashier_id,
                                              p_discount, p_items, p_payments, p_discounts);

    UPDATE sales SET idempotency_key = p_key WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION complete_sale_keyed(TEXT, INT, INT, UUID, NUMERIC, JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_sale_keyed(TEXT, INT, INT, UUID, NUMERIC, JSONB, JSONB, JSONB) TO authenticated;

-- ============================================================
-- 012_receipt_prints.sql
-- ============================================================

-- Reprinting a receipt is the ordinary answer to "can I have another copy",
-- and it is also how a refund that never happened gets justified. The signal
-- worth acting on is the COUNT and the TIMES; `printed_by` is the session,
-- which on a shared till names the device rather than the person.
CREATE TABLE IF NOT EXISTS receipt_prints (
    id          BIGSERIAL PRIMARY KEY,
    sale_id     BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    printed_by  UUID REFERENCES profiles(id),
    printed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipt_prints_sale
    ON receipt_prints (sale_id, printed_at DESC);

ALTER TABLE receipt_prints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_all ON receipt_prints;
CREATE POLICY read_all ON receipt_prints FOR SELECT TO authenticated USING (true);

-- No INSERT, UPDATE or DELETE policy on purpose: rows arrive only through the
-- function below, so the trail cannot be edited or thinned by whoever is
-- standing at the till. Note RLS blocks those silently — a denied DELETE
-- reports zero rows rather than raising — so verify by counting, not by
-- expecting an error.
CREATE OR REPLACE FUNCTION record_receipt_print(p_sale_id BIGINT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id) THEN
        RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
    END IF;

    INSERT INTO receipt_prints (sale_id, printed_by)
    VALUES (p_sale_id, auth.uid());

    SELECT count(*)::INT INTO v_count
      FROM receipt_prints WHERE sale_id = p_sale_id;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION record_receipt_print(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_receipt_print(BIGINT) TO authenticated;

-- ============================================================
-- Kids Corner — migration 013: the Z report
--
-- Modelled on the Carfectionist till's `z_totals`, which has been through a
-- real shop's end-of-day and had three specific mistakes beaten out of it. Kids
-- Corner has a simpler schema — every sale is settled at the till, so there is
-- no on-account line — but the three traps are the same and are avoided the
-- same way:
--
--   • CATEGORY totals must be apportioned. A sale-level discount lives on
--     `sales.discount`, not on the lines, so summing `sale_items.line_total`
--     by category gives MORE than the shop took. Each line is scaled by
--     (sale total / sum of its line totals) so the categories add up exactly.
--
--   • VAT comes from the frozen `sales.vat_amount`, never re-derived from the
--     lines. The stored figure used the rate in force when the sale happened,
--     and Kids Corner prices are VAT-INCLUSIVE — the VAT is contained in the
--     total, not added to it. Re-deriving it would silently restate every
--     historical sale at today's rate.
--
--   • AVERAGE BASKET is the total over the ticket count. Carfectionist excludes
--     on-account tickets from the denominator because those brought in no
--     money; Kids Corner has none — `complete_sale` refuses a sale whose
--     payments do not cover it — so every ticket counts. Stated here because it
--     is a real difference between the two shops, not an oversight.
--
-- `p_as_at` is what makes a Z reproducible. The figures are "as the world was
-- at the moment the till was closed", so a reprint next month is the slip that
-- came out of the printer today.
--
-- Migrations 001-012 are untouched.
-- ============================================================
-- ===== z_reports =====
-- The frozen slip. `totals` is whatever z_totals returned at close, stored
-- verbatim — a reprint reads this, never the live aggregator, because the live
-- one would answer with today's world.
CREATE TABLE IF NOT EXISTS z_reports (
    id          BIGSERIAL PRIMARY KEY,
    shift_id    INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    z_no        TEXT NOT NULL,
    closed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_by   UUID REFERENCES profiles(id),
    counted_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
    expected_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
    variance    NUMERIC(12,2) NOT NULL DEFAULT 0,
    totals      JSONB NOT NULL,
    -- One Z per shift. A second close is a bug, not a second report.
    CONSTRAINT z_reports_shift_unique UNIQUE (shift_id)
);
CREATE INDEX IF NOT EXISTS idx_z_reports_closed_at ON z_reports (closed_at DESC);
ALTER TABLE z_reports ENABLE ROW LEVEL SECURITY;
-- Readable by staff, written only by the SECURITY DEFINER close below. A Z
-- report that could be edited after the fact is not a fiscal record.
DROP POLICY IF EXISTS read_z_reports ON z_reports;
CREATE POLICY read_z_reports ON z_reports
    FOR SELECT TO authenticated USING (true);
-- ===== z_totals =====
-- The ONE aggregator behind the Z slip, the X-read and the back office, so the
-- three can never disagree about the same shift.
CREATE OR REPLACE FUNCTION z_totals(p_shift_id INT, p_as_at TIMESTAMPTZ DEFAULT now())
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_shift       RECORD;
    v_sales       BIGINT[];
    v_sale_count  INT;
    v_sales_total NUMERIC := 0;
    v_vat_total   NUMERIC := 0;
    v_discount    NUMERIC := 0;
    v_items       INT := 0;
    v_methods     JSONB;
    v_categories  JSONB;
    v_vat         JSONB;
    v_cashiers    JSONB;
    v_hourly      JSONB;
    v_top         JSONB;
    v_cash_in     NUMERIC := 0;
    v_movements   NUMERIC := 0;
    v_moves       JSONB;
    v_voided      INT := 0;
    v_refunded    INT := 0;
    v_credited    NUMERIC := 0;
    v_default_vat NUMERIC;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift % does not exist', p_shift_id;
    END IF;
    -- The shop's configured rate, used only for a sale whose own rate cannot be
    -- implied (a fully discounted ticket, where total and VAT are both zero).
    SELECT coalesce((value #>> '{}')::NUMERIC, 0.15) INTO v_default_vat
      FROM settings WHERE key = 'vat_rate';
    IF v_default_vat IS NULL THEN v_default_vat := 0.15; END IF;
    -- ── The tickets in scope. Only 'completed': a voided or refunded ticket
    -- must not be expected in the drawer. Bounded by p_as_at so the report is
    -- reproducible.
    SELECT coalesce(array_agg(id), '{}')
      INTO v_sales
      FROM sales
     WHERE shift_id = p_shift_id
       AND status = 'completed'
       AND sale_date <= p_as_at;
    SELECT count(*), coalesce(sum(total), 0),
           coalesce(sum(vat_amount), 0), coalesce(sum(discount), 0)
      INTO v_sale_count, v_sales_total, v_vat_total, v_discount
      FROM sales WHERE id = ANY(v_sales);
    SELECT coalesce(sum(qty), 0) INTO v_items
      FROM sale_items WHERE sale_id = ANY(v_sales);
    -- ── Means of payment, with the cash split a drawer actually needs: gross is
    -- what was handed over, change is what went back, net is what stayed. The
    -- count is SUM(sign(amount)) so a negative line shows as -1 rather than
    -- inflating the tally.
    SELECT coalesce(jsonb_agg(m ORDER BY m->>'method'), '[]'::jsonb) INTO v_methods
      FROM (
        SELECT jsonb_build_object(
                 'method', sp.method,
                 'count',  sum(sign(sp.amount))::INT,
                 'gross',  round(sum(coalesce(sp.tendered, sp.amount)), 2),
                 'change', round(sum(greatest(coalesce(sp.tendered, sp.amount) - sp.amount, 0)), 2),
                 'net',    round(sum(sp.amount), 2)
               ) AS m
          FROM sale_payments sp
         WHERE sp.sale_id = ANY(v_sales)
         GROUP BY sp.method
      ) x;
    -- ── Categories, apportioned.
    --
    -- `factor` forces each sale's lines to add up to what that sale actually
    -- took. Without it a Rs 263 sale-level discount would be missing from the
    -- category split and the section would over-report the day.
    SELECT coalesce(jsonb_agg(c ORDER BY c->>'name'), '[]'::jsonb) INTO v_categories
      FROM (
        SELECT jsonb_build_object(
                 'name',  coalesce(nullif(trim(cat.name), ''), '(uncategorised)'),
                 'lines', count(*)::INT,
                 'qty',   sum(si.qty)::INT,
                 'incl',  round(sum(si.line_total * f.factor), 2)
               ) AS c
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          LEFT JOIN product_variants pv ON pv.id = si.variant_id
          LEFT JOIN products p ON p.id = pv.product_id
          LEFT JOIN categories cat ON cat.id = p.category_id
          JOIN LATERAL (
            SELECT CASE WHEN sum(si2.line_total) > 0
                        THEN s.total / sum(si2.line_total) ELSE 1 END AS factor
              FROM sale_items si2 WHERE si2.sale_id = s.id
          ) f ON TRUE
         WHERE si.sale_id = ANY(v_sales)
         GROUP BY coalesce(nullif(trim(cat.name), ''), '(uncategorised)')
      ) y;
    -- ── VAT, grouped by the rate each sale was actually rung up at.
    --
    -- Kids Corner is VAT-INCLUSIVE: the total already contains the VAT, so the
    -- net is total - vat and the rate is vat / net. Implied per sale rather than
    -- read from settings, so a shift spanning a rate change reports both rather
    -- than restating the earlier sales at the newer rate.
    SELECT coalesce(jsonb_agg(v ORDER BY (v->>'rate')::NUMERIC DESC), '[]'::jsonb) INTO v_vat
      FROM (
        SELECT jsonb_build_object(
                 'rate',  rate,
                 'label', CASE WHEN rate = 0 THEN 'Zero-rated 0.00%'
                               ELSE 'VAT ' || to_char(rate, 'FM990.00') || '%' END,
                 'excl',  round(sum(net), 2),
                 'vat',   round(sum(vat), 2),
                 'incl',  round(sum(net) + sum(vat), 2)
               ) AS v
          FROM (
            SELECT round(
                     CASE WHEN s.total - s.vat_amount > 0
                          THEN s.vat_amount / (s.total - s.vat_amount) * 100
                          ELSE v_default_vat * 100 END, 2) AS rate,
                   s.total - s.vat_amount AS net,
                   s.vat_amount           AS vat
              FROM sales s WHERE s.id = ANY(v_sales)
          ) parts
         GROUP BY rate
      ) z;
    -- ── Who rang it, and what they took.
    SELECT coalesce(jsonb_agg(c ORDER BY (c->>'total')::NUMERIC DESC), '[]'::jsonb) INTO v_cashiers
      FROM (
        SELECT jsonb_build_object(
                 'cashier_id', s.cashier_id,
                 'name',       coalesce(pr.full_name, 'Unknown'),
                 'sale_count', count(*)::INT,
                 'total',      round(sum(s.total), 2)
               ) AS c
          FROM sales s
          LEFT JOIN profiles pr ON pr.id = s.cashier_id
         WHERE s.id = ANY(v_sales)
         GROUP BY s.cashier_id, pr.full_name
      ) w;
    -- ── Trade by hour, in the shop's own timezone. Tells an owner when to put a
    -- second person on the till, which is the commonest thing a Z gets used for
    -- beyond balancing the drawer.
    -- The hour is derived in an inner select and grouped by name. `GROUP BY 1`
    -- would point at the whole jsonb_build_object, which contains the
    -- aggregates it is supposed to be grouping.
    SELECT coalesce(jsonb_agg(h ORDER BY (h->>'hour')::INT), '[]'::jsonb) INTO v_hourly
      FROM (
        SELECT jsonb_build_object(
                 'hour',  hr,
                 'count', count(*)::INT,
                 'total', round(sum(amount), 2)
               ) AS h
          FROM (
            SELECT extract(hour FROM (s.sale_date AT TIME ZONE 'Indian/Mauritius'))::INT AS hr,
                   s.total AS amount
              FROM sales s WHERE s.id = ANY(v_sales)
          ) src
         GROUP BY hr
      ) hh;
    -- ── Best sellers, by units.
    SELECT coalesce(jsonb_agg(t ORDER BY (t->>'qty')::INT DESC), '[]'::jsonb) INTO v_top
      FROM (
        SELECT jsonb_build_object(
                 'name', coalesce(p.name, 'Unknown'),
                 'qty',  sum(si.qty)::INT,
                 'total', round(sum(si.line_total), 2)
               ) AS t
          FROM sale_items si
          LEFT JOIN product_variants pv ON pv.id = si.variant_id
          LEFT JOIN products p ON p.id = pv.product_id
         WHERE si.sale_id = ANY(v_sales)
         GROUP BY p.name
         ORDER BY sum(si.qty) DESC
         LIMIT 10
      ) tt;
    v_cash_in := coalesce((
        SELECT round(sum(sp.amount), 2) FROM sale_payments sp
         WHERE sp.sale_id = ANY(v_sales) AND sp.method = 'cash'
    ), 0);
    SELECT coalesce(sum(amount), 0) INTO v_movements
      FROM till_movements
     WHERE shift_id = p_shift_id AND created_at <= p_as_at;
    -- Listed, not just summed. A drawer that is short by exactly the amount of
    -- an unexplained pay-out is a different conversation from one that is
    -- simply short.
    SELECT coalesce(jsonb_agg(m ORDER BY m->>'at'), '[]'::jsonb) INTO v_moves
      FROM (
        SELECT jsonb_build_object(
                 'amount', round(tm.amount, 2),
                 'reason', tm.reason,
                 'at',     tm.created_at
               ) AS m
          FROM till_movements tm
         WHERE tm.shift_id = p_shift_id AND tm.created_at <= p_as_at
      ) mm;
    SELECT count(*) FILTER (WHERE status = 'void'),
           count(*) FILTER (WHERE status = 'refunded')
      INTO v_voided, v_refunded
      FROM sales
     WHERE shift_id = p_shift_id AND sale_date <= p_as_at;
    SELECT coalesce(sum(cn.total), 0) INTO v_credited
      FROM credit_notes cn
      JOIN sales s ON s.id = cn.sale_id
     WHERE s.shift_id = p_shift_id AND cn.created_at <= p_as_at;
    RETURN jsonb_build_object(
        'shift_id',       p_shift_id,
        'opened_at',      v_shift.opened_at,
        'as_at',          p_as_at,
        'tickets',        v_sale_count,
        'sales_total',    round(v_sales_total, 2),
        'item_count',     v_items,
        'discount_total', round(v_discount, 2),
        -- Every Kids Corner ticket is settled at the till, so unlike the
        -- Carfectionist slip there is no on-account denominator to exclude.
        'avg_basket',     CASE WHEN v_sale_count > 0
                               THEN round(v_sales_total / v_sale_count, 2) ELSE 0 END,
        'vat_total',      round(v_vat_total, 2),
        'methods',        v_methods,
        'categories',     v_categories,
        'vat',            v_vat,
        'cashiers',       v_cashiers,
        'hourly',         v_hourly,
        'top_sellers',    v_top,
        'opening_float',  round(v_shift.opening_float, 2),
        'cash_taken',     v_cash_in,
        'till_movements', round(v_movements, 2),
        'movements',      v_moves,
        'expected_cash',  round(v_shift.opening_float + v_cash_in + v_movements, 2),
        'voided',         v_voided,
        'refunded',       v_refunded,
        'credited',       round(v_credited, 2)
    );
END;
$$;
-- ===== close_shift_z =====
-- Closes the shift AND freezes its Z in one transaction.
--
-- Both together on purpose. A close that wrote the shift row and then failed to
-- write the Z would leave a shift nobody can produce a slip for, and the whole
-- point of the frozen copy is that it exists for every closed shift.
CREATE OR REPLACE FUNCTION close_shift_z(
    p_shift_id     INT,
    p_counted_cash NUMERIC,
    p_notes        TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_now      TIMESTAMPTZ := now();
    v_totals   JSONB;
    v_expected NUMERIC;
    v_variance NUMERIC;
    v_counted  NUMERIC := round(coalesce(p_counted_cash, 0), 2);
    v_z_no     TEXT;
    v_z_id     BIGINT;
    v_user     UUID := auth.uid();
BEGIN
    PERFORM 1 FROM shifts WHERE id = p_shift_id AND closed_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That shift is already closed, or does not exist';
    END IF;
    -- Computed once, at v_now, and used for BOTH the stored variance and the
    -- frozen slip. Calling the aggregator twice could return two different
    -- answers if a sale landed between them, and the paper would then disagree
    -- with the shift row it was printed from.
    v_totals   := z_totals(p_shift_id, v_now);
    v_expected := (v_totals->>'expected_cash')::NUMERIC;
    v_variance := round(v_counted - v_expected, 2);
    UPDATE shifts
       SET closed_by     = v_user,
           closed_at     = v_now,
           counted_cash  = v_counted,
           expected_cash = v_expected,
           variance      = v_variance,
           notes         = p_notes
     WHERE id = p_shift_id;
    -- Z1, Z2, … per shop, not per shift id, so the sequence a shop reads on its
    -- slips has no gaps when a shift row is ever removed.
    SELECT 'Z' || lpad((count(*) + 1)::TEXT, 5, '0') INTO v_z_no FROM z_reports;
    INSERT INTO z_reports (
        shift_id, z_no, closed_at, closed_by,
        counted_cash, expected_cash, variance, totals
    ) VALUES (
        p_shift_id, v_z_no, v_now, v_user,
        v_counted, v_expected, v_variance, v_totals
    ) RETURNING id INTO v_z_id;
    RETURN jsonb_build_object(
        'z_id',           v_z_id,
        'z_no',           v_z_no,
        'counted_cash',   v_counted,
        'expected_cash',  v_expected,
        'variance',       v_variance,
        'totals',         v_totals
    );
END;
$$;
GRANT EXECUTE ON FUNCTION z_totals(INT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION close_shift_z(INT, NUMERIC, TEXT) TO authenticated;

-- ============================================================
-- Kids Corner — migration 014: the daily summary
--
-- The Cashmag-style wide report the Carfectionist back office produces: one row
-- per trading day, with column groups that appear only when there is something
-- in them. An owner reads it across, not down — "which day did card overtake
-- cash", "which category carried the week".
--
-- Aggregated in SQL rather than in the app for the same reason `z_totals` is:
-- a year of sales is tens of thousands of rows, and pulling them into Node to
-- group them would be slow and would put a second implementation of the shop's
-- arithmetic somewhere it can drift.
--
-- VAT IS INCLUDED IN KIDS CORNER PRICES. So for every figure here:
--
--     total_incl  = what the customer paid
--     total_excl  = total_incl - vat        (what is left inside it)
--
-- They are two views of one number, not two numbers to add. The Carfectionist
-- report carries both columns and so does this — but there they are computed
-- from a VAT-exclusive base, and here they are not. Getting that backwards
-- would overstate the shop's turnover by 15%.
--
-- Written as ONE statement with CTEs rather than a temp table: a temp table
-- makes the function VOLATILE, and a report that Postgres believes might write
-- something cannot be safely called from a read replica or reused within a
-- query. The scoping is expressed once in `scoped` and referenced from there.
--
-- Migrations 001-013 are untouched.
-- ============================================================

CREATE OR REPLACE FUNCTION daily_summary(p_from DATE, p_to DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_out JSONB;
BEGIN
    IF p_from IS NULL OR p_to IS NULL THEN
        RAISE EXCEPTION 'daily_summary needs a from and a to date';
    END IF;
    IF p_to < p_from THEN
        RAISE EXCEPTION 'daily_summary: % is before %', p_to, p_from;
    END IF;
    -- Bounded on purpose. An unbounded range would be a table scan of every
    -- sale the shop has ever made, triggered by a mistyped URL.
    IF p_to - p_from > 400 THEN
        RAISE EXCEPTION 'daily_summary: range is longer than 400 days';
    END IF;

    WITH
    -- `sale_date` is a timestamptz; a day in Mauritius is not a day in UTC, and
    -- grouping on the raw column would file an 8pm sale under tomorrow.
    scoped AS (
        SELECT s.id,
               (s.sale_date AT TIME ZONE 'Indian/Mauritius')::DATE AS day,
               s.total,
               s.vat_amount AS vat,
               coalesce(pr.full_name, 'Unknown') AS cashier,
               s.customer_id,
               -- The rate this ticket was actually rung up at, implied from the
               -- frozen figures rather than read from settings, so a range
               -- spanning a rate change reports both.
               to_char(round(CASE WHEN s.total - s.vat_amount > 0
                                  THEN s.vat_amount / (s.total - s.vat_amount) * 100
                                  ELSE 0 END, 2), 'FM990.00') AS rate
          FROM sales s
          LEFT JOIN profiles pr ON pr.id = s.cashier_id
         WHERE s.status = 'completed'
           AND (s.sale_date AT TIME ZONE 'Indian/Mauritius')::DATE BETWEEN p_from AND p_to
    ),
    -- Each line scaled so its sale's lines add up to what that sale took. The
    -- sale-level discount lives on the sale, not the lines, so raw line totals
    -- exceed the day's takings — the same apportionment `z_totals` does.
    lines AS (
        SELECT sc.day,
               si.qty,
               coalesce(nullif(trim(cat.name), ''), '(uncategorised)') AS category,
               si.line_total * CASE WHEN t.line_sum > 0 THEN sc.total / t.line_sum ELSE 1 END AS amount
          FROM sale_items si
          JOIN scoped sc ON sc.id = si.sale_id
          JOIN (
            SELECT si2.sale_id, sum(si2.line_total) AS line_sum
              FROM sale_items si2
             WHERE si2.sale_id IN (SELECT id FROM scoped)
             GROUP BY si2.sale_id
          ) t ON t.sale_id = si.sale_id
          LEFT JOIN product_variants pv ON pv.id = si.variant_id
          LEFT JOIN products p ON p.id = pv.product_id
          LEFT JOIN categories cat ON cat.id = p.category_id
    ),
    pays AS (
        SELECT sc.day, sp.method, sp.amount
          FROM sale_payments sp JOIN scoped sc ON sc.id = sp.sale_id
    ),

    -- ── Per-day aggregates, one CTE per section.
    headline AS (
        SELECT day,
               count(*)::INT AS tickets,
               count(DISTINCT customer_id)::INT AS customers,
               round(sum(total), 2) AS total_incl,
               round(sum(vat), 2) AS vat,
               round(sum(total) - sum(vat), 2) AS total_excl,
               round(sum(total) / count(*), 2) AS avg_incl,
               round((sum(total) - sum(vat)) / count(*), 2) AS avg_excl
          FROM scoped GROUP BY day
    ),
    day_items AS (
        SELECT day, sum(qty)::INT AS items FROM lines GROUP BY day
    ),
    day_methods AS (
        SELECT day, jsonb_object_agg(method, jsonb_build_object(
                 'n', n, 'amount', round(amount, 2))) AS by_method
          FROM (
            SELECT day, method, count(*)::INT AS n, sum(amount) AS amount
              FROM pays GROUP BY day, method
          ) m GROUP BY day
    ),
    day_taxes AS (
        SELECT day, jsonb_object_agg(rate, jsonb_build_object(
                 'incl', round(incl, 2),
                 'excl', round(incl - vat, 2),
                 'vat',  round(vat, 2))) AS by_tax
          FROM (
            SELECT day, rate, sum(total) AS incl, sum(vat) AS vat
              FROM scoped GROUP BY day, rate
          ) t GROUP BY day
    ),
    day_sellers AS (
        SELECT day, jsonb_object_agg(cashier, jsonb_build_object(
                 'n', n, 'amount', round(amount, 2))) AS by_seller
          FROM (
            SELECT day, cashier, count(*)::INT AS n, sum(total) AS amount
              FROM scoped GROUP BY day, cashier
          ) s GROUP BY day
    ),
    day_categories AS (
        SELECT day, jsonb_object_agg(category, jsonb_build_object(
                 'qty', qty, 'amount', round(amount, 2))) AS by_category
          FROM (
            SELECT day, category, sum(qty)::INT AS qty, sum(amount) AS amount
              FROM lines GROUP BY day, category
          ) c GROUP BY day
    ),

    -- ── The column headers.
    --
    -- Dynamic: a method, cashier or category only earns a column if it actually
    -- traded in the period. A report with a permanently empty "Juice" column
    -- teaches an owner to skim past columns, which is how a real one gets
    -- missed.
    cols AS (
        SELECT
          (SELECT coalesce(jsonb_agg(DISTINCT method ORDER BY method), '[]'::jsonb) FROM pays)     AS methods,
          (SELECT coalesce(jsonb_agg(DISTINCT rate ORDER BY rate), '[]'::jsonb) FROM scoped)       AS taxes,
          (SELECT coalesce(jsonb_agg(DISTINCT cashier ORDER BY cashier), '[]'::jsonb) FROM scoped) AS sellers,
          (SELECT coalesce(jsonb_agg(DISTINCT category ORDER BY category), '[]'::jsonb) FROM lines) AS categories
    )

    SELECT jsonb_build_object(
        'from', p_from,
        'to',   p_to,
        'rows', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                     'day',         h.day,
                     'tickets',     h.tickets,
                     'items',       coalesce(di.items, 0),
                     'customers',   h.customers,
                     'total_incl',  h.total_incl,
                     'vat',         h.vat,
                     'total_excl',  h.total_excl,
                     'avg_incl',    h.avg_incl,
                     'avg_excl',    h.avg_excl,
                     'by_method',   coalesce(dm.by_method, '{}'::jsonb),
                     'by_tax',      coalesce(dt.by_tax, '{}'::jsonb),
                     'by_seller',   coalesce(ds.by_seller, '{}'::jsonb),
                     'by_category', coalesce(dc.by_category, '{}'::jsonb)
                   ) ORDER BY h.day)
              FROM headline h
              LEFT JOIN day_items      di ON di.day = h.day
              LEFT JOIN day_methods    dm ON dm.day = h.day
              LEFT JOIN day_taxes      dt ON dt.day = h.day
              LEFT JOIN day_sellers    ds ON ds.day = h.day
              LEFT JOIN day_categories dc ON dc.day = h.day
        ), '[]'::jsonb),
        'methods',    (SELECT methods    FROM cols),
        'taxes',      (SELECT taxes      FROM cols),
        'sellers',    (SELECT sellers    FROM cols),
        'categories', (SELECT categories FROM cols)
    ) INTO v_out;

    RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION daily_summary(DATE, DATE) TO authenticated;


-- ============================================================
-- Kids Corner — migration 015: sales that arrived after their Z
--
-- THE PROBLEM THIS MAKES VISIBLE.
--
-- The till queues a sale it could not send (migration 011's idempotency key is
-- what makes that safe). `close_shift_z` freezes the Z from what the database
-- holds at that instant. If a queued sale is still on the tablet when the till
-- is closed, it is not in that snapshot — and when it drains minutes later it
-- lands in a shift whose Z is already frozen and cannot be corrected.
--
-- The result is a Z that is short by that sale, permanently, and a drawer that
-- is over by its cash with nothing on the slip to explain why.
--
-- The tablet now refuses to close while anything is queued, which prevents this
-- in the normal case. But "the app was reinstalled", "the tablet died flat" and
-- "someone closed on a second device" are all real, and a silent discrepancy in
-- a fiscal record is the worst kind. So this makes it findable.
--
-- Detection, not prevention. Rejecting the sale would be far worse: the shop
-- has already taken the customer's money.
--
-- Migrations 001-014 are untouched.
-- ============================================================

-- ===== late_sales =====
-- Sales that were written into a shift after that shift's Z was frozen.
--
-- A view rather than a flag on `sales`: this is a question asked occasionally by
-- the back office, not a fact worth denormalising onto every ticket, and a view
-- cannot drift out of date the way a stored flag would.
CREATE OR REPLACE VIEW late_sales AS
SELECT
    s.id            AS sale_id,
    s.sale_no,
    s.shift_id,
    s.total,
    s.sale_date,
    z.z_no,
    z.closed_at,
    -- How long after the Z it landed. A few seconds is a close racing a drain;
    -- an hour is a tablet that was offline and came back.
    s.sale_date - z.closed_at AS arrived_after
  FROM sales s
  JOIN z_reports z ON z.shift_id = s.shift_id
 WHERE s.status = 'completed'
   -- `sale_date` is stamped by `complete_sale` when the row is written, so for
   -- a queued sale it is the moment it finally reached the server — which is
   -- exactly the comparison wanted here.
   AND s.sale_date > z.closed_at;

COMMENT ON VIEW late_sales IS
  'Completed sales written into a shift after its Z report was frozen. Each one '
  'means that Z understates the shift by its total. Should normally be empty.';

-- ===== shift_z_variance =====
-- What a shift's Z says against what its sales now add up to.
--
-- The honest reconciliation: `z_total` is the frozen figure on the paper,
-- `actual_total` is what the ledger holds today. They should be identical, and
-- the difference is the amount of money the slip in the shop's file does not
-- account for.
CREATE OR REPLACE VIEW shift_z_variance AS
SELECT
    z.shift_id,
    z.z_no,
    z.closed_at,
    (z.totals->>'sales_total')::NUMERIC AS z_total,
    coalesce((
      SELECT round(sum(s.total), 2) FROM sales s
       WHERE s.shift_id = z.shift_id AND s.status = 'completed'
    ), 0) AS actual_total,
    coalesce((
      SELECT round(sum(s.total), 2) FROM sales s
       WHERE s.shift_id = z.shift_id AND s.status = 'completed'
    ), 0) - (z.totals->>'sales_total')::NUMERIC AS unreported,
    (SELECT count(*) FROM late_sales l WHERE l.shift_id = z.shift_id)::INT AS late_count
  FROM z_reports z;

COMMENT ON VIEW shift_z_variance IS
  'Frozen Z total against what the shift holds now. `unreported` should be 0.00 '
  'on every row; anything else is money the printed slip does not account for.';

GRANT SELECT ON late_sales TO authenticated;
GRANT SELECT ON shift_z_variance TO authenticated;


-- ============================================================
-- Kids Corner — migration 016: traceability
--
-- Most of what a shop needs to trace already leaves a record: a sale is a sale
-- row, a stock adjustment is a stock_movement, a reprint is a receipt_print,
-- a close is a z_report. The activity feed is built by reading those, not by
-- duplicating them into a log — a log that can disagree with the thing it
-- describes is worse than no log.
--
-- WHAT LEAVES NO TRACE TODAY, AND SHOULD.
--
--   • A SELLING PRICE CHANGE. `product_variants` has no timestamps and no
--     audit at all. Someone can halve a price, sell to a friend, and put it
--     back, and nothing anywhere records it. After cash, this is the single
--     most important thing in a shop to be able to trace.
--   • A PIN OR ROLE CHANGE. Both are access control.
--   • A SETTINGS OR DISCOUNT-RULE CHANGE. Both move money.
--
-- WHY TRIGGERS RATHER THAN APPLICATION CODE.
--
-- The app is not the only way in. A migration, a psql session, or the Supabase
-- table editor all bypass it. A trigger sees every write, and an audit trail
-- with a documented hole in it is not an audit trail.
--
-- Migrations 001-015 are untouched.
-- ============================================================

-- NOT ADDED HERE: an author column on `credit_notes`.
--
-- It already has `cashier_id`, set by `create_credit_note` to the PIN-selected
-- cashier — which is the better attribution of the two, because it names the
-- person accountable rather than the shared device account they were signed in
-- under. A second author column would have sat permanently NULL and implied
-- refunds were going unattributed when they were not.

-- ===== audit_events =====
CREATE TABLE IF NOT EXISTS audit_events (
    id         BIGSERIAL PRIMARY KEY,
    at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL means the change did not come through the app — a migration, or
    -- somebody in the SQL editor. Worth being able to see, so it is recorded
    -- rather than hidden behind a placeholder.
    actor_id   UUID REFERENCES profiles(id),
    event_type TEXT NOT NULL,
    ref_type   TEXT NOT NULL,
    ref_id     TEXT,
    -- Just enough to render the line without joining back to a row that may
    -- since have changed or been deleted.
    summary    TEXT NOT NULL,
    detail     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_events_at ON audit_events (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events (event_type, at DESC);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Readable by staff; written only by the triggers below, which are SECURITY
-- DEFINER. There is deliberately no INSERT, UPDATE or DELETE policy: a trail
-- that the people it describes can edit is not a control.
DROP POLICY IF EXISTS read_audit_events ON audit_events;
CREATE POLICY read_audit_events ON audit_events
    FOR SELECT TO authenticated USING (true);

-- ===== the recorder =====
CREATE OR REPLACE FUNCTION log_audit(
    p_event_type TEXT,
    p_ref_type   TEXT,
    p_ref_id     TEXT,
    p_summary    TEXT,
    p_detail     JSONB DEFAULT '{}'::jsonb
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO audit_events (actor_id, event_type, ref_type, ref_id, summary, detail)
    VALUES (auth.uid(), p_event_type, p_ref_type, p_ref_id, p_summary, p_detail);
END;
$$;

-- ===== price changes =====
--
-- Guarded by a WHEN clause on the trigger, not by an IF inside the function.
-- `complete_sale` updates `qty_on_hand` on every line of every sale, so a
-- trigger that fired on any UPDATE would write an audit row per item sold and
-- bury the price changes it exists to surface.
CREATE OR REPLACE FUNCTION audit_variant_price() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_name TEXT;
BEGIN
    SELECT p.name INTO v_name
      FROM products p WHERE p.id = NEW.product_id;

    IF OLD.selling_price IS DISTINCT FROM NEW.selling_price THEN
        PERFORM log_audit(
            'price.changed', 'product_variant', NEW.id::TEXT,
            format('%s (%s): price %s to %s',
                   coalesce(v_name, 'a product'), NEW.sku,
                   to_char(OLD.selling_price, 'FM999999990.00'),
                   to_char(NEW.selling_price, 'FM999999990.00')),
            jsonb_build_object('sku', NEW.sku, 'product', v_name,
                               'from', OLD.selling_price, 'to', NEW.selling_price)
        );
    END IF;

    IF OLD.cost_price IS DISTINCT FROM NEW.cost_price THEN
        PERFORM log_audit(
            'cost.changed', 'product_variant', NEW.id::TEXT,
            format('%s (%s): cost %s to %s',
                   coalesce(v_name, 'a product'), NEW.sku,
                   to_char(OLD.cost_price, 'FM999999990.00'),
                   to_char(NEW.cost_price, 'FM999999990.00')),
            jsonb_build_object('sku', NEW.sku, 'product', v_name,
                               'from', OLD.cost_price, 'to', NEW.cost_price)
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_variant_price ON product_variants;
CREATE TRIGGER trg_audit_variant_price
    AFTER UPDATE ON product_variants
    FOR EACH ROW
    WHEN (OLD.selling_price IS DISTINCT FROM NEW.selling_price
       OR OLD.cost_price IS DISTINCT FROM NEW.cost_price)
    EXECUTE FUNCTION audit_variant_price();

-- ===== staff access =====
CREATE OR REPLACE FUNCTION audit_profile_access() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF OLD.role IS DISTINCT FROM NEW.role THEN
        PERFORM log_audit(
            'staff.role_changed', 'profile', NEW.id::TEXT,
            format('%s: role %s to %s', NEW.full_name, OLD.role, NEW.role),
            jsonb_build_object('from', OLD.role, 'to', NEW.role)
        );
    END IF;

    -- The hash itself is never recorded, only that it changed. An audit trail
    -- carrying credentials is a second copy of them.
    IF OLD.pin_code IS DISTINCT FROM NEW.pin_code THEN
        PERFORM log_audit(
            'staff.pin_changed', 'profile', NEW.id::TEXT,
            format('%s: PIN %s', NEW.full_name,
                   CASE WHEN NEW.pin_code IS NULL THEN 'cleared' ELSE 'set' END),
            jsonb_build_object('cleared', NEW.pin_code IS NULL)
        );
    END IF;

    IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
        PERFORM log_audit(
            'staff.active_changed', 'profile', NEW.id::TEXT,
            format('%s: %s', NEW.full_name,
                   CASE WHEN NEW.is_active THEN 'reactivated' ELSE 'deactivated' END),
            jsonb_build_object('active', NEW.is_active)
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_profile_access ON profiles;
CREATE TRIGGER trg_audit_profile_access
    AFTER UPDATE ON profiles
    FOR EACH ROW
    WHEN (OLD.role IS DISTINCT FROM NEW.role
       OR OLD.pin_code IS DISTINCT FROM NEW.pin_code
       OR OLD.is_active IS DISTINCT FROM NEW.is_active)
    EXECUTE FUNCTION audit_profile_access();

-- ===== settings =====
CREATE OR REPLACE FUNCTION audit_settings() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM log_audit(
        'setting.changed', 'setting', NEW.key,
        format('%s changed', NEW.key),
        jsonb_build_object('key', NEW.key, 'from', OLD.value, 'to', NEW.value)
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_settings ON settings;
CREATE TRIGGER trg_audit_settings
    AFTER UPDATE ON settings
    FOR EACH ROW
    WHEN (OLD.value IS DISTINCT FROM NEW.value)
    EXECUTE FUNCTION audit_settings();

-- ===== discount rules =====
-- These decide how much money can come off a sale, so a change to one is a
-- change to the shop's pricing policy.
CREATE OR REPLACE FUNCTION audit_discounts() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_audit('discount.created', 'discount', NEW.id::TEXT,
            format('Discount created: %s', NEW.name),
            to_jsonb(NEW) - 'created_at');
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        PERFORM log_audit('discount.deleted', 'discount', OLD.id::TEXT,
            format('Discount deleted: %s', OLD.name),
            to_jsonb(OLD) - 'created_at');
        RETURN OLD;
    END IF;

    PERFORM log_audit('discount.changed', 'discount', NEW.id::TEXT,
        format('Discount changed: %s', NEW.name),
        jsonb_build_object(
            'from', to_jsonb(OLD) - 'created_at',
            'to',   to_jsonb(NEW) - 'created_at'));
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_discounts ON discounts;
CREATE TRIGGER trg_audit_discounts
    AFTER INSERT OR UPDATE OR DELETE ON discounts
    FOR EACH ROW EXECUTE FUNCTION audit_discounts();

-- ===== voided and refunded sales =====
-- A status change on a sale is money reversed.
CREATE OR REPLACE FUNCTION audit_sale_status() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM log_audit(
        'sale.' || NEW.status, 'sale', NEW.id::TEXT,
        format('%s marked %s (%s)', NEW.sale_no, NEW.status,
               to_char(NEW.total, 'FM999999990.00')),
        jsonb_build_object('sale_no', NEW.sale_no, 'from', OLD.status,
                           'to', NEW.status, 'total', NEW.total)
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_sale_status ON sales;
CREATE TRIGGER trg_audit_sale_status
    AFTER UPDATE ON sales
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION audit_sale_status();

GRANT EXECUTE ON FUNCTION log_audit(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;


-- ============================================================
-- Done. Expect 27 tables, 4 views, 33 functions, and the seed counts.
-- ============================================================

SELECT
    (SELECT count(*) FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('profiles','categories','brands','sizes','colours',
                            'suppliers','customers','settings','products',
                            'product_variants','stock_movements','purchases',
                            'purchase_items','shifts','sales','sale_items',
                            'sale_payments','till_movements'))   AS tables_present,
    (SELECT count(*) FROM information_schema.views
       WHERE table_schema = 'public'
         AND table_name IN ('low_stock_variants',
                                            'stock_by_location'))         AS views_present,
    (SELECT count(*) FROM information_schema.routines
       WHERE routine_schema = 'public'
         AND routine_name IN ('current_role_of_user','record_stock_movement',
                              'complete_sale','receive_purchase',
                              'record_till_movement','shift_totals',
                              'forbid_till_mutation',
                              'allocate_barcode_serials',
                              'set_barcode_scheme','pin_lock_state',
                              'register_pin_attempt','clear_pin_lock')) AS functions_present,
    -- The stock floor is a constraint rather than a function, so it needs its
    -- own check: without it a sale can drive a variant negative, and that is
    -- the sort of thing you want to find here rather than on a Saturday.
    (SELECT count(*) FROM pg_constraint
       WHERE conname = 'qty_on_hand_non_negative')                AS stock_floor,
    (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name IN ('pin_failed_count','pin_locked_until',
                             'pin_last_used_at'))                 AS pin_lockout_cols,
    (SELECT count(*) FROM sizes)                                  AS sizes,
    (SELECT count(*) FROM colours)                                AS colours,
    (SELECT count(*) FROM categories)                             AS categories,
    (SELECT count(*) FROM settings)                               AS settings,
    (SELECT count(*) FROM profiles)                               AS staff_profiles;
