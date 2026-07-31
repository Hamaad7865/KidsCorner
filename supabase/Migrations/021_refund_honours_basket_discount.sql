-- A refund must give back what the customer PAID, not what the line listed.
--
-- `create_credit_note` valued each returned unit at `line_total / qty`.
-- `sale_items.line_total` is net of that line's own discount but knows nothing
-- about a discount applied to the whole basket, which lives on `sales.discount`.
--
-- So a basket that listed at 1,451.42, took 10% off and was paid at 1,306.28
-- refunded the full 1,451.42 when it came back — 145.14 of the shop's money,
-- on every returned item, every time.
--
-- Latent until now: no completed sale has ever carried a basket discount
-- (verified against the live table before writing this). The till's new
-- basket-discount key makes it reachable, which is why it is fixed here.
--
-- THE APPORTIONMENT
--
-- Pro-rata by line total, which for this schema reduces to a single factor:
-- `complete_sale` sets `subtotal = SUM(line_total)` and `total = subtotal -
-- discount`, so every line scales by `total / subtotal`. A line that was 40%
-- of the basket carries 40% of the discount — the only split that cannot be
-- argued with when a customer returns one item of four.
--
-- This is migration 019's function with ONLY the unit price changed. The
-- restock call, the already-returned guard and the fully-refunded check are
-- untouched, deliberately: a money fix is not the place to also reshape the
-- parts that were working.

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
    -- What the customer actually paid, over what the lines listed.
    v_paid_factor NUMERIC;
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
$$;
