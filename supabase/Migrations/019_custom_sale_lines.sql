-- ============================================================
-- 019 — a sale line that is not a catalogue item
--
-- POS v2 adds a "Custom item" key: gift wrap, an alteration, stock that came in
-- without a label. Those have a description and a price and nothing else — no
-- variant, no barcode, no stock to move.
--
-- `sale_items.variant_id` has been NOT NULL since migration 001, so such a line
-- cannot be written at all today. This makes it nullable, adds the description
-- it needs instead, and constrains the pair so a line is always one thing or
-- the other — never a row with neither, which would be a charge nobody can
-- identify on a receipt a customer is holding.
--
-- `credit_note_items` gets the same treatment. Without it a custom line could
-- be sold and then never returned, which is a worse trap than not selling it:
-- the customer is at the counter with the receipt.
--
-- Migrations 001-018 are untouched.
-- ============================================================

-- ===== sale_items =====

ALTER TABLE sale_items ALTER COLUMN variant_id DROP NOT NULL;

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS sale_items_identifiable;

-- Every line names what was sold: a catalogue variant, or words on a receipt.
ALTER TABLE sale_items ADD CONSTRAINT sale_items_identifiable CHECK (
    variant_id IS NOT NULL
    OR (description IS NOT NULL AND length(trim(description)) > 0)
);

COMMENT ON COLUMN sale_items.description IS
  'Set only for a custom line — gift wrap, an alteration, unlabelled stock. '
  'Mutually exclusive with variant_id in practice; the constraint requires at '
  'least one.';

-- ===== credit_note_items =====

ALTER TABLE credit_note_items ALTER COLUMN variant_id DROP NOT NULL;

-- ===== complete_sale, replaced =====
-- Identical to migration 009's except that a line without a variant is written
-- with its description and moves no stock. Everything else — the placeholder
-- sale_no, the VAT-inclusive arithmetic, the payment rows — is unchanged.
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

    -- A throwaway unique value first: sale_no is NOT NULL UNIQUE, so it needs
    -- *something* on insert, and two concurrent sales must not collide on it.
    -- The real number is stamped on immediately below, inside the same
    -- transaction, so no caller ever observes the placeholder.
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
$$;

-- ===== create_credit_note, replaced =====
-- Same as migration 018's except a custom line is returnable: it is written to
-- credit_note_items with a NULL variant and moves no stock, whatever the
-- restock flag says. There is no shelf for gift wrap to go back onto.
CREATE OR REPLACE FUNCTION create_credit_note(
    p_sale_id BIGINT,
    p_shift_id INT,
    p_cashier_id UUID,
    p_reason TEXT,
    p_refund_method TEXT,
    p_items JSONB,
    p_restock BOOLEAN DEFAULT TRUE
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

        v_unit := (v_sale_item.line_total / v_sale_item.qty);
        v_subtotal := v_subtotal + round(v_unit * v_qty, 2);
    END LOOP;

    INSERT INTO credit_notes (credit_no, sale_id, shift_id, cashier_id, reason,
            subtotal, vat_amount, total, refund_method)
    VALUES (
        'CN' || to_char(now(), 'YYMMDD') || '-' || nextval('credit_note_no_seq'),
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

        v_unit := (v_sale_item.line_total / v_sale_item.qty);
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
$$;
