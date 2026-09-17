-- ============================================================
-- Kids Corner — migration 049: cash rounding to the nearest Rs 5
--
-- WHY. Coins under Rs 5 are scarce at the counter: a Rs 1,137 cash sale
-- paid with Rs 1,140 leaves Rs 3 in coins the drawer may not hold. When the
-- shop switches rounding on, an ALL-CASH sale books the nearest Rs 5
-- instead (Rs 1,135), and the Rs -2 rides on the receipt as its own
-- "Rounding" line, so the books always foot: subtotal − discount +
-- rounding = total, and the cash in the drawer matches the Z to the cent.
--
-- WHY THE SERVER OWNS IT. complete_sale_keyed_at_policy refuses any sale
-- whose payments do not equal its computed total (043/044), and the
-- TypeScript layer re-prices every line from product_variants. A till that
-- rounded locally would be refused at commit — or worse, two tills would
-- book different totals for identical baskets. So the rule lives here, read
-- from settings.round_cash, and every client (web till, Android, offline
-- queue replay) gets the same answer from the same inputs. The till mirrors
-- the arithmetic for its tender display, but the receipt and the ledger
-- always come from these rows.
--
-- DETERMINISM (both sides must agree to the cent). Rounding is defined on
-- the total already rounded to cents: SQL round(v/5)*5 on numeric (exact
-- decimal, ties away from zero) against the tills' Math.round(v/5)*5 on
-- non-negative float64 (half up, identical for positives). Every .5
-- boundary of x/5 with x in cents is exactly representable in binary, so no
-- drift correction is needed the way round2 needs it — the asserts at the
-- end of this file pin the boundaries on this database.
--
-- SCOPE. Ordinary sales through this function only. A mixed tender
-- (cash + card) stays exact — the card rail settles to the cent — as do
-- credit sales, refunds, exchanges and deposits, which are adjustment
-- documents, not counter takings. A mid-queue settings toggle can strand a
-- queued sale (rounded paper against an exact expectation or vice versa);
-- that lands in the existing refused-sale path with the totals message, for
-- the owner to sort before close — the same handling as any other refusal.
--
-- Migrations 001-048 are untouched. Patched in place with blind-patch
-- guards (028 precedent), not restated: the 043 totals guard and the 044
-- balance check stay byte-identical, and both keep working because they run
-- AFTER the rounding below — they validate the rounded total, which is what
-- the payments actually sum to.
-- ============================================================

-- ===== 1. the switch (off: today keeps working exactly as before) =====
INSERT INTO settings (key, value)
VALUES ('round_cash', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ===== 2. the stored figure =====
ALTER TABLE sales ADD COLUMN IF NOT EXISTS rounding NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales.rounding IS
    'Cash-rounding adjustment booked on all-cash sales while '
    'settings.round_cash is on: total = subtotal − discount + rounding. '
    'Zero on every other sale.';

-- ===== 3. declare the working variables =====
DO $$
DECLARE
    v_def TEXT;
    v_old TEXT := '    v_total numeric;' || chr(10);
    v_new TEXT :=
        '    v_total numeric;' || chr(10) ||
        '    -- 049: cash rounding workspace. v_rounding is what lands on the' || chr(10) ||
        '    -- receipt and in sales.rounding; the other two are its inputs.' || chr(10) ||
        '    v_rounding  numeric(12,2) := 0;' || chr(10) ||
        '    v_all_cash  boolean;' || chr(10) ||
        '    v_round_on  boolean;';
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'complete_sale_keyed_at_policy'
       AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'complete_sale_keyed_at_policy not found — refusing to patch blind';
    END IF;
    IF position('v_rounding' IN v_def) > 0 THEN
        RAISE NOTICE '049 already applied (variables) — leaving it alone';
        RETURN;
    END IF;
    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'declare block not as expected — refusing to patch blind';
    END IF;

    EXECUTE replace(v_def, v_old, v_new);
END;
$$;

-- ===== 4. compute the rounding right after the total, before every check ==
--
-- Placed immediately after the same line 044 anchors on, so 044's balance
-- check (already in the body, directly below) validates the ROUNDED total —
-- which is what the payments sum to — and the VAT lines after it are
-- contained in the rounded figure, exactly as for an unrounded sale.
DO $$
DECLARE
    v_def TEXT;
    v_old TEXT := '    v_total := v_subtotal - coalesce(p_discount, 0);' || chr(10);
    v_new TEXT :=
        '    v_total := v_subtotal - coalesce(p_discount, 0);' || chr(10) ||
        '' || chr(10) ||
        '    -- 049: cash rounding. All-cash sales only, and only while the' || chr(10) ||
        '    -- shop has it switched on. Defined on the total already rounded' || chr(10) ||
        '    -- to cents, so every client recomputes the identical figure' || chr(10) ||
        '    -- (see the migration notes on determinism). A mixed tender,' || chr(10) ||
        '    -- credit, and a zero total stay exact.' || chr(10) ||
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
    IF position('049: cash rounding' IN v_def) > 0 THEN
        RAISE NOTICE '049 already applied (computation) — leaving it alone';
        RETURN;
    END IF;
    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'total block not as expected — refusing to patch blind';
    END IF;

    EXECUTE replace(v_def, v_old, v_new);
END;
$$;

-- ===== 5. store the figure on the sale =====
DO $$
DECLARE
    v_def TEXT;
    v_old_cols TEXT :=
        '        vat_number, idempotency_key' || chr(10) ||
        '    ) values (';
    v_new_cols TEXT :=
        '        vat_number, idempotency_key, rounding' || chr(10) ||
        '    ) values (';
    v_old_vals TEXT :=
        '        v_policy.id, v_policy.enabled, v_effective_rate, v_snapshot_number,' || chr(10) ||
        '        v_key' || chr(10) ||
        '    ) returning id into v_sale_id;';
    v_new_vals TEXT :=
        '        v_policy.id, v_policy.enabled, v_effective_rate, v_snapshot_number,' || chr(10) ||
        '        v_key, v_rounding' || chr(10) ||
        '    ) returning id into v_sale_id;';
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'complete_sale_keyed_at_policy'
       AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'complete_sale_keyed_at_policy not found — refusing to patch blind';
    END IF;
    IF position('idempotency_key, rounding' IN v_def) > 0 THEN
        RAISE NOTICE '049 already applied (insert) — leaving it alone';
        RETURN;
    END IF;
    IF position(v_old_cols IN v_def) = 0 OR position(v_old_vals IN v_def) = 0 THEN
        RAISE EXCEPTION 'sale insert not as expected — refusing to patch blind';
    END IF;

    v_def := replace(v_def, v_old_cols, v_new_cols);
    v_def := replace(v_def, v_old_vals, v_new_vals);
    EXECUTE v_def;
END;
$$;

-- ===== 6. pin the arithmetic on this database =====
--
-- Read-only asserts: no rows touched. If any fails the whole migration rolls
-- back, which is the point — a database whose round() disagrees with the
-- tills must never start booking rounded sales.
DO $$
BEGIN
    ASSERT pg_catalog.round(pg_catalog.round(1137.50, 2) / 5, 0) * 5
           - pg_catalog.round(1137.50, 2) = 2.50, 'round5 boundary rounds up';
    ASSERT pg_catalog.round(pg_catalog.round(1137.49, 2) / 5, 0) * 5
           - pg_catalog.round(1137.49, 2) = -2.49, 'just below stays down';
    ASSERT pg_catalog.round(pg_catalog.round(1135.00, 2) / 5, 0) * 5
           - pg_catalog.round(1135.00, 2) = 0, 'exact multiple is a no-op';
    ASSERT pg_catalog.round(pg_catalog.round(0, 2) / 5, 0) * 5
           - pg_catalog.round(0, 2) = 0, 'zero stays zero';
END;
$$;
