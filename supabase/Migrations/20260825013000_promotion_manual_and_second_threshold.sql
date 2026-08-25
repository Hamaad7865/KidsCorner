-- ============================================================
-- Kids Corner — promotions: manual markdowns, and a second threshold
--
-- Migrations 001-… are untouched.
-- ============================================================
--
-- Two additions to the promotions feature:
--
-- 1. MANUAL PROMOTION. A promotion no longer has to start from the
--    slow-mover list — an owner or manager can put ANY product on promotion
--    from the back office. `apply_promotion` already allowed this (it never
--    checked why a variant was being marked down), so this migration changes
--    nothing about that path; it only exists alongside the UI that now
--    reaches it from the product page.
--
-- 2. THE SECOND THRESHOLD. A promotion that STILL does not sell is worse
--    than no promotion: the stock is older, and the margin is already gone.
--    A shop setting `promo_still_days` says how many days a variant may sit
--    on promotion without a sale before it is flagged to be reduced again,
--    and `stale_promotions(days)` is the detection — the `slow_movers` of an
--    already-marked-down world.
--
--    Reducing again is NOT a second promotion row. The active promotion keeps
--    its original_price — the true pre-promotion figure — and only its
--    promo_price moves, so lifting later still puts the whole markdown back
--    in one step, and the till's struck-through "was" stays honest.
--    `reduce_promotion` is that single write, with the same never-loss guard
--    as apply_promotion: below cost is refused, here and nowhere else.

-- ===== 1. the second threshold, a shop setting =====
INSERT INTO settings (key, value)
VALUES ('promo_still_days', '14'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ===== 2. reduce_promotion — mark the same promotion down again =====
-- Returns the promotion id. The variant's cost is the floor, exactly as in
-- apply_promotion; the new price must also be a REAL reduction of the promo
-- price, not a quiet way back up — raising a price is lifting, and lifting is
-- a different button with a different audit trail.
CREATE OR REPLACE FUNCTION public.reduce_promotion(
    p_variant_id INT,
    p_new_price NUMERIC,
    p_note TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_cost  numeric(10,2);
    v_promo numeric(10,2);
    v_sku   text;
    v_new   numeric(10,2);
    v_id    bigint;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
         WHERE id = v_actor AND is_active AND role IN ('owner', 'manager')
    ) THEN
        RAISE insufficient_privilege
            USING MESSAGE = 'Only an owner or manager can reduce a promotion';
    END IF;

    -- FOR UPDATE serialises a reduction against a lift of the same promotion;
    -- the promotion row is what is locked, because it is what is edited.
    SELECT pr.id, pr.promo_price, pv.cost_price, coalesce(pv.sku, pv.id::text)
      INTO v_id, v_promo, v_cost, v_sku
      FROM public.promotions pr
      JOIN public.product_variants pv ON pv.id = pr.variant_id
     WHERE pr.variant_id = p_variant_id
       AND pr.status = 'active'
     FOR UPDATE OF pr;
    IF NOT FOUND THEN
        RAISE no_data_found USING MESSAGE = 'That item is not on promotion';
    END IF;

    IF p_new_price IS NULL THEN
        RAISE not_null_violation USING MESSAGE = 'A new promotion price is required';
    END IF;
    v_new := p_new_price::numeric(10,2);

    IF v_new < v_cost THEN
        RAISE check_violation
            USING MESSAGE = 'A promotion cannot go below cost — that would be a loss';
    END IF;
    IF v_new >= v_promo THEN
        RAISE check_violation
            USING MESSAGE = 'The new price must be lower than the current promotion price';
    END IF;

    -- original_price is deliberately untouched: it is what lifting restores,
    -- and what the till strikes through, however many times the price comes
    -- down in between.
    UPDATE public.promotions
       SET promo_price = v_new,
           note = coalesce(nullif(pg_catalog.btrim(p_note), ''), note)
     WHERE id = v_id;

    UPDATE public.product_variants
       SET selling_price = v_new
     WHERE id = p_variant_id;

    -- Same event type apply_promotion uses, so the activity feed renders it as
    -- the price change it is; the reason spells out that this was a reduction
    -- of a running promotion, not a fresh one.
    INSERT INTO public.audit_events (actor_id, event_type, ref_type, ref_id, summary, detail)
    VALUES (v_actor, 'price.changed', 'variant', p_variant_id::text,
            coalesce(v_sku, p_variant_id::text) || ' · promotion reduced',
            pg_catalog.jsonb_build_object(
                'sku', v_sku, 'before', v_promo, 'after', v_new,
                'promotion_id', v_id, 'reason', 'promotion reduced'));

    RETURN v_id;
END;
$$;

-- ===== 3. stale_promotions(p_days) — the second detection =====
-- One row per ACTIVE promotion whose variant has not sold for at least p_days,
-- counted from whichever came later: the promotion being applied, or the last
-- sale. A promotion that sold last week is working and is nobody's business;
-- one applied 40 days ago with no sale in that entire span is the stock this
-- exists to find. Variants out of stock are excluded — nothing to reprice on
-- an empty shelf. SECURITY INVOKER so the caller's RLS still applies, the same
-- reason slow_movers is.
CREATE OR REPLACE FUNCTION public.stale_promotions(p_days INT)
RETURNS TABLE (
    promotion_id  bigint,
    variant_id    int,
    product_id    int,
    product_name  text,
    product_code  text,
    sku           text,
    size_label    text,
    colour_name   text,
    qty_on_hand   int,
    cost_price    numeric,
    original_price numeric,
    promo_price   numeric,
    applied_at    timestamptz,
    last_sold_at  timestamptz,
    days_idle     int
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT
        pr.id,
        pr.variant_id,
        p.id,
        p.name,
        p.product_code,
        pv.sku,
        coalesce(s.label, ''),
        coalesce(c.name, ''),
        pv.qty_on_hand,
        pv.cost_price,
        pr.original_price,
        pr.promo_price,
        pr.applied_at,
        ls.sold_at,
        extract(
            day FROM now() - greatest(pr.applied_at, ls.sold_at)
        )::int
      FROM public.promotions pr
      JOIN public.product_variants pv ON pv.id = pr.variant_id
      JOIN public.products p ON p.id = pv.product_id
      LEFT JOIN public.sizes s ON s.id = pv.size_id
      LEFT JOIN public.colours c ON c.id = pv.colour_id
      LEFT JOIN LATERAL (
          SELECT max(sa.sale_date) AS sold_at
            FROM public.sale_items si
            JOIN public.sales sa ON sa.id = si.sale_id
           WHERE si.variant_id = pr.variant_id
             AND sa.status = 'completed'
      ) ls ON true
     WHERE pr.status = 'active'
       AND pv.is_active
       AND p.is_active
       AND pv.qty_on_hand > 0
       AND greatest(pr.applied_at, ls.sold_at) <= now() - (p_days || ' days')::interval
     ORDER BY greatest(pr.applied_at, ls.sold_at) ASC;
$$;

-- ===== 4. grants — nothing public, nothing anonymous =====
REVOKE ALL ON FUNCTION public.reduce_promotion(INT, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stale_promotions(INT)                  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reduce_promotion(INT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stale_promotions(INT)                TO authenticated;
