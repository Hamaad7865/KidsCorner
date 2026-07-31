-- ============================================================
-- 018 — a return does not always go back on the shelf
--
-- `create_credit_note` from migration 004 always calls `record_stock_movement`
-- with 'return', so every credit note puts the goods back into stock. That is
-- right for "wrong size" and "changed mind"; it is wrong for "faulty item",
-- where the unit is coming back to the shop but must never be sold again.
--
-- POS v2's refund screen makes that a switch — "Put items back into stock",
-- with "Faulty stock stays out — back office writes it off" underneath — so the
-- RPC needs to be told which it is.
--
-- `p_restock` defaults TRUE, so every existing caller keeps its current
-- behaviour and no past credit note is affected. The old five-argument
-- signature is dropped at the end: leaving both would let a caller reach the
-- one that ignores the flag, which is exactly the bug this closes.
--
-- Migrations 001-017 are untouched.
-- ============================================================

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

    -- Second pass: write the lines, and put the stock back only if asked.
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
        --
        -- Skipped for a faulty return. The credit note still records that the
        -- unit came back and that the customer was refunded — the goods simply
        -- never rejoin the sellable count, and the back office writes them off
        -- from the credit note.
        IF p_restock THEN
            PERFORM record_stock_movement(
                v_sale_item.variant_id, 'return', v_qty,
                'credit_note', v_note_id,
                'Returned on ' || (SELECT credit_no FROM credit_notes WHERE id = v_note_id));
        END IF;
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

-- The six-argument original would still be reachable by a caller that omits
-- p_restock positionally, and it ignores the flag entirely. Dropped so there is
-- one definition and one behaviour.
DROP FUNCTION IF EXISTS create_credit_note(BIGINT, INT, UUID, TEXT, TEXT, JSONB);
