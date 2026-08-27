-- ============================================================
-- Kids Corner — migration: exchanges settle either way, and can't double-fire
--
-- TWO INDEPENDENT FIXES, bundled because both touch create_exchange.
--
-- 1. THE REFUSAL THAT SHOULDN'T HAVE BEEN ONE.
--
-- create_exchange raised whenever the replacement cost less than the credit,
-- sending the cashier to the separate Returns screen to hand back the
-- difference. There is no reason a single customer interaction — one set of
-- goods back, one set out — should need two documents. The gap is now signed:
-- positive means the customer pays it (unchanged), negative means the shop
-- pays it back through the same "settle by" method already on screen. The
-- sale_payments row this writes already only ever carried the GAP, never the
-- new sale's full total — a negative amount on that same row is that same
-- shape, not a new one. z_totals needs no change: its cash math already nets
-- signed sale_payments.amount (see its own comment about sign() specifically
-- anticipating a negative line), and credit_notes.refund_method stays
-- 'exchange' in both directions, so it never touches z_totals' separate
-- cash-refund tally either.
--
-- `tendered` only means something when the CUSTOMER is handing over cash to
-- make change from — never on a payout leg, and never on a non-cash method.
--
-- 2. THE ERROR THAT NAMED A DATABASE ROW INSTEAD OF A PRODUCT.
--
-- "Only 0 of line 332 can still come back" — 332 is sale_items.id, meaningless
-- at a till. Both create_exchange and create_credit_note raise the identical
-- message; both now name the product instead. The refusal itself is
-- unchanged: a fully returned or exchanged line still can't be touched again.
--
-- 3. THE MISSING KEY.
--
-- create_exchange has always been atomic, which is not the same as safe to
-- retry — exactly the bug migration 011 closed for complete_sale. Lose the
-- response after a successful exchange and the till shows a failure over an
-- exchange that already happened; pressing Exchange again then fails THIS
-- error's own validation, because the line really was already returned — by
-- the first, silent success. create_exchange_keyed wraps create_exchange the
-- same way complete_sale_keyed wraps complete_sale_with_discounts, reusing
-- sales.idempotency_key and its unique index from migration 011 — the
-- exchange's replacement item is itself a row in `sales`, so no new column is
-- needed. Needs no explicit GRANT/REVOKE: created after migration 035's
-- `ALTER DEFAULT PRIVILEGES`, it inherits the same defaults create_exchange
-- itself already relies on.
-- ============================================================

-- ===== create_exchange =====
-- Migration 20260826130000's function: the negative-gap refusal is gone, the
-- sale_payments tendered/amount pair now signs correctly either way, and the
-- first-pass error names the product. Everything else — the VAT snapshot, the
-- credit cap, the stock movements — is untouched.
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
    -- Only resolved when the returnable-quantity check actually fails — a
    -- product name for a message, nothing pricing depends on it.
    v_product_name    TEXT;
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
            SELECT coalesce(p.name, v_sale_item.description, 'this item') INTO v_product_name
              FROM product_variants pv JOIN products p ON p.id = pv.product_id
             WHERE pv.id = v_sale_item.variant_id;
            RAISE EXCEPTION
                'Only % left of "%" to exchange (% sold, % already returned)',
                v_sale_item.qty - v_returned, coalesce(v_product_name, v_sale_item.description, 'this item'),
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

    -- The gap, decided AFTER the cap: a clamped credit narrows it. Signed —
    -- positive is what the customer still owes, negative is what the shop
    -- owes back. Both settle through p_payment_method below.
    v_gap := round(v_new_subtotal - v_credit_subtotal, 2);

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
        -- Change only means something when the customer hands over cash to
        -- pay a positive gap. A refund leg, an exact match, or any non-cash
        -- method carries no tendered figure at all.
        CASE WHEN p_payment_method = 'cash' AND v_gap > 0
            THEN coalesce(p_tendered, v_gap)
            ELSE NULL END
    );

    RETURN v_new_sale_id;
END;
$$;

-- ===== create_credit_note =====
-- Migration 021's function with ONLY the returnable-quantity message changed
-- to name the product instead of the internal sale_items.id. Everything else
-- — the paid-factor apportionment, the restock call, the fully-refunded
-- check — is untouched.
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
    -- Only resolved when the returnable-quantity check actually fails.
    v_product_name TEXT;
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
            SELECT coalesce(p.name, v_sale_item.description, 'this item') INTO v_product_name
              FROM product_variants pv JOIN products p ON p.id = pv.product_id
             WHERE pv.id = v_sale_item.variant_id;
            RAISE EXCEPTION
                'Only % left of "%" to return (% sold, % already returned)',
                v_sale_item.qty - v_returned, coalesce(v_product_name, v_sale_item.description, 'this item'),
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

-- ===== create_exchange_keyed =====
-- The wrapper the till calls, mirroring complete_sale_keyed (migration 011)
-- exactly: everything about pricing, VAT, stock and the settlement direction
-- still happens in create_exchange above — this adds only the "have I already
-- done this?" question in front of it, reusing sales.idempotency_key and its
-- unique index rather than adding a new column, because the exchange's
-- replacement item is itself a row in `sales`.
CREATE OR REPLACE FUNCTION create_exchange_keyed(
    p_key            TEXT,
    p_sale_id        BIGINT,
    p_shift_id       INT,
    p_cashier_id     UUID,
    p_return_items   JSONB,
    p_new_items      JSONB,
    p_payment_method TEXT,
    p_tendered       NUMERIC,
    p_approved_by    UUID
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_existing BIGINT;
    v_sale_id  BIGINT;
BEGIN
    -- No key means the caller accepts the old behaviour. Kept so an older
    -- client, or a script, still works rather than failing closed on a till.
    IF p_key IS NULL OR btrim(p_key) = '' THEN
        RETURN create_exchange(p_sale_id, p_shift_id, p_cashier_id, p_return_items,
                                p_new_items, p_payment_method, p_tendered, p_approved_by);
    END IF;

    -- Held to the end of the transaction. A concurrent retry under the same
    -- key blocks here rather than racing past the check below.
    PERFORM pg_advisory_xact_lock(hashtext(p_key));

    SELECT id INTO v_existing FROM sales WHERE idempotency_key = p_key;
    IF v_existing IS NOT NULL THEN
        -- The replay. Deliberately returns the original sale rather than
        -- raising: from the till's side this attempt succeeded, and it did —
        -- just the first time.
        RETURN v_existing;
    END IF;

    v_sale_id := create_exchange(p_sale_id, p_shift_id, p_cashier_id, p_return_items,
                                  p_new_items, p_payment_method, p_tendered, p_approved_by);

    UPDATE sales SET idempotency_key = p_key WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$;
