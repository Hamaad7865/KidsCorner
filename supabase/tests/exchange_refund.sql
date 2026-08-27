-- Exchange refund + idempotency acceptance test.
--
-- Run after 20260826140000_exchange_refund_and_idempotency.sql has been
-- applied. Every fixture, sale, credit note and stock movement is rolled
-- back.
--
-- What this proves, in order: create_exchange settles a trade-DOWN gap by
-- refunding the difference instead of refusing; the sale_payments row it
-- writes for that leg is negative with no tendered figure; create_exchange
-- still settles a trade-UP gap exactly as before; create_exchange_keyed
-- replays an identical attempt instead of writing a second credit note and
-- sale; and the "already returned" refusal names the product instead of an
-- internal row id.
begin;

select 'public.create_exchange(bigint,int,uuid,jsonb,jsonb,text,numeric,uuid)'::regprocedure;
select 'public.create_exchange_keyed(text,bigint,int,uuid,jsonb,jsonb,text,numeric,uuid)'::regprocedure;
select 'public.create_credit_note(bigint,int,uuid,text,text,jsonb,boolean)'::regprocedure;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'Exchange acceptance failure: %', p_message;
  end if;
end;
$$;

do $$
declare
  v_staff             uuid;
  v_shift             integer;
  v_category          integer;
  v_size              integer;
  v_colour_original   integer;
  v_colour_cheaper    integer;
  v_colour_pricier    integer;
  v_product           integer;
  v_variant_original  integer;
  v_variant_cheaper   integer;
  v_variant_pricier   integer;
  v_sale_a            bigint;
  v_sale_b            bigint;
  v_item_a            bigint;
  v_item_b            bigint;
  v_new_sale          bigint;
  v_replay_sale       bigint;
  v_payment           record;
  v_error             text;
  v_unexpectedly_allowed boolean;
begin
  select id into v_staff from public.profiles where is_active order by created_at limit 1;
  perform pg_temp.assert_true(v_staff is not null, 'fixtures need an active staff profile');

  -- Closed on arrival: shifts_one_open_per_device allows only one OPEN shift
  -- per device, and a real till may already have one going. Neither RPC under
  -- test cares whether its shift is open — that gate lives in the route, not
  -- here — so there is nothing lost by not colliding with it.
  insert into public.shifts (opened_by, opening_float, closed_at)
    values (v_staff, 0, now()) returning id into v_shift;

  insert into public.categories (name) values ('Exchange acceptance category')
    returning id into v_category;
  insert into public.sizes (size_type, label, sort_order) values ('letter_size', 'Acceptance size', 1)
    returning id into v_size;
  insert into public.colours (name, hex_code) values ('Acceptance colour original', '#111111')
    returning id into v_colour_original;
  insert into public.colours (name, hex_code) values ('Acceptance colour cheaper', '#222222')
    returning id into v_colour_cheaper;
  insert into public.colours (name, hex_code) values ('Acceptance colour pricier', '#333333')
    returning id into v_colour_pricier;
  insert into public.products (name, category_id) values ('Acceptance tee', v_category)
    returning id into v_product;

  -- Three colourways of the same product, since (product_id, size_id,
  -- colour_id) is unique — one size shared, one colour per variant.
  insert into public.product_variants (product_id, size_id, colour_id, sku, cost_price, selling_price, qty_on_hand)
    values (v_product, v_size, v_colour_original, 'ACC-ORIG', 50, 200, 10) returning id into v_variant_original;
  insert into public.product_variants (product_id, size_id, colour_id, sku, cost_price, selling_price, qty_on_hand)
    values (v_product, v_size, v_colour_cheaper, 'ACC-CHEAP', 40, 150, 10) returning id into v_variant_cheaper;
  insert into public.product_variants (product_id, size_id, colour_id, sku, cost_price, selling_price, qty_on_hand)
    values (v_product, v_size, v_colour_pricier, 'ACC-PRICEY', 60, 250, 10) returning id into v_variant_pricier;

  -- ── trade-down: the shop pays the customer back ──────────────────────────

  v_sale_a := public.complete_sale_with_discounts(
    v_shift, null, v_staff, 0,
    jsonb_build_array(jsonb_build_object('variant_id', v_variant_original, 'qty', 1, 'unit_price', 200, 'discount', 0)),
    '[{"method":"cash","amount":200,"tendered":200}]'::jsonb
  );
  select id into v_item_a from public.sale_items where sale_id = v_sale_a;

  v_new_sale := public.create_exchange_keyed(
    'exchange-acceptance-tradedown-1',
    v_sale_a, v_shift, v_staff,
    jsonb_build_array(jsonb_build_object('sale_item_id', v_item_a, 'qty', 1)),
    jsonb_build_array(jsonb_build_object('variant_id', v_variant_cheaper, 'qty', 1)),
    'cash', null, null
  );

  perform pg_temp.assert_true(
    (select total from public.sales where id = v_new_sale) = 150,
    'the replacement sale should total the cheaper item''s list price'
  );

  select * into v_payment from public.sale_payments where sale_id = v_new_sale;
  perform pg_temp.assert_true(found, 'a trade-down exchange should still write one settlement row');
  perform pg_temp.assert_true(
    v_payment.amount = -50,
    format('a 200 credit against a 150 replacement should refund 50, not %s', v_payment.amount)
  );
  perform pg_temp.assert_true(
    v_payment.tendered is null,
    'a refund leg carries no tendered figure - there is nothing to compute change from'
  );

  perform pg_temp.assert_true(
    (select refund_method from public.credit_notes where sale_id = v_sale_a) = 'exchange',
    'an exchange credit note keeps its exchange marker regardless of which way the gap ran'
  );

  -- ── replay: the same key must not write a second document ───────────────

  v_replay_sale := public.create_exchange_keyed(
    'exchange-acceptance-tradedown-1',
    v_sale_a, v_shift, v_staff,
    jsonb_build_array(jsonb_build_object('sale_item_id', v_item_a, 'qty', 1)),
    jsonb_build_array(jsonb_build_object('variant_id', v_variant_cheaper, 'qty', 1)),
    'cash', null, null
  );
  perform pg_temp.assert_true(
    v_replay_sale = v_new_sale, 'replaying the same key must return the original sale, not a new one'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.credit_notes where sale_id = v_sale_a) = 1,
    'a replay must not write a second credit note'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.sales where exchange_note_id =
       (select id from public.credit_notes where sale_id = v_sale_a)) = 1,
    'a replay must not write a second replacement sale'
  );

  -- ── the line really is exhausted now, and says so in plain language ──────

  v_unexpectedly_allowed := false;
  begin
    perform public.create_exchange(
      v_sale_a, v_shift, v_staff,
      jsonb_build_array(jsonb_build_object('sale_item_id', v_item_a, 'qty', 1)),
      jsonb_build_array(jsonb_build_object('variant_id', v_variant_cheaper, 'qty', 1)),
      'cash', null, null
    );
    v_unexpectedly_allowed := true;
  exception
    when others then
      v_error := sqlerrm;
  end;
  perform pg_temp.assert_true(
    not v_unexpectedly_allowed, 'a fully exchanged line must still refuse a further exchange'
  );
  perform pg_temp.assert_true(
    v_error = 'Only 0 left of "Acceptance tee" to exchange (1 sold, 1 already returned)',
    format('unexpected refusal wording: %s', v_error)
  );

  -- ── trade-up: unchanged behaviour, still a live path ─────────────────────

  v_sale_b := public.complete_sale_with_discounts(
    v_shift, null, v_staff, 0,
    jsonb_build_array(jsonb_build_object('variant_id', v_variant_original, 'qty', 1, 'unit_price', 200, 'discount', 0)),
    '[{"method":"cash","amount":200,"tendered":200}]'::jsonb
  );
  select id into v_item_b from public.sale_items where sale_id = v_sale_b;

  v_new_sale := public.create_exchange_keyed(
    'exchange-acceptance-tradeup-1',
    v_sale_b, v_shift, v_staff,
    jsonb_build_array(jsonb_build_object('sale_item_id', v_item_b, 'qty', 1)),
    jsonb_build_array(jsonb_build_object('variant_id', v_variant_pricier, 'qty', 1)),
    'cash', 300, null
  );

  select * into v_payment from public.sale_payments where sale_id = v_new_sale;
  perform pg_temp.assert_true(
    v_payment.amount = 50,
    format('a 200 credit against a 250 replacement should take 50, not %s', v_payment.amount)
  );
  perform pg_temp.assert_true(
    v_payment.tendered = 300,
    'a paying customer''s tendered cash is still recorded, for change'
  );

  raise notice 'exchange refund + idempotency: all acceptance checks passed';
end $$;

rollback;
