-- ============================================================
-- Kids Corner — migration 027: document numbers that cannot skip
--
-- THE DEFECT. sale_no was derived from the row id (009) and credit_no from a
-- sequence (004). Both ids and sequences survive a rollback — that is what
-- makes them concurrency-safe — so every aborted sale burned a receipt number
-- forever. An oversell that the till retried, a network failure mid-commit, a
-- test run: each left a hole in the sequence. The sales journal's own header
-- says what a hole means to an auditor: it reads as a deleted sale.
--
-- Proof it happens: sales ids 56-59 and 61-63 were consumed by rolled-back
-- transactions during pre-go-live testing on 2026-07-29, and ids 1-3 by the
-- seed run's first attempt. Ten numbers, gone, with nothing to show for them.
-- Those historical gaps are left as they are — the numbers were never issued
-- on any document, and renumbering issued receipts would be worse than the
-- holes. This migration stops new ones.
--
-- THE FIX. A counter table, incremented inside the sale's own transaction.
-- A row update is transactional: if the sale rolls back, the increment rolls
-- back with it, and the next sale takes the same number. Two concurrent sales
-- serialise briefly on the day-row lock — the price of gapless, and a queue
-- of two at a shop counter.
--
-- The day in the prefix now comes from the SHOP's calendar (UTC+4), not the
-- server's. Under the old rule a sale at 01:14 Mauritius time was numbered
-- into the previous day — the same class of bug the reports fixed with
-- startOfShopDay.
--
-- Migrations 001-026 are untouched.
-- ============================================================

CREATE TABLE IF NOT EXISTS doc_counters (
    kind TEXT NOT NULL CHECK (kind IN ('sale', 'credit')),
    day  TEXT NOT NULL,          -- 'YYMMDD' on the shop's clock
    n    INT  NOT NULL,
    PRIMARY KEY (kind, day)
);

COMMENT ON TABLE doc_counters IS
    'Per-day document numbering. Incremented inside the issuing transaction, '
    'so an aborted sale rolls its number back instead of burning it.';

ALTER TABLE doc_counters ENABLE ROW LEVEL SECURITY;
-- No policies at all: only the SECURITY DEFINER functions below touch it.

-- Start each existing day's counter at that day's highest issued number, so a
-- counter can never re-issue a number that is already on a document.
INSERT INTO doc_counters (kind, day, n)
SELECT 'sale', substr(split_part(sale_no, '-', 1), 2),
       max((split_part(sale_no, '-', 2))::int)
  FROM sales
 WHERE sale_no ~ '^S[0-9]{6}-[0-9]+$'
 GROUP BY 2
ON CONFLICT (kind, day) DO NOTHING;

INSERT INTO doc_counters (kind, day, n)
SELECT 'credit', substr(split_part(credit_no, '-', 1), 3),
       max((split_part(credit_no, '-', 2))::int)
  FROM credit_notes
 WHERE credit_no ~ '^CN[0-9]{6}-[0-9]+$'
 GROUP BY 2
ON CONFLICT (kind, day) DO NOTHING;

CREATE OR REPLACE FUNCTION next_doc_no(p_kind TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_day TEXT := to_char(now() AT TIME ZONE 'Indian/Mauritius', 'YYMMDD');
    v_n   INT;
BEGIN
    INSERT INTO doc_counters AS c (kind, day, n) VALUES (p_kind, v_day, 1)
    ON CONFLICT (kind, day) DO UPDATE SET n = c.n + 1
    RETURNING n INTO v_n;

    RETURN CASE p_kind WHEN 'sale' THEN 'S' ELSE 'CN' END || v_day || '-' || v_n;
END;
$$;

REVOKE ALL ON FUNCTION next_doc_no(TEXT) FROM PUBLIC;
-- Deliberately not granted to authenticated: nothing outside the two RPCs
-- below has any business taking a number.

-- ===== complete_sale: same body as 009/019 left it, one line changed =====
--
-- The placeholder-then-stamp dance stays: sale_no is NOT NULL UNIQUE, so the
-- insert needs a throwaway value either way, and keeping the shape identical
-- keeps this a one-line change to a money function.
-- Folded in while recreating: SET search_path, which the 001 original never
-- pinned — a SECURITY DEFINER function without it trusts whoever set the
-- session's search_path.

CREATE OR REPLACE FUNCTION complete_sale(
    p_shift_id INT,
    p_customer_id INT,
    p_cashier_id UUID,
    p_discount NUMERIC,
    p_items JSONB,
    p_payments JSONB
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_sale_id   BIGINT;
    v_subtotal  NUMERIC := 0;
    v_vat_rate  NUMERIC;
    v_total     NUMERIC;
    v_item      JSONB;
    v_line      NUMERIC;
    v_variant   INT;
    v_desc      TEXT;
BEGIN
    SELECT (value)::NUMERIC INTO v_vat_rate FROM settings WHERE key = 'vat_rate';

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_line := (v_item->>'qty')::INT * (v_item->>'unit_price')::NUMERIC
                  - COALESCE((v_item->>'discount')::NUMERIC, 0);
        v_subtotal := v_subtotal + v_line;
    END LOOP;

    v_total := v_subtotal - COALESCE(p_discount, 0);

    INSERT INTO sales (sale_no, shift_id, customer_id, subtotal, discount,
            vat_amount, total, cashier_id)
    VALUES (
        'pending-' || gen_random_uuid()::TEXT,
        p_shift_id, p_customer_id, v_subtotal, COALESCE(p_discount, 0),
        round(v_total - v_total / (1 + v_vat_rate), 2),  -- VAT-inclusive pricing
        v_total, p_cashier_id
    )
    RETURNING id INTO v_sale_id;

    -- THE change: a transactional counter instead of the row id, so an
    -- aborted sale gives its number back.
    UPDATE sales SET sale_no = next_doc_no('sale') WHERE id = v_sale_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_line := (v_item->>'qty')::INT * (v_item->>'unit_price')::NUMERIC
                  - COALESCE((v_item->>'discount')::NUMERIC, 0);

        v_variant := (v_item->>'variant_id')::INT;
        v_desc    := nullif(btrim(coalesce(v_item->>'description', '')), '');

        IF v_variant IS NULL AND v_desc IS NULL THEN
            RAISE EXCEPTION
                'A sale line needs either a variant or a description';
        END IF;

        INSERT INTO sale_items (sale_id, variant_id, description, qty,
                unit_price, discount, line_total)
        VALUES (v_sale_id, v_variant, v_desc, (v_item->>'qty')::INT,
                (v_item->>'unit_price')::NUMERIC,
                COALESCE((v_item->>'discount')::NUMERIC, 0), v_line);

        -- A custom line has no stock to move. Guarded rather than skipped
        -- silently: record_stock_movement on a NULL variant would either fail
        -- or, worse, write a movement against nothing.
        IF v_variant IS NOT NULL THEN
            PERFORM record_stock_movement(
                v_variant, 'sale',
                -(v_item->>'qty')::INT, 'pos_sale', v_sale_id, NULL);
        END IF;
    END LOOP;

    INSERT INTO sale_payments (sale_id, method, amount, tendered)
    SELECT v_sale_id, p->>'method', (p->>'amount')::NUMERIC,
           (p->>'tendered')::NUMERIC
    FROM jsonb_array_elements(p_payments) AS p;

    RETURN v_sale_id;
END;
$$;

-- ===== create_credit_note: the one numbering line, swapped in place =====
--
-- Recreating the whole function to change one expression risks drifting from
-- 021's carefully patched body, so the swap is done by rewriting the live
-- definition text — the body that runs after this migration is byte-for-byte
-- the body that ran before it, except for the number.
DO $$
DECLARE
    v_def TEXT;
BEGIN
    SELECT pg_get_functiondef(oid) INTO v_def
      FROM pg_proc
     WHERE proname = 'create_credit_note'
       AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'create_credit_note not found';
    END IF;

    IF position('nextval(''credit_note_no_seq'')' IN v_def) = 0 THEN
        RAISE EXCEPTION 'create_credit_note does not look as expected — refusing to patch blind';
    END IF;

    v_def := replace(
        v_def,
        '''CN'' || to_char(now(), ''YYMMDD'') || ''-'' || nextval(''credit_note_no_seq'')',
        'next_doc_no(''credit'')'
    );

    EXECUTE v_def;
END;
$$;

-- ===== repair the seed run's payment timestamps =====
--
-- The seed script backdated sales but let sale_payments.created_at default to
-- now(), so 52 payments claim they happened at the seed run's instant — days
-- away from their own sale, and outside their shift's life. Every payment the
-- real RPC writes is stamped in the same transaction as its sale, so aligning
-- these to their sale's timestamp restores exactly what the column would have
-- said. Pinned to that one instant so no genuine row can ever match.
UPDATE sale_payments sp
   SET created_at = s.sale_date
  FROM sales s
 WHERE s.id = sp.sale_id
   AND sp.created_at >= '2026-07-29T07:07:00+00:00'
   AND sp.created_at <  '2026-07-29T07:08:00+00:00'
   AND abs(extract(epoch FROM sp.created_at - s.sale_date)) > 60;
