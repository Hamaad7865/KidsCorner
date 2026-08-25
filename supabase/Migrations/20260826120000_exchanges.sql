-- ============================================================
-- Kids Corner — migration: exchanges
--
-- An exchange is a return and a sale in one breath. The customer hands back
-- last week's jeans and walks out with this week's; the till shows one
-- document and one number — the gap.
--
-- Modelled as TWO documents that this RPC writes atomically:
--
--   1. A credit note (refund_method 'exchange') against the ORIGINAL sale,
--      crediting each returned line at what the customer actually paid for it
--      — discount included — exactly as a plain return does. All the proven
--      guards apply unchanged: no returning more than was sold and not yet
--      returned, no returns against a void sale, stock back onto the shelf
--      through record_stock_movement.
--
--   2. A NEW sale carrying the replacement lines at TODAY's list prices,
--      re-priced here from product_variants.selling_price — never trusted from
--      the client — with one payment row settling the difference. When the
--      credit exceeds what the replacements cost, the RPC refuses: the change
--      goes back through the normal return path, which is already built,
--      audited and drawer-correct. An exchange only ever takes money.
--
-- The pair is linked: the new sale's exchange_note_id points at the credit
-- note that spawned it.
--
-- The receipt's 7-day promise is enforced HERE, in the database, measured
-- from the original sale to now. Past it, the RPC refuses unless the route
-- has already verified a manager (passed as p_approved_by) — the same
-- division as refunds: the route asks first as a courtesy, the database
-- enforces regardless.
--
-- Money rule, as everywhere: the client sends ids and quantities. Every price
-- in both documents is read or re-derived inside this function.
-- ============================================================

ALTER TABLE sales ADD COLUMN IF NOT EXISTS exchange_note_id BIGINT REFERENCES credit_notes(id);

CREATE OR REPLACE FUNCTION create_exchange(
    p_sale_id BIGINT,
    p_shift_id INT,
    p_cashier_id UUID,
    p_return_items JSONB,   -- [{"sale_item_id": 12, "qty": 1}, ...]
    p_new_items JSONB,      -- [{"variant_id": 34, "qty": 1}, ...]
    p_payment_method TEXT,  -- how the gap is settled on the new sale
    p_tendered NUMERIC,     -- cash handed over for the gap, when cash
    p_approved_by UUID      -- NULL inside the window; manager id past it
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_sale            sales%ROWTYPE;
    v_note_id         BIGINT;
    v_new_sale_id     BIGINT;
    v_item            JSONB;
    v_sale_item       sale_items%ROWTYPE;
    v_qty             INT;
    v_returned        INT;
    v_unit            NUMERIC;
    v_line            NUMERIC;
    v_credit_subtotal NUMERIC := 0;
    v_new_subtotal    NUMERIC := 0;
    v_gap             NUMERIC;
    v_vat_rate        NUMERIC;
    v_list            NUMERIC;
    v_variant         INT;
    v_days_old        NUMERIC;
BEGIN
    IF jsonb_array_length(coalesce(p_return_items, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'An exchange needs at least one item coming back';
    END IF;
    IF jsonb_array_length(coalesce(p_new_items, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'An exchange needs at least one item going out';
    END IF;

    SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
    END IF;
    IF v_sale.status = 'void' THEN
        RAISE EXCEPTION 'Sale % is void and cannot be exchanged', p_sale_id;
    END IF;

    -- The receipt's own promise: seven days, then a manager decides. The route
    -- will have verified the manager before calling; here that is enforced,
    -- not assumed.
    SELECT EXTRACT(DAY FROM now() - v_sale.sale_date) INTO v_days_old;
    IF v_days_old > 7 AND p_approved_by IS NULL THEN
        RAISE EXCEPTION
            'This sale is % days old - past the 7-day exchange window. A manager must approve.',
            floor(v_days_old)::INT;
    END IF;

    SELECT (value)::NUMERIC INTO v_vat_rate FROM settings WHERE key = 'vat_rate';
    v_vat_rate := coalesce(v_vat_rate, 0.15);

    ------------------------------------------------------------------
    -- First pass: price what comes back at what was PAID, validate counts.
    ------------------------------------------------------------------
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_return_items) LOOP
        v_qty := (v_item->>'qty')::INT;
        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION 'Return quantities must be positive';
        END IF;

        SELECT * INTO v_sale_item
          FROM sale_items
         WHERE id = (v_item->>'sale_item_id')::BIGINT AND sale_id = p_sale_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Line % does not belong to sale %',
                v_item->>'sale_item_id', p_sale_id;
        END IF;

        v_returned := returned_qty(v_sale_item.id);
        IF v_returned + v_qty > v_sale_item.qty THEN
            RAISE EXCEPTION
                'Only % of line % can still come back (% sold, % already returned)',
                v_sale_item.qty - v_returned, v_sale_item.id,
                v_sale_item.qty, v_returned;
        END IF;

        v_unit := (v_sale_item.line_total / v_sale_item.qty);
        v_credit_subtotal := v_credit_subtotal + round(v_unit * v_qty, 2);
    END LOOP;

    ------------------------------------------------------------------
    -- Second pass: price what goes out at TODAY's list price, straight from
    -- product_variants.selling_price. Nothing here trusts the client.
    ------------------------------------------------------------------
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_new_items) LOOP
        v_qty     := (v_item->>'qty')::INT;
        v_variant := (v_item->>'variant_id')::INT;
        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION 'Replacement quantities must be positive';
        END IF;
        IF v_variant IS NULL THEN
            RAISE EXCEPTION 'Every replacement line needs a variant';
        END IF;

        SELECT selling_price INTO v_list FROM product_variants WHERE id = v_variant;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Variant % does not exist', v_variant;
        END IF;

        v_new_subtotal := v_new_subtotal + round(v_list * v_qty, 2);
    END LOOP;

    v_gap := round(v_new_subtotal - v_credit_subtotal, 2);
    IF v_gap < 0 THEN
        RAISE EXCEPTION
            'The replacement items cost MUR % less than the MUR % credit. Give the difference back through Returns instead.',
            abs(v_gap), v_credit_subtotal;
    END IF;

    ------------------------------------------------------------------
    -- Write: credit note first (the new sale points at it), then the new
    -- sale, its lines, its settlement payment; stock moves both ways.
    ------------------------------------------------------------------
    INSERT INTO credit_notes (credit_no, sale_id, shift_id, cashier_id, reason,
            subtotal, vat_amount, total, refund_method)
    VALUES (
        'CN' || to_char(now(), 'YYMMDD') || '-' || nextval('credit_note_no_seq'),
        p_sale_id, p_shift_id, p_cashier_id,
        'Exchange — items swapped at the counter',
        v_credit_subtotal,
        round(v_credit_subtotal - v_credit_subtotal / (1 + v_vat_rate), 2),
        v_credit_subtotal,
        'exchange'
    )
    RETURNING id INTO v_note_id;

    INSERT INTO sales (sale_no, shift_id, customer_id, subtotal, discount,
            vat_amount, total, cashier_id, exchange_note_id)
    VALUES (
        'pending-' || gen_random_uuid()::TEXT,
        p_shift_id, v_sale.customer_id, v_new_subtotal, 0,
        round(v_new_subtotal - v_new_subtotal / (1 + v_vat_rate), 2),
        v_new_subtotal, p_cashier_id, v_note_id
    )
    RETURNING id INTO v_new_sale_id;

    UPDATE sales SET sale_no = next_doc_no('sale') WHERE id = v_new_sale_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_return_items) LOOP
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

        PERFORM record_stock_movement(
            v_sale_item.variant_id, 'return', v_qty,
            'credit_note', v_note_id,
            'Exchanged on ' || (SELECT credit_no FROM credit_notes WHERE id = v_note_id));
    END LOOP;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_new_items) LOOP
        v_qty     := (v_item->>'qty')::INT;
        v_variant := (v_item->>'variant_id')::INT;

        SELECT selling_price INTO v_list FROM product_variants WHERE id = v_variant;
        v_line := round(v_list * v_qty, 2);

        INSERT INTO sale_items (sale_id, variant_id, qty, unit_price, discount, line_total)
        VALUES (v_new_sale_id, v_variant, v_qty, v_list, 0, v_line);

        PERFORM record_stock_movement(
            v_variant, 'sale', -v_qty, 'pos_sale', v_new_sale_id, NULL);
    END LOOP;

    INSERT INTO sale_payments (sale_id, method, amount, tendered)
    VALUES (
        v_new_sale_id, p_payment_method, v_gap,
        CASE WHEN p_payment_method = 'cash' THEN p_tendered ELSE NULL END
    );

    RETURN v_new_sale_id;
END;
$$;
