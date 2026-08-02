-- ============================================================================
-- Kids Corner — complete schema
--
-- A SNAPSHOT of the live database, generated from its own catalog, not a replay
-- of the migration history. Run it on a fresh Supabase project and you get
-- exactly the schema the shop is running.
--
-- Why a snapshot. The previous version of this file was every migration
-- rewritten to be idempotent, and it drifted twice over: it stopped at 025, so
-- a fresh project was missing the two migrations that keep the shop's takings
-- private (028 pins search_path on every SECURITY DEFINER function; 035 takes
-- EXECUTE away from the publishable key's role). And inside its own range its
-- create_credit_note was still the original six-argument version — so the later
-- migrations, several of which patch a function body by matching on text, had
-- no anchor to find.
--
-- The numbered files in supabase/Migrations/ remain the historical record of
-- what was applied and why. This file is what you RUN.
--
-- Safe to re-run: every object is dropped-if-exists or created-if-not-exists,
-- and the seed rows are ON CONFLICT DO NOTHING.
--
-- It assumes Supabase's own auth and storage schemas already exist, which they
-- do on any real project.
--
-- Generated 2026-08-02 from the live schema.
-- ============================================================================

-- ==========================================================================
-- EXTENSIONS
-- ==========================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ==========================================================================
-- TABLES
-- ==========================================================================

CREATE TABLE IF NOT EXISTS audit_events (
    id BIGSERIAL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    event_type text NOT NULL,
    ref_type text NOT NULL,
    ref_id text,
    summary text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    device_id integer
);

CREATE TABLE IF NOT EXISTS brands (
    id SERIAL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
    id SERIAL,
    name text NOT NULL,
    parent_id integer,
    is_active boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS colours (
    id SERIAL,
    name text NOT NULL,
    hex_code text,
    is_active boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_note_items (
    id BIGSERIAL,
    credit_note_id bigint NOT NULL,
    sale_item_id bigint NOT NULL,
    variant_id integer,
    qty integer NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    line_total numeric(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_notes (
    id BIGSERIAL,
    credit_no text NOT NULL,
    sale_id bigint NOT NULL,
    shift_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cashier_id uuid,
    reason text NOT NULL,
    subtotal numeric(12,2) NOT NULL,
    vat_amount numeric(12,2) DEFAULT 0 NOT NULL,
    total numeric(12,2) NOT NULL,
    refund_method text NOT NULL,
    approved_by uuid
);

CREATE TABLE IF NOT EXISTS customers (
    id SERIAL,
    full_name text NOT NULL,
    phone text,
    email text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS discounts (
    id SERIAL,
    name text NOT NULL,
    code text,
    kind text NOT NULL,
    value numeric(10,2) NOT NULL,
    scope text DEFAULT 'sale'::text NOT NULL,
    category_id integer,
    min_spend numeric(10,2) DEFAULT 0 NOT NULL,
    max_amount numeric(10,2),
    starts_on date,
    ends_on date,
    requires_manager boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_counters (
    kind text NOT NULL,
    day text NOT NULL,
    n integer NOT NULL
);

CREATE TABLE IF NOT EXISTS module_access (
    id SERIAL,
    role text NOT NULL,
    module text NOT NULL,
    can_view boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS pos_devices (
    id SERIAL,
    code text NOT NULL,
    name text NOT NULL,
    model text,
    app_version text,
    is_back_office boolean DEFAULT false NOT NULL,
    last_seen_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS product_variants (
    id SERIAL,
    product_id integer NOT NULL,
    size_id integer NOT NULL,
    colour_id integer NOT NULL,
    sku text NOT NULL,
    barcode text,
    cost_price numeric(10,2) DEFAULT 0 NOT NULL,
    selling_price numeric(10,2) NOT NULL,
    qty_on_hand integer DEFAULT 0 NOT NULL,
    reorder_level integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id SERIAL,
    name text NOT NULL,
    category_id integer NOT NULL,
    brand_id integer,
    gender text DEFAULT 'unisex'::text NOT NULL,
    description text,
    image_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
    id uuid NOT NULL,
    full_name text NOT NULL,
    role text DEFAULT 'cashier'::text NOT NULL,
    pin_code text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    pin_failed_count integer DEFAULT 0 NOT NULL,
    pin_locked_until timestamp with time zone,
    pin_last_used_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id SERIAL,
    purchase_id integer NOT NULL,
    variant_id integer NOT NULL,
    qty integer NOT NULL,
    unit_cost numeric(10,2) NOT NULL,
    line_total numeric(12,2) GENERATED ALWAYS AS ((qty)::numeric * unit_cost) STORED
);

CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL,
    supplier_id integer NOT NULL,
    invoice_no text,
    purchase_date date DEFAULT CURRENT_DATE NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expected_date date
);

CREATE TABLE IF NOT EXISTS receipt_prints (
    id BIGSERIAL,
    sale_id bigint NOT NULL,
    printed_by uuid,
    printed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_discounts (
    id BIGSERIAL,
    sale_id bigint NOT NULL,
    discount_id integer,
    label text NOT NULL,
    kind text NOT NULL,
    value numeric(10,2) NOT NULL,
    amount numeric(12,2) NOT NULL,
    approved_by uuid
);

CREATE TABLE IF NOT EXISTS sale_items (
    id BIGSERIAL,
    sale_id bigint NOT NULL,
    variant_id integer,
    qty integer NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    discount numeric(10,2) DEFAULT 0 NOT NULL,
    line_total numeric(12,2) NOT NULL,
    description text
);

CREATE TABLE IF NOT EXISTS sale_payments (
    id BIGSERIAL,
    sale_id bigint NOT NULL,
    method text NOT NULL,
    amount numeric(12,2) NOT NULL,
    tendered numeric(12,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
    id BIGSERIAL,
    sale_no text NOT NULL,
    shift_id integer,
    customer_id integer,
    sale_date timestamp with time zone DEFAULT now() NOT NULL,
    subtotal numeric(12,2) NOT NULL,
    discount numeric(12,2) DEFAULT 0 NOT NULL,
    vat_amount numeric(12,2) DEFAULT 0 NOT NULL,
    total numeric(12,2) NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    cashier_id uuid,
    idempotency_key text
);

CREATE TABLE IF NOT EXISTS settings (
    key text NOT NULL,
    value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
    id SERIAL,
    opened_by uuid NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    opening_float numeric(10,2) DEFAULT 0 NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    counted_cash numeric(10,2),
    expected_cash numeric(10,2),
    variance numeric(10,2),
    notes text,
    device_id integer
);

CREATE TABLE IF NOT EXISTS sizes (
    id SERIAL,
    size_type text NOT NULL,
    label text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_locations (
    id SERIAL,
    name text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
    id BIGSERIAL,
    variant_id integer NOT NULL,
    movement_type text NOT NULL,
    qty integer NOT NULL,
    reference_type text,
    reference_id bigint,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    location_id integer
);

CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL,
    name text NOT NULL,
    phone text,
    email text,
    address text,
    is_active boolean DEFAULT true NOT NULL,
    contact_name text,
    town text,
    payment_terms text
);

CREATE TABLE IF NOT EXISTS till_movements (
    id BIGSERIAL,
    shift_id integer NOT NULL,
    amount numeric(10,2) NOT NULL,
    reason text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS z_reports (
    id BIGSERIAL,
    shift_id integer NOT NULL,
    z_no text NOT NULL,
    closed_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_by uuid,
    counted_cash numeric(12,2) DEFAULT 0 NOT NULL,
    expected_cash numeric(12,2) DEFAULT 0 NOT NULL,
    variance numeric(12,2) DEFAULT 0 NOT NULL,
    totals jsonb NOT NULL
);


-- ==========================================================================
-- CONSTRAINTS — primary keys, uniques, checks, then foreign keys
-- ==========================================================================

DO $$ BEGIN
    ALTER TABLE audit_events ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE brands ADD CONSTRAINT brands_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE categories ADD CONSTRAINT categories_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE colours ADD CONSTRAINT colours_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_note_items ADD CONSTRAINT credit_note_items_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE discounts ADD CONSTRAINT discounts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE doc_counters ADD CONSTRAINT doc_counters_pkey PRIMARY KEY (kind, day);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE module_access ADD CONSTRAINT module_access_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE pos_devices ADD CONSTRAINT pos_devices_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE product_variants ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE purchases ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE receipt_prints ADD CONSTRAINT receipt_prints_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_discounts ADD CONSTRAINT sale_discounts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_items ADD CONSTRAINT sale_items_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sales ADD CONSTRAINT sales_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE settings ADD CONSTRAINT settings_pkey PRIMARY KEY (key);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE shifts ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sizes ADD CONSTRAINT sizes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE till_movements ADD CONSTRAINT till_movements_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE z_reports ADD CONSTRAINT z_reports_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE brands ADD CONSTRAINT brands_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE categories ADD CONSTRAINT categories_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE colours ADD CONSTRAINT colours_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_credit_no_key UNIQUE (credit_no);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE customers ADD CONSTRAINT customers_phone_key UNIQUE (phone);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE discounts ADD CONSTRAINT discounts_code_key UNIQUE (code);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE module_access ADD CONSTRAINT module_access_role_module_key UNIQUE (role, module);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE pos_devices ADD CONSTRAINT pos_devices_code_key UNIQUE (code);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE product_variants ADD CONSTRAINT product_variants_barcode_key UNIQUE (barcode);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE product_variants ADD CONSTRAINT product_variants_product_id_size_id_colour_id_key UNIQUE (product_id, size_id, colour_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE product_variants ADD CONSTRAINT product_variants_sku_key UNIQUE (sku);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sales ADD CONSTRAINT sales_sale_no_key UNIQUE (sale_no);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sizes ADD CONSTRAINT sizes_size_type_label_key UNIQUE (size_type, label);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE z_reports ADD CONSTRAINT z_reports_shift_unique UNIQUE (shift_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_note_items ADD CONSTRAINT credit_note_items_qty_check CHECK ((qty > 0));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_refund_method_check CHECK ((refund_method = ANY (ARRAY['cash'::text, 'card'::text, 'juice'::text, 'myt_money'::text, 'exchange'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE discounts ADD CONSTRAINT discounts_kind_check CHECK ((kind = ANY (ARRAY['percent'::text, 'amount'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE discounts ADD CONSTRAINT discounts_line_scope_needs_category CHECK (((scope <> 'line'::text) OR (category_id IS NOT NULL)));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE discounts ADD CONSTRAINT discounts_max_amount_check CHECK (((max_amount IS NULL) OR (max_amount > (0)::numeric)));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE discounts ADD CONSTRAINT discounts_min_spend_check CHECK ((min_spend >= (0)::numeric));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE discounts ADD CONSTRAINT discounts_percent_sane CHECK (((kind <> 'percent'::text) OR (value <= (100)::numeric)));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE discounts ADD CONSTRAINT discounts_scope_check CHECK ((scope = ANY (ARRAY['sale'::text, 'line'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE discounts ADD CONSTRAINT discounts_value_check CHECK ((value > (0)::numeric));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE discounts ADD CONSTRAINT discounts_window_sane CHECK (((starts_on IS NULL) OR (ends_on IS NULL) OR (ends_on >= starts_on)));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE doc_counters ADD CONSTRAINT doc_counters_kind_check CHECK ((kind = ANY (ARRAY['sale'::text, 'credit'::text, 'z'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE module_access ADD CONSTRAINT module_access_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'cashier'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE product_variants ADD CONSTRAINT qty_on_hand_non_negative CHECK ((qty_on_hand >= 0));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE products ADD CONSTRAINT products_gender_check CHECK ((gender = ANY (ARRAY['boy'::text, 'girl'::text, 'unisex'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'cashier'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_qty_check CHECK ((qty > 0));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE purchases ADD CONSTRAINT purchases_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'received'::text, 'cancelled'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_discounts ADD CONSTRAINT sale_discounts_amount_check CHECK ((amount >= (0)::numeric));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_discounts ADD CONSTRAINT sale_discounts_kind_check CHECK ((kind = ANY (ARRAY['percent'::text, 'amount'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_items ADD CONSTRAINT sale_items_identifiable CHECK (((variant_id IS NOT NULL) OR ((description IS NOT NULL) AND (length(TRIM(BOTH FROM description)) > 0))));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_items ADD CONSTRAINT sale_items_qty_check CHECK ((qty > 0));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check CHECK ((method = ANY (ARRAY['cash'::text, 'card'::text, 'juice'::text, 'myt_money'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'refunded'::text, 'void'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sizes ADD CONSTRAINT sizes_size_type_check CHECK ((size_type = ANY (ARRAY['age_range'::text, 'shoe_size'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['purchase'::text, 'sale'::text, 'adjustment'::text, 'return'::text, 'opening'::text, 'import'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE till_movements ADD CONSTRAINT till_movements_amount_check CHECK ((amount <> (0)::numeric));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE till_movements ADD CONSTRAINT till_movements_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE audit_events ADD CONSTRAINT audit_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE audit_events ADD CONSTRAINT audit_events_device_id_fkey FOREIGN KEY (device_id) REFERENCES pos_devices(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE categories ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES categories(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_note_items ADD CONSTRAINT credit_note_items_credit_note_id_fkey FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_note_items ADD CONSTRAINT credit_note_items_sale_item_id_fkey FOREIGN KEY (sale_item_id) REFERENCES sale_items(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_note_items ADD CONSTRAINT credit_note_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES product_variants(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE discounts ADD CONSTRAINT discounts_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE product_variants ADD CONSTRAINT product_variants_colour_id_fkey FOREIGN KEY (colour_id) REFERENCES colours(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE product_variants ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE product_variants ADD CONSTRAINT product_variants_size_id_fkey FOREIGN KEY (size_id) REFERENCES sizes(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE products ADD CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES brands(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE products ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES product_variants(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE purchases ADD CONSTRAINT purchases_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE purchases ADD CONSTRAINT purchases_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE receipt_prints ADD CONSTRAINT receipt_prints_printed_by_fkey FOREIGN KEY (printed_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE receipt_prints ADD CONSTRAINT receipt_prints_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_discounts ADD CONSTRAINT sale_discounts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_discounts ADD CONSTRAINT sale_discounts_discount_id_fkey FOREIGN KEY (discount_id) REFERENCES discounts(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_discounts ADD CONSTRAINT sale_discounts_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_items ADD CONSTRAINT sale_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_items ADD CONSTRAINT sale_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES product_variants(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sales ADD CONSTRAINT sales_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sales ADD CONSTRAINT sales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sales ADD CONSTRAINT sales_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE shifts ADD CONSTRAINT shifts_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE shifts ADD CONSTRAINT shifts_device_id_fkey FOREIGN KEY (device_id) REFERENCES pos_devices(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE shifts ADD CONSTRAINT shifts_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_location_id_fkey FOREIGN KEY (location_id) REFERENCES stock_locations(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES product_variants(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE till_movements ADD CONSTRAINT till_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE till_movements ADD CONSTRAINT till_movements_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE z_reports ADD CONSTRAINT z_reports_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE z_reports ADD CONSTRAINT z_reports_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

-- ==========================================================================
-- INDEXES
-- ==========================================================================

CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON public.audit_events USING btree (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_at ON public.audit_events USING btree (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_device ON public.audit_events USING btree (device_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON public.audit_events USING btree (event_type, at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_note_items_note ON public.credit_note_items USING btree (credit_note_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_sale ON public.credit_notes USING btree (sale_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_shift ON public.credit_notes USING btree (shift_id, created_at);
CREATE INDEX IF NOT EXISTS idx_discounts_active ON public.discounts USING btree (is_active, scope);
CREATE INDEX IF NOT EXISTS idx_pos_devices_active ON public.pos_devices USING btree (is_active, name);
CREATE INDEX IF NOT EXISTS idx_variants_barcode ON public.product_variants USING btree (barcode);
CREATE INDEX IF NOT EXISTS idx_variants_product ON public.product_variants USING btree (product_id);
CREATE INDEX IF NOT EXISTS idx_variants_without_barcode ON public.product_variants USING btree (product_id) WHERE (barcode IS NULL);
CREATE INDEX IF NOT EXISTS idx_purchases_expected ON public.purchases USING btree (expected_date) WHERE ((status = 'draft'::text) AND (expected_date IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_receipt_prints_sale ON public.receipt_prints USING btree (sale_id, printed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_discounts_discount ON public.sale_discounts USING btree (discount_id);
CREATE INDEX IF NOT EXISTS idx_sale_discounts_sale ON public.sale_discounts USING btree (sale_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_idempotency_key ON public.sales USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_shifts_device ON public.shifts USING btree (device_id, opened_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_per_device ON public.shifts USING btree (COALESCE(device_id, '-1'::integer)) WHERE (closed_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_locations_one_default ON public.stock_locations USING btree (is_default) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_stock_movements_location ON public.stock_movements USING btree (location_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant ON public.stock_movements USING btree (variant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_till_movements_shift ON public.till_movements USING btree (shift_id, created_at);
CREATE INDEX IF NOT EXISTS idx_z_reports_closed_at ON public.z_reports USING btree (closed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS z_reports_z_no_unique ON public.z_reports USING btree (z_no);

-- ==========================================================================
-- FUNCTIONS
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.allocate_barcode_serials(p_count integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.audit_discounts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.audit_pos_device_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
        PERFORM log_audit(
            CASE WHEN NEW.is_active THEN 'till_restored' ELSE 'till_retired' END,
            'pos_device', NEW.id::text,
            NEW.name || CASE WHEN NEW.is_active THEN ' brought back' ELSE ' retired' END,
            '{}'::jsonb,
            NEW.id
        );
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_profile_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.audit_sale_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.audit_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    PERFORM log_audit(
        'setting.changed', 'setting', NEW.key,
        format('%s changed', NEW.key),
        jsonb_build_object('key', NEW.key, 'from', OLD.value, 'to', NEW.value)
    );
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_variant_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.clear_pin_lock(p_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF current_role_of_user() NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Only an owner or manager can clear a PIN lock';
    END IF;

    UPDATE profiles
       SET pin_failed_count = 0,
           pin_locked_until = NULL
     WHERE id = p_profile_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_shift_z(p_shift_id integer, p_counted_cash numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_z_no := next_z_no();

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
$function$;

CREATE OR REPLACE FUNCTION public.complete_sale(p_shift_id integer, p_customer_id integer, p_cashier_id uuid, p_discount numeric, p_items jsonb, p_payments jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_sale_id   BIGINT;
    v_subtotal  NUMERIC := 0;
    v_vat_rate  NUMERIC;
    v_total     NUMERIC;
    v_item      JSONB;
    v_line      NUMERIC;
    v_variant   INT;
    v_desc      TEXT;
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
        'pending-' || gen_random_uuid()::TEXT,
        p_shift_id, p_customer_id, v_subtotal, COALESCE(p_discount, 0),
        round(v_total - v_total / (1 + v_vat_rate), 2),  -- VAT-inclusive pricing
        v_total, p_cashier_id
    )
    RETURNING id INTO v_sale_id;

    -- THE change: a transactional counter instead of the row id, so an
    -- aborted sale gives its number back.
    UPDATE sales SET sale_no = next_doc_no('sale') WHERE id = v_sale_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_line := (v_item->>'qty')::INT * (v_item->>'unit_price')::NUMERIC
                  - COALESCE((v_item->>'discount')::NUMERIC, 0);

        v_variant := (v_item->>'variant_id')::INT;
        v_desc    := nullif(btrim(coalesce(v_item->>'description', '')), '');

        IF v_variant IS NULL AND v_desc IS NULL THEN
            RAISE EXCEPTION
                'A sale line needs either a variant or a description';
        END IF;

        INSERT INTO sale_items (sale_id, variant_id, description, qty,
                unit_price, discount, line_total)
        VALUES (v_sale_id, v_variant, v_desc, (v_item->>'qty')::INT,
                (v_item->>'unit_price')::NUMERIC,
                COALESCE((v_item->>'discount')::NUMERIC, 0), v_line);

        -- A custom line has no stock to move. Guarded rather than skipped
        -- silently: record_stock_movement on a NULL variant would either fail
        -- or, worse, write a movement against nothing.
        IF v_variant IS NOT NULL THEN
            PERFORM record_stock_movement(
                v_variant, 'sale',
                -(v_item->>'qty')::INT, 'pos_sale', v_sale_id, NULL);
        END IF;
    END LOOP;

    INSERT INTO sale_payments (sale_id, method, amount, tendered)
    SELECT v_sale_id, p->>'method', (p->>'amount')::NUMERIC,
           (p->>'tendered')::NUMERIC
    FROM jsonb_array_elements(p_payments) AS p;

    RETURN v_sale_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_sale_keyed(p_key text, p_shift_id integer, p_customer_id integer, p_cashier_id uuid, p_discount numeric, p_items jsonb, p_payments jsonb, p_discounts jsonb DEFAULT '[]'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.complete_sale_with_discounts(p_shift_id integer, p_customer_id integer, p_cashier_id uuid, p_discount numeric, p_items jsonb, p_payments jsonb, p_discounts jsonb DEFAULT '[]'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.create_credit_note(p_sale_id bigint, p_shift_id integer, p_cashier_id uuid, p_reason text, p_refund_method text, p_items jsonb, p_restock boolean DEFAULT true, p_approved_by uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_note_id    BIGINT;
    v_sale       sales%ROWTYPE;
    v_item       JSONB;
    v_sale_item  sale_items%ROWTYPE;
    v_qty        INT;
    v_returned   INT;
    v_unit       NUMERIC;
    -- What the customer actually paid, over what the lines listed.
    v_paid_factor NUMERIC;
    v_line       NUMERIC;
    v_subtotal   NUMERIC := 0;
    v_vat_rate   NUMERIC;
    v_sold       INT;
    v_back       INT;
BEGIN
    -- Serialise refunds of THIS sale: the already-returned check
    -- below is check-then-act, so two tills refunding one line would
    -- both see nothing returned, pay the customer twice, and restock
    -- the item twice.
    PERFORM 1 FROM sales WHERE id = p_sale_id FOR UPDATE;

    -- A manager, only when the shop has asked for one (migration 036).
    IF coalesce((SELECT value::text = 'true' FROM settings
                  WHERE key = 'refund_requires_manager'), false) THEN
        IF p_approved_by IS NULL THEN
            RAISE EXCEPTION 'This shop needs a manager to approve a return';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM profiles
                        WHERE id = p_approved_by
                          AND is_active
                          AND role IN ('owner', 'manager')) THEN
            RAISE EXCEPTION 'Only an owner or a manager can approve a return';
        END IF;
    END IF;
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
    -- 1 when nothing came off the basket, so the common case is unchanged.
    v_paid_factor := CASE
        WHEN coalesce(v_sale.subtotal, 0) > 0 THEN v_sale.total / v_sale.subtotal
        ELSE 1
    END;

    IF v_sale.status = 'void' THEN
        RAISE EXCEPTION 'Sale % is void and cannot be returned against', p_sale_id;
    END IF;

    SELECT (value)::NUMERIC INTO v_vat_rate FROM settings WHERE key = 'vat_rate';
    v_vat_rate := coalesce(v_vat_rate, 0.15);

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

        v_unit := (v_sale_item.line_total / v_sale_item.qty) * v_paid_factor;
        v_subtotal := v_subtotal + round(v_unit * v_qty, 2);
    END LOOP;

    -- Never give back more than this sale has left to give.
    --
    -- Each line was apportioned and rounded on its own, so a full return
    -- of several lines can total a cent or two over what was actually
    -- paid. The sale's own total, less everything already credited
    -- against it, is the ceiling.
    v_subtotal := least(
        v_subtotal,
        greatest(0, v_sale.total - coalesce((
            SELECT sum(cn.total) FROM credit_notes cn WHERE cn.sale_id = p_sale_id
        ), 0))
    );

    INSERT INTO credit_notes (approved_by, credit_no, sale_id, shift_id, cashier_id, reason,
            subtotal, vat_amount, total, refund_method)
    VALUES (
        p_approved_by, next_doc_no('credit'),
        p_sale_id, p_shift_id, p_cashier_id, trim(p_reason),
        v_subtotal,
        round(v_subtotal - v_subtotal / (1 + v_vat_rate), 2),
        v_subtotal, p_refund_method
    )
    RETURNING id INTO v_note_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_qty := (v_item->>'qty')::INT;

        SELECT * INTO v_sale_item
          FROM sale_items
         WHERE id = (v_item->>'sale_item_id')::BIGINT AND sale_id = p_sale_id;

        v_unit := (v_sale_item.line_total / v_sale_item.qty) * v_paid_factor;
        v_line := round(v_unit * v_qty, 2);

        INSERT INTO credit_note_items (credit_note_id, sale_item_id, variant_id,
                qty, unit_price, line_total)
        VALUES (v_note_id, v_sale_item.id, v_sale_item.variant_id,
                v_qty, round(v_unit, 2), v_line);

        -- Restocked only when there is a shelf to restock: a catalogue line,
        -- and the cashier did not mark it faulty.
        IF p_restock AND v_sale_item.variant_id IS NOT NULL THEN
            PERFORM record_stock_movement(
                v_sale_item.variant_id, 'return', v_qty,
                'credit_note', v_note_id,
                'Returned on ' || (SELECT credit_no FROM credit_notes WHERE id = v_note_id));
        END IF;
    END LOOP;

    SELECT coalesce(sum(si.qty), 0), coalesce(sum(returned_qty(si.id)), 0)
      INTO v_sold, v_back
      FROM sale_items si WHERE si.sale_id = p_sale_id;

    IF v_back >= v_sold THEN
        UPDATE sales SET status = 'refunded' WHERE id = p_sale_id;
    END IF;

    RETURN v_note_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_role_of_user()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT role FROM profiles WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.daily_summary(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.default_movement_location()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.location_id IS NULL THEN
        SELECT id INTO NEW.location_id
        FROM stock_locations WHERE is_default LIMIT 1;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.discount_amount_for(p_kind text, p_value numeric, p_base numeric, p_max_amount numeric DEFAULT NULL::numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.discount_report(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(discount_id integer, label text, times_used bigint, total_given numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.forbid_received_purchase_lines()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_purchase BIGINT := coalesce(NEW.purchase_id, OLD.purchase_id);
    v_status   TEXT;
BEGIN
    SELECT status INTO v_status FROM purchases WHERE id = v_purchase;

    -- A purchase that has gone is not this trigger's business: the cascade
    -- from deleting the parent must still work.
    IF NOT FOUND THEN
        RETURN coalesce(NEW, OLD);
    END IF;

    IF v_status <> 'draft' THEN
        RAISE EXCEPTION
            'Purchase % is % — its lines record what was received and cannot be changed',
            v_purchase, v_status;
    END IF;

    RETURN coalesce(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.forbid_till_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'till_movements is append-only: record a correcting movement instead';
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_pos_access()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.module = 'pos' AND NEW.can_view = FALSE THEN
        RAISE EXCEPTION 'The till cannot be hidden from a role';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_audit(p_event_type text, p_ref_type text, p_ref_id text, p_summary text, p_detail jsonb DEFAULT '{}'::jsonb, p_device_id integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    INSERT INTO audit_events (actor_id, event_type, ref_type, ref_id, summary, detail, device_id)
    VALUES (auth.uid(), p_event_type, p_ref_type, p_ref_id, p_summary, p_detail, p_device_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.next_doc_no(p_kind text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_day TEXT := to_char(now() AT TIME ZONE 'Indian/Mauritius', 'YYMMDD');
    v_n   INT;
BEGIN
    INSERT INTO doc_counters AS c (kind, day, n) VALUES (p_kind, v_day, 1)
    ON CONFLICT (kind, day) DO UPDATE SET n = c.n + 1
    RETURNING n INTO v_n;

    RETURN CASE p_kind WHEN 'sale' THEN 'S' ELSE 'CN' END || v_day || '-' || v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.next_z_no()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_n INT;
BEGIN
    INSERT INTO doc_counters AS c (kind, day, n) VALUES ('z', 'all', 1)
    ON CONFLICT (kind, day) DO UPDATE SET n = c.n + 1
    RETURNING n INTO v_n;

    RETURN 'Z' || lpad(v_n::TEXT, 5, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.pin_lock_state(p_profile_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT GREATEST(
        0,
        COALESCE(EXTRACT(EPOCH FROM (pin_locked_until - now()))::INT, 0)
    )
    FROM profiles
    WHERE id = p_profile_id;
$function$;

CREATE OR REPLACE FUNCTION public.receive_purchase(p_purchase_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.record_receipt_print(p_sale_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.record_stock_movement(p_variant_id integer, p_type text, p_qty integer, p_reference_type text DEFAULT NULL::text, p_reference_id bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.record_stock_movement_at(p_variant_id integer, p_type text, p_qty integer, p_location_id integer, p_reference_type text DEFAULT NULL::text, p_reference_id bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.record_till_movement(p_shift_id integer, p_amount numeric, p_reason text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    FROM shifts WHERE id = p_shift_id FOR UPDATE;

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
$function$;

CREATE OR REPLACE FUNCTION public.register_pin_attempt(p_profile_id uuid, p_ok boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- Three free misses, because a keypad in a busy shop gets mistyped. After
    -- that the wait doubles: 5s, 10s, 20s ... capped at five minutes. Twenty
    -- wrong guesses already costs well over an hour, which puts the full 10,000
    -- out of reach without ever locking a real cashier out for long.
    IF v_failed > 3 THEN
        -- Exponent clamped, not the result: 5 * 2^6 = 320 is already past
        -- the 300s cap, so anything beyond it is arithmetic that can only
        -- overflow. See the note above.
        v_wait := LEAST(300, 5 * POWER(2, LEAST(v_failed - 4, 6))::INT);
        UPDATE profiles
           SET pin_locked_until = now() + make_interval(secs => v_wait)
         WHERE id = p_profile_id;
    END IF;

    RETURN v_wait;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_pos_device(p_code text, p_model text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id       INT;
    v_existing BOOLEAN;
    v_old_seen TIMESTAMPTZ;
    v_old_ver  TEXT;
    v_name     TEXT;
    v_ver      TEXT := nullif(trim(p_app_version), '');
BEGIN
    IF coalesce(trim(p_code), '') = '' THEN
        RAISE EXCEPTION 'A device needs a code';
    END IF;

    -- Read what was known before the write, so the events below can compare.
    -- FOR UPDATE so two racing bootstraps from the same tablet serialise here
    -- rather than both deciding the other's changes are news.
    SELECT id, last_seen_at, app_version INTO v_id, v_old_seen, v_old_ver
      FROM pos_devices WHERE code = trim(p_code)
      FOR UPDATE;
    v_existing := FOUND;

    INSERT INTO pos_devices (code, name, model, app_version, last_seen_at)
    VALUES (
        trim(p_code),
        -- A name only on FIRST sight. After that the owner's name wins, and a
        -- reinstall reporting its model again must not overwrite it.
        coalesce(nullif(trim(p_model), ''), 'New till'),
        nullif(trim(p_model), ''),
        v_ver,
        now()
    )
    ON CONFLICT (code) DO UPDATE
        SET last_seen_at = now(),
            model       = coalesce(nullif(trim(p_model), ''), pos_devices.model),
            app_version = coalesce(v_ver, pos_devices.app_version)
    RETURNING id, name INTO v_id, v_name;

    IF NOT v_existing THEN
        PERFORM log_audit(
            'till_registered', 'pos_device', v_id::text,
            v_name || ' registered itself',
            jsonb_strip_nulls(jsonb_build_object('model', nullif(trim(p_model), ''), 'version', v_ver)),
            v_id
        );
    ELSE
        -- A seeded row has no last_seen_at at all; its first check-in is a
        -- start, not a registration.
        IF v_old_seen IS NULL OR now() - v_old_seen > interval '30 minutes' THEN
            PERFORM log_audit(
                'terminal_started', 'pos_device', v_id::text,
                v_name || ' started',
                jsonb_strip_nulls(jsonb_build_object('model', nullif(trim(p_model), ''), 'version', v_ver)),
                v_id
            );
        END IF;
        IF v_ver IS NOT NULL AND v_ver IS DISTINCT FROM v_old_ver THEN
            PERFORM log_audit(
                'app_version_changed', 'pos_device', v_id::text,
                v_name || ' now runs v' || v_ver,
                jsonb_build_object('from', v_old_ver, 'to', v_ver),
                v_id
            );
        END IF;
    END IF;

    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.returned_qty(p_sale_item_id bigint)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT coalesce(sum(qty), 0)::INT
      FROM credit_note_items
     WHERE sale_item_id = p_sale_item_id;
$function$;

CREATE OR REPLACE FUNCTION public.set_barcode_scheme(p_auto boolean, p_prefix text, p_next integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.shift_totals(p_shift_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.transfer_stock(p_variant_id integer, p_qty integer, p_from_location integer, p_to_location integer, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_available INT;
    v_where     TEXT;
BEGIN
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'A transfer needs a positive quantity';
    END IF;
    IF p_from_location = p_to_location THEN
        RAISE EXCEPTION 'Pick two different locations';
    END IF;

    -- Serialised per variant, so two transfers of the same goods cannot both
    -- read the same balance and both pass. hashtext over a per-variant key
    -- rather than the variant id alone, to stay clear of other advisory locks.
    PERFORM pg_advisory_xact_lock(hashtext('transfer_stock:' || p_variant_id::TEXT));

    SELECT coalesce(sum(qty), 0) INTO v_available
      FROM stock_movements
     WHERE variant_id = p_variant_id
       AND location_id = p_from_location;

    IF v_available < p_qty THEN
        -- `stock_locations`, not `locations` — the table 006 actually created.
        SELECT name INTO v_where FROM stock_locations WHERE id = p_from_location;
        RAISE EXCEPTION
            'Only % of that item at %, so % cannot be moved',
            v_available, coalesce(v_where, 'that location'), p_qty;
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
$function$;

CREATE OR REPLACE FUNCTION public.z_totals(p_shift_id integer, p_as_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Refunds handed back in CASH from this shift's drawer.
    v_cash_refund NUMERIC := 0;
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

    -- Money off individual lines counts as a discount given. It lives
    -- in sale_items and is already inside line_total, so it never
    -- reached sales.discount — and a line discount is exactly the kind
    -- a manager has to authorise.
    v_discount := v_discount + coalesce((
        SELECT sum(si.discount) FROM sale_items si
         WHERE si.sale_id = ANY(v_sales)
    ), 0);

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
            SELECT (
                     -- Snapped to the configured rate when within half a
                     -- point: the implied figure wobbles by a few
                     -- hundredths on small tickets because vat_amount was
                     -- rounded to the cent, and each wobble used to open
                     -- its own band on the shop's VAT record.
                     SELECT CASE
                       WHEN s.total - s.vat_amount <= 0 THEN round(v_default_vat * 100, 2)
                       WHEN abs(s.vat_amount / (s.total - s.vat_amount) * 100
                                - v_default_vat * 100) <= 0.5
                            THEN round(v_default_vat * 100, 2)
                       ELSE round(s.vat_amount / (s.total - s.vat_amount) * 100, 2)
                     END) AS rate,
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
        -- Not ANY(v_sales): that set is completed-only, and a ticket
        -- refunded in full leaves it — taking the cash it collected
        -- out of the drawer figure while v_cash_refund subtracts the
        -- same money a second time.
        SELECT round(sum(sp.amount), 2)
          FROM sale_payments sp
          JOIN sales s ON s.id = sp.sale_id
         WHERE s.shift_id = p_shift_id
           AND s.status IN ('completed', 'refunded')
           AND s.sale_date <= p_as_at
           AND sp.method = 'cash'
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

    -- Attributed by the shift that PAID it out, not the one that made the
    -- sale. A refund on last week's receipt comes out of today's drawer.
    SELECT coalesce(sum(cn.total), 0) INTO v_credited
      FROM credit_notes cn
     WHERE cn.shift_id = p_shift_id AND cn.created_at <= p_as_at;

    -- Only cash leaves the drawer. A card or Juice refund reverses on that
    -- rail and must not be counted against the notes and coins in the till.
    SELECT coalesce(sum(cn.total), 0) INTO v_cash_refund
      FROM credit_notes cn
     WHERE cn.shift_id = p_shift_id AND cn.created_at <= p_as_at
       AND cn.refund_method = 'cash';

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
        'expected_cash',  round(v_shift.opening_float + v_cash_in + v_movements
                            - v_cash_refund, 2),
        'cash_refunded',  round(v_cash_refund, 2),
        'voided',         v_voided,
        'refunded',       v_refunded,
        'credited',       round(v_credited, 2)
    );
END;
$function$;


-- ==========================================================================
-- VIEWS
-- ==========================================================================

CREATE OR REPLACE VIEW late_sales WITH (security_invoker=on) AS
SELECT s.id AS sale_id,
    s.sale_no,
    s.shift_id,
    s.total,
    s.sale_date,
    z.z_no,
    z.closed_at,
    s.sale_date - z.closed_at AS arrived_after
   FROM sales s
     JOIN z_reports z ON z.shift_id = s.shift_id
  WHERE s.status = 'completed'::text AND s.sale_date > z.closed_at;

CREATE OR REPLACE VIEW low_stock_variants WITH (security_invoker=on) AS
SELECT pv.id AS variant_id,
    pv.product_id,
    pv.sku,
    pv.barcode,
    pv.qty_on_hand,
    pv.reorder_level,
    pv.selling_price,
    pv.cost_price,
    p.name AS product_name,
    s.label AS size_label,
    s.size_type,
    c.name AS colour_name,
    c.hex_code AS colour_hex
   FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     JOIN sizes s ON s.id = pv.size_id
     JOIN colours c ON c.id = pv.colour_id
  WHERE pv.is_active AND p.is_active AND pv.qty_on_hand <= pv.reorder_level;

CREATE OR REPLACE VIEW shift_z_variance WITH (security_invoker=on) AS
SELECT shift_id,
    z_no,
    closed_at,
    (totals ->> 'sales_total'::text)::numeric AS z_total,
    COALESCE(( SELECT round(sum(s.total), 2) AS round
           FROM sales s
          WHERE s.shift_id = z.shift_id AND s.status = 'completed'::text), 0::numeric) AS actual_total,
    COALESCE(( SELECT round(sum(s.total), 2) AS round
           FROM sales s
          WHERE s.shift_id = z.shift_id AND s.status = 'completed'::text), 0::numeric) - ((totals ->> 'sales_total'::text)::numeric) AS unreported,
    (( SELECT count(*) AS count
           FROM late_sales l
          WHERE l.shift_id = z.shift_id))::integer AS late_count
   FROM z_reports z;

CREATE OR REPLACE VIEW stock_by_location WITH (security_invoker=on) AS
SELECT sm.location_id,
    sl.name AS location_name,
    sm.variant_id,
    pv.sku,
    p.id AS product_id,
    p.name AS product_name,
    s.label AS size_label,
    c.name AS colour_name,
    c.hex_code AS colour_hex,
    sum(sm.qty)::integer AS qty_on_hand
   FROM stock_movements sm
     JOIN stock_locations sl ON sl.id = sm.location_id
     JOIN product_variants pv ON pv.id = sm.variant_id
     JOIN products p ON p.id = pv.product_id
     JOIN sizes s ON s.id = pv.size_id
     JOIN colours c ON c.id = pv.colour_id
  GROUP BY sm.location_id, sl.name, sm.variant_id, pv.sku, p.id, p.name, s.label, c.name, c.hex_code
 HAVING sum(sm.qty) <> 0;


-- ==========================================================================
-- TRIGGERS
-- ==========================================================================

DROP TRIGGER IF EXISTS trg_audit_discounts ON discounts;
CREATE TRIGGER trg_audit_discounts AFTER INSERT OR DELETE OR UPDATE ON public.discounts FOR EACH ROW EXECUTE FUNCTION audit_discounts();
DROP TRIGGER IF EXISTS trg_module_access_pos ON module_access;
CREATE TRIGGER trg_module_access_pos BEFORE INSERT OR UPDATE ON public.module_access FOR EACH ROW EXECUTE FUNCTION guard_pos_access();
DROP TRIGGER IF EXISTS trg_pos_device_state ON pos_devices;
CREATE TRIGGER trg_pos_device_state AFTER UPDATE ON public.pos_devices FOR EACH ROW EXECUTE FUNCTION audit_pos_device_state();
DROP TRIGGER IF EXISTS trg_audit_variant_price ON product_variants;
CREATE TRIGGER trg_audit_variant_price AFTER UPDATE ON public.product_variants FOR EACH ROW WHEN (((old.selling_price IS DISTINCT FROM new.selling_price) OR (old.cost_price IS DISTINCT FROM new.cost_price))) EXECUTE FUNCTION audit_variant_price();
DROP TRIGGER IF EXISTS trg_audit_profile_access ON profiles;
CREATE TRIGGER trg_audit_profile_access AFTER UPDATE ON public.profiles FOR EACH ROW WHEN (((old.role IS DISTINCT FROM new.role) OR (old.pin_code IS DISTINCT FROM new.pin_code) OR (old.is_active IS DISTINCT FROM new.is_active))) EXECUTE FUNCTION audit_profile_access();
DROP TRIGGER IF EXISTS trg_purchase_items_draft_only ON purchase_items;
CREATE TRIGGER trg_purchase_items_draft_only BEFORE INSERT OR DELETE OR UPDATE ON public.purchase_items FOR EACH ROW EXECUTE FUNCTION forbid_received_purchase_lines();
DROP TRIGGER IF EXISTS trg_audit_sale_status ON sales;
CREATE TRIGGER trg_audit_sale_status AFTER UPDATE ON public.sales FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION audit_sale_status();
DROP TRIGGER IF EXISTS trg_audit_settings ON settings;
CREATE TRIGGER trg_audit_settings AFTER UPDATE ON public.settings FOR EACH ROW WHEN ((old.value IS DISTINCT FROM new.value)) EXECUTE FUNCTION audit_settings();
DROP TRIGGER IF EXISTS trg_stock_movements_location ON stock_movements;
CREATE TRIGGER trg_stock_movements_location BEFORE INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION default_movement_location();
DROP TRIGGER IF EXISTS trg_till_movements_append_only ON till_movements;
CREATE TRIGGER trg_till_movements_append_only BEFORE DELETE OR UPDATE ON public.till_movements FOR EACH ROW EXECUTE FUNCTION forbid_till_mutation();

-- ==========================================================================
-- ROW LEVEL SECURITY
-- ==========================================================================

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE colours ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_note_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_prints ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE till_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE z_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_audit_events ON audit_events;
CREATE POLICY read_audit_events ON audit_events
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS manage ON brands;
CREATE POLICY manage ON brands
    FOR ALL TO authenticated
    USING ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS read_all ON brands;
CREATE POLICY read_all ON brands
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS manage ON categories;
CREATE POLICY manage ON categories
    FOR ALL TO authenticated
    USING ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS read_all ON categories;
CREATE POLICY read_all ON categories
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS manage ON colours;
CREATE POLICY manage ON colours
    FOR ALL TO authenticated
    USING ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS read_all ON colours;
CREATE POLICY read_all ON colours
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS read_all ON credit_note_items;
CREATE POLICY read_all ON credit_note_items
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS read_all ON credit_notes;
CREATE POLICY read_all ON credit_notes
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS create_customers ON customers;
CREATE POLICY create_customers ON customers
    FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS read_all ON customers;
CREATE POLICY read_all ON customers
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS update_customers ON customers;
CREATE POLICY update_customers ON customers
    FOR UPDATE TO authenticated
    USING ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])))
    WITH CHECK ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS manage ON discounts;
CREATE POLICY manage ON discounts
    FOR ALL TO authenticated
    USING ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS read_all ON discounts;
CREATE POLICY read_all ON discounts
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS manage ON module_access;
CREATE POLICY manage ON module_access
    FOR ALL TO authenticated
    USING ((current_role_of_user() = 'owner'::text));

DROP POLICY IF EXISTS read_all ON module_access;
CREATE POLICY read_all ON module_access
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS read_pos_devices ON pos_devices;
CREATE POLICY read_pos_devices ON pos_devices
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS write_pos_devices ON pos_devices;
CREATE POLICY write_pos_devices ON pos_devices
    FOR UPDATE TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND p.is_active AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));

DROP POLICY IF EXISTS manage ON product_variants;
CREATE POLICY manage ON product_variants
    FOR ALL TO authenticated
    USING ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS read_all ON product_variants;
CREATE POLICY read_all ON product_variants
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS manage ON products;
CREATE POLICY manage ON products
    FOR ALL TO authenticated
    USING ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS read_all ON products;
CREATE POLICY read_all ON products
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS manage_profiles ON profiles;
CREATE POLICY manage_profiles ON profiles
    FOR ALL TO authenticated
    USING ((current_role_of_user() = 'owner'::text));

DROP POLICY IF EXISTS read_all ON profiles;
CREATE POLICY read_all ON profiles
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS manage ON purchase_items;
CREATE POLICY manage ON purchase_items
    FOR ALL TO authenticated
    USING ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS manage ON purchases;
CREATE POLICY manage ON purchases
    FOR ALL TO authenticated
    USING ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS read_purchases ON purchases;
CREATE POLICY read_purchases ON purchases
    FOR SELECT TO authenticated
    USING ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS read_all ON receipt_prints;
CREATE POLICY read_all ON receipt_prints
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS read_all ON sale_discounts;
CREATE POLICY read_all ON sale_discounts
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS read_all ON sale_items;
CREATE POLICY read_all ON sale_items
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS read_all ON sale_payments;
CREATE POLICY read_all ON sale_payments
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS read_all ON sales;
CREATE POLICY read_all ON sales
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS manage ON settings;
CREATE POLICY manage ON settings
    FOR ALL TO authenticated
    USING ((current_role_of_user() = 'owner'::text));

DROP POLICY IF EXISTS read_all ON settings;
CREATE POLICY read_all ON settings
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS open_own_shift ON shifts;
CREATE POLICY open_own_shift ON shifts
    FOR INSERT TO authenticated
    WITH CHECK ((opened_by = auth.uid()));

DROP POLICY IF EXISTS read_all ON shifts;
CREATE POLICY read_all ON shifts
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS manage ON sizes;
CREATE POLICY manage ON sizes
    FOR ALL TO authenticated
    USING ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS read_all ON sizes;
CREATE POLICY read_all ON sizes
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS manage ON stock_locations;
CREATE POLICY manage ON stock_locations
    FOR ALL TO authenticated
    USING ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS read_all ON stock_locations;
CREATE POLICY read_all ON stock_locations
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS read_stock ON stock_movements;
CREATE POLICY read_stock ON stock_movements
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS manage ON suppliers;
CREATE POLICY manage ON suppliers
    FOR ALL TO authenticated
    USING ((current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS read_suppliers ON suppliers;
CREATE POLICY read_suppliers ON suppliers
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS read_till_movements ON till_movements;
CREATE POLICY read_till_movements ON till_movements
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS read_z_reports ON z_reports;
CREATE POLICY read_z_reports ON z_reports
    FOR SELECT TO authenticated
    USING (true);


-- ==========================================================================
-- STORAGE — the product-images bucket and its policies
-- ==========================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', true, 3145728, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
   SET public = EXCLUDED.public,
       file_size_limit = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS product_images_delete ON storage.objects;
CREATE POLICY product_images_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (((bucket_id = 'product-images'::text) AND (current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text]))));

DROP POLICY IF EXISTS product_images_insert ON storage.objects;
CREATE POLICY product_images_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (((bucket_id = 'product-images'::text) AND (current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text]))));

DROP POLICY IF EXISTS product_images_read ON storage.objects;
CREATE POLICY product_images_read ON storage.objects
    FOR SELECT
    USING ((bucket_id = 'product-images'::text));

DROP POLICY IF EXISTS product_images_update ON storage.objects;
CREATE POLICY product_images_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (((bucket_id = 'product-images'::text) AND (current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text]))))
    WITH CHECK (((bucket_id = 'product-images'::text) AND (current_role_of_user() = ANY (ARRAY['owner'::text, 'manager'::text]))));


-- ==========================================================================
-- GRANTS — migration 035, the one that matters most
-- ==========================================================================

-- Supabase grants EXECUTE on everything in public to anon and authenticated
-- by default, and most of this schema is SECURITY DEFINER — which bypasses row
-- level security entirely. `anon` is the role the PUBLISHABLE KEY maps to: the
-- key in the browser bundle and inside the Android APK. Left alone, that key
-- can read the day's takings and call complete_sale.
--
-- Nothing in the app needs it. Every call site runs server-side under a signed-in
-- session, and the Android till reaches the database through /api/till/* with a
-- bearer token that resolves to an authenticated session.
DO $$
DECLARE fn RECORD;
BEGIN
    FOR fn IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
        JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public'
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', fn.sig);
    END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;

-- ==========================================================================
-- SEED DATA
-- ==========================================================================

INSERT INTO settings (key, value) VALUES
    ('barcode_auto', 'true'::jsonb),
    ('barcode_next', '317'::jsonb),
    ('barcode_prefix', '"6291041"'::jsonb),
    ('currency', '"MUR"'::jsonb),
    ('payment_methods', '["cash","card","juice","myt_money"]'::jsonb),
    ('refund_requires_manager', 'false'::jsonb),
    ('shop_name', '"Kids Corner"'::jsonb),
    ('vat_rate', '0.15'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO sizes (id, size_type, label, sort_order, is_active) VALUES
    (1, 'age_range', '0-3 mths', 1, TRUE),
    (2, 'age_range', '3-6 mths', 2, TRUE),
    (3, 'age_range', '6-12 mths', 3, TRUE),
    (4, 'age_range', '1-2 yrs', 4, TRUE),
    (5, 'age_range', '2-3 yrs', 5, TRUE),
    (6, 'age_range', '3-4 yrs', 6, TRUE),
    (7, 'age_range', '4-5 yrs', 7, TRUE),
    (8, 'age_range', '5-6 yrs', 8, TRUE),
    (9, 'age_range', '7-8 yrs', 9, TRUE),
    (10, 'age_range', '9-10 yrs', 10, TRUE),
    (11, 'shoe_size', 'EU 19', 20, TRUE),
    (12, 'shoe_size', 'EU 20', 21, TRUE),
    (13, 'shoe_size', 'EU 21', 22, TRUE),
    (14, 'shoe_size', 'EU 22', 23, TRUE),
    (15, 'shoe_size', 'EU 23', 24, TRUE),
    (16, 'shoe_size', 'EU 24', 25, TRUE),
    (17, 'shoe_size', 'EU 25', 26, TRUE),
    (18, 'shoe_size', 'EU 26', 27, TRUE),
    (19, 'shoe_size', 'EU 27', 28, TRUE),
    (20, 'shoe_size', 'EU 28', 29, TRUE)
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('sizes', 'id'),
       greatest((SELECT max(id) FROM sizes), 1));

INSERT INTO colours (id, name, hex_code, is_active) VALUES
    (1, 'Red', '#E53935', TRUE),
    (2, 'Blue', '#1E88E5', TRUE),
    (3, 'Navy', '#1A237E', TRUE),
    (4, 'Pink', '#EC407A', TRUE),
    (5, 'White', '#FFFFFF', TRUE),
    (6, 'Black', '#212121', TRUE),
    (7, 'Yellow', '#FDD835', TRUE),
    (8, 'Green', '#43A047', TRUE),
    (9, 'Grey', '#9E9E9E', TRUE),
    (10, 'Purple', '#8E24AA', TRUE),
    (11, 'Orange', '#FB8C00', TRUE),
    (12, 'Beige', '#D7CCC8', TRUE)
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('colours', 'id'),
       greatest((SELECT max(id) FROM colours), 1));

INSERT INTO categories (id, name, parent_id, is_active) VALUES
    (1, 'T-Shirts', NULL, TRUE),
    (2, 'Dresses', NULL, TRUE),
    (3, 'Trousers', NULL, TRUE),
    (4, 'Shorts', NULL, TRUE),
    (5, 'Pyjamas', NULL, TRUE),
    (6, 'Shoes', NULL, TRUE),
    (7, 'Sandals', NULL, TRUE),
    (8, 'Accessories', NULL, TRUE)
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('categories', 'id'),
       greatest((SELECT max(id) FROM categories), 1));

INSERT INTO stock_locations (id, name, is_default, is_active) VALUES
    (1, 'Shop floor', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('stock_locations', 'id'),
       greatest((SELECT max(id) FROM stock_locations), 1));

INSERT INTO module_access (id, role, module, can_view) VALUES
    (1, 'owner', 'dashboard', TRUE),
    (2, 'owner', 'products', FALSE),
    (3, 'owner', 'import', TRUE),
    (4, 'owner', 'stock', TRUE),
    (5, 'owner', 'purchases', TRUE),
    (6, 'owner', 'suppliers', TRUE),
    (7, 'owner', 'sales', TRUE),
    (8, 'owner', 'reports', TRUE),
    (9, 'owner', 'customers', TRUE),
    (10, 'owner', 'settings', TRUE),
    (11, 'owner', 'pos', TRUE),
    (12, 'manager', 'dashboard', TRUE),
    (13, 'manager', 'products', TRUE),
    (14, 'manager', 'import', TRUE),
    (15, 'manager', 'stock', TRUE),
    (16, 'manager', 'purchases', TRUE),
    (17, 'manager', 'suppliers', TRUE),
    (18, 'manager', 'sales', TRUE),
    (19, 'manager', 'reports', TRUE),
    (20, 'manager', 'customers', TRUE),
    (21, 'manager', 'settings', TRUE),
    (22, 'manager', 'pos', TRUE),
    (23, 'cashier', 'dashboard', FALSE),
    (24, 'cashier', 'products', FALSE),
    (25, 'cashier', 'import', FALSE),
    (26, 'cashier', 'stock', FALSE),
    (27, 'cashier', 'purchases', FALSE),
    (28, 'cashier', 'suppliers', FALSE),
    (29, 'cashier', 'sales', FALSE),
    (30, 'cashier', 'reports', FALSE),
    (31, 'cashier', 'customers', FALSE),
    (32, 'cashier', 'settings', FALSE),
    (33, 'cashier', 'pos', TRUE)
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('module_access', 'id'),
       greatest((SELECT max(id) FROM module_access), 1));


-- ==========================================================================
-- WHAT YOU SHOULD SEE
-- ==========================================================================

-- Run this after the file. The three security figures are the point: any
-- other answer means the publishable key reaches further than it should.
SELECT
    (SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE')      AS tables,
    (SELECT count(*) FROM information_schema.views
      WHERE table_schema = 'public')                                    AS views,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public')                                       AS functions,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')      AS policies,
    -- Must be 0. Migration 035.
    (SELECT count(*) FROM information_schema.role_routine_grants
      WHERE specific_schema = 'public' AND grantee IN ('anon','PUBLIC')) AS anon_can_execute,
    -- Must be 0. Migration 028.
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef
        AND (p.proconfig IS NULL OR NOT EXISTS (
              SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%')))
                                                                        AS definers_unpinned,
    -- Must be 4. Migration 034.
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v'
        AND 'security_invoker=on' = ANY(c.reloptions))                  AS views_with_invoker,
    (SELECT count(*) FROM sizes)      AS sizes,
    (SELECT count(*) FROM colours)    AS colours,
    (SELECT count(*) FROM categories) AS categories,
    (SELECT count(*) FROM settings)   AS settings;
