-- ============================================================
-- Kids Corner — migration 013: the Z report
--
-- Modelled on the Carfectionist till's `z_totals`, which has been through a
-- real shop's end-of-day and had three specific mistakes beaten out of it. Kids
-- Corner has a simpler schema — every sale is settled at the till, so there is
-- no on-account line — but the three traps are the same and are avoided the
-- same way:
--
--   • CATEGORY totals must be apportioned. A sale-level discount lives on
--     `sales.discount`, not on the lines, so summing `sale_items.line_total`
--     by category gives MORE than the shop took. Each line is scaled by
--     (sale total / sum of its line totals) so the categories add up exactly.
--
--   • VAT comes from the frozen `sales.vat_amount`, never re-derived from the
--     lines. The stored figure used the rate in force when the sale happened,
--     and Kids Corner prices are VAT-INCLUSIVE — the VAT is contained in the
--     total, not added to it. Re-deriving it would silently restate every
--     historical sale at today's rate.
--
--   • AVERAGE BASKET is the total over the ticket count. Carfectionist excludes
--     on-account tickets from the denominator because those brought in no
--     money; Kids Corner has none — `complete_sale` refuses a sale whose
--     payments do not cover it — so every ticket counts. Stated here because it
--     is a real difference between the two shops, not an oversight.
--
-- `p_as_at` is what makes a Z reproducible. The figures are "as the world was
-- at the moment the till was closed", so a reprint next month is the slip that
-- came out of the printer today.
--
-- Migrations 001-012 are untouched.
-- ============================================================

-- ===== z_reports =====
-- The frozen slip. `totals` is whatever z_totals returned at close, stored
-- verbatim — a reprint reads this, never the live aggregator, because the live
-- one would answer with today's world.
CREATE TABLE IF NOT EXISTS z_reports (
    id          BIGSERIAL PRIMARY KEY,
    shift_id    INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    z_no        TEXT NOT NULL,
    closed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_by   UUID REFERENCES profiles(id),
    counted_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
    expected_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
    variance    NUMERIC(12,2) NOT NULL DEFAULT 0,
    totals      JSONB NOT NULL,
    -- One Z per shift. A second close is a bug, not a second report.
    CONSTRAINT z_reports_shift_unique UNIQUE (shift_id)
);

CREATE INDEX IF NOT EXISTS idx_z_reports_closed_at ON z_reports (closed_at DESC);

ALTER TABLE z_reports ENABLE ROW LEVEL SECURITY;

-- Readable by staff, written only by the SECURITY DEFINER close below. A Z
-- report that could be edited after the fact is not a fiscal record.
DROP POLICY IF EXISTS read_z_reports ON z_reports;
CREATE POLICY read_z_reports ON z_reports
    FOR SELECT TO authenticated USING (true);

-- ===== z_totals =====
-- The ONE aggregator behind the Z slip, the X-read and the back office, so the
-- three can never disagree about the same shift.
CREATE OR REPLACE FUNCTION z_totals(p_shift_id INT, p_as_at TIMESTAMPTZ DEFAULT now())
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_shift       RECORD;
    v_sales       BIGINT[];
    v_sale_count  INT;
    v_sales_total NUMERIC := 0;
    v_vat_total   NUMERIC := 0;
    v_discount    NUMERIC := 0;
    v_items       INT := 0;
    v_methods     JSONB;
    v_categories  JSONB;
    v_vat         JSONB;
    v_cashiers    JSONB;
    v_hourly      JSONB;
    v_top         JSONB;
    v_cash_in     NUMERIC := 0;
    v_movements   NUMERIC := 0;
    v_moves       JSONB;
    v_voided      INT := 0;
    v_refunded    INT := 0;
    v_credited    NUMERIC := 0;
    v_default_vat NUMERIC;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift % does not exist', p_shift_id;
    END IF;

    -- The shop's configured rate, used only for a sale whose own rate cannot be
    -- implied (a fully discounted ticket, where total and VAT are both zero).
    SELECT coalesce((value #>> '{}')::NUMERIC, 0.15) INTO v_default_vat
      FROM settings WHERE key = 'vat_rate';
    IF v_default_vat IS NULL THEN v_default_vat := 0.15; END IF;

    -- ── The tickets in scope. Only 'completed': a voided or refunded ticket
    -- must not be expected in the drawer. Bounded by p_as_at so the report is
    -- reproducible.
    SELECT coalesce(array_agg(id), '{}')
      INTO v_sales
      FROM sales
     WHERE shift_id = p_shift_id
       AND status = 'completed'
       AND sale_date <= p_as_at;

    SELECT count(*), coalesce(sum(total), 0),
           coalesce(sum(vat_amount), 0), coalesce(sum(discount), 0)
      INTO v_sale_count, v_sales_total, v_vat_total, v_discount
      FROM sales WHERE id = ANY(v_sales);

    SELECT coalesce(sum(qty), 0) INTO v_items
      FROM sale_items WHERE sale_id = ANY(v_sales);

    -- ── Means of payment, with the cash split a drawer actually needs: gross is
    -- what was handed over, change is what went back, net is what stayed. The
    -- count is SUM(sign(amount)) so a negative line shows as -1 rather than
    -- inflating the tally.
    SELECT coalesce(jsonb_agg(m ORDER BY m->>'method'), '[]'::jsonb) INTO v_methods
      FROM (
        SELECT jsonb_build_object(
                 'method', sp.method,
                 'count',  sum(sign(sp.amount))::INT,
                 'gross',  round(sum(coalesce(sp.tendered, sp.amount)), 2),
                 'change', round(sum(greatest(coalesce(sp.tendered, sp.amount) - sp.amount, 0)), 2),
                 'net',    round(sum(sp.amount), 2)
               ) AS m
          FROM sale_payments sp
         WHERE sp.sale_id = ANY(v_sales)
         GROUP BY sp.method
      ) x;

    -- ── Categories, apportioned.
    --
    -- `factor` forces each sale's lines to add up to what that sale actually
    -- took. Without it a Rs 263 sale-level discount would be missing from the
    -- category split and the section would over-report the day.
    SELECT coalesce(jsonb_agg(c ORDER BY c->>'name'), '[]'::jsonb) INTO v_categories
      FROM (
        SELECT jsonb_build_object(
                 'name',  coalesce(nullif(trim(cat.name), ''), '(uncategorised)'),
                 'lines', count(*)::INT,
                 'qty',   sum(si.qty)::INT,
                 'incl',  round(sum(si.line_total * f.factor), 2)
               ) AS c
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          LEFT JOIN product_variants pv ON pv.id = si.variant_id
          LEFT JOIN products p ON p.id = pv.product_id
          LEFT JOIN categories cat ON cat.id = p.category_id
          JOIN LATERAL (
            SELECT CASE WHEN sum(si2.line_total) > 0
                        THEN s.total / sum(si2.line_total) ELSE 1 END AS factor
              FROM sale_items si2 WHERE si2.sale_id = s.id
          ) f ON TRUE
         WHERE si.sale_id = ANY(v_sales)
         GROUP BY coalesce(nullif(trim(cat.name), ''), '(uncategorised)')
      ) y;

    -- ── VAT, grouped by the rate each sale was actually rung up at.
    --
    -- Kids Corner is VAT-INCLUSIVE: the total already contains the VAT, so the
    -- net is total - vat and the rate is vat / net. Implied per sale rather than
    -- read from settings, so a shift spanning a rate change reports both rather
    -- than restating the earlier sales at the newer rate.
    SELECT coalesce(jsonb_agg(v ORDER BY (v->>'rate')::NUMERIC DESC), '[]'::jsonb) INTO v_vat
      FROM (
        SELECT jsonb_build_object(
                 'rate',  rate,
                 'label', CASE WHEN rate = 0 THEN 'Zero-rated 0.00%'
                               ELSE 'VAT ' || to_char(rate, 'FM990.00') || '%' END,
                 'excl',  round(sum(net), 2),
                 'vat',   round(sum(vat), 2),
                 'incl',  round(sum(net) + sum(vat), 2)
               ) AS v
          FROM (
            SELECT round(
                     CASE WHEN s.total - s.vat_amount > 0
                          THEN s.vat_amount / (s.total - s.vat_amount) * 100
                          ELSE v_default_vat * 100 END, 2) AS rate,
                   s.total - s.vat_amount AS net,
                   s.vat_amount           AS vat
              FROM sales s WHERE s.id = ANY(v_sales)
          ) parts
         GROUP BY rate
      ) z;

    -- ── Who rang it, and what they took.
    SELECT coalesce(jsonb_agg(c ORDER BY (c->>'total')::NUMERIC DESC), '[]'::jsonb) INTO v_cashiers
      FROM (
        SELECT jsonb_build_object(
                 'cashier_id', s.cashier_id,
                 'name',       coalesce(pr.full_name, 'Unknown'),
                 'sale_count', count(*)::INT,
                 'total',      round(sum(s.total), 2)
               ) AS c
          FROM sales s
          LEFT JOIN profiles pr ON pr.id = s.cashier_id
         WHERE s.id = ANY(v_sales)
         GROUP BY s.cashier_id, pr.full_name
      ) w;

    -- ── Trade by hour, in the shop's own timezone. Tells an owner when to put a
    -- second person on the till, which is the commonest thing a Z gets used for
    -- beyond balancing the drawer.
    -- The hour is derived in an inner select and grouped by name. `GROUP BY 1`
    -- would point at the whole jsonb_build_object, which contains the
    -- aggregates it is supposed to be grouping.
    SELECT coalesce(jsonb_agg(h ORDER BY (h->>'hour')::INT), '[]'::jsonb) INTO v_hourly
      FROM (
        SELECT jsonb_build_object(
                 'hour',  hr,
                 'count', count(*)::INT,
                 'total', round(sum(amount), 2)
               ) AS h
          FROM (
            SELECT extract(hour FROM (s.sale_date AT TIME ZONE 'Indian/Mauritius'))::INT AS hr,
                   s.total AS amount
              FROM sales s WHERE s.id = ANY(v_sales)
          ) src
         GROUP BY hr
      ) hh;

    -- ── Best sellers, by units.
    SELECT coalesce(jsonb_agg(t ORDER BY (t->>'qty')::INT DESC), '[]'::jsonb) INTO v_top
      FROM (
        SELECT jsonb_build_object(
                 'name', coalesce(p.name, 'Unknown'),
                 'qty',  sum(si.qty)::INT,
                 'total', round(sum(si.line_total), 2)
               ) AS t
          FROM sale_items si
          LEFT JOIN product_variants pv ON pv.id = si.variant_id
          LEFT JOIN products p ON p.id = pv.product_id
         WHERE si.sale_id = ANY(v_sales)
         GROUP BY p.name
         ORDER BY sum(si.qty) DESC
         LIMIT 10
      ) tt;

    v_cash_in := coalesce((
        SELECT round(sum(sp.amount), 2) FROM sale_payments sp
         WHERE sp.sale_id = ANY(v_sales) AND sp.method = 'cash'
    ), 0);

    SELECT coalesce(sum(amount), 0) INTO v_movements
      FROM till_movements
     WHERE shift_id = p_shift_id AND created_at <= p_as_at;

    -- Listed, not just summed. A drawer that is short by exactly the amount of
    -- an unexplained pay-out is a different conversation from one that is
    -- simply short.
    SELECT coalesce(jsonb_agg(m ORDER BY m->>'at'), '[]'::jsonb) INTO v_moves
      FROM (
        SELECT jsonb_build_object(
                 'amount', round(tm.amount, 2),
                 'reason', tm.reason,
                 'at',     tm.created_at
               ) AS m
          FROM till_movements tm
         WHERE tm.shift_id = p_shift_id AND tm.created_at <= p_as_at
      ) mm;

    SELECT count(*) FILTER (WHERE status = 'void'),
           count(*) FILTER (WHERE status = 'refunded')
      INTO v_voided, v_refunded
      FROM sales
     WHERE shift_id = p_shift_id AND sale_date <= p_as_at;

    SELECT coalesce(sum(cn.total), 0) INTO v_credited
      FROM credit_notes cn
      JOIN sales s ON s.id = cn.sale_id
     WHERE s.shift_id = p_shift_id AND cn.created_at <= p_as_at;

    RETURN jsonb_build_object(
        'shift_id',       p_shift_id,
        'opened_at',      v_shift.opened_at,
        'as_at',          p_as_at,
        'tickets',        v_sale_count,
        'sales_total',    round(v_sales_total, 2),
        'item_count',     v_items,
        'discount_total', round(v_discount, 2),
        -- Every Kids Corner ticket is settled at the till, so unlike the
        -- Carfectionist slip there is no on-account denominator to exclude.
        'avg_basket',     CASE WHEN v_sale_count > 0
                               THEN round(v_sales_total / v_sale_count, 2) ELSE 0 END,
        'vat_total',      round(v_vat_total, 2),
        'methods',        v_methods,
        'categories',     v_categories,
        'vat',            v_vat,
        'cashiers',       v_cashiers,
        'hourly',         v_hourly,
        'top_sellers',    v_top,
        'opening_float',  round(v_shift.opening_float, 2),
        'cash_taken',     v_cash_in,
        'till_movements', round(v_movements, 2),
        'movements',      v_moves,
        'expected_cash',  round(v_shift.opening_float + v_cash_in + v_movements, 2),
        'voided',         v_voided,
        'refunded',       v_refunded,
        'credited',       round(v_credited, 2)
    );
END;
$$;

-- ===== close_shift_z =====
-- Closes the shift AND freezes its Z in one transaction.
--
-- Both together on purpose. A close that wrote the shift row and then failed to
-- write the Z would leave a shift nobody can produce a slip for, and the whole
-- point of the frozen copy is that it exists for every closed shift.
CREATE OR REPLACE FUNCTION close_shift_z(
    p_shift_id     INT,
    p_counted_cash NUMERIC,
    p_notes        TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_now      TIMESTAMPTZ := now();
    v_totals   JSONB;
    v_expected NUMERIC;
    v_variance NUMERIC;
    v_counted  NUMERIC := round(coalesce(p_counted_cash, 0), 2);
    v_z_no     TEXT;
    v_z_id     BIGINT;
    v_user     UUID := auth.uid();
BEGIN
    PERFORM 1 FROM shifts WHERE id = p_shift_id AND closed_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That shift is already closed, or does not exist';
    END IF;

    -- Computed once, at v_now, and used for BOTH the stored variance and the
    -- frozen slip. Calling the aggregator twice could return two different
    -- answers if a sale landed between them, and the paper would then disagree
    -- with the shift row it was printed from.
    v_totals   := z_totals(p_shift_id, v_now);
    v_expected := (v_totals->>'expected_cash')::NUMERIC;
    v_variance := round(v_counted - v_expected, 2);

    UPDATE shifts
       SET closed_by     = v_user,
           closed_at     = v_now,
           counted_cash  = v_counted,
           expected_cash = v_expected,
           variance      = v_variance,
           notes         = p_notes
     WHERE id = p_shift_id;

    -- Z1, Z2, … per shop, not per shift id, so the sequence a shop reads on its
    -- slips has no gaps when a shift row is ever removed.
    SELECT 'Z' || lpad((count(*) + 1)::TEXT, 5, '0') INTO v_z_no FROM z_reports;

    INSERT INTO z_reports (
        shift_id, z_no, closed_at, closed_by,
        counted_cash, expected_cash, variance, totals
    ) VALUES (
        p_shift_id, v_z_no, v_now, v_user,
        v_counted, v_expected, v_variance, v_totals
    ) RETURNING id INTO v_z_id;

    RETURN jsonb_build_object(
        'z_id',           v_z_id,
        'z_no',           v_z_no,
        'counted_cash',   v_counted,
        'expected_cash',  v_expected,
        'variance',       v_variance,
        'totals',         v_totals
    );
END;
$$;

GRANT EXECUTE ON FUNCTION z_totals(INT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION close_shift_z(INT, NUMERIC, TEXT) TO authenticated;
