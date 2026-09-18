-- Sale notes: the till's "prints on the receipt" line, persisted.
--
-- The note lived only on the tablet (cart, held sale, offline print) — the
-- sale it belonged to carried no trace of it, so online receipts and reprints
-- dropped it silently. This adds the column and threads it through the commit
-- RPC as an optional parameter with a default, so older clients that never
-- send it keep working unchanged.

alter table public.sales
  add column if not exists note text;

-- Same body as live, plus p_note. OR REPLACE keeps the owner and grants, and
-- the DEFAULT keeps every existing caller (which sends ten arguments) valid.
create or replace function public.complete_sale_keyed_at_policy(p_key text, p_shift_id integer, p_customer_id integer, p_cashier_id uuid, p_discount numeric, p_items jsonb, p_payments jsonb, p_discounts jsonb, p_vat_policy_id bigint, p_checked_out_at timestamp with time zone, p_note text default null)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
    v_key text := nullif(pg_catalog.btrim(p_key), '');
    v_existing bigint;
    v_sale_id bigint;
    v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
    v_policy public.vat_policies%rowtype;
    v_checked_out_at timestamptz;
    v_effective_rate numeric(7,6);
    v_snapshot_number text;
    v_subtotal numeric := 0;
    v_total numeric;
    -- 049: cash rounding workspace. v_rounding is what lands on the
    -- receipt and in sales.rounding; the other two are its inputs.
    v_rounding  numeric(12,2) := 0;
    v_all_cash  boolean;
    v_round_on  boolean;    v_vat_amount numeric(12,2);
    v_item jsonb;
    v_line numeric;
    v_variant integer;
    v_desc text;
begin
    -- A note is a sentence, not a document. The route validates 200; this is
    -- the backstop for any authenticated client calling the RPC directly.
    if v_note is not null and pg_catalog.char_length(v_note) > 500 then
        raise check_violation using message = 'Sale note is too long';
    end if;

    -- This must precede policy resolution. A retry belongs to the already
    -- completed sale even if its cached policy would no longer validate.
    if v_key is not null then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_key));

        select id into v_existing
        from public.sales
        where idempotency_key = v_key;

        if v_existing is not null then
            return v_existing;
        end if;
    end if;

    if p_vat_policy_id is null then
        select * into strict v_policy
        from public.vat_policies
        where is_legacy;
    else
        if p_checked_out_at is null then
            raise check_violation using
                message = 'A checkout time is required with a VAT policy id';
        end if;

        select * into v_policy
        from public.vat_policies
        where id = p_vat_policy_id;

        if not found then
            raise check_violation using
                message = pg_catalog.format('VAT policy %s does not exist', p_vat_policy_id);
        end if;
        if v_policy.created_at > p_checked_out_at then
            raise check_violation using
                message = pg_catalog.format(
                    'VAT policy %s was created after checkout',
                    p_vat_policy_id
                );
        end if;
    end if;

    v_checked_out_at := coalesce(p_checked_out_at, pg_catalog.clock_timestamp());
    v_effective_rate := case when v_policy.enabled then v_policy.configured_rate else 0 end;
    v_snapshot_number := case when v_policy.enabled then v_policy.vat_number else null end;

    for v_item in select * from pg_catalog.jsonb_array_elements(p_items) loop
        v_line := (v_item->>'qty')::integer * (v_item->>'unit_price')::numeric
                  - coalesce((v_item->>'discount')::numeric, 0);
        v_subtotal := v_subtotal + v_line;
    end loop;

    v_total := v_subtotal - coalesce(p_discount, 0);

    -- Balanced like the till. TypeScript refuses an unbalanced sale
    -- before calling, but this function is reachable by any
    -- authenticated client, so the rule lives here too. Compared in
    -- cents — each row rounded, exactly what sale_payments stores —
    -- with the same cent of slack the till allows, and before
    -- anything is inserted so a refusal burns no sale number.
    if abs(
        coalesce((
            select sum(pg_catalog.round((payment->>'amount')::numeric, 2))
            from pg_catalog.jsonb_array_elements(p_payments) as payment
        ), 0) - pg_catalog.round(v_total, 2)
    ) > 0.001 then
        raise check_violation using
            message = 'Sale payments do not match the sale total';
    end if;
    v_vat_amount := case
        when v_policy.enabled then
            pg_catalog.round(v_total - v_total / (1 + v_effective_rate), 2)
        else 0
    end;

    -- 043: money the app settled is re-checked where it cannot be skipped.
    -- A direct PostgREST caller skips sale-core's re-pricing and tender
    -- checks, so the RPC enforces both itself: payments equal the total,
    -- and every catalogue line still carries its variant's price.
    <<sale_totals_guard_043>> DECLARE
        v_paid_043   numeric := 0;
        v_chk_043    jsonb;
        v_price_043  numeric;
        v_active_043 boolean;
    BEGIN
        FOR v_chk_043 IN SELECT * FROM pg_catalog.jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) LOOP
            v_paid_043 := v_paid_043 + coalesce((v_chk_043->>'amount')::numeric, 0);
        END LOOP;
        IF pg_catalog.abs(v_paid_043 - v_total) > 0.01 THEN
            RAISE check_violation USING MESSAGE = 'Payments do not match the sale total — recheck the cart';
        END IF;
        FOR v_chk_043 IN SELECT * FROM pg_catalog.jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
            -- A custom line (gift wrap, alteration) has no catalogue row;
            -- its price needs a manager in sale-core, not a lookup here.
            IF (v_chk_043->>'variant_id') IS NULL THEN
                CONTINUE;
            END IF;
            IF coalesce((v_chk_043->>'qty')::integer, 0) <= 0 THEN
                RAISE check_violation USING MESSAGE = 'A sale line needs a positive quantity';
            END IF;
            SELECT selling_price, is_active INTO v_price_043, v_active_043
              FROM public.product_variants WHERE id = (v_chk_043->>'variant_id')::integer;
            IF NOT FOUND THEN
                RAISE check_violation USING MESSAGE = 'An item in the cart no longer exists — clear it and rescan';
            END IF;
            IF NOT coalesce(v_active_043, FALSE) THEN
                RAISE check_violation USING MESSAGE = 'An item in the cart has been retired and cannot be sold';
            END IF;
            IF pg_catalog.abs(v_price_043 - (v_chk_043->>'unit_price')::numeric) > 0.01 THEN
                RAISE check_violation USING MESSAGE = 'A price changed while the sale was being rung up — recheck the cart';
            END IF;
        END LOOP;
    END;
    insert into public.sales (
        sale_no, shift_id, customer_id, sale_date, subtotal, discount,
        vat_amount, total, cashier_id, vat_policy_id, vat_enabled, vat_rate,
        vat_number, idempotency_key, rounding, note
    ) values (
        'pending-' || pg_catalog.gen_random_uuid()::text,
        p_shift_id, p_customer_id, v_checked_out_at, v_subtotal,
        coalesce(p_discount, 0), v_vat_amount, v_total, p_cashier_id,
        v_policy.id, v_policy.enabled, v_effective_rate, v_snapshot_number,
        v_key, v_rounding, v_note
    ) returning id into v_sale_id;

    update public.sales
    set sale_no = public.next_doc_no('sale')
    where id = v_sale_id;

    for v_item in select * from pg_catalog.jsonb_array_elements(p_items) loop
        v_line := (v_item->>'qty')::integer * (v_item->>'unit_price')::numeric
                  - coalesce((v_item->>'discount')::numeric, 0);
        v_variant := (v_item->>'variant_id')::integer;
        v_desc := nullif(
            pg_catalog.btrim(coalesce(v_item->>'description', '')),
            ''
        );

        if v_variant is null and v_desc is null then
            raise exception 'A sale line needs either a variant or a description';
        end if;

        insert into public.sale_items (
            sale_id, variant_id, description, qty, unit_price, discount, line_total
        ) values (
            v_sale_id, v_variant, v_desc, (v_item->>'qty')::integer,
            (v_item->>'unit_price')::numeric,
            coalesce((v_item->>'discount')::numeric, 0), v_line
        );

        if v_variant is not null then
            perform public.record_stock_movement(
                v_variant,
                'sale',
                -(v_item->>'qty')::integer,
                'pos_sale',
                v_sale_id,
                null
            );
        end if;
    end loop;

    insert into public.sale_payments (sale_id, method, amount, tendered)
    select
        v_sale_id,
        payment->>'method',
        (payment->>'amount')::numeric,
        (payment->>'tendered')::numeric
    from pg_catalog.jsonb_array_elements(p_payments) as payment;

    insert into public.sale_discounts (
        sale_id, discount_id, label, kind, value, amount, approved_by
    )
    select
        v_sale_id,
        nullif(discount_row->>'discount_id', '')::integer,
        discount_row->>'label',
        discount_row->>'kind',
        (discount_row->>'value')::numeric,
        (discount_row->>'amount')::numeric,
        nullif(discount_row->>'approved_by', '')::uuid
    from pg_catalog.jsonb_array_elements(
        coalesce(p_discounts, '[]'::jsonb)
    ) as discount_row;

    return v_sale_id;
end;
$function$;
