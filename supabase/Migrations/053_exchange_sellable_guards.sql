-- ============================================================
-- Kids Corner — migration 053: exchange replacements must be sellable,
-- in stock, and paid for
--
-- THREE GAPS in create_exchange's second pass (what goes OUT), all stricter
-- on the ordinary sale path:
--
-- 1. RETIRED VARIANTS. The loop checked only that the variant EXISTS. A
--    retired variant — pulled from sale precisely so it cannot be sold —
--    walked straight back out through an exchange. Fresh sales refuse it in
--    both TypeScript and the RPC's 043 guard; exchanges now refuse it too,
--    in the sale's own words.
--
-- 2. STOCK, MEASURED PER VARIANT. The same variant can arrive as two rows,
--    and checking each row against qty_on_hand separately lets 2 + 2 through
--    on 3 units (the sale path sums per variant first, for exactly this
--    reason). Replacement quantities are now aggregated per variant before
--    they are measured, so the refusal names the real shortfall instead of
--    arriving as a raw constraint violation from the stock floor.
--
-- 3. SHORT CASH TENDER. The settlement row always booked amount = gap, with
--    no check that cash tendered covers it. Cash short of the gap booked the
--    full gap as taken while the drawer received less — the ordinary sale
--    path refuses an under-payment for the same reason, and now so does this.
--
-- Patched in place with blind-patch guards (049 precedent): the function's
-- pricing, VAT snapshot, credit cap and writes are untouched.
-- ============================================================

-- ===== 1. working variables for the per-variant check =====
DO $$
DECLARE
    v_def TEXT;
    v_old TEXT := '    v_gap             NUMERIC;' || chr(10);
    v_new TEXT := '    v_gap             NUMERIC;' || chr(10) ||
                  '    v_active          BOOLEAN;' || chr(10) ||
                  '    v_stock           INT;' || chr(10);
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'create_exchange'
       AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'create_exchange not found — refusing to patch blind';
    END IF;
    IF position('053:' IN v_def) > 0 THEN
        RAISE NOTICE '053 already applied (variables) — leaving it alone';
        RETURN;
    END IF;
    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'declare block not as expected — refusing to patch blind';
    END IF;

    EXECUTE replace(v_def, v_old, v_new);
END;
$$;

-- ===== 2. per-variant replacement validation, before the pricing loop =====
DO $$
DECLARE
    v_def TEXT;
    v_old TEXT :=
        '    FOR v_item IN SELECT * FROM jsonb_array_elements(p_new_items) LOOP' || chr(10) ||
        '        v_qty     := (v_item->>''qty'')::INT;' || chr(10) ||
        '        v_variant := (v_item->>''variant_id'')::INT;' || chr(10) ||
        '        IF v_qty IS NULL OR v_qty <= 0 THEN' || chr(10) ||
        '            RAISE EXCEPTION ''Replacement quantities must be positive'';' || chr(10) ||
        '        END IF;' || chr(10) ||
        '        IF v_variant IS NULL THEN' || chr(10) ||
        '            RAISE EXCEPTION ''Every replacement line needs a variant'';' || chr(10) ||
        '        END IF;' || chr(10);
    v_new TEXT :=
        '    -- 053: replacements validated per variant, not per row. Duplicate' || chr(10) ||
        '    -- rows naming one variant measure against stock together (2 + 2' || chr(10) ||
        '    -- must not pass on 3 units), and a retired variant cannot walk out' || chr(10) ||
        '    -- of an exchange any more than of a fresh sale.' || chr(10) ||
        '    FOR v_variant, v_qty IN' || chr(10) ||
        '        SELECT (v_new_row->>''variant_id'')::INT, SUM((v_new_row->>''qty'')::INT)::INT' || chr(10) ||
        '          FROM pg_catalog.jsonb_array_elements(p_new_items) AS v_new_row' || chr(10) ||
        '         GROUP BY (v_new_row->>''variant_id'')::INT' || chr(10) ||
        '    LOOP' || chr(10) ||
        '        IF v_variant IS NULL THEN' || chr(10) ||
        '            RAISE EXCEPTION ''Every replacement line needs a variant'';' || chr(10) ||
        '        END IF;' || chr(10) ||
        '        IF v_qty IS NULL OR v_qty <= 0 THEN' || chr(10) ||
        '            RAISE EXCEPTION ''Replacement quantities must be positive'';' || chr(10) ||
        '        END IF;' || chr(10) ||
        '' || chr(10) ||
        '        SELECT pv.selling_price, pv.is_active, pv.qty_on_hand,' || chr(10) ||
        '               coalesce(p.name, ''This item'')' || chr(10) ||
        '          INTO v_list, v_active, v_stock, v_product_name' || chr(10) ||
        '          FROM product_variants pv LEFT JOIN products p ON p.id = pv.product_id' || chr(10) ||
        '         WHERE pv.id = v_variant;' || chr(10) ||
        '        IF NOT FOUND THEN' || chr(10) ||
        '            RAISE EXCEPTION ''Variant % does not exist'', v_variant;' || chr(10) ||
        '        END IF;' || chr(10) ||
        '        IF NOT coalesce(v_active, FALSE) THEN' || chr(10) ||
        '            RAISE EXCEPTION ''% has been retired and cannot be sold.'', v_product_name;' || chr(10) ||
        '        END IF;' || chr(10) ||
        '        IF v_qty > v_stock THEN' || chr(10) ||
        '            RAISE EXCEPTION ''Only % of % left — the exchange asks for %.'',' || chr(10) ||
        '                v_stock, v_product_name, v_qty;' || chr(10) ||
        '        END IF;' || chr(10) ||
        '    END LOOP;' || chr(10) ||
        '' || chr(10) ||
        '    FOR v_item IN SELECT * FROM jsonb_array_elements(p_new_items) LOOP' || chr(10) ||
        '        v_qty     := (v_item->>''qty'')::INT;' || chr(10) ||
        '        v_variant := (v_item->>''variant_id'')::INT;' || chr(10) ||
        '        IF v_qty IS NULL OR v_qty <= 0 THEN' || chr(10) ||
        '            RAISE EXCEPTION ''Replacement quantities must be positive'';' || chr(10) ||
        '        END IF;' || chr(10) ||
        '        IF v_variant IS NULL THEN' || chr(10) ||
        '            RAISE EXCEPTION ''Every replacement line needs a variant'';' || chr(10) ||
        '        END IF;' || chr(10);
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'create_exchange'
       AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'create_exchange not found — refusing to patch blind';
    END IF;
    IF position('has been retired and cannot be sold' IN v_def) > 0 THEN
        RAISE NOTICE '053 already applied (replacement validation) — leaving it alone';
        RETURN;
    END IF;
    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'replacement loop not as expected — refusing to patch blind';
    END IF;
    IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
        RAISE EXCEPTION 'replacement loop anchor is not unique — refusing to patch blind';
    END IF;

    EXECUTE replace(v_def, v_old, v_new);
END;
$$;

-- ===== 3. refuse cash short of the gap =====
DO $$
DECLARE
    v_def TEXT;
    v_old TEXT :=
        '    INSERT INTO sale_payments (sale_id, method, amount, tendered)' || chr(10) ||
        '    VALUES (' || chr(10) ||
        '        v_new_sale_id, p_payment_method, v_gap,' || chr(10);
    v_new TEXT :=
        '    -- 053: cash short of the gap is refused, not booked. Recording the' || chr(10) ||
        '    -- full gap as taken while the drawer received less leaves it short' || chr(10) ||
        '    -- at close with only the tendered column to explain it — the' || chr(10) ||
        '    -- ordinary sale path refuses an under-payment for the same reason.' || chr(10) ||
        '    IF p_payment_method = ''cash'' AND v_gap > 0' || chr(10) ||
        '       AND coalesce(p_tendered, v_gap) < v_gap THEN' || chr(10) ||
        '        RAISE EXCEPTION ''Cash of % is short of the % gap — tender the gap or settle another way.'',' || chr(10) ||
        '            coalesce(p_tendered, v_gap), v_gap;' || chr(10) ||
        '    END IF;' || chr(10) ||
        '' || chr(10) ||
        '    INSERT INTO sale_payments (sale_id, method, amount, tendered)' || chr(10) ||
        '    VALUES (' || chr(10) ||
        '        v_new_sale_id, p_payment_method, v_gap,' || chr(10);
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'create_exchange'
       AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'create_exchange not found — refusing to patch blind';
    END IF;
    IF position('short of the % gap' IN v_def) > 0 THEN
        RAISE NOTICE '053 already applied (tender check) — leaving it alone';
        RETURN;
    END IF;
    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'settlement insert not as expected — refusing to patch blind';
    END IF;

    EXECUTE replace(v_def, v_old, v_new);
END;
$$;

-- ===== 4. prove the repair took =====
DO $$
DECLARE
    v_def TEXT;
BEGIN
    SELECT pg_get_functiondef(oid) INTO v_def
      FROM pg_proc
     WHERE proname = 'create_exchange'
       AND pronamespace = 'public'::regnamespace;

    IF position('has been retired and cannot be sold' IN v_def) = 0 THEN
        RAISE EXCEPTION '053 failed: the replacement validation is absent';
    END IF;
    IF position('short of the % gap' IN v_def) = 0 THEN
        RAISE EXCEPTION '053 failed: the tender check is absent';
    END IF;
END;
$$;
