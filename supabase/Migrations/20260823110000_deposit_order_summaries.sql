-- ═══════════════════════════════════════════════════════════════════════════
-- Deposit order summaries — one row per layaway with the arithmetic done
--
-- Both readers of a deposit LIST want the same three numbers: what was paid,
-- how much is still owed, and how many units are still held. Computing them
-- once here means the till's search screen and the back office's ledger can
-- never disagree about an order they are both looking at.
--
-- security_invoker per migration 034: reads ride on the caller's own RLS,
-- so this view cannot become a side door around the deposit tables'.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.deposit_order_summaries
WITH (security_invoker = true) AS
SELECT
    o.id                          AS order_id,
    o.order_no,
    o.status,
    o.total,
    o.collect_by,
    o.note,
    o.created_at,
    o.collected_at,
    o.cancelled_at,
    o.cancelled_reason,
    o.customer_id,
    c.full_name                   AS customer_name,
    c.phone                       AS customer_phone,

    -- Money handed over net of refunds. Allocation is NOT subtracted here:
    -- allocated money bought goods, which is different from money leaving.
    COALESCE(p.payments_net, 0)   AS payments_net,

    -- Paid but not yet converted into goods — what a cancellation would refund.
    cr.unallocated_credit,

    -- What the customer must still pay to take home everything still held:
    -- the frozen value of the units NOT yet collected, less the credit already
    -- in hand. NOT total − credit: once a pickup turns credit into goods, that
    -- value has left what is owed, so a part-collected order would otherwise
    -- read as owing far more than it truly does.
    GREATEST(
        COALESCE(i.value_remaining, 0) - cr.unallocated_credit,
        0::numeric
    )                             AS balance,

    COALESCE(i.qty_total, 0)      AS qty_total,
    COALESCE(i.qty_collected, 0)  AS qty_collected
FROM deposit_orders o
JOIN customers c ON c.id = o.customer_id
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(
               CASE WHEN entry_type = 'payment' THEN amount ELSE 0 END
           ), 0) AS payments_net
      FROM deposit_order_payments dpo
     WHERE dpo.order_id = o.id
) p ON TRUE
LEFT JOIN LATERAL (
    SELECT SUM(di.qty)            AS qty_total,
           SUM(di.collected_qty)  AS qty_collected,
           -- Frozen value still on the shelf for this order: each line's
           -- uncollected units at their frozen price, net of the share of
           -- the line discount not yet taken.
           SUM((di.qty - di.collected_qty) * di.unit_price
               - (di.discount - di.discount_taken)) AS value_remaining
      FROM deposit_order_items di
     WHERE di.order_id = o.id
) i ON TRUE
LEFT JOIN LATERAL (
    -- Computed once, shared by the unallocated_credit and balance columns.
    SELECT public.deposit_unallocated_credit(o.id) AS unallocated_credit
) cr ON TRUE;

COMMENT ON VIEW public.deposit_order_summaries IS
  'One row per deposit order with paid/balance/collected arithmetic done. '
  'Filter on status = ''open'' for live layaways, or collect_by < today for '
  'the ones staff should be chasing.';

GRANT SELECT ON public.deposit_order_summaries TO authenticated;
REVOKE ALL ON public.deposit_order_summaries FROM anon;

-- ── prove the balance arithmetic ────────────────────────────────────────────
--
-- The number this view exists to get right is `balance`, and the case that
-- once got it wrong is a PART-collected order: value already turned into goods
-- must leave what is still owed. Exercised for real, then rolled back — fixture
-- included, so no probe rows remain — in the style the deposit migration set.

DO $probe$
DECLARE
    v_profile  uuid;
    v_customer int;
    v_category int;
    v_size     int;
    v_colour   int;
    v_product  int;
    v_variant  int;
    v_shift    int;
    v_result   jsonb;
    v_order    bigint;
    v_item     bigint;
    v_balance  numeric;
    v_credit   numeric;
BEGIN
    SELECT id INTO v_profile FROM public.profiles ORDER BY full_name LIMIT 1;
    IF v_profile IS NULL THEN
        RAISE EXCEPTION 'probe needs at least one profile';
    END IF;

    BEGIN
        INSERT INTO public.customers (full_name, phone)
        VALUES ('__Balance probe', '+2300000001') RETURNING id INTO v_customer;
        INSERT INTO public.categories (name) VALUES ('__bal_probe_cat')
        RETURNING id INTO v_category;
        INSERT INTO public.sizes (size_type, label) VALUES ('age_range', '__bp')
        RETURNING id INTO v_size;
        INSERT INTO public.colours (name) VALUES ('__bp') RETURNING id INTO v_colour;
        INSERT INTO public.products (name, category_id)
        VALUES ('__Probe cot', v_category) RETURNING id INTO v_product;
        INSERT INTO public.product_variants (product_id, size_id, colour_id, sku,
                selling_price, qty_on_hand)
        VALUES (v_product, v_size, v_colour, '__BP-A', 100, 0)
        RETURNING id INTO v_variant;

        PERFORM public.record_stock_movement(v_variant, 'opening', 10, 'probe', NULL, NULL);

        INSERT INTO public.shifts (opened_by, opening_float)
        VALUES (v_profile, 50) RETURNING id INTO v_shift;

        -- Two units at 100, paid in full up front: Rs 200 down on a 200 order.
        v_result := public.create_deposit_order(
            'bal-probe-1', v_customer,
            ('[{"variant_id":' || v_variant || ', "qty":2, "discount":0}]')::jsonb,
            '{"method":"cash","amount":200}'::jsonb,
            NULL, NULL, v_shift, v_profile, NULL, NULL);
        v_order := (v_result->>'order_id')::bigint;

        -- Nothing collected yet: paid in full, so nothing is owed.
        SELECT balance INTO v_balance
          FROM public.deposit_order_summaries WHERE order_id = v_order;
        IF v_balance <> 0 THEN
            RAISE EXCEPTION 'a fully-paid, uncollected order should owe 0, view says %', v_balance;
        END IF;

        SELECT id INTO v_item FROM public.deposit_order_items
         WHERE order_id = v_order LIMIT 1;

        -- Take ONE of the two units: 100 of goods leave, drawn from credit.
        PERFORM public.collect_deposit_order(
            v_order,
            ('[{"item_id":' || v_item || ', "qty":1}]')::jsonb,
            '[]'::jsonb, v_shift, v_profile, NULL, NULL, now(), 'bal-collect-1');

        SELECT balance, unallocated_credit INTO v_balance, v_credit
          FROM public.deposit_order_summaries WHERE order_id = v_order;

        -- Half the credit is now goods; a fully-paid customer still owes 0.
        -- The old `total − credit` read 100 here — the value that had left.
        IF v_credit <> 100 THEN
            RAISE EXCEPTION 'credit after one pickup should be 100, got %', v_credit;
        END IF;
        IF v_balance <> 0 THEN
            RAISE EXCEPTION
                'part-collected, fully-paid order must still owe 0, view says %', v_balance;
        END IF;

        RAISE NOTICE 'balance holds true across a partial pickup';
        RAISE EXCEPTION 'rollback the probe';
    EXCEPTION
        WHEN others THEN
            IF sqlerrm <> 'rollback the probe' THEN RAISE; END IF;
            RAISE NOTICE 'balance probe rolled back; no probe rows remain';
    END;
END;
$probe$;
