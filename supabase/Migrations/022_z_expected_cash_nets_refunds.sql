-- The Z report expected cash the shop had already given back.
--
-- TWO DEFECTS, both in the drawer reconciliation.
--
-- 1. Cash refunds were never subtracted from expected cash. Migration 004 did
--    subtract them; 013 rebuilt the function and dropped it. Hand a customer
--    Rs 500 back in cash and the Z expects Rs 500 more in the drawer than is
--    in it — so the cashier is reported short by exactly the amount the shop
--    itself paid out, every time. A reconciliation that manufactures its own
--    discrepancies is worse than none: it teaches everyone to ignore it.
--
-- 2. Credit notes were attributed through `sales.shift_id` — the shift that
--    made the ORIGINAL sale. A refund handed over today against last week's
--    receipt landed on last week's closed shift, while today's drawer came up
--    short with nothing on the Z to explain it. `credit_notes.shift_id`
--    records where the money actually left, and that is what a drawer count
--    has to answer to.
--
-- Latent so far: no credit note has ever been raised (verified before writing
-- this). The till's return screen makes both reachable.
--
-- Only the cash figures change. Every other total in this function is
-- untouched — see the note on migration 021 about not reshaping working parts
-- inside a money fix.

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
    -- Refunds handed back in CASH from this shift's drawer.
    v_cash_refund NUMERIC := 0;
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

    -- Attributed by the shift that PAID it out, not the one that made the
    -- sale. A refund on last week's receipt comes out of today's drawer.
    SELECT coalesce(sum(cn.total), 0) INTO v_credited
      FROM credit_notes cn
     WHERE cn.shift_id = p_shift_id AND cn.created_at <= p_as_at;

    -- Only cash leaves the drawer. A card or Juice refund reverses on that
    -- rail and must not be counted against the notes and coins in the till.
    SELECT coalesce(sum(cn.total), 0) INTO v_cash_refund
      FROM credit_notes cn
     WHERE cn.shift_id = p_shift_id AND cn.created_at <= p_as_at
       AND cn.refund_method = 'cash';

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
        'expected_cash',  round(v_shift.opening_float + v_cash_in + v_movements
                            - v_cash_refund, 2),
        'cash_refunded',  round(v_cash_refund, 2),
        'voided',         v_voided,
        'refunded',       v_refunded,
        'credited',       round(v_credited, 2)
    );
END;
$$;
