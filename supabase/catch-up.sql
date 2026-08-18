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
-- Generated 2026-08-18 from the live schema.
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
    approved_by uuid,
    vat_policy_id bigint NOT NULL,
    vat_enabled boolean NOT NULL,
    vat_rate numeric(7,6) NOT NULL,
    vat_number text
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
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    shelf_location text
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
    pin_last_used_at timestamp with time zone,
    pin_device_verifier text
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
    expected_date date,
    vat_policy_id bigint,
    vat_enabled boolean,
    vat_rate numeric(7,6),
    vat_amount numeric(12,2)
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
    idempotency_key text,
    vat_policy_id bigint NOT NULL,
    vat_enabled boolean NOT NULL,
    vat_rate numeric(7,6) NOT NULL,
    vat_number text
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

CREATE TABLE IF NOT EXISTS vat_policies (
    id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    enabled boolean NOT NULL,
    configured_rate numeric(7,6) NOT NULL,
    vat_number text,
    is_legacy boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
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
    totals jsonb NOT NULL,
    vat_identity_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL
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
    ALTER TABLE vat_policies ADD CONSTRAINT vat_policies_pkey PRIMARY KEY (id);
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
    ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_refund_method_check CHECK ((refund_method = ANY (ARRAY['cash'::text, 'card'::text, 'juice'::text, 'myt_money'::text, 'bank'::text, 'exchange'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_vat_number_normalized CHECK (((vat_number IS NULL) OR ((vat_number = btrim(vat_number)) AND (length(vat_number) > 0))));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_vat_rate_valid CHECK (((vat_enabled AND (vat_rate > (0)::numeric) AND (vat_rate <= (1)::numeric)) OR ((NOT vat_enabled) AND (vat_rate = (0)::numeric) AND (vat_number IS NULL) AND (vat_amount = (0)::numeric))));
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
    ALTER TABLE purchases ADD CONSTRAINT purchases_vat_amount_valid CHECK (((vat_amount IS NULL) OR (vat_amount >= (0)::numeric)));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE purchases ADD CONSTRAINT purchases_vat_rate_valid CHECK (((vat_rate IS NULL) OR (vat_enabled AND (vat_rate > (0)::numeric) AND (vat_rate <= (1)::numeric)) OR ((NOT vat_enabled) AND (vat_rate = (0)::numeric) AND (vat_amount = (0)::numeric))));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE purchases ADD CONSTRAINT purchases_vat_snapshot_for_received CHECK ((((status = 'received'::text) AND (vat_policy_id IS NOT NULL) AND (vat_enabled IS NOT NULL) AND (vat_rate IS NOT NULL) AND (vat_amount IS NOT NULL)) OR ((status = ANY (ARRAY['draft'::text, 'cancelled'::text])) AND (vat_policy_id IS NULL) AND (vat_enabled IS NULL) AND (vat_rate IS NULL) AND (vat_amount IS NULL))));
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
    ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check CHECK ((method = ANY (ARRAY['cash'::text, 'card'::text, 'juice'::text, 'myt_money'::text, 'bank'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'refunded'::text, 'void'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sales ADD CONSTRAINT sales_vat_number_normalized CHECK (((vat_number IS NULL) OR ((vat_number = btrim(vat_number)) AND (length(vat_number) > 0))));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sales ADD CONSTRAINT sales_vat_rate_valid CHECK (((vat_enabled AND (vat_rate > (0)::numeric) AND (vat_rate <= (1)::numeric)) OR ((NOT vat_enabled) AND (vat_rate = (0)::numeric) AND (vat_number IS NULL) AND (vat_amount = (0)::numeric))));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE sizes ADD CONSTRAINT sizes_size_type_check CHECK ((size_type = ANY (ARRAY['age_range'::text, 'letter_size'::text, 'shoe_size'::text])));
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
    ALTER TABLE vat_policies ADD CONSTRAINT vat_policies_enabled_number_required CHECK (((NOT enabled) OR (vat_number IS NOT NULL) OR is_legacy));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE vat_policies ADD CONSTRAINT vat_policies_number_normalized CHECK (((vat_number IS NULL) OR ((vat_number = btrim(vat_number)) AND (length(vat_number) > 0))));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE vat_policies ADD CONSTRAINT vat_policies_rate_valid CHECK (((configured_rate > (0)::numeric) AND (configured_rate <= (1)::numeric)));
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE z_reports ADD CONSTRAINT z_reports_vat_identity_array CHECK ((jsonb_typeof(vat_identity_snapshot) = 'array'::text));
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
    ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_vat_policy_id_fkey FOREIGN KEY (vat_policy_id) REFERENCES vat_policies(id);
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
    ALTER TABLE purchases ADD CONSTRAINT purchases_vat_policy_id_fkey FOREIGN KEY (vat_policy_id) REFERENCES vat_policies(id);
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
    ALTER TABLE sales ADD CONSTRAINT sales_vat_policy_id_fkey FOREIGN KEY (vat_policy_id) REFERENCES vat_policies(id);
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
    ALTER TABLE vat_policies ADD CONSTRAINT vat_policies_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
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
CREATE INDEX IF NOT EXISTS idx_credit_notes_vat_policy_id ON public.credit_notes USING btree (vat_policy_id);
CREATE INDEX IF NOT EXISTS idx_discounts_active ON public.discounts USING btree (is_active, scope);
CREATE INDEX IF NOT EXISTS idx_pos_devices_active ON public.pos_devices USING btree (is_active, name);
CREATE INDEX IF NOT EXISTS idx_variants_barcode ON public.product_variants USING btree (barcode);
CREATE INDEX IF NOT EXISTS idx_variants_product ON public.product_variants USING btree (product_id);
CREATE INDEX IF NOT EXISTS idx_variants_without_barcode ON public.product_variants USING btree (product_id) WHERE (barcode IS NULL);
CREATE INDEX IF NOT EXISTS idx_purchases_expected ON public.purchases USING btree (expected_date) WHERE ((status = 'draft'::text) AND (expected_date IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_purchases_vat_policy_id ON public.purchases USING btree (vat_policy_id);
CREATE INDEX IF NOT EXISTS idx_receipt_prints_sale ON public.receipt_prints USING btree (sale_id, printed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_discounts_discount ON public.sale_discounts USING btree (discount_id);
CREATE INDEX IF NOT EXISTS idx_sale_discounts_sale ON public.sale_discounts USING btree (sale_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_idempotency_key ON public.sales USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sales_vat_policy_id ON public.sales USING btree (vat_policy_id);
CREATE INDEX IF NOT EXISTS idx_shifts_device ON public.shifts USING btree (device_id, opened_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_per_device ON public.shifts USING btree (COALESCE(device_id, '-1'::integer)) WHERE (closed_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_locations_one_default ON public.stock_locations USING btree (is_default) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_stock_movements_location ON public.stock_movements USING btree (location_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant ON public.stock_movements USING btree (variant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_till_movements_shift ON public.till_movements USING btree (shift_id, created_at);
CREATE INDEX IF NOT EXISTS idx_vat_policies_created_by ON public.vat_policies USING btree (created_by);
CREATE UNIQUE INDEX IF NOT EXISTS vat_policies_one_legacy_idx ON public.vat_policies USING btree (is_legacy) WHERE is_legacy;
CREATE INDEX IF NOT EXISTS idx_z_reports_closed_at ON public.z_reports USING btree (closed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS z_reports_z_no_unique ON public.z_reports USING btree (z_no);

-- ==========================================================================
-- FUNCTIONS
-- ==========================================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.resolve_vat_policy_preparation(p_rate jsonb, p_vat_number jsonb)
 RETURNS TABLE(configured_rate numeric, vat_number text)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
    v_rate_text text := p_rate #>> '{}';
    v_number_text text := p_vat_number #>> '{}';
begin
    configured_rate := 0.15;
    if v_rate_text is not null
       and pg_catalog.btrim(v_rate_text) ~ '^[+]?([0-9]+([.][0-9]*)?|[.][0-9]+)$'
       and pg_catalog.btrim(v_rate_text)::numeric > 0
       and pg_catalog.btrim(v_rate_text)::numeric <= 1 then
        configured_rate := pg_catalog.btrim(v_rate_text)::numeric(7,6);
    end if;

    vat_number := nullif(pg_catalog.btrim(v_number_text), '');
    return next;
end;
$function$;

CREATE OR REPLACE FUNCTION private.shift_vat_snapshot(p_shift_id integer, p_as_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
    with tax_parts as (
        select
            s.vat_policy_id as policy_id,
            s.vat_rate,
            s.vat_number,
            s.total - s.vat_amount as net,
            s.vat_amount as vat
        from public.sales s
        where s.shift_id = p_shift_id
          and s.status in ('completed', 'refunded')
          and s.sale_date <= p_as_at
          and s.vat_enabled

        union all

        select
            cn.vat_policy_id,
            cn.vat_rate,
            cn.vat_number,
            -(cn.total - cn.vat_amount),
            -cn.vat_amount
        from public.credit_notes cn
        where cn.shift_id = p_shift_id
          and cn.created_at <= p_as_at
          and cn.vat_enabled
    ),
    bands as (
        select
            vat_rate,
            pg_catalog.round(pg_catalog.sum(net), 2) as excl,
            pg_catalog.round(pg_catalog.sum(vat), 2) as vat,
            pg_catalog.round(pg_catalog.sum(net) + pg_catalog.sum(vat), 2) as incl
        from tax_parts
        group by vat_rate
    ),
    identities as (
        select distinct policy_id, vat_rate, vat_number
        from tax_parts
    )
    select pg_catalog.jsonb_build_object(
        'vat_total', coalesce((select pg_catalog.round(pg_catalog.sum(vat), 2) from tax_parts), 0),
        'vat', coalesce((
            select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'rate', b.vat_rate * 100,
                    'label', case
                        when b.vat_rate = 0 then 'Zero-rated 0.00%'
                        else 'VAT ' || pg_catalog.to_char(b.vat_rate * 100, 'FM990.00') || '%'
                    end,
                    'excl', b.excl,
                    'vat', b.vat,
                    'incl', b.incl
                )
                order by b.vat_rate desc
            )
            from bands b
        ), '[]'::jsonb),
        'vat_identities', coalesce((
            select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'policyId', i.policy_id,
                    'rate', i.vat_rate,
                    'vatNumber', i.vat_number
                )
                order by i.policy_id
            )
            from identities i
        ), '[]'::jsonb)
    );
$function$;

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
 SET search_path TO ''
AS $function$
begin
    if new.key in ('vat_enabled', 'vat_rate', 'vat_number') then
        return new;
    end if;

    perform public.log_audit(
        'setting.changed', 'setting', new.key,
        pg_catalog.format('%s changed', new.key),
        pg_catalog.jsonb_build_object('key', new.key, 'from', old.value, 'to', new.value)
    );
    return new;
end;
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
 SET search_path TO ''
AS $function$
declare
    v_now timestamptz := pg_catalog.now();
    v_totals jsonb;
    v_identities jsonb;
    v_expected numeric;
    v_variance numeric;
    v_counted numeric := pg_catalog.round(coalesce(p_counted_cash, 0), 2);
    v_z_no text;
    v_z_id bigint;
    v_user uuid := auth.uid();
begin
    perform 1
    from public.shifts
    where id = p_shift_id and closed_at is null
    for update;
    if not found then
        raise exception 'That shift is already closed, or does not exist';
    end if;

    v_totals := public.z_totals(p_shift_id, v_now);
    v_identities := coalesce(v_totals -> 'vat_identities', '[]'::jsonb);
    v_expected := (v_totals ->> 'expected_cash')::numeric;
    v_variance := pg_catalog.round(v_counted - v_expected, 2);

    update public.shifts
    set closed_by = v_user,
        closed_at = v_now,
        counted_cash = v_counted,
        expected_cash = v_expected,
        variance = v_variance,
        notes = p_notes
    where id = p_shift_id;

    v_z_no := public.next_z_no();

    insert into public.z_reports (
        shift_id, z_no, closed_at, closed_by,
        counted_cash, expected_cash, variance, totals, vat_identity_snapshot
    ) values (
        p_shift_id, v_z_no, v_now, v_user,
        v_counted, v_expected, v_variance,
        v_totals - 'vat_identities', v_identities
    ) returning id into v_z_id;

    return pg_catalog.jsonb_build_object(
        'z_id', v_z_id,
        'z_no', v_z_no,
        'counted_cash', v_counted,
        'expected_cash', v_expected,
        'variance', v_variance,
        'totals', v_totals,
        'vat_identity_snapshot', v_identities
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_sale(p_shift_id integer, p_customer_id integer, p_cashier_id uuid, p_discount numeric, p_items jsonb, p_payments jsonb)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    select public.complete_sale_keyed_at_policy(
        null, p_shift_id, p_customer_id, p_cashier_id, p_discount,
        p_items, p_payments, '[]'::jsonb, null, null
    );
$function$;

CREATE OR REPLACE FUNCTION public.complete_sale_keyed(p_key text, p_shift_id integer, p_customer_id integer, p_cashier_id uuid, p_discount numeric, p_items jsonb, p_payments jsonb, p_discounts jsonb DEFAULT '[]'::jsonb)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    select public.complete_sale_keyed_at_policy(
        p_key, p_shift_id, p_customer_id, p_cashier_id, p_discount,
        p_items, p_payments, p_discounts, null, null
    );
$function$;

CREATE OR REPLACE FUNCTION public.complete_sale_keyed_at_policy(p_key text, p_shift_id integer, p_customer_id integer, p_cashier_id uuid, p_discount numeric, p_items jsonb, p_payments jsonb, p_discounts jsonb, p_vat_policy_id bigint, p_checked_out_at timestamp with time zone)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_key text := nullif(pg_catalog.btrim(p_key), '');
    v_existing bigint;
    v_sale_id bigint;
    v_policy public.vat_policies%rowtype;
    v_checked_out_at timestamptz;
    v_effective_rate numeric(7,6);
    v_snapshot_number text;
    v_subtotal numeric := 0;
    v_total numeric;
    v_vat_amount numeric(12,2);
    v_item jsonb;
    v_line numeric;
    v_variant integer;
    v_desc text;
begin
    -- This must precede policy resolution. A retry belongs to the already
    -- completed sale even if its cached policy would no longer validate.
    if v_key is not null then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_key));

        select id into v_existing
        from public.sales
        where idempotency_key = v_key;

        if v_existing is not null then
            return v_existing;
        end if;
    end if;

    if p_vat_policy_id is null then
        select * into strict v_policy
        from public.vat_policies
        where is_legacy;
    else
        if p_checked_out_at is null then
            raise check_violation using
                message = 'A checkout time is required with a VAT policy id';
        end if;

        select * into v_policy
        from public.vat_policies
        where id = p_vat_policy_id;

        if not found then
            raise check_violation using
                message = pg_catalog.format('VAT policy %s does not exist', p_vat_policy_id);
        end if;
        if v_policy.created_at > p_checked_out_at then
            raise check_violation using
                message = pg_catalog.format(
                    'VAT policy %s was created after checkout',
                    p_vat_policy_id
                );
        end if;
    end if;

    v_checked_out_at := coalesce(p_checked_out_at, pg_catalog.clock_timestamp());
    v_effective_rate := case when v_policy.enabled then v_policy.configured_rate else 0 end;
    v_snapshot_number := case when v_policy.enabled then v_policy.vat_number else null end;

    for v_item in select * from pg_catalog.jsonb_array_elements(p_items) loop
        v_line := (v_item->>'qty')::integer * (v_item->>'unit_price')::numeric
                  - coalesce((v_item->>'discount')::numeric, 0);
        v_subtotal := v_subtotal + v_line;
    end loop;

    v_total := v_subtotal - coalesce(p_discount, 0);
    v_vat_amount := case
        when v_policy.enabled then
            pg_catalog.round(v_total - v_total / (1 + v_effective_rate), 2)
        else 0
    end;

    insert into public.sales (
        sale_no, shift_id, customer_id, sale_date, subtotal, discount,
        vat_amount, total, cashier_id, vat_policy_id, vat_enabled, vat_rate,
        vat_number, idempotency_key
    ) values (
        'pending-' || pg_catalog.gen_random_uuid()::text,
        p_shift_id, p_customer_id, v_checked_out_at, v_subtotal,
        coalesce(p_discount, 0), v_vat_amount, v_total, p_cashier_id,
        v_policy.id, v_policy.enabled, v_effective_rate, v_snapshot_number,
        v_key
    ) returning id into v_sale_id;

    update public.sales
    set sale_no = public.next_doc_no('sale')
    where id = v_sale_id;

    for v_item in select * from pg_catalog.jsonb_array_elements(p_items) loop
        v_line := (v_item->>'qty')::integer * (v_item->>'unit_price')::numeric
                  - coalesce((v_item->>'discount')::numeric, 0);
        v_variant := (v_item->>'variant_id')::integer;
        v_desc := nullif(
            pg_catalog.btrim(coalesce(v_item->>'description', '')),
            ''
        );

        if v_variant is null and v_desc is null then
            raise exception 'A sale line needs either a variant or a description';
        end if;

        insert into public.sale_items (
            sale_id, variant_id, description, qty, unit_price, discount, line_total
        ) values (
            v_sale_id, v_variant, v_desc, (v_item->>'qty')::integer,
            (v_item->>'unit_price')::numeric,
            coalesce((v_item->>'discount')::numeric, 0), v_line
        );

        if v_variant is not null then
            perform public.record_stock_movement(
                v_variant,
                'sale',
                -(v_item->>'qty')::integer,
                'pos_sale',
                v_sale_id,
                null
            );
        end if;
    end loop;

    insert into public.sale_payments (sale_id, method, amount, tendered)
    select
        v_sale_id,
        payment->>'method',
        (payment->>'amount')::numeric,
        (payment->>'tendered')::numeric
    from pg_catalog.jsonb_array_elements(p_payments) as payment;

    insert into public.sale_discounts (
        sale_id, discount_id, label, kind, value, amount, approved_by
    )
    select
        v_sale_id,
        nullif(discount_row->>'discount_id', '')::integer,
        discount_row->>'label',
        discount_row->>'kind',
        (discount_row->>'value')::numeric,
        (discount_row->>'amount')::numeric,
        nullif(discount_row->>'approved_by', '')::uuid
    from pg_catalog.jsonb_array_elements(
        coalesce(p_discounts, '[]'::jsonb)
    ) as discount_row;

    return v_sale_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_sale_with_discounts(p_shift_id integer, p_customer_id integer, p_cashier_id uuid, p_discount numeric, p_items jsonb, p_payments jsonb, p_discounts jsonb DEFAULT '[]'::jsonb)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    select public.complete_sale_keyed_at_policy(
        null, p_shift_id, p_customer_id, p_cashier_id, p_discount,
        p_items, p_payments, p_discounts, null, null
    );
$function$;

CREATE OR REPLACE FUNCTION public.create_credit_note(p_sale_id bigint, p_shift_id integer, p_cashier_id uuid, p_reason text, p_refund_method text, p_items jsonb, p_restock boolean DEFAULT true, p_approved_by uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_note_id bigint;
    v_sale public.sales%rowtype;
    v_item jsonb;
    v_sale_item public.sale_items%rowtype;
    v_qty integer;
    v_returned integer;
    v_unit numeric;
    v_paid_factor numeric;
    v_line numeric;
    v_subtotal numeric := 0;
    v_vat_amount numeric(12,2);
    v_remaining_vat numeric(12,2);
    v_sold integer;
    v_back integer;
begin
    select * into v_sale
    from public.sales
    where id = p_sale_id
    for update;

    if not found then
        raise exception 'Sale % does not exist', p_sale_id;
    end if;

    if coalesce((
        select value::text = 'true'
        from public.settings
        where key = 'refund_requires_manager'
    ), false) then
        if p_approved_by is null then
            raise exception 'This shop needs a manager to approve a return';
        end if;
        if not exists (
            select 1
            from public.profiles
            where id = p_approved_by
              and is_active
              and role in ('owner', 'manager')
        ) then
            raise exception 'Only an owner or a manager can approve a return';
        end if;
    end if;

    if coalesce(pg_catalog.btrim(p_reason), '') = '' then
        raise exception 'A reason is required for a credit note';
    end if;
    if pg_catalog.jsonb_array_length(
        coalesce(p_items, '[]'::jsonb)
    ) = 0 then
        raise exception 'A credit note needs at least one line';
    end if;
    if v_sale.status = 'void' then
        raise exception 'Sale % is void and cannot be returned against', p_sale_id;
    end if;

    v_paid_factor := case
        when coalesce(v_sale.subtotal, 0) > 0
            then v_sale.total / v_sale.subtotal
        else 1
    end;

    for v_item in select * from pg_catalog.jsonb_array_elements(p_items) loop
        v_qty := (v_item->>'qty')::integer;
        if v_qty is null or v_qty <= 0 then
            raise exception 'Return quantities must be positive';
        end if;

        select * into v_sale_item
        from public.sale_items
        where id = (v_item->>'sale_item_id')::bigint
          and sale_id = p_sale_id;

        if not found then
            raise exception 'Line % does not belong to sale %',
                v_item->>'sale_item_id', p_sale_id;
        end if;

        v_returned := public.returned_qty(v_sale_item.id);
        if v_returned + v_qty > v_sale_item.qty then
            raise exception
                'Only % of line % can still be returned (% sold, % already returned)',
                v_sale_item.qty - v_returned,
                v_sale_item.id,
                v_sale_item.qty,
                v_returned;
        end if;

        v_unit := (v_sale_item.line_total / v_sale_item.qty) * v_paid_factor;
        v_subtotal := v_subtotal + pg_catalog.round(v_unit * v_qty, 2);
    end loop;

    v_subtotal := least(
        v_subtotal,
        greatest(
            0,
            v_sale.total - coalesce((
                select pg_catalog.sum(cn.total)
                from public.credit_notes cn
                where cn.sale_id = p_sale_id
            ), 0)
        )
    );

    v_remaining_vat := greatest(
        0,
        v_sale.vat_amount - coalesce((
            select pg_catalog.sum(cn.vat_amount)
            from public.credit_notes cn
            where cn.sale_id = p_sale_id
        ), 0)
    );
    v_vat_amount := case
        when not v_sale.vat_enabled or v_sale.total <= 0 then 0
        else least(
            v_remaining_vat,
            pg_catalog.round(v_subtotal * v_sale.vat_amount / v_sale.total, 2)
        )
    end;

    insert into public.credit_notes (
        approved_by, credit_no, sale_id, shift_id, cashier_id, reason,
        subtotal, vat_amount, total, refund_method, vat_policy_id, vat_enabled,
        vat_rate, vat_number
    ) values (
        p_approved_by,
        public.next_doc_no('credit'),
        p_sale_id,
        p_shift_id,
        p_cashier_id,
        pg_catalog.btrim(p_reason),
        v_subtotal,
        v_vat_amount,
        v_subtotal,
        p_refund_method,
        v_sale.vat_policy_id,
        v_sale.vat_enabled,
        v_sale.vat_rate,
        v_sale.vat_number
    ) returning id into v_note_id;

    for v_item in select * from pg_catalog.jsonb_array_elements(p_items) loop
        v_qty := (v_item->>'qty')::integer;

        select * into v_sale_item
        from public.sale_items
        where id = (v_item->>'sale_item_id')::bigint
          and sale_id = p_sale_id;

        v_unit := (v_sale_item.line_total / v_sale_item.qty) * v_paid_factor;
        v_line := pg_catalog.round(v_unit * v_qty, 2);

        insert into public.credit_note_items (
            credit_note_id, sale_item_id, variant_id, qty, unit_price, line_total
        ) values (
            v_note_id,
            v_sale_item.id,
            v_sale_item.variant_id,
            v_qty,
            pg_catalog.round(v_unit, 2),
            v_line
        );

        if p_restock and v_sale_item.variant_id is not null then
            perform public.record_stock_movement(
                v_sale_item.variant_id,
                'return',
                v_qty,
                'credit_note',
                v_note_id,
                'Returned on ' || (
                    select credit_no from public.credit_notes where id = v_note_id
                )
            );
        end if;
    end loop;

    select
        coalesce(pg_catalog.sum(si.qty), 0),
        coalesce(pg_catalog.sum(public.returned_qty(si.id)), 0)
    into v_sold, v_back
    from public.sale_items si
    where si.sale_id = p_sale_id;

    if v_back >= v_sold then
        update public.sales set status = 'refunded' where id = p_sale_id;
    end if;

    return v_note_id;
end;
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
 SET search_path TO ''
AS $function$
declare
    v_out jsonb;
begin
    if p_from is null or p_to is null then
        raise exception 'daily_summary needs a from and a to date';
    end if;
    if p_to < p_from then
        raise exception 'daily_summary: % is before %', p_to, p_from;
    end if;
    if p_to - p_from > 400 then
        raise exception 'daily_summary: range is longer than 400 days';
    end if;

    with
    scoped as (
        select
            s.id,
            (s.sale_date at time zone 'Indian/Mauritius')::date as day,
            s.total,
            s.vat_amount as vat,
            coalesce(pr.full_name, 'Unknown') as cashier,
            s.customer_id
        from public.sales s
        left join public.profiles pr on pr.id = s.cashier_id
        where s.status = 'completed'
          and (s.sale_date at time zone 'Indian/Mauritius')::date between p_from and p_to
    ),
    tax_parts as (
        select
            (s.sale_date at time zone 'Indian/Mauritius')::date as day,
            pg_catalog.to_char(
                pg_catalog.round(s.vat_rate * 100, 2),
                'FM990.00'
            ) as rate,
            s.total as incl,
            s.vat_amount as vat
        from public.sales s
        where s.status in ('completed', 'refunded')
          and s.vat_enabled
          and (s.sale_date at time zone 'Indian/Mauritius')::date between p_from and p_to

        union all

        select
            (cn.created_at at time zone 'Indian/Mauritius')::date,
            pg_catalog.to_char(
                pg_catalog.round(cn.vat_rate * 100, 2),
                'FM990.00'
            ),
            -cn.total,
            -cn.vat_amount
        from public.credit_notes cn
        where cn.vat_enabled
          and (cn.created_at at time zone 'Indian/Mauritius')::date between p_from and p_to
    ),
    lines as (
        select
            sc.day,
            si.qty,
            coalesce(nullif(pg_catalog.btrim(cat.name), ''), '(uncategorised)') as category,
            si.line_total
              * case when t.line_sum > 0 then sc.total / t.line_sum else 1 end as amount
        from public.sale_items si
        join scoped sc on sc.id = si.sale_id
        join (
            select si2.sale_id, pg_catalog.sum(si2.line_total) as line_sum
            from public.sale_items si2
            where si2.sale_id in (select id from scoped)
            group by si2.sale_id
        ) t on t.sale_id = si.sale_id
        left join public.product_variants pv on pv.id = si.variant_id
        left join public.products p on p.id = pv.product_id
        left join public.categories cat on cat.id = p.category_id
    ),
    pays as (
        select sc.day, sp.method, sp.amount
        from public.sale_payments sp
        join scoped sc on sc.id = sp.sale_id
    ),
    headline as (
        select
            day,
            pg_catalog.count(*)::integer as tickets,
            pg_catalog.count(distinct customer_id)::integer as customers,
            pg_catalog.round(pg_catalog.sum(total), 2) as total_incl,
            pg_catalog.round(pg_catalog.sum(vat), 2) as vat,
            pg_catalog.round(pg_catalog.sum(total) - pg_catalog.sum(vat), 2) as total_excl,
            pg_catalog.round(pg_catalog.sum(total) / pg_catalog.count(*), 2) as avg_incl,
            pg_catalog.round(
                (pg_catalog.sum(total) - pg_catalog.sum(vat)) / pg_catalog.count(*),
                2
            ) as avg_excl
        from scoped
        group by day
    ),
    day_items as (
        select day, pg_catalog.sum(qty)::integer as items
        from lines
        group by day
    ),
    day_methods as (
        select
            day,
            pg_catalog.jsonb_object_agg(
                method,
                pg_catalog.jsonb_build_object(
                    'n', n,
                    'amount', pg_catalog.round(amount, 2)
                )
            ) as by_method
        from (
            select
                day,
                method,
                pg_catalog.count(*)::integer as n,
                pg_catalog.sum(amount) as amount
            from pays
            group by day, method
        ) m
        group by day
    ),
    day_taxes as (
        select
            day,
            pg_catalog.jsonb_object_agg(
                rate,
                pg_catalog.jsonb_build_object(
                    'incl', pg_catalog.round(incl, 2),
                    'excl', pg_catalog.round(incl - vat, 2),
                    'vat', pg_catalog.round(vat, 2)
                )
            ) as by_tax
        from (
            select
                day,
                rate,
                pg_catalog.sum(incl) as incl,
                pg_catalog.sum(vat) as vat
            from tax_parts
            group by day, rate
        ) t
        group by day
    ),
    day_sellers as (
        select
            day,
            pg_catalog.jsonb_object_agg(
                cashier,
                pg_catalog.jsonb_build_object(
                    'n', n,
                    'amount', pg_catalog.round(amount, 2)
                )
            ) as by_seller
        from (
            select
                day,
                cashier,
                pg_catalog.count(*)::integer as n,
                pg_catalog.sum(total) as amount
            from scoped
            group by day, cashier
        ) s
        group by day
    ),
    day_categories as (
        select
            day,
            pg_catalog.jsonb_object_agg(
                category,
                pg_catalog.jsonb_build_object(
                    'qty', qty,
                    'amount', pg_catalog.round(amount, 2)
                )
            ) as by_category
        from (
            select
                day,
                category,
                pg_catalog.sum(qty)::integer as qty,
                pg_catalog.sum(amount) as amount
            from lines
            group by day, category
        ) c
        group by day
    ),
    cols as (
        select
            (
                select coalesce(
                    pg_catalog.jsonb_agg(distinct method order by method),
                    '[]'::jsonb
                )
                from pays
            ) as methods,
            (
                select coalesce(
                    pg_catalog.jsonb_agg(distinct rate order by rate),
                    '[]'::jsonb
                )
                from tax_parts
            ) as taxes,
            (
                select coalesce(
                    pg_catalog.jsonb_agg(distinct cashier order by cashier),
                    '[]'::jsonb
                )
                from scoped
            ) as sellers,
            (
                select coalesce(
                    pg_catalog.jsonb_agg(distinct category order by category),
                    '[]'::jsonb
                )
                from lines
            ) as categories
    )
    select pg_catalog.jsonb_build_object(
        'from', p_from,
        'to', p_to,
        'rows', coalesce((
            select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'day', h.day,
                    'tickets', h.tickets,
                    'items', coalesce(di.items, 0),
                    'customers', h.customers,
                    'total_incl', h.total_incl,
                    'vat', h.vat,
                    'total_excl', h.total_excl,
                    'avg_incl', h.avg_incl,
                    'avg_excl', h.avg_excl,
                    'by_method', coalesce(dm.by_method, '{}'::jsonb),
                    'by_tax', coalesce(dt.by_tax, '{}'::jsonb),
                    'by_seller', coalesce(ds.by_seller, '{}'::jsonb),
                    'by_category', coalesce(dc.by_category, '{}'::jsonb)
                )
                order by h.day
            )
            from headline h
            left join day_items di on di.day = h.day
            left join day_methods dm on dm.day = h.day
            left join day_taxes dt on dt.day = h.day
            left join day_sellers ds on ds.day = h.day
            left join day_categories dc on dc.day = h.day
        ), '[]'::jsonb),
        'methods', (select methods from cols),
        'taxes', (select taxes from cols),
        'sellers', (select sellers from cols),
        'categories', (select categories from cols)
    ) into v_out;

    return v_out;
end;
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

CREATE OR REPLACE FUNCTION public.forget_verifier_with_pin()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- No PIN, no verifier. Checked on INSERT too: offline sign-in consults only
  -- the verifier, so a row carrying one with no pin_code would unlock a till
  -- that the online path would refuse.
  if new.pin_code is null then
    new.pin_device_verifier := null;
    return new;
  end if;

  -- The PIN moved and the verifier did not, so the verifier is for the OLD
  -- PIN. Dropped rather than kept: offline sign-in then needs the network once
  -- more, which is a delay. Keeping it would be a hole.
  if tg_op = 'UPDATE'
     and new.pin_code is distinct from old.pin_code
     and new.pin_device_verifier is not distinct from old.pin_device_verifier
  then
    new.pin_device_verifier := null;
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_owner_access()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.role = 'owner' AND NEW.can_view = FALSE THEN
        RAISE EXCEPTION 'A module cannot be hidden from the owner';
    END IF;
    RETURN NEW;
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

CREATE OR REPLACE FUNCTION public.prevent_vat_policy_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
    -- Preserve the declared ON DELETE SET NULL behavior for actor cleanup. The
    -- fiscal policy fields remain byte-for-byte unchanged.
    if tg_op = 'UPDATE'
       and old.created_by is not null
       and new.created_by is null
       and new.id = old.id
       and new.enabled is not distinct from old.enabled
       and new.configured_rate is not distinct from old.configured_rate
       and new.vat_number is not distinct from old.vat_number
       and new.is_legacy is not distinct from old.is_legacy
       and new.created_at is not distinct from old.created_at then
        return new;
    end if;

    raise exception 'VAT policies are immutable';
end;
$function$;

CREATE OR REPLACE FUNCTION public.receive_purchase(p_purchase_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_purchase public.purchases%rowtype;
    v_policy public.vat_policies%rowtype;
    v_effective_rate numeric(7,6);
    v_vat_amount numeric(12,2);
    v_item record;
begin
    select * into v_purchase
    from public.purchases
    where id = p_purchase_id
    for update;

    if not found or v_purchase.status <> 'draft' then
        raise exception 'Purchase % is not in draft status', p_purchase_id;
    end if;

    -- The policy mutation RPC uses this same transaction lock. Receipt and a
    -- toggle therefore have a definite order instead of racing on "current".
    perform pg_catalog.pg_advisory_xact_lock(20260818090000);

    select * into strict v_policy
    from public.vat_policies
    order by id desc
    limit 1;

    v_effective_rate := case when v_policy.enabled then v_policy.configured_rate else 0 end;
    v_vat_amount := case
        when v_policy.enabled then pg_catalog.round(
            v_purchase.total_amount
            - v_purchase.total_amount / (1 + v_effective_rate),
            2
        )
        else 0
    end;

    update public.purchases
    set status = 'received',
        vat_policy_id = v_policy.id,
        vat_enabled = v_policy.enabled,
        vat_rate = v_effective_rate,
        vat_amount = v_vat_amount
    where id = p_purchase_id;

    for v_item in
        select variant_id, qty
        from public.purchase_items
        where purchase_id = p_purchase_id
    loop
        perform public.record_stock_movement(
            v_item.variant_id,
            'purchase',
            v_item.qty,
            'purchase',
            p_purchase_id,
            null
        );
    end loop;

    update public.product_variants pv
    set cost_price = pi.unit_cost
    from public.purchase_items pi
    where pi.purchase_id = p_purchase_id
      and pi.variant_id = pv.id;
end;
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

CREATE OR REPLACE FUNCTION public.set_vat_policy(p_enabled boolean, p_configured_rate numeric, p_vat_number text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_actor uuid := auth.uid();
    v_number text := nullif(pg_catalog.btrim(p_vat_number), '');
    v_rate numeric(7,6);
    v_old public.vat_policies%rowtype;
    v_new_id bigint;
begin
    if not exists (
        select 1
        from public.profiles
        where id = v_actor
          and role = 'owner'
          and is_active
    ) then
        raise insufficient_privilege using message = 'Only an active owner can change VAT policy';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(20260818090000);

    if p_configured_rate is null or p_configured_rate <= 0 or p_configured_rate > 1 then
        raise check_violation using message = 'Configured VAT rate must be greater than zero and at most one';
    end if;
    v_rate := p_configured_rate::numeric(7,6);
    if v_rate <= 0 or v_rate > 1 then
        raise check_violation using message = 'Configured VAT rate must be greater than zero and at most one';
    end if;
    if p_enabled is null then
        raise not_null_violation using message = 'VAT enabled state is required';
    end if;
    if p_enabled and v_number is null then
        raise check_violation using message = 'A VAT number is required when VAT is enabled';
    end if;

    select * into strict v_old
    from public.vat_policies
    order by id desc
    limit 1;

    insert into public.vat_policies (
        enabled, configured_rate, vat_number, is_legacy, created_by
    ) values (
        p_enabled, v_rate, v_number, false, v_actor
    )
    returning id into v_new_id;

    insert into public.settings (key, value) values
        ('vat_enabled', pg_catalog.to_jsonb(p_enabled)),
        ('vat_rate', pg_catalog.to_jsonb(v_rate)),
        ('vat_number', coalesce(pg_catalog.to_jsonb(v_number), 'null'::jsonb))
    on conflict (key) do update set value = excluded.value;

    insert into public.audit_events (
        actor_id, event_type, ref_type, ref_id, summary, detail
    ) values (
        v_actor,
        'setting.changed',
        'setting',
        'vat_policy',
        'VAT policy changed',
        pg_catalog.jsonb_build_object(
            'old', pg_catalog.jsonb_build_object(
                'enabled', v_old.enabled,
                'rate', v_old.configured_rate,
                'vatNumber', v_old.vat_number
            ),
            'new', pg_catalog.jsonb_build_object(
                'enabled', p_enabled,
                'rate', v_rate,
                'vatNumber', v_number
            )
        )
    );

    return v_new_id;
end;
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
    v_default_vat := 0; -- compatibility variable; frozen output is merged below

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
    ) || private.shift_vat_snapshot(p_shift_id, p_as_at);
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
DROP TRIGGER IF EXISTS trg_module_access_owner ON module_access;
CREATE TRIGGER trg_module_access_owner BEFORE INSERT OR UPDATE ON public.module_access FOR EACH ROW EXECUTE FUNCTION guard_owner_access();
DROP TRIGGER IF EXISTS trg_module_access_pos ON module_access;
CREATE TRIGGER trg_module_access_pos BEFORE INSERT OR UPDATE ON public.module_access FOR EACH ROW EXECUTE FUNCTION guard_pos_access();
DROP TRIGGER IF EXISTS trg_pos_device_state ON pos_devices;
CREATE TRIGGER trg_pos_device_state AFTER UPDATE ON public.pos_devices FOR EACH ROW EXECUTE FUNCTION audit_pos_device_state();
DROP TRIGGER IF EXISTS trg_audit_variant_price ON product_variants;
CREATE TRIGGER trg_audit_variant_price AFTER UPDATE ON public.product_variants FOR EACH ROW WHEN (((old.selling_price IS DISTINCT FROM new.selling_price) OR (old.cost_price IS DISTINCT FROM new.cost_price))) EXECUTE FUNCTION audit_variant_price();
DROP TRIGGER IF EXISTS profiles_forget_verifier_with_pin ON profiles;
CREATE TRIGGER profiles_forget_verifier_with_pin BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION forget_verifier_with_pin();
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
DROP TRIGGER IF EXISTS trg_vat_policies_immutable ON vat_policies;
CREATE TRIGGER trg_vat_policies_immutable BEFORE DELETE OR UPDATE ON public.vat_policies FOR EACH ROW EXECUTE FUNCTION prevent_vat_policy_mutation();

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
ALTER TABLE vat_policies ENABLE ROW LEVEL SECURITY;
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
    USING (((current_role_of_user() = 'owner'::text) AND (key <> ALL (ARRAY['vat_enabled'::text, 'vat_rate'::text, 'vat_number'::text]))))
    WITH CHECK (((current_role_of_user() = 'owner'::text) AND (key <> ALL (ARRAY['vat_enabled'::text, 'vat_rate'::text, 'vat_number'::text]))));

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

DROP POLICY IF EXISTS read_vat_policies_for_active_staff ON vat_policies;
CREATE POLICY read_vat_policies_for_active_staff ON vat_policies
    FOR SELECT TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND profiles.is_active))));

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
    ('payment_methods', '["cash","card","juice","bank"]'::jsonb),
    ('refund_requires_manager', 'false'::jsonb),
    ('shop_name', '"Kids Corner"'::jsonb),
    ('vat_enabled', 'false'::jsonb),
    ('vat_number', NULL),
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
    (20, 'shoe_size', 'EU 28', 29, TRUE),
    (196, 'letter_size', 'S', 40, TRUE),
    (197, 'letter_size', 'M', 41, TRUE),
    (198, 'letter_size', 'L', 42, TRUE),
    (199, 'letter_size', 'XL', 43, TRUE),
    (200, 'letter_size', 'XXL', 44, TRUE),
    (201, 'letter_size', 'XXXL', 45, TRUE)
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
    (1, 'Shop', TRUE, TRUE),
    (2, 'Warehouse', FALSE, TRUE)
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('stock_locations', 'id'),
       greatest((SELECT max(id) FROM stock_locations), 1));

INSERT INTO module_access (id, role, module, can_view) VALUES
    (1, 'owner', 'dashboard', TRUE),
    (2, 'owner', 'products', TRUE),
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
