-- ============================================================
-- Kids Corner — migration 032: three reporting and rounding defects
--
-- Migrations 001-031 are untouched.
-- ============================================================

-- ===== 1. the Z under-reported discounts given =====
--
-- `discount_total` was `sum(sales.discount)`, which is the BASKET discount
-- only. Money taken off a single line lives in `sale_items.discount` and is
-- already inside `line_total`, so it never reached the figure — and a line
-- discount is precisely the kind that needs a manager's PIN. Rs 200 could come
-- off a shirt, a manager be made to authorise it, and the day's Z report
-- "Discounts given: Rs 0.00".
--
-- Both are now counted. They cannot double-count: a basket discount is
-- `sales.discount` and comes off the subtotal, a line discount is inside the
-- line and comes off before it.

-- ===== 2. the VAT breakdown fragmented into fictitious bands =====
--
-- The rate was re-implied per sale from stored figures —
-- `vat_amount / (total - vat_amount)` — and grouped by the result. Because
-- `vat_amount` is rounded to the cent when the sale commits, that quotient
-- wobbles on small tickets: a Rs 20.00 ticket implies 15.01%, a Rs 5.00 ticket
-- 14.94%. A shift with a Rs 100, a Rs 20 and a Rs 5 sale printed THREE VAT
-- bands on the slip that is the shop's VAT record.
--
-- Re-implying is still the right instinct — it is what keeps sales made before
-- a rate change in their own band rather than relabelling them with today's
-- rate. So the implied rate is kept, and merely SNAPPED to the configured rate
-- when it lands within half a point of it, which rounding noise always does
-- and a genuine historical rate never would.

-- ===== 3. a full return could exceed what was paid, by cents =====
--
-- Each line is apportioned `(line_total / qty) * paid_factor` and rounded to
-- the cent, and nothing reconciled the sum against the sale. Three lines of
-- Rs 333.34 on a sale paid at Rs 900.02 each refund Rs 300.01 — Rs 900.03 back
-- for Rs 900.02 taken. Cents, but it is the shop's cents, and the drawer is
-- short by them.
--
-- Capped at what the sale has left to give: its total, less everything already
-- credited against it. A full return now hands back exactly what was paid.

DO $$
DECLARE
    v_def TEXT;

    -- ---- (1) discounts -------------------------------------------------
    v_disc_old TEXT :=
        'SELECT count(*), coalesce(sum(total), 0),' || chr(10) ||
        '           coalesce(sum(vat_amount), 0), coalesce(sum(discount), 0)' || chr(10) ||
        '      INTO v_sale_count, v_sales_total, v_vat_total, v_discount' || chr(10) ||
        '      FROM sales WHERE id = ANY(v_sales);';
    v_disc_new TEXT :=
        'SELECT count(*), coalesce(sum(total), 0),' || chr(10) ||
        '           coalesce(sum(vat_amount), 0), coalesce(sum(discount), 0)' || chr(10) ||
        '      INTO v_sale_count, v_sales_total, v_vat_total, v_discount' || chr(10) ||
        '      FROM sales WHERE id = ANY(v_sales);' || chr(10) || chr(10) ||
        '    -- Money off individual lines counts as a discount given. It lives' || chr(10) ||
        '    -- in sale_items and is already inside line_total, so it never' || chr(10) ||
        '    -- reached sales.discount — and a line discount is exactly the kind' || chr(10) ||
        '    -- a manager has to authorise.' || chr(10) ||
        '    v_discount := v_discount + coalesce((' || chr(10) ||
        '        SELECT sum(si.discount) FROM sale_items si' || chr(10) ||
        '         WHERE si.sale_id = ANY(v_sales)' || chr(10) ||
        '    ), 0);';

    -- ---- (2) VAT bands -------------------------------------------------
    v_vat_old TEXT :=
        'SELECT round(' || chr(10) ||
        '                     CASE WHEN s.total - s.vat_amount > 0' || chr(10) ||
        '                          THEN s.vat_amount / (s.total - s.vat_amount) * 100' || chr(10) ||
        '                          ELSE v_default_vat * 100 END, 2) AS rate,';
    v_vat_new TEXT :=
        'SELECT (' || chr(10) ||
        '                     -- Snapped to the configured rate when within half a' || chr(10) ||
        '                     -- point: the implied figure wobbles by a few' || chr(10) ||
        '                     -- hundredths on small tickets because vat_amount was' || chr(10) ||
        '                     -- rounded to the cent, and each wobble used to open' || chr(10) ||
        '                     -- its own band on the shop''s VAT record.' || chr(10) ||
        '                     SELECT CASE' || chr(10) ||
        '                       WHEN s.total - s.vat_amount <= 0 THEN round(v_default_vat * 100, 2)' || chr(10) ||
        '                       WHEN abs(s.vat_amount / (s.total - s.vat_amount) * 100' || chr(10) ||
        '                                - v_default_vat * 100) <= 0.5' || chr(10) ||
        '                            THEN round(v_default_vat * 100, 2)' || chr(10) ||
        '                       ELSE round(s.vat_amount / (s.total - s.vat_amount) * 100, 2)' || chr(10) ||
        '                     END) AS rate,';
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'z_totals' AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'z_totals not found';
    END IF;
    IF position(v_disc_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'z_totals discount block not as expected — refusing to patch blind';
    END IF;
    IF position(v_vat_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'z_totals VAT block not as expected — refusing to patch blind';
    END IF;

    v_def := replace(v_def, v_disc_old, v_disc_new);
    v_def := replace(v_def, v_vat_old, v_vat_new);
    EXECUTE v_def;
END;
$$;

-- ===== 3. cap a credit note at what the sale has left =====
DO $$
DECLARE
    v_def TEXT;
    v_old TEXT :=
        'INSERT INTO credit_notes (credit_no, sale_id, shift_id, cashier_id, reason,';
    v_cap TEXT :=
        '-- Never give back more than this sale has left to give.' || chr(10) ||
        '    --' || chr(10) ||
        '    -- Each line was apportioned and rounded on its own, so a full return' || chr(10) ||
        '    -- of several lines can total a cent or two over what was actually' || chr(10) ||
        '    -- paid. The sale''s own total, less everything already credited' || chr(10) ||
        '    -- against it, is the ceiling.' || chr(10) ||
        '    v_subtotal := least(' || chr(10) ||
        '        v_subtotal,' || chr(10) ||
        '        greatest(0, v_sale.total - coalesce((' || chr(10) ||
        '            SELECT sum(cn.total) FROM credit_notes cn WHERE cn.sale_id = p_sale_id' || chr(10) ||
        '        ), 0))' || chr(10) ||
        '    );' || chr(10) || chr(10) ||
        '    INSERT INTO credit_notes (credit_no, sale_id, shift_id, cashier_id, reason,';
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'create_credit_note' AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'create_credit_note not as expected — refusing to patch blind';
    END IF;
    IF position('has left to give' IN v_def) > 0 THEN
        RAISE NOTICE 'create_credit_note already capped — leaving it alone';
    ELSE
        EXECUTE replace(v_def, v_old, v_cap);
    END IF;
END;
$$;
