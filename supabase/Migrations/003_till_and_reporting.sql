-- ============================================================
-- Kids Corner — migration 003: till movements + the shift totals aggregator
--
-- Ported in spirit (not in code) from the Carfectionist detailing system, whose
-- till ledger and Z-report aggregator solve the same problems. Three ideas
-- carried across:
--
--   1. The cash ledger is APPEND-ONLY. A mistake is corrected with an opposite
--      row, never an edit, so the drawer's history always explains its balance.
--   2. ONE aggregator behind every report. The till and the back office call the
--      same function, so they can never quote different numbers for the same
--      shift.
--   3. VAT comes from each sale's FROZEN vat_amount, never re-derived from the
--      lines. `complete_sale` already computed and stored it against the rate in
--      force at the time; re-deriving would silently restate history if the VAT
--      rate in `settings` ever changes.
--
-- What is deliberately NOT carried across: Carfectionist is VAT-EXCLUSIVE and
-- multi-tenant. Kids Corner is VAT-INCLUSIVE and one shop. Copying its money
-- path would misstate every total by 15%.
--
-- Migrations 001 and 002 are untouched.
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
