-- ============================================================
-- Kids Corner — migration: exchange VAT snapshot, numbering, caps
--
-- create_exchange (20260826120000) wrote its credit note and its
-- replacement sale without the VAT snapshot columns — vat_policy_id,
-- vat_enabled, vat_rate, vat_number — so every exchange died on
-- credit_notes' NOT NULL before it wrote a row (and would have died on
-- sales' own NOT NULLs next). It also minted credit numbers from a
-- private sequence rather than next_doc_no('credit'), so they would
-- drift from the numbering every return uses, and it priced the credit
-- without the paid factor or the refund cap that create_credit_note
-- enforces — a sale sold under a basket discount would have credited
-- more than the customer actually paid.
--
-- This replacement mirrors the two functions the till already trusts:
--
--   * The credit note copies the ORIGINAL sale's frozen VAT snapshot and
--     shares create_credit_note's paid factor, remaining-credit cap and
--     proportional VAT — an exchange line is credited exactly as a
--     returned line is.
--   * The replacement sale snapshots the CURRENT policy (highest id, the
--     same row getCurrentVatPolicy hands the till) exactly as
--     complete_sale_keyed_at_policy does: effective rate zero while
--     disabled, the configured rate while enabled, the number only when
--     enabled.
-- ============================================================

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
    v_policy          vat_policies%ROWTYPE;
    v_note_id         BIGINT;
    v_new_sale_id     BIGINT;
    v_item            JSONB;
    v_sale_item       sale_items%ROWTYPE;
    v_qty             INT;
    v_returned        INT;
    v_paid_factor     NUMERIC;
    v_unit            NUMERIC;
    v_line            NUMERIC;
    v_credit_subtotal NUMERIC := 0;
    v_credit_vat      NUMERIC(12,2);
    v_new_subtotal    NUMERIC := 0;
    v_new_vat         NUMERIC(12,2);
    v_effective_rate  NUMERIC;
    v_gap             NUMERIC;
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

    -- Locked, as create_credit_note locks it: a return running at the same
    -- moment must queue behind this exchange, not interleave with it.
    SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
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

    -- What the customer actually PAID per rupee of line price: a basket-level
    -- discount spread across every line, exactly as create_credit_note reads
    -- it. Without it the credit overstates the money that changed hands.
    v_paid_factor := CASE
        WHEN coalesce(v_sale.subtotal, 0) > 0
            THEN v_sale.total / v_sale.subtotal
        ELSE 1
    END;

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

        v_unit := (v_sale_item.line_total / v_sale_item.qty) * v_paid_factor;
        v_credit_subtotal := v_credit_subtotal + round(v_unit * v_qty, 2);
    END LOOP;

    -- The same cap a plain return lives under: the sale's credits can never
    -- total more than the sale took. Earlier credit notes count against it.
    v_credit_subtotal := least(
        v_credit_subtotal,
        greatest(
            0,
            v_sale.total - coalesce((
                SELECT sum(cn.total) FROM credit_notes cn
                 WHERE cn.sale_id = p_sale_id
            ), 0)
        )
    );

    -- The VAT line shares the sale's own frozen snapshot: a proportional
    -- slice of what the sale charged, never more than has not yet been
    -- credited, and nothing at all when the sale was rung VAT-off.
    v_credit_vat := CASE
        WHEN NOT v_sale.vat_enabled OR v_sale.total <= 0 THEN 0
        ELSE least(
            greatest(
                0,
                v_sale.vat_amount - coalesce((
                    SELECT sum(cn.vat_amount) FROM credit_notes cn
                     WHERE cn.sale_id = p_sale_id
                ), 0)
            ),
            round(v_credit_subtotal * v_sale.vat_amount / v_sale.total, 2)
        )
    END;

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

    -- The replacements ring under the CURRENT policy — the same highest-id
    -- row getCurrentVatPolicy hands the till for a fresh sale, snapshot onto
    -- this document now so a later rate change cannot restate it.
    SELECT * INTO v_policy FROM vat_policies ORDER BY id DESC LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No VAT policy is configured';
    END IF;
    v_effective_rate := CASE WHEN v_policy.enabled THEN v_policy.configured_rate ELSE 0 END;
    v_new_vat := CASE
        WHEN v_policy.enabled
            THEN round(v_new_subtotal - v_new_subtotal / (1 + v_effective_rate), 2)
        ELSE 0
    END;

    -- The gap, decided AFTER the cap: a clamped credit narrows it.
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
            subtotal, vat_amount, total, refund_method,
            vat_policy_id, vat_enabled, vat_rate, vat_number)
    VALUES (
        next_doc_no('credit'),
        p_sale_id, p_shift_id, p_cashier_id,
        'Exchange — items swapped at the counter',
        v_credit_subtotal,
        v_credit_vat,
        v_credit_subtotal,
        'exchange',
        v_sale.vat_policy_id,
        v_sale.vat_enabled,
        v_sale.vat_rate,
        v_sale.vat_number
    )
    RETURNING id INTO v_note_id;

    INSERT INTO sales (sale_no, shift_id, customer_id, subtotal, discount,
            vat_amount, total, cashier_id, exchange_note_id,
            vat_policy_id, vat_enabled, vat_rate, vat_number)
    VALUES (
        'pending-' || gen_random_uuid()::TEXT,
        p_shift_id, v_sale.customer_id, v_new_subtotal, 0,
        v_new_vat, v_new_subtotal, p_cashier_id, v_note_id,
        v_policy.id,
        v_policy.enabled,
        v_effective_rate,
        CASE WHEN v_policy.enabled THEN v_policy.vat_number ELSE NULL END
    )
    RETURNING id INTO v_new_sale_id;

    UPDATE sales SET sale_no = next_doc_no('sale') WHERE id = v_new_sale_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_return_items) LOOP
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
