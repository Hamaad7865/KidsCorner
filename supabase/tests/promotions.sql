-- Promotions acceptance test: manual markdowns and the second threshold.
--
-- Run as a database owner. Every mutation is enclosed in this transaction and
-- rolled back, so the test leaves no promotion, no price change and no audit
-- row behind.
begin;

-- Keep the schema probe first: the pre-feature RED run must fail because the
-- second-threshold functions are absent, before any fixture is touched. Both
-- probes are plan-time only — WHERE false keeps the bodies from running.
select public.reduce_promotion(0, 0) where false;
select * from public.stale_promotions(14) where false;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'Promotions acceptance failure: %', p_message;
  end if;
end;
$$;

-- ── grants: the two new functions are authenticated-only ─────────────────
select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.reduce_promotion(int,numeric,text)', 'EXECUTE'),
  'authenticated callers need reduce_promotion execute privilege'
);
select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.stale_promotions(int)', 'EXECUTE'),
  'authenticated callers need stale_promotions execute privilege'
);
select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.reduce_promotion(int,numeric,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.stale_promotions(int)', 'EXECUTE'),
  'anon must not reach the promotion writes or reads'
);

-- ── the flow: apply by hand, reduce twice, lift, detect ──────────────────
do $$
declare
  v_owner     uuid;
  v_cashier   uuid;
  v_colour_id int;
  v_variant   int;
  v_price     numeric;
  v_cost      numeric;
  v_promo_id  bigint;
  v_check_id  bigint;
  v_now_price numeric;
  v_row       record;
begin
  select id into v_owner
    from public.profiles
   where role = 'owner' and is_active
   order by created_at limit 1;
  perform pg_temp.assert_true(v_owner is not null, 'test needs an active owner profile');

  select id into v_cashier from public.profiles where role = 'cashier' and is_active limit 1;
  perform pg_temp.assert_true(v_cashier is not null, 'test needs an active cashier profile');

  -- The fixture is a CLONE of an existing variant — never sold (it was born
  -- inside this transaction), so the idle clock runs from the promotion alone
  -- and the backdating below means what it says. Rolled back with everything
  -- else. The clone takes its template's size but a colour the product does
  -- not yet have, satisfying the (product, size, colour) unique key.
  for v_row in
    select pv.id, pv.product_id, pv.size_id, pv.cost_price
      from public.product_variants pv
     where pv.is_active and pv.cost_price > 0
     order by pv.id
  loop
    select c.id into v_colour_id
      from public.colours c
     where not exists (
       select 1 from public.product_variants x
        where x.product_id = v_row.product_id and x.colour_id = c.id
     )
     order by c.id
     limit 1;
    if v_colour_id is not null then
      begin
        insert into public.product_variants
          (product_id, sku, size_id, colour_id, cost_price, selling_price, qty_on_hand, is_active)
        values
          (v_row.product_id, 'ACCEPT-' || substr(md5(random()::text), 1, 12),
           v_row.size_id, v_colour_id, v_row.cost_price, v_row.cost_price + 10, 5, true)
        returning id, selling_price, cost_price into v_variant, v_price, v_cost;
      exception when unique_violation then
        v_variant := null;
      end;
    end if;
    exit when v_variant is not null;
    v_colour_id := null;
  end loop;
  perform pg_temp.assert_true(v_variant is not null, 'test could not clone a variant');

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  -- ── apply: the manual path — any variant, not only a slow mover ─────────
  v_promo_id := public.apply_promotion(v_variant, v_price - 5, 'acceptance test');
  perform pg_temp.assert_true(v_promo_id is not null, 'apply_promotion should return the promotion id');

  select selling_price into v_now_price from public.product_variants where id = v_variant;
  perform pg_temp.assert_true(v_now_price = v_price - 5, 'apply_promotion must move selling_price');

  -- ── reduce: the second markdown edits the SAME promotion ────────────────
  v_check_id := public.reduce_promotion(v_variant, v_price - 10, null);
  perform pg_temp.assert_true(v_check_id = v_promo_id, 'reduce_promotion must reuse the running promotion');

  select selling_price into v_now_price from public.product_variants where id = v_variant;
  perform pg_temp.assert_true(v_now_price = v_price - 10, 'reduce_promotion must move selling_price again');

  select pr.original_price, pr.promo_price into v_row
    from public.promotions pr where pr.id = v_promo_id;
  perform pg_temp.assert_true(
    v_row.original_price = v_price and v_row.promo_price = v_price - 10,
    'reduce_promotion must lower promo_price but keep the true original_price'
  );

  -- ── guards: never below cost, never sideways, never upwards ─────────────
  begin
    perform public.reduce_promotion(v_variant, v_cost - 1);
    raise exception 'reduced below cost';
  exception
    when check_violation then null;
  end;

  begin
    perform public.reduce_promotion(v_variant, v_price - 10);
    raise exception 'reduced to the same price';
  exception
    when check_violation then null;
  end;

  begin
    perform public.reduce_promotion(v_variant, v_price - 2);
    raise exception 'reduced upwards';
  exception
    when check_violation then null;
  end;

  perform set_config('request.jwt.claim.sub', v_cashier::text, true);
  begin
    perform public.reduce_promotion(v_variant, v_price - 12);
    raise exception 'cashier reduced a promotion';
  exception
    when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  -- ── lifting after two reductions restores the FIRST price ───────────────
  perform public.lift_promotion(v_promo_id);
  select selling_price into v_now_price from public.product_variants where id = v_variant;
  perform pg_temp.assert_true(
    v_now_price = v_price,
    'lifting after a reduction must restore the original price, not the intermediate one'
  );

  -- ── stale_promotions: the second threshold's detection ──────────────────
  -- Re-apply and backdate the promotion past the threshold. The connection is
  -- the database owner, so this direct UPDATE is RLS-exempt; the function
  -- reads the row exactly as an authenticated caller would.
  v_promo_id := public.apply_promotion(v_variant, v_price - 5, null);
  update public.promotions
     set applied_at = now() - interval '40 days'
   where id = v_promo_id;

  -- Found-row checks compare a FIELD, not the record: a composite `is not
  -- null` is false when ANY field is null, and this row legitimately carries
  -- nulls (last_sold_at — never sold — and product_code).
  select * into v_row from public.stale_promotions(14) where promotion_id = v_promo_id;
  perform pg_temp.assert_true(v_row.promotion_id is not null, 'a 40-day-old unsold promotion must be flagged');
  perform pg_temp.assert_true(
    v_row.original_price = v_price and v_row.promo_price = v_price - 5,
    'the stale row must carry the promotion prices'
  );
  perform pg_temp.assert_true(v_row.days_idle >= 14, 'the stale row must have counted the idle days');

  -- Inside the threshold: the same promotion, freshly applied, is invisible.
  update public.promotions set applied_at = now() where id = v_promo_id;
  select * into v_row from public.stale_promotions(14) where promotion_id = v_promo_id;
  perform pg_temp.assert_true(v_row.promotion_id is null, 'a fresh promotion must not be flagged');
end;
$$;

rollback;
