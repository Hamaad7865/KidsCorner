-- ============================================================
-- Kids Corner — migration 044: cash fixes (drawer guard and balanced sales)
--
-- TWO DEFECTS, both money leaving the drawer uncounted or unbalanced.
--
-- 1. record_till_movement's overdraw guard counts money already refunded.
--
--    v_available was opening_float + cash sales (completed only) + movements.
--    Cash handed back in a refund was never subtracted, so after a Rs 500 cash
--    sale with a Rs 200 cash refund on a Rs 1,000 float, the guard believed Rs
--    1,500 was available in a drawer holding Rs 1,300 — and would let a
--    cashier take Rs 1,500 out. The Z and shift_totals both compute
--    expected_cash as float + cash_in + movements - cash_refunds; the guard
--    that protects the same drawer must use the same figure.
--
--    THE FIX widens the guard's cash_in to completed AND refunded (a fully
--    returned ticket still took cash across this counter — migration 031
--    established exactly this for z_totals) and subtracts cash refunds raised
--    in this shift. Only refund_method = 'cash' counts: card/Juice/exchange
--    refunds reverse on their own rail and never left this drawer.
--
-- 2. complete_sale_keyed_at_policy trusts the payments it is handed.
--
--    The TypeScript till refuses an under- or over-payment before calling, but
--    this RPC is reachable by any authenticated client and inserts whatever
--    payment rows it receives. A caller skipping the TS layer could book an
--    unbalanced sale — short-changing the reconciliation with no refusal.
--
--    THE FIX refuses, before anything is inserted (so a refusal burns no sale
--    number), when the payments do not match the computed total. Compared in
--    cents — each row rounded, exactly what sale_payments stores — with the
--    same 0.001 slack the till allows.
--
-- DELIBERATELY NOT CHANGED:
--
-- - shift_totals still counts completed AND refunded tickets in its sales
--   lines. That is not the 031 defect: the Z lists refunded tickets separately
--   (v_sales stays completed-only, credited alongside), while shift_totals'
--   net_total = sales_total - refunds nets to zero on a fully refunded
--   same-shift sale precisely BECAUSE the ticket is still counted. Narrowing
--   it to completed-only would show net -500 on a sale that took and returned
--   500, and would reintroduce the double-subtraction 031 fixed — this time
--   into the close screen. Both reports already agree on expected_cash.
--
-- - No credit ceiling is (re)introduced. Migration 20260821090000 retired
--   per-customer limits at the owner's request: an open account may run a tab
--   of any size, and the trigger, the view comment and the till tests all say
--   so. A limit here would contradict that decision and fail the migration's
--   own 5,000,000-probe.
-- ============================================================

-- ── 1. the drawer guard ──────────────────────────────────────────────

DO $$
DECLARE
    v_def TEXT;
    v_old_cash TEXT :=
        '    SELECT coalesce(sum(sp.amount), 0) INTO v_cash_in' || chr(10) ||
        '    FROM sale_payments sp' || chr(10) ||
        '    JOIN sales s ON s.id = sp.sale_id' || chr(10) ||
        '    WHERE s.shift_id = p_shift_id' || chr(10) ||
        '      AND s.status = ''completed''' || chr(10) ||
        '      AND sp.method = ''cash'';' || chr(10) ||
        '' || chr(10) ||
        '    SELECT coalesce(sum(amount), 0) INTO v_movements' || chr(10) ||
        '    FROM till_movements WHERE shift_id = p_shift_id;' || chr(10) ||
        '' || chr(10) ||
        '    v_available := v_float + v_cash_in + v_movements;';
    v_new_cash TEXT :=
        '    -- Completed AND refunded: a fully-returned ticket still took cash' || chr(10) ||
        '    -- across this counter (migration 031 established this for z_totals);' || chr(10) ||
        '    -- the giving back is v_cash_refund''s job below, exactly once.' || chr(10) ||
        '    SELECT coalesce(sum(sp.amount), 0) INTO v_cash_in' || chr(10) ||
        '    FROM sale_payments sp' || chr(10) ||
        '    JOIN sales s ON s.id = sp.sale_id' || chr(10) ||
        '    WHERE s.shift_id = p_shift_id' || chr(10) ||
        '      AND s.status IN (''completed'', ''refunded'')' || chr(10) ||
        '      AND sp.method = ''cash'';' || chr(10) ||
        '' || chr(10) ||
        '    SELECT coalesce(sum(amount), 0) INTO v_movements' || chr(10) ||
        '    FROM till_movements WHERE shift_id = p_shift_id;' || chr(10) ||
        '' || chr(10) ||
        '    -- Cash handed back comes straight out of this drawer. Only cash:' || chr(10) ||
        '    -- a card or Juice refund reverses on its own rail.' || chr(10) ||
        '    SELECT coalesce(sum(total), 0) INTO v_cash_refund' || chr(10) ||
        '    FROM credit_notes' || chr(10) ||
        '    WHERE shift_id = p_shift_id AND refund_method = ''cash'';' || chr(10) ||
        '' || chr(10) ||
        '    v_available := v_float + v_cash_in + v_movements - v_cash_refund;';
    v_old_decl TEXT :=
        '    v_movements     NUMERIC;' || chr(10) ||
        '    v_available     NUMERIC;';
    v_new_decl TEXT :=
        '    v_movements     NUMERIC;' || chr(10) ||
        '    v_cash_refund   NUMERIC;' || chr(10) ||
        '    v_available     NUMERIC;';
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'record_till_movement' AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'record_till_movement not found — refusing to patch blind';
    END IF;
    IF position(v_old_cash IN v_def) = 0 THEN
        RAISE EXCEPTION 'record_till_movement cash block not as expected — refusing to patch blind';
    END IF;
    IF position(v_old_decl IN v_def) = 0 THEN
        RAISE EXCEPTION 'record_till_movement declare block not as expected — refusing to patch blind';
    END IF;

    v_def := replace(v_def, v_old_decl, v_new_decl);
    v_def := replace(v_def, v_old_cash, v_new_cash);
    EXECUTE v_def;
END;
$$;

-- ── 2. the balanced-sale rule ────────────────────────────────────────

DO $$
DECLARE
    v_def TEXT;
    v_old TEXT :=
        '    v_total := v_subtotal - coalesce(p_discount, 0);' || chr(10);
    v_new TEXT :=
        '    v_total := v_subtotal - coalesce(p_discount, 0);' || chr(10) ||
        '' || chr(10) ||
        '    -- Balanced like the till. TypeScript refuses an unbalanced sale' || chr(10) ||
        '    -- before calling, but this function is reachable by any' || chr(10) ||
        '    -- authenticated client, so the rule lives here too. Compared in' || chr(10) ||
        '    -- cents — each row rounded, exactly what sale_payments stores —' || chr(10) ||
        '    -- with the same cent of slack the till allows, and before' || chr(10) ||
        '    -- anything is inserted so a refusal burns no sale number.' || chr(10) ||
        '    if abs(' || chr(10) ||
        '        coalesce((' || chr(10) ||
        '            select sum(pg_catalog.round((payment->>''amount'')::numeric, 2))' || chr(10) ||
        '            from pg_catalog.jsonb_array_elements(p_payments) as payment' || chr(10) ||
        '        ), 0) - pg_catalog.round(v_total, 2)' || chr(10) ||
        '    ) > 0.001 then' || chr(10) ||
        '        raise check_violation using' || chr(10) ||
        '            message = ''Sale payments do not match the sale total'';' || chr(10) ||
        '    end if;' || chr(10);
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'complete_sale_keyed_at_policy'
       AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'complete_sale_keyed_at_policy not found — refusing to patch blind';
    END IF;
    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'complete_sale_keyed_at_policy total block not as expected — refusing to patch blind';
    END IF;

    -- Guard against double-apply: the anchor line survives inside v_new, so a
    -- re-run would match again and insert a second copy of the check.
    IF position('Sale payments do not match the sale total' IN v_def) > 0 THEN
        RAISE NOTICE 'balance check already present; skipping';
        RETURN;
    END IF;

    EXECUTE replace(v_def, v_old, v_new);
END;
$$;
