-- ============================================================
-- Kids Corner — migration 014: the daily summary
--
-- The Cashmag-style wide report the Carfectionist back office produces: one row
-- per trading day, with column groups that appear only when there is something
-- in them. An owner reads it across, not down — "which day did card overtake
-- cash", "which category carried the week".
--
-- Aggregated in SQL rather than in the app for the same reason `z_totals` is:
-- a year of sales is tens of thousands of rows, and pulling them into Node to
-- group them would be slow and would put a second implementation of the shop's
-- arithmetic somewhere it can drift.
--
-- VAT IS INCLUDED IN KIDS CORNER PRICES. So for every figure here:
--
--     total_incl  = what the customer paid
--     total_excl  = total_incl - vat        (what is left inside it)
--
-- They are two views of one number, not two numbers to add. The Carfectionist
-- report carries both columns and so does this — but there they are computed
-- from a VAT-exclusive base, and here they are not. Getting that backwards
-- would overstate the shop's turnover by 15%.
--
-- Written as ONE statement with CTEs rather than a temp table: a temp table
-- makes the function VOLATILE, and a report that Postgres believes might write
-- something cannot be safely called from a read replica or reused within a
-- query. The scoping is expressed once in `scoped` and referenced from there.
--
-- Migrations 001-013 are untouched.
-- ============================================================

CREATE OR REPLACE FUNCTION daily_summary(p_from DATE, p_to DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_out JSONB;
BEGIN
    IF p_from IS NULL OR p_to IS NULL THEN
        RAISE EXCEPTION 'daily_summary needs a from and a to date';
    END IF;
    IF p_to < p_from THEN
        RAISE EXCEPTION 'daily_summary: % is before %', p_to, p_from;
    END IF;
    -- Bounded on purpose. An unbounded range would be a table scan of every
    -- sale the shop has ever made, triggered by a mistyped URL.
    IF p_to - p_from > 400 THEN
        RAISE EXCEPTION 'daily_summary: range is longer than 400 days';
    END IF;

    WITH
    -- `sale_date` is a timestamptz; a day in Mauritius is not a day in UTC, and
    -- grouping on the raw column would file an 8pm sale under tomorrow.
    scoped AS (
        SELECT s.id,
               (s.sale_date AT TIME ZONE 'Indian/Mauritius')::DATE AS day,
               s.total,
               s.vat_amount AS vat,
               coalesce(pr.full_name, 'Unknown') AS cashier,
               s.customer_id,
               -- The rate this ticket was actually rung up at, implied from the
               -- frozen figures rather than read from settings, so a range
               -- spanning a rate change reports both.
               to_char(round(CASE WHEN s.total - s.vat_amount > 0
                                  THEN s.vat_amount / (s.total - s.vat_amount) * 100
                                  ELSE 0 END, 2), 'FM990.00') AS rate
          FROM sales s
          LEFT JOIN profiles pr ON pr.id = s.cashier_id
         WHERE s.status = 'completed'
           AND (s.sale_date AT TIME ZONE 'Indian/Mauritius')::DATE BETWEEN p_from AND p_to
    ),
    -- Each line scaled so its sale's lines add up to what that sale took. The
    -- sale-level discount lives on the sale, not the lines, so raw line totals
    -- exceed the day's takings — the same apportionment `z_totals` does.
    lines AS (
        SELECT sc.day,
               si.qty,
               coalesce(nullif(trim(cat.name), ''), '(uncategorised)') AS category,
               si.line_total * CASE WHEN t.line_sum > 0 THEN sc.total / t.line_sum ELSE 1 END AS amount
          FROM sale_items si
          JOIN scoped sc ON sc.id = si.sale_id
          JOIN (
            SELECT si2.sale_id, sum(si2.line_total) AS line_sum
              FROM sale_items si2
             WHERE si2.sale_id IN (SELECT id FROM scoped)
             GROUP BY si2.sale_id
          ) t ON t.sale_id = si.sale_id
          LEFT JOIN product_variants pv ON pv.id = si.variant_id
          LEFT JOIN products p ON p.id = pv.product_id
          LEFT JOIN categories cat ON cat.id = p.category_id
    ),
    pays AS (
        SELECT sc.day, sp.method, sp.amount
          FROM sale_payments sp JOIN scoped sc ON sc.id = sp.sale_id
    ),

    -- ── Per-day aggregates, one CTE per section.
    headline AS (
        SELECT day,
               count(*)::INT AS tickets,
               count(DISTINCT customer_id)::INT AS customers,
               round(sum(total), 2) AS total_incl,
               round(sum(vat), 2) AS vat,
               round(sum(total) - sum(vat), 2) AS total_excl,
               round(sum(total) / count(*), 2) AS avg_incl,
               round((sum(total) - sum(vat)) / count(*), 2) AS avg_excl
          FROM scoped GROUP BY day
    ),
    day_items AS (
        SELECT day, sum(qty)::INT AS items FROM lines GROUP BY day
    ),
    day_methods AS (
        SELECT day, jsonb_object_agg(method, jsonb_build_object(
                 'n', n, 'amount', round(amount, 2))) AS by_method
          FROM (
            SELECT day, method, count(*)::INT AS n, sum(amount) AS amount
              FROM pays GROUP BY day, method
          ) m GROUP BY day
    ),
    day_taxes AS (
        SELECT day, jsonb_object_agg(rate, jsonb_build_object(
                 'incl', round(incl, 2),
                 'excl', round(incl - vat, 2),
                 'vat',  round(vat, 2))) AS by_tax
          FROM (
            SELECT day, rate, sum(total) AS incl, sum(vat) AS vat
              FROM scoped GROUP BY day, rate
          ) t GROUP BY day
    ),
    day_sellers AS (
        SELECT day, jsonb_object_agg(cashier, jsonb_build_object(
                 'n', n, 'amount', round(amount, 2))) AS by_seller
          FROM (
            SELECT day, cashier, count(*)::INT AS n, sum(total) AS amount
              FROM scoped GROUP BY day, cashier
          ) s GROUP BY day
    ),
    day_categories AS (
        SELECT day, jsonb_object_agg(category, jsonb_build_object(
                 'qty', qty, 'amount', round(amount, 2))) AS by_category
          FROM (
            SELECT day, category, sum(qty)::INT AS qty, sum(amount) AS amount
              FROM lines GROUP BY day, category
          ) c GROUP BY day
    ),

    -- ── The column headers.
    --
    -- Dynamic: a method, cashier or category only earns a column if it actually
    -- traded in the period. A report with a permanently empty "Juice" column
    -- teaches an owner to skim past columns, which is how a real one gets
    -- missed.
    cols AS (
        SELECT
          (SELECT coalesce(jsonb_agg(DISTINCT method ORDER BY method), '[]'::jsonb) FROM pays)     AS methods,
          (SELECT coalesce(jsonb_agg(DISTINCT rate ORDER BY rate), '[]'::jsonb) FROM scoped)       AS taxes,
          (SELECT coalesce(jsonb_agg(DISTINCT cashier ORDER BY cashier), '[]'::jsonb) FROM scoped) AS sellers,
          (SELECT coalesce(jsonb_agg(DISTINCT category ORDER BY category), '[]'::jsonb) FROM lines) AS categories
    )

    SELECT jsonb_build_object(
        'from', p_from,
        'to',   p_to,
        'rows', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                     'day',         h.day,
                     'tickets',     h.tickets,
                     'items',       coalesce(di.items, 0),
                     'customers',   h.customers,
                     'total_incl',  h.total_incl,
                     'vat',         h.vat,
                     'total_excl',  h.total_excl,
                     'avg_incl',    h.avg_incl,
                     'avg_excl',    h.avg_excl,
                     'by_method',   coalesce(dm.by_method, '{}'::jsonb),
                     'by_tax',      coalesce(dt.by_tax, '{}'::jsonb),
                     'by_seller',   coalesce(ds.by_seller, '{}'::jsonb),
                     'by_category', coalesce(dc.by_category, '{}'::jsonb)
                   ) ORDER BY h.day)
              FROM headline h
              LEFT JOIN day_items      di ON di.day = h.day
              LEFT JOIN day_methods    dm ON dm.day = h.day
              LEFT JOIN day_taxes      dt ON dt.day = h.day
              LEFT JOIN day_sellers    ds ON ds.day = h.day
              LEFT JOIN day_categories dc ON dc.day = h.day
        ), '[]'::jsonb),
        'methods',    (SELECT methods    FROM cols),
        'taxes',      (SELECT taxes      FROM cols),
        'sellers',    (SELECT sellers    FROM cols),
        'categories', (SELECT categories FROM cols)
    ) INTO v_out;

    RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION daily_summary(DATE, DATE) TO authenticated;
