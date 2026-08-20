-- ============================================================
-- Kids Corner — promotions: slow-mover markdowns that never sell at a loss
--
-- Migrations 001-… are untouched.
-- ============================================================
--
-- The shop wants to clear stock that has stopped moving. A product that has not
-- sold for a while is flagged, and an owner or manager marks it down — but never
-- below what it cost, so a promotion can never turn a sale into a loss.
--
-- A promotion is a REAL change to product_variants.selling_price, not a discount
-- rule: the discount engine (migration 005) targets a category or the whole
-- basket, never a single product, and a plain markdown flows to the Android till
-- through the catalogue it already reads. The original price is remembered here
-- so the promotion can be lifted and the price put back.
--
-- The never-loss rule lives in apply_promotion and nowhere else — the single
-- authority, the same discipline discount_amount_for follows — because there are
-- two clients and a check in one of them is a check the other can be built
-- without.

-- ===== 1. the threshold, a shop setting =====
-- How many days without a sale makes a product a slow mover. Editable in the
-- back office; owner-only to change, like every other row in settings.
INSERT INTO settings (key, value)
VALUES ('slow_mover_days', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ===== 2. the promotions ledger =====
-- One row per variant markdown. Variant-level because the never-loss floor is
-- each variant's own cost, and two sizes of one product can cost different
-- amounts. The page groups these back up by product for display.
CREATE TABLE IF NOT EXISTS promotions (
    id             BIGSERIAL PRIMARY KEY,
    variant_id     INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    -- The selling price at the instant the promotion was applied, so lifting can
    -- put it back exactly.
    original_price NUMERIC(10,2) NOT NULL,
    -- What it was marked down to. Equals the variant's selling_price while active.
    promo_price    NUMERIC(10,2) NOT NULL,
    status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'lifted')),
    note           TEXT,
    applied_by     UUID REFERENCES profiles(id),
    applied_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    lifted_by      UUID REFERENCES profiles(id),
    lifted_at      TIMESTAMPTZ,
    -- A promotion that costs the shop money is the one thing this feature exists
    -- to prevent. Belt to the RPC's braces.
    CONSTRAINT promotions_not_a_loss CHECK (promo_price >= 0),
    CONSTRAINT promotions_is_a_reduction CHECK (promo_price <= original_price)
);

-- At most one live promotion per variant. The RPC checks this too and gives a
-- sentence; this is the backstop that holds under a race.
CREATE UNIQUE INDEX IF NOT EXISTS promotions_one_active
    ON promotions (variant_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_promotions_variant ON promotions (variant_id, status);

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_all ON promotions;
CREATE POLICY read_all ON promotions FOR SELECT TO authenticated USING (true);
-- No INSERT/UPDATE policy: written only through the RPCs below, which run as
-- definer and carry the never-loss guard. Same shape as sale_discounts.

-- ===== 3. apply_promotion — the never-loss guard =====
CREATE OR REPLACE FUNCTION public.apply_promotion(
    p_variant_id INT,
    p_promo_price NUMERIC,
    p_note TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_actor   uuid := auth.uid();
    v_cost    numeric(10,2);
    v_current numeric(10,2);
    v_sku     text;
    v_promo   numeric(10,2);
    v_id      bigint;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
         WHERE id = v_actor AND is_active AND role IN ('owner', 'manager')
    ) THEN
        RAISE insufficient_privilege
            USING MESSAGE = 'Only an owner or manager can put a product on promotion';
    END IF;

    -- FOR UPDATE serialises two people promoting the same variant at once; the
    -- partial unique index is the hard backstop behind it.
    SELECT cost_price, selling_price, sku
      INTO v_cost, v_current, v_sku
      FROM public.product_variants
     WHERE id = p_variant_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE no_data_found USING MESSAGE = 'That item no longer exists';
    END IF;

    IF p_promo_price IS NULL THEN
        RAISE not_null_violation USING MESSAGE = 'A promotion price is required';
    END IF;
    v_promo := p_promo_price::numeric(10,2);

    IF v_promo < v_cost THEN
        RAISE check_violation
            USING MESSAGE = 'A promotion cannot go below cost — that would be a loss';
    END IF;
    IF v_promo >= v_current THEN
        RAISE check_violation
            USING MESSAGE = 'A promotion price must be lower than the current price';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.promotions
         WHERE variant_id = p_variant_id AND status = 'active'
    ) THEN
        RAISE unique_violation USING MESSAGE = 'This item is already on promotion';
    END IF;

    INSERT INTO public.promotions (variant_id, original_price, promo_price, note, applied_by)
    VALUES (p_variant_id, v_current, v_promo,
            nullif(pg_catalog.btrim(p_note), ''), v_actor)
    RETURNING id INTO v_id;

    UPDATE public.product_variants
       SET selling_price = v_promo
     WHERE id = p_variant_id;

    -- Recorded as a price change (already rendered, already money-toned in the
    -- activity feed) with the reason spelled into the summary. The promotions
    -- table is the authoritative record; this is so the trail reads plainly.
    INSERT INTO public.audit_events (actor_id, event_type, ref_type, ref_id, summary, detail)
    VALUES (v_actor, 'price.changed', 'variant', p_variant_id::text,
            coalesce(v_sku, p_variant_id::text) || ' · put on promotion',
            pg_catalog.jsonb_build_object(
                'sku', v_sku, 'before', v_current, 'after', v_promo,
                'promotion_id', v_id, 'reason', 'promotion'));

    RETURN v_id;
END;
$$;

-- ===== 4. lift_promotion — put the price back =====
-- Returns TRUE when the original price was restored, FALSE when it was left as
-- it stood because someone had changed it manually since the promotion began.
CREATE OR REPLACE FUNCTION public.lift_promotion(
    p_promotion_id BIGINT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_actor    uuid := auth.uid();
    v_variant  int;
    v_original numeric(10,2);
    v_promo    numeric(10,2);
    v_current  numeric(10,2);
    v_sku      text;
    v_restored boolean := false;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
         WHERE id = v_actor AND is_active AND role IN ('owner', 'manager')
    ) THEN
        RAISE insufficient_privilege
            USING MESSAGE = 'Only an owner or manager can lift a promotion';
    END IF;

    SELECT variant_id, original_price, promo_price
      INTO v_variant, v_original, v_promo
      FROM public.promotions
     WHERE id = p_promotion_id AND status = 'active'
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE no_data_found USING MESSAGE = 'That promotion is not active';
    END IF;

    SELECT selling_price, sku INTO v_current, v_sku
      FROM public.product_variants
     WHERE id = v_variant
       FOR UPDATE;

    UPDATE public.promotions
       SET status = 'lifted', lifted_by = v_actor, lifted_at = now()
     WHERE id = p_promotion_id;

    -- Only restore if the price is still the promo price. If it was edited by
    -- hand during the promotion, that newer figure is the shop's latest word and
    -- must not be clobbered by a stale original.
    IF v_current = v_promo THEN
        UPDATE public.product_variants
           SET selling_price = v_original
         WHERE id = v_variant;
        v_restored := true;

        INSERT INTO public.audit_events (actor_id, event_type, ref_type, ref_id, summary, detail)
        VALUES (v_actor, 'price.changed', 'variant', v_variant::text,
                coalesce(v_sku, v_variant::text) || ' · promotion lifted',
                pg_catalog.jsonb_build_object(
                    'sku', v_sku, 'before', v_promo, 'after', v_original,
                    'promotion_id', p_promotion_id, 'reason', 'promotion lifted'));
    END IF;

    RETURN v_restored;
END;
$$;

-- ===== 5. slow_movers(p_days) — the detection =====
-- One row per product that has not sold for at least p_days, still has stock to
-- sell, and is not already on promotion. A product that has never sold falls
-- back to its creation date, so a brand-new arrival is not flagged the day it
-- lands. SECURITY INVOKER so the caller's RLS on products/variants/sales still
-- applies — the same reason low_stock_variants uses security_invoker.
CREATE OR REPLACE FUNCTION public.slow_movers(p_days INT)
RETURNS TABLE (
    product_id    int,
    product_name  text,
    product_code  text,
    category_name text,
    qty_on_hand   bigint,
    variant_count bigint,
    last_sold_at  timestamptz,
    idle_since    timestamptz,
    days_idle     int,
    min_price     numeric,
    max_price     numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    WITH active_variants AS (
        SELECT pv.id, pv.product_id, pv.qty_on_hand, pv.selling_price
          FROM public.product_variants pv
         WHERE pv.is_active
    ),
    last_sale AS (
        SELECT si.variant_id, pg_catalog.max(s.sale_date) AS sold_at
          FROM public.sale_items si
          JOIN public.sales s ON s.id = si.sale_id
         WHERE s.status = 'completed'
         GROUP BY si.variant_id
    )
    SELECT
        p.id,
        p.name,
        p.product_code,
        c.name,
        sum(av.qty_on_hand)::bigint                              AS qty_on_hand,
        count(av.id)::bigint                                     AS variant_count,
        max(ls.sold_at)                                          AS last_sold_at,
        -- GREATEST/EXTRACT are SQL expressions, not schema-qualifiable
        -- functions, so they stay bare; pg_catalog is always searched anyway.
        greatest(p.created_at, max(ls.sold_at))                 AS idle_since,
        extract(
            day FROM now() - greatest(p.created_at, max(ls.sold_at))
        )::int                                                   AS days_idle,
        min(av.selling_price)                                    AS min_price,
        max(av.selling_price)                                    AS max_price
      FROM public.products p
      JOIN active_variants av ON av.product_id = p.id
      LEFT JOIN last_sale ls ON ls.variant_id = av.id
      LEFT JOIN public.categories c ON c.id = p.category_id
     WHERE p.is_active
       -- not already on promotion (any of its variants)
       AND NOT EXISTS (
            SELECT 1 FROM public.promotions pr
             WHERE pr.variant_id = av.id AND pr.status = 'active'
       )
     GROUP BY p.id, p.name, p.product_code, c.name, p.created_at
    HAVING sum(av.qty_on_hand) > 0
       AND greatest(p.created_at, max(ls.sold_at))
           <= now() - (p_days || ' days')::interval
     ORDER BY greatest(p.created_at, max(ls.sold_at)) ASC;
$$;

-- The header pill's number. Runs on every back-office render, so it is a bare
-- count over the same rule rather than a second query that could drift from it.
CREATE OR REPLACE FUNCTION public.count_slow_movers(p_days INT)
RETURNS INT
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT pg_catalog.count(*)::int FROM public.slow_movers(p_days);
$$;

-- ===== 6. grants — nothing public, nothing anonymous =====
REVOKE ALL ON FUNCTION public.apply_promotion(INT, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lift_promotion(BIGINT)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.slow_movers(INT)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.count_slow_movers(INT)             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_promotion(INT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lift_promotion(BIGINT)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.slow_movers(INT)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_slow_movers(INT)             TO authenticated;
