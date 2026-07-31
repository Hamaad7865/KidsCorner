-- ============================================================
-- Kids Corner — Merged Back Office + POS
-- Supabase migration 001: schema, RLS, RPCs
-- Run in Supabase SQL Editor (or supabase db push)
-- ============================================================

-- ===== Profiles (linked to Supabase Auth) =====

CREATE TABLE profiles (
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

CREATE TABLE categories (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    parent_id   INT REFERENCES categories(id),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE brands (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE sizes (
    id          SERIAL PRIMARY KEY,
    size_type   TEXT NOT NULL CHECK (size_type IN ('age_range', 'shoe_size')),
    label       TEXT NOT NULL,           -- '2-3 yrs', 'EU 24'
    sort_order  INT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (size_type, label)
);

CREATE TABLE colours (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    hex_code    TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE suppliers (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    phone       TEXT,
    email       TEXT,
    address     TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE customers (
    id          SERIAL PRIMARY KEY,
    full_name   TEXT NOT NULL,
    phone       TEXT UNIQUE,
    email       TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
    key         TEXT PRIMARY KEY,        -- 'shop_name', 'vat_rate', ...
    value       JSONB NOT NULL
);

INSERT INTO settings (key, value) VALUES
    ('shop_name',       '"Kids Corner"'),
    ('vat_rate',        '0.15'),
    ('currency',        '"MUR"'),
    ('payment_methods', '["cash","card","juice","myt_money"]');

-- ===== Catalog =====

CREATE TABLE products (
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

CREATE TABLE product_variants (
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

CREATE INDEX idx_variants_barcode ON product_variants (barcode);
CREATE INDEX idx_variants_product ON product_variants (product_id);

-- ===== Stock =====

CREATE TABLE stock_movements (
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

CREATE INDEX idx_stock_movements_variant ON stock_movements (variant_id, created_at);

-- ===== Purchasing =====

CREATE TABLE purchases (
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

CREATE TABLE purchase_items (
    id              SERIAL PRIMARY KEY,
    purchase_id     INT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    variant_id      INT NOT NULL REFERENCES product_variants(id),
    qty             INT NOT NULL CHECK (qty > 0),
    unit_cost       NUMERIC(10,2) NOT NULL,
    line_total      NUMERIC(12,2) GENERATED ALWAYS AS (qty * unit_cost) STORED
);

-- ===== Shifts =====

CREATE TABLE shifts (
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

CREATE TABLE sales (
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

CREATE TABLE sale_items (
    id              BIGSERIAL PRIMARY KEY,
    sale_id         BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    variant_id      INT NOT NULL REFERENCES product_variants(id),
    qty             INT NOT NULL CHECK (qty > 0),
    unit_price      NUMERIC(10,2) NOT NULL,
    discount        NUMERIC(10,2) NOT NULL DEFAULT 0,
    line_total      NUMERIC(12,2) NOT NULL
);

-- Split payments: one sale can have multiple payment rows
CREATE TABLE sale_payments (
    id              BIGSERIAL PRIMARY KEY,
    sale_id         BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method          TEXT NOT NULL CHECK (method IN ('cash', 'card', 'juice', 'myt_money')),
    amount          NUMERIC(12,2) NOT NULL,
    tendered        NUMERIC(12,2),       -- cash given (for change calc)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RPCs (atomic operations — supabase-js can't do transactions)
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
CREATE POLICY read_all ON categories       FOR SELECT TO authenticated USING (true);
CREATE POLICY read_all ON brands           FOR SELECT TO authenticated USING (true);
CREATE POLICY read_all ON sizes            FOR SELECT TO authenticated USING (true);
CREATE POLICY read_all ON colours          FOR SELECT TO authenticated USING (true);
CREATE POLICY read_all ON products         FOR SELECT TO authenticated USING (true);
CREATE POLICY read_all ON product_variants FOR SELECT TO authenticated USING (true);
CREATE POLICY read_all ON customers        FOR SELECT TO authenticated USING (true);
CREATE POLICY read_all ON settings         FOR SELECT TO authenticated USING (true);
CREATE POLICY read_all ON profiles         FOR SELECT TO authenticated USING (true);
CREATE POLICY read_all ON shifts           FOR SELECT TO authenticated USING (true);
CREATE POLICY read_all ON sales            FOR SELECT TO authenticated USING (true);
CREATE POLICY read_all ON sale_items       FOR SELECT TO authenticated USING (true);
CREATE POLICY read_all ON sale_payments    FOR SELECT TO authenticated USING (true);

-- Only owner/manager can modify catalog, master data, purchases, suppliers
CREATE POLICY manage ON categories FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
CREATE POLICY manage ON brands FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
CREATE POLICY manage ON sizes FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
CREATE POLICY manage ON colours FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
CREATE POLICY manage ON products FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
CREATE POLICY manage ON product_variants FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
CREATE POLICY manage ON suppliers FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
CREATE POLICY read_suppliers ON suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY manage ON purchases FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
CREATE POLICY read_purchases ON purchases FOR SELECT TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
CREATE POLICY manage ON purchase_items FOR ALL TO authenticated
    USING (current_role_of_user() IN ('owner','manager'));
CREATE POLICY manage ON settings FOR ALL TO authenticated
    USING (current_role_of_user() = 'owner');
CREATE POLICY manage_profiles ON profiles FOR ALL TO authenticated
    USING (current_role_of_user() = 'owner');

-- Cashiers can create customers, shifts (open/close), and stock reads
CREATE POLICY create_customers ON customers FOR INSERT TO authenticated
    WITH CHECK (true);
CREATE POLICY manage_shifts ON shifts FOR ALL TO authenticated USING (true);
CREATE POLICY read_stock ON stock_movements FOR SELECT TO authenticated
    USING (true);

-- Sales/movements are written ONLY through the SECURITY DEFINER RPCs,
-- so no direct INSERT policies on sales/sale_items/sale_payments/stock_movements.

-- ===== Starter seed data =====

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
    ('shoe_size', 'EU 27', 28), ('shoe_size', 'EU 28', 29);

INSERT INTO colours (name, hex_code) VALUES
    ('Red', '#E53935'), ('Blue', '#1E88E5'), ('Navy', '#1A237E'),
    ('Pink', '#EC407A'), ('White', '#FFFFFF'), ('Black', '#212121'),
    ('Yellow', '#FDD835'), ('Green', '#43A047'), ('Grey', '#9E9E9E'),
    ('Purple', '#8E24AA'), ('Orange', '#FB8C00'), ('Beige', '#D7CCC8');

INSERT INTO categories (name) VALUES
    ('T-Shirts'), ('Dresses'), ('Trousers'), ('Shorts'),
    ('Pyjamas'), ('Shoes'), ('Sandals'), ('Accessories');