-- ============================================================
-- Kids Corner — migration 004: returns and credit notes
--
-- `sales.status` has always had a 'refunded' value with nothing implementing
-- it. A return is modelled as its own document rather than by mutating the
-- original sale, for the same reason stock_movements is append-only: the
-- original ticket is what the customer holds, and it must still say what it
-- said on the day.
--
--   credit_notes       — header: which sale, which shift, who, why, how refunded
--   credit_note_items  — the lines coming back, each tied to its sale_item
--   create_credit_note — the only write path (atomic: note + lines + stock in)
--
-- Partial returns are first class: a customer bringing back one of three shirts
-- gets a credit note for one. The RPC refuses to return more of a line than was
-- sold and not yet returned, so repeated partial returns can never over-refund.
--
-- VAT: prices are VAT-INCLUSIVE, so VAT is extracted from the credit total with
-- the same expression complete_sale uses. A refund must reverse the original
-- exactly, not re-derive it under a different model.
--
-- shift_totals is replaced here so cash refunds reduce expected cash — without
-- that a refunded shift would never reconcile.
--
-- Migrations 001–003 are untouched.
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
