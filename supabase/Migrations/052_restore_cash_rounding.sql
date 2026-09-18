-- ============================================================
-- Kids Corner — migration 052: restore the cash rounding 050 dropped
--
-- THE DEFECT. Migration 050 restated complete_sale_keyed_at_policy as "same
-- body as live, plus p_note" — but the body it restated predated 049. The
-- 049 computation block (read settings.round_cash, round an all-cash total to
-- the nearest Rs 5, book the delta in sales.rounding) never made it into the
-- restatement. What survived is its shadow: the v_rounding / v_all_cash /
-- v_round_on declarations and the `rounding` column in the insert, with
-- v_rounding hard-wired to 0 and v_total never adjusted.
--
-- The tills did not notice, because both compute the rounded figure themselves
-- (TypeScript in lib/pos/sale-core.ts, Kotlin in TillViewModel) and post
-- payments for it. With round_cash off those payments are exact and the RPC's
-- balance checks pass. The moment an owner switches rounding on, every
-- all-cash sale is refused with "Sale payments do not match the sale total" —
-- the tills post 1,135, the RPC expects 1,137.
--
-- WHY NOT RE-RUN 049. All three of its blind-patch guards false-positive on
-- 050's carcass: 'v_rounding' matches the dead declaration, '049: cash
-- rounding' matches the workspace comment above it, and 'idempotency_key,
-- rounding' matches the insert list. Re-running 049 reports "already applied"
-- three times and changes nothing. So this migration re-applies ONLY the
-- computation block, guarded on the computation's own fingerprint
-- ('v_all_cash AND v_round_on'), which no non-working body contains.
--
-- The re-applied block is byte-identical to 049's: same setting, same scope
-- (all-cash, positive totals), same SQL round(v/5)*5 the tills mirror. It is
-- placed in the same position — immediately after the total, before the
-- 043/044 balance checks — so those checks keep validating the rounded total
-- the payments actually sum to.
-- ============================================================

-- ===== 1. confirm the body is the one this patch is written against =====
DO $$
DECLARE
    v_def TEXT;
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'complete_sale_keyed_at_policy'
       AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'complete_sale_keyed_at_policy not found — refusing to patch blind';
    END IF;
    -- The eleven-argument shape: ten would be the pre-050 overload 051 dropped.
    IF position('p_note' IN v_def) = 0 THEN
        RAISE EXCEPTION 'complete_sale_keyed_at_policy has no p_note — 050 is missing, apply it first';
    END IF;
    -- The 050 carcass this repairs: declarations present, computation absent.
    IF position('v_all_cash  boolean;' IN v_def) = 0
       OR position('v_round_on  boolean;' IN v_def) = 0 THEN
        RAISE EXCEPTION 'rounding workspace declarations not as expected — refusing to patch blind';
    END IF;
    IF position('v_all_cash AND v_round_on' IN v_def) > 0 THEN
        RAISE NOTICE '052 already applied (rounding computation present) — leaving it alone';
        RETURN;
    END IF;
    IF position('    v_total := v_subtotal - coalesce(p_discount, 0);' || chr(10) IN v_def) = 0 THEN
        RAISE EXCEPTION 'total block not as expected — refusing to patch blind';
    END IF;
END;
$$;

-- ===== 2. re-apply the 049 computation, verbatim =====
DO $$
DECLARE
    v_def TEXT;
    v_old TEXT := '    v_total := v_subtotal - coalesce(p_discount, 0);' || chr(10);
    v_new TEXT :=
        '    v_total := v_subtotal - coalesce(p_discount, 0);' || chr(10) ||
        '' || chr(10) ||
        '    -- 052: restored 049 cash rounding (050''s restatement dropped it;' || chr(10) ||
        '    -- see the migration notes). All-cash sales only, and only while the' || chr(10) ||
        '    -- shop has it switched on. Defined on the total already rounded' || chr(10) ||
        '    -- to cents, so every client recomputes the identical figure.' || chr(10) ||
        '    -- A mixed tender, credit, and a zero total stay exact.' || chr(10) ||
        '    SELECT NOT EXISTS (' || chr(10) ||
        '        SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payments) AS payment' || chr(10) ||
        '         WHERE payment->>''method'' <> ''cash''' || chr(10) ||
        '    ) INTO v_all_cash;' || chr(10) ||
        '    SELECT coalesce((SELECT value::text FROM public.settings' || chr(10) ||
        '                      WHERE key = ''round_cash''), ''false'') = ''true''' || chr(10) ||
        '      INTO v_round_on;' || chr(10) ||
        '    IF v_all_cash AND v_round_on AND v_total > 0 THEN' || chr(10) ||
        '        v_rounding := pg_catalog.round(pg_catalog.round(v_total, 2) / 5, 0) * 5' || chr(10) ||
        '                      - pg_catalog.round(v_total, 2);' || chr(10) ||
        '        v_rounding := pg_catalog.round(v_rounding, 2);' || chr(10) ||
        '        v_total := v_total + v_rounding;' || chr(10) ||
        '    END IF;' || chr(10);
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'complete_sale_keyed_at_policy'
       AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'complete_sale_keyed_at_policy not found — refusing to patch blind';
    END IF;
    IF position('v_all_cash AND v_round_on' IN v_def) > 0 THEN
        RAISE NOTICE '052 already applied (rounding computation present) — leaving it alone';
        RETURN;
    END IF;
    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'total block not as expected — refusing to patch blind';
    END IF;

    EXECUTE replace(v_def, v_old, v_new);
END;
$$;

-- ===== 3. prove the repair took =====
DO $$
DECLARE
    v_def TEXT;
BEGIN
    SELECT pg_get_functiondef(oid) INTO v_def
      FROM pg_proc
     WHERE proname = 'complete_sale_keyed_at_policy'
       AND pronamespace = 'public'::regnamespace;

    IF position('v_all_cash AND v_round_on' IN v_def) = 0 THEN
        RAISE EXCEPTION '052 failed: the rounding computation is still absent';
    END IF;
    IF position('round_cash' IN v_def) = 0 THEN
        RAISE EXCEPTION '052 failed: the function no longer reads the round_cash setting';
    END IF;
END;
$$;
