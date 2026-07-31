-- ============================================================
-- Kids Corner — migration 005: the discount engine
--
-- Until now a discount was a bare number typed into the cart: nothing recorded
-- WHY money was given away, so "how much did we discount last month, and on
-- what" was unanswerable. This adds named, reusable discounts and a ledger of
-- what was actually applied to each sale.
--
--   discounts       — the rules: percent or fixed amount, sale- or line-level,
--                     optional category, minimum spend, cap, date window, and
--                     a manager-approval flag.
--   sale_discounts  — what was applied, with the name/kind/value FROZEN at the
--                     time of sale. Editing a discount next month must not
--                     restate what a receipt from today says.
--   complete_sale_with_discounts — wraps complete_sale so the sale and its
--                     discount rows land in one transaction.
--
-- Simpler than the equivalent in the Carfectionist system on purpose: that one
-- stores money ex-VAT and has to divide fixed discounts by (1 + vat_rate) to
-- reach its base. Kids Corner is VAT-INCLUSIVE end to end, so a "Rs 50 off" is
-- simply Rs 50 off and VAT falls out of the total as it always has.
--
-- Migrations 001-004 are untouched.
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
