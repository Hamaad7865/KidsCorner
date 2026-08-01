-- ============================================================
-- Kids Corner — migration 031: a full cash refund is subtracted once
--
-- THE DEFECT, and it is the mirror of the one 022 was written to fix.
--
-- `v_sales` is the shift's tickets, filtered to status 'completed'. Every
-- figure on the Z is built from it, `v_cash_in` included. But when a customer
-- returns EVERYTHING on a ticket, `create_credit_note` flips that sale to
-- 'refunded' — so it drops out of `v_sales`, and the cash it took drops out of
-- `v_cash_in` with it. Line 272 then subtracts `v_cash_refund` as well.
--
-- Worked through, and reproduced against the live database before this was
-- written: float Rs 1,000, one cash sale of Rs 500, customer returns the lot
-- for cash. The drawer holds 1,000 + 500 − 500 = Rs 1,000. The Z computed
-- 1,000 + 0 + 0 − 500 = Rs 500, and reported the cashier Rs 500 OVER.
--
-- A PARTIAL refund reconciled correctly the whole time — the sale stays
-- 'completed', so its cash is still counted and the refund is subtracted once.
-- That asymmetry is why this survived every review until now.
--
-- THE FIX. Cash in is a question about money that physically crossed the
-- counter, not about the ticket's later fate. A sale that was refunded still
-- took cash; the giving back is `v_cash_refund`'s job, and it should happen
-- exactly once.
--
-- Deliberately NOT changed: `v_sales` itself. Tickets, sales total, VAT and
-- discounts still count completed sales only. Whether a refunded ticket should
-- appear in the Z's sales line is a reporting judgement for the shop, not a
-- reconciliation defect, and widening it here would move half a dozen figures
-- to fix one.
--
-- Voided sales stay out of both. A void is money that never counted.
--
-- Migrations 001-030 are untouched.
-- ============================================================

DO $$
DECLARE
    v_def TEXT;
    v_old TEXT :=
        'v_cash_in := coalesce((' || chr(10) ||
        '        SELECT round(sum(sp.amount), 2) FROM sale_payments sp' || chr(10) ||
        '         WHERE sp.sale_id = ANY(v_sales) AND sp.method = ''cash''' || chr(10) ||
        '    ), 0);';
    v_new TEXT :=
        'v_cash_in := coalesce((' || chr(10) ||
        '        -- Not ANY(v_sales): that set is completed-only, and a ticket' || chr(10) ||
        '        -- refunded in full leaves it — taking the cash it collected' || chr(10) ||
        '        -- out of the drawer figure while v_cash_refund subtracts the' || chr(10) ||
        '        -- same money a second time.' || chr(10) ||
        '        SELECT round(sum(sp.amount), 2)' || chr(10) ||
        '          FROM sale_payments sp' || chr(10) ||
        '          JOIN sales s ON s.id = sp.sale_id' || chr(10) ||
        '         WHERE s.shift_id = p_shift_id' || chr(10) ||
        '           AND s.status IN (''completed'', ''refunded'')' || chr(10) ||
        '           AND s.sale_date <= p_as_at' || chr(10) ||
        '           AND sp.method = ''cash''' || chr(10) ||
        '    ), 0);';
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'z_totals' AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'z_totals does not look as expected — refusing to patch blind';
    END IF;

    EXECUTE replace(v_def, v_old, v_new);
END;
$$;
