-- ============================================================
-- Kids Corner — migration 009: a stock floor, and sale numbers that match
--
-- TWO INDEPENDENT FIXES, BOTH IN THE SALE PATH.
--
-- 1. STOCK COULD GO NEGATIVE. record_stock_movement in 001 does
--    `qty_on_hand = qty_on_hand + p_qty` with no floor, so two tills selling
--    the last unit at the same moment both succeed and the variant lands on
--    -1. The app now checks availability before calling the RPC, but a check
--    in application code cannot survive a race — between the read and the
--    write, the other till has already sold it. Only the database can hold
--    this, so the floor goes here as a CHECK constraint.
--
--    A constraint rather than a trigger on purpose: it is declarative, it
--    cannot be bypassed by a future RPC that forgets to call the trigger, and
--    it makes an oversell abort the whole sale transaction — which is the
--    correct outcome, since complete_sale is meant to be atomic.
--
--    Note this also stops a manual adjustment taking stock below zero. That is
--    intended: there is no such thing as -2 shirts on a shelf. The stock
--    actions map the resulting 23514 to a readable sentence.
--
-- 2. SALE NUMBERS SKIPPED. complete_sale built sale_no with
--    `nextval('sales_id_seq')` while the row's own BIGSERIAL default called
--    nextval on the SAME sequence — two values burned per sale, and a printed
--    sale_no that never matched the row id. Receipts read S260728-2, -4, -6.
--    Below, the id is allocated once and the number is derived from it, so the
--    two always agree.
--
-- Migrations 001-008 are untouched.
-- ============================================================

-- ===== 1. Stock floor =====

-- Any pre-existing negative would make the constraint fail to validate, and a
-- half-applied migration is worse than a loud one. Report them first.
DO $$
DECLARE
    v_bad INT;
BEGIN
    SELECT count(*) INTO v_bad FROM product_variants WHERE qty_on_hand < 0;
    IF v_bad > 0 THEN
        RAISE EXCEPTION
            'Cannot add the stock floor: % variant(s) are already negative. '
            'Correct them with an adjustment first, then re-run 009.', v_bad;
    END IF;
END $$;

ALTER TABLE product_variants
    DROP CONSTRAINT IF EXISTS qty_on_hand_non_negative;

ALTER TABLE product_variants
    ADD CONSTRAINT qty_on_hand_non_negative CHECK (qty_on_hand >= 0);

-- ===== 2. complete_sale, with sale_no derived from the id =====
-- Byte-for-byte the 001 body apart from the sale_no handling. Everything else —
-- VAT extraction, the line loop, the stock movements, the payment rows — is
-- deliberately unchanged.
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

        INSERT INTO sale_items (sale_id, variant_id, qty, unit_price, discount, line_total)
        VALUES (v_sale_id, (v_item->>'variant_id')::INT, (v_item->>'qty')::INT,
                (v_item->>'unit_price')::NUMERIC,
                COALESCE((v_item->>'discount')::NUMERIC, 0), v_line);

        PERFORM record_stock_movement(
            (v_item->>'variant_id')::INT, 'sale',
            -(v_item->>'qty')::INT, 'pos_sale', v_sale_id, NULL);
    END LOOP;

    INSERT INTO sale_payments (sale_id, method, amount, tendered)
    SELECT v_sale_id, p->>'method', (p->>'amount')::NUMERIC,
           (p->>'tendered')::NUMERIC
    FROM jsonb_array_elements(p_payments) AS p;

    RETURN v_sale_id;
END;
$$;
