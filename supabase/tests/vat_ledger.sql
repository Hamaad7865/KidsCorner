-- Transactional VAT ledger acceptance test.
--
-- Run as a database owner after the complete VAT migration has been applied.
-- Every fixture and stock movement is rolled back.
begin;

-- Keep the feature probe first. Against the authorized pre-migration project
-- this must fail on the missing policy-aware RPC before the read-only SQL
-- connector reaches any temporary helper or fixture mutation.
select 'public.complete_sale_keyed_at_policy(text,integer,integer,uuid,numeric,jsonb,jsonb,jsonb,bigint,timestamp with time zone)'::regprocedure;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'VAT ledger acceptance failure: %', p_message;
  end if;
end;
$$;

select pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.complete_sale_keyed_at_policy(text,integer,integer,uuid,numeric,jsonb,jsonb,jsonb,bigint,timestamp with time zone)',
    'EXECUTE'
  ),
  'authenticated tills need the policy-aware checkout RPC'
);
select pg_temp.assert_true(
  not has_function_privilege(
    'anon',
    'public.complete_sale_keyed_at_policy(text,integer,integer,uuid,numeric,jsonb,jsonb,jsonb,bigint,timestamp with time zone)',
    'EXECUTE'
  ),
  'anonymous callers must not execute the policy-aware checkout RPC'
);

do $$
declare
  v_staff uuid;
  v_legacy public.vat_policies%rowtype;
  v_disabled_id bigint;
  v_enabled_id bigint;
  v_new_current_id bigint;
  v_sale_id bigint;
  v_legacy_sale_id bigint;
  v_old_keyed_sale_id bigint;
  v_old_plain_sale_id bigint;
  v_replayed_id bigint;
  v_padded_sale_id bigint;
  v_padded_key text := '  vat-padded-replay-test  ';
  v_checked_at timestamptz := clock_timestamp();
  v_unknown_id bigint;
  v_future_id bigint;
  v_rejected boolean;
  v_items jsonb := jsonb_build_array(jsonb_build_object(
    'variant_id', null,
    'description', 'VAT acceptance item',
    'qty', 1,
    'unit_price', 115,
    'discount', 0
  ));
  v_payments jsonb := jsonb_build_array(jsonb_build_object(
    'method', 'cash',
    'amount', 115,
    'tendered', 115
  ));
begin
  select id into v_staff
  from public.profiles
  where is_active
  order by created_at
  limit 1;
  perform pg_temp.assert_true(v_staff is not null, 'sale fixtures need an active staff profile');

  select * into strict v_legacy
  from public.vat_policies
  where is_legacy;

  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at
  ) values (
    false, 0.15, 'SAVED-WHILE-DISABLED', v_checked_at - interval '5 minutes'
  ) returning id into v_disabled_id;

  v_sale_id := public.complete_sale_keyed_at_policy(
    'vat-disabled-ledger-test', null, null, v_staff, 0,
    v_items, v_payments, '[]'::jsonb,
    v_disabled_id, v_checked_at
  );

  perform pg_temp.assert_true(
    (select vat_policy_id = v_disabled_id
       and vat_enabled is false
       and vat_rate = 0
       and vat_number is null
       and vat_amount = 0
       and subtotal = 115
       and total = 115
       and sale_date = v_checked_at
     from public.sales where id = v_sale_id),
    'disabled checkout must freeze zero effective VAT without changing gross totals'
  );

  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at
  ) values (
    true, 0.15, 'VAT-ENABLED-15', v_checked_at - interval '4 minutes'
  ) returning id into v_enabled_id;

  -- A higher id becomes current before checkout commits. The supplied older
  -- immutable id must still win.
  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at
  ) values (
    false, 0.20, 'PREPARED-20', v_checked_at - interval '3 minutes'
  ) returning id into v_new_current_id;

  v_sale_id := public.complete_sale_keyed_at_policy(
    'vat-enabled-ledger-test', null, null, v_staff, 0,
    v_items, v_payments, '[]'::jsonb,
    v_enabled_id, v_checked_at
  );

  perform pg_temp.assert_true(
    (select vat_policy_id = v_enabled_id
       and vat_policy_id <> v_new_current_id
       and vat_enabled is true
       and vat_rate = 0.15
       and vat_number = 'VAT-ENABLED-15'
       and vat_amount = 15
       and subtotal = 115
       and total = 115
     from public.sales where id = v_sale_id),
    'enabled checkout must freeze the supplied 15 percent policy and inclusive split'
  );

  v_legacy_sale_id := public.complete_sale_keyed_at_policy(
    'vat-null-policy-test', null, null, v_staff, 0,
    v_items, v_payments, '[]'::jsonb,
    null, null
  );
  perform pg_temp.assert_true(
    (select vat_policy_id = v_legacy.id
       and vat_enabled = v_legacy.enabled
       and vat_rate = v_legacy.configured_rate
     from public.sales where id = v_legacy_sale_id),
    'a null policy id must map only to the immutable legacy policy'
  );

  v_old_keyed_sale_id := public.complete_sale_keyed(
    'vat-old-keyed-test', null, null, v_staff, 0,
    v_items, v_payments, '[]'::jsonb
  );
  perform pg_temp.assert_true(
    (select vat_policy_id = v_legacy.id from public.sales where id = v_old_keyed_sale_id),
    'the old keyed signature must remain explicitly legacy-compatible'
  );

  v_old_plain_sale_id := public.complete_sale(
    null, null, v_staff, 0, v_items, v_payments
  );
  perform pg_temp.assert_true(
    (select vat_policy_id = v_legacy.id from public.sales where id = v_old_plain_sale_id),
    'the old unkeyed checkout must remain explicitly legacy-compatible'
  );

  select max(id) + 1000 into v_unknown_id from public.vat_policies;
  v_rejected := false;
  begin
    perform public.complete_sale_keyed_at_policy(
      'vat-unknown-policy-test', null, null, v_staff, 0,
      v_items, v_payments, '[]'::jsonb,
      v_unknown_id, v_checked_at
    );
  exception when others then
    v_rejected := true;
  end;
  perform pg_temp.assert_true(v_rejected, 'a non-null unknown policy id must be rejected');
  perform pg_temp.assert_true(
    not exists (select 1 from public.sales where idempotency_key = 'vat-unknown-policy-test'),
    'an unknown policy rejection must not leave a sale'
  );

  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at
  ) values (
    true, 0.15, 'FUTURE-VAT', v_checked_at + interval '1 day'
  ) returning id into v_future_id;

  v_rejected := false;
  begin
    perform public.complete_sale_keyed_at_policy(
      'vat-future-policy-test', null, null, v_staff, 0,
      v_items, v_payments, '[]'::jsonb,
      v_future_id, v_checked_at
    );
  exception when others then
    v_rejected := true;
  end;
  perform pg_temp.assert_true(v_rejected, 'a policy created after checkout must be rejected');

  v_padded_sale_id := public.complete_sale_keyed_at_policy(
    v_padded_key, null, null, v_staff, 0,
    v_items, v_payments, '[]'::jsonb,
    v_enabled_id, v_checked_at
  );

  -- The same supplied, whitespace-padded key must normalize identically for
  -- lock, lookup and persistence. The invalid policy makes a missed replay
  -- fail before this assertion rather than silently creating another sale.
  v_replayed_id := public.complete_sale_keyed_at_policy(
    v_padded_key, null, null, v_staff, 0,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    v_future_id, v_checked_at
  );
  perform pg_temp.assert_true(
    v_replayed_id = v_padded_sale_id,
    'a padded idempotency key must replay before validating an invalid policy'
  );

  -- The replay deliberately supplies an invalid future policy. Returning the
  -- first sale proves the idempotency lookup occurs before policy resolution.
  v_replayed_id := public.complete_sale_keyed_at_policy(
    'vat-enabled-ledger-test', null, null, v_staff, 0,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    v_future_id, v_checked_at
  );
  perform pg_temp.assert_true(
    v_replayed_id = v_sale_id,
    'an idempotency replay must return the original sale before resolving a newer policy'
  );
end;
$$;

do $$
declare
  v_staff uuid;
  v_approver uuid;
  v_source_policy_id bigint;
  v_opposite_policy_id bigint;
  v_sale_id bigint;
  v_sale_item_id bigint;
  v_first_note_id bigint;
  v_second_note_id bigint;
  v_checked_at timestamptz := clock_timestamp();
begin
  select id into v_staff
  from public.profiles
  where is_active
  order by created_at
  limit 1;
  select id into v_approver
  from public.profiles
  where is_active and role in ('owner', 'manager')
  order by created_at
  limit 1;
  perform pg_temp.assert_true(
    v_staff is not null and v_approver is not null,
    'return fixtures need active staff and an active approver'
  );

  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at
  ) values (
    true, 0.15, 'RETURN-SOURCE-VAT', v_checked_at - interval '1 minute'
  ) returning id into v_source_policy_id;

  v_sale_id := public.complete_sale_keyed_at_policy(
    'vat-return-source-test', null, null, v_staff, 0,
    jsonb_build_array(jsonb_build_object(
      'variant_id', null,
      'description', 'Two-part return',
      'qty', 2,
      'unit_price', 57.525,
      'discount', 0
    )),
    jsonb_build_array(jsonb_build_object(
      'method', 'cash',
      'amount', 115.05,
      'tendered', 115.05
    )),
    '[]'::jsonb,
    v_source_policy_id,
    v_checked_at
  );
  select id into strict v_sale_item_id
  from public.sale_items
  where sale_id = v_sale_id;

  -- Returns happen after the current policy flips off. They must still reverse
  -- the enabled source snapshot.
  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at
  ) values (
    false, 0.20, 'OPPOSITE-CURRENT-POLICY', clock_timestamp()
  ) returning id into v_opposite_policy_id;

  v_first_note_id := public.create_credit_note(
    v_sale_id, null, v_staff, 'First half', 'cash',
    jsonb_build_array(jsonb_build_object('sale_item_id', v_sale_item_id, 'qty', 1)),
    false, v_approver
  );
  v_second_note_id := public.create_credit_note(
    v_sale_id, null, v_staff, 'Second half', 'cash',
    jsonb_build_array(jsonb_build_object('sale_item_id', v_sale_item_id, 'qty', 1)),
    false, v_approver
  );

  perform pg_temp.assert_true(
    (select vat_policy_id = v_source_policy_id
       and vat_policy_id <> v_opposite_policy_id
       and vat_enabled is true
       and vat_rate = 0.15
       and vat_number = 'RETURN-SOURCE-VAT'
     from public.credit_notes where id = v_first_note_id)
    and
    (select vat_policy_id = v_source_policy_id
       and vat_enabled is true
       and vat_rate = 0.15
       and vat_number = 'RETURN-SOURCE-VAT'
     from public.credit_notes where id = v_second_note_id),
    'every return must copy the source sale policy under the opposite current policy'
  );
  perform pg_temp.assert_true(
    (select sum(vat_amount) = (select vat_amount from public.sales where id = v_sale_id)
       from public.credit_notes where sale_id = v_sale_id),
    'proportional return VAT must be capped at the source VAT remaining'
  );
  perform pg_temp.assert_true(
    (select sum(total) = (select total from public.sales where id = v_sale_id)
       from public.credit_notes where sale_id = v_sale_id),
    'split returns must remain capped at the source gross total'
  );
end;
$$;

do $$
declare
  v_staff uuid;
  v_supplier_id integer;
  v_variant_id integer;
  v_disabled_policy_id bigint;
  v_enabled_policy_id bigint;
  v_purchase_id integer;
  v_enabled_purchase_id integer;
  v_rejected boolean;
begin
  select id into v_staff
  from public.profiles
  where is_active
  order by created_at
  limit 1;
  select id into v_supplier_id from public.suppliers order by id limit 1;
  select id into v_variant_id from public.product_variants order by id limit 1;
  perform pg_temp.assert_true(
    v_staff is not null and v_supplier_id is not null and v_variant_id is not null,
    'purchase fixtures need an active staff profile, supplier, and variant'
  );

  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at
  ) values (
    false, 0.15, 'PURCHASE-PREPARED', clock_timestamp()
  ) returning id into v_disabled_policy_id;

  insert into public.purchases (
    supplier_id, total_amount, status, created_by
  ) values (
    v_supplier_id, 115, 'draft', v_staff
  ) returning id into v_purchase_id;
  insert into public.purchase_items (purchase_id, variant_id, qty, unit_cost)
  values (v_purchase_id, v_variant_id, 1, 115);

  perform public.receive_purchase(v_purchase_id);
  perform pg_temp.assert_true(
    (select status = 'received'
       and vat_policy_id = v_disabled_policy_id
       and vat_enabled is false
       and vat_rate = 0
       and vat_amount = 0
     from public.purchases where id = v_purchase_id),
    'receiving while VAT is disabled must freeze that current policy once with zero VAT'
  );

  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at
  ) values (
    true, 0.15, 'PURCHASE-ENABLED-VAT', clock_timestamp()
  ) returning id into v_enabled_policy_id;

  v_rejected := false;
  begin
    perform public.receive_purchase(v_purchase_id);
  exception when others then
    v_rejected := true;
  end;
  perform pg_temp.assert_true(v_rejected, 'retrying a received purchase must be rejected');
  perform pg_temp.assert_true(
    (select vat_policy_id = v_disabled_policy_id
       and vat_enabled is false
       and vat_rate = 0
       and vat_amount = 0
     from public.purchases where id = v_purchase_id),
    'a receipt retry under a newer policy must not replace the frozen snapshot'
  );

  insert into public.purchases (
    supplier_id, total_amount, status, created_by
  ) values (
    v_supplier_id, 115, 'draft', v_staff
  ) returning id into v_enabled_purchase_id;
  insert into public.purchase_items (purchase_id, variant_id, qty, unit_cost)
  values (v_enabled_purchase_id, v_variant_id, 1, 115);

  perform public.receive_purchase(v_enabled_purchase_id);
  perform pg_temp.assert_true(
    (select vat_policy_id = v_enabled_policy_id
       and vat_enabled is true
       and vat_rate = 0.15
       and vat_amount = 15
     from public.purchases where id = v_enabled_purchase_id),
    'receiving while VAT is enabled must freeze the current inclusive VAT split'
  );
end;
$$;

rollback;
