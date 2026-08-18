-- Transactional acceptance test for snapshot-driven VAT reports.
--
-- Run as a database owner after the complete VAT migration has been applied.
-- Every fixture and policy transition is rolled back.
begin;

-- Keep the feature probe first. The authorized pre-migration RED run must fail
-- before the connector reaches any fixture mutation.
select vat_identity_snapshot from public.z_reports limit 0;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'VAT report acceptance failure: %', p_message;
  end if;
end;
$$;

do $$
declare
  v_owner uuid;
  v_device integer;
  v_shift integer;
  v_supplier integer;
  v_disabled_policy bigint;
  v_enabled_policy bigint;
  v_later_policy bigint;
  v_disabled_sale bigint;
  v_enabled_sale bigint;
  v_disabled_line bigint;
  v_enabled_line bigint;
  v_disabled_note bigint;
  v_enabled_note bigint;
  v_disabled_purchase integer;
  v_enabled_purchase integer;
  v_x jsonb;
  v_daily jsonb;
  v_close jsonb;
  v_z_id bigint;
  v_frozen_totals jsonb;
  v_frozen_identities jsonb;
  v_base timestamptz := pg_catalog.now() - interval '2 days';
  v_items jsonb := jsonb_build_array(jsonb_build_object(
    'variant_id', null,
    'description', 'VAT report fixture',
    'qty', 2,
    'unit_price', 115,
    'discount', 0
  ));
  v_payments jsonb := jsonb_build_array(jsonb_build_object(
    'method', 'cash',
    'amount', 230,
    'tendered', 230
  ));
  v_day date := (v_base at time zone 'Indian/Mauritius')::date;
begin
  select id into v_owner
  from public.profiles
  where role = 'owner' and is_active
  order by created_at
  limit 1;
  perform pg_temp.assert_true(v_owner is not null, 'fixtures need an active owner');
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into public.pos_devices (code, name, model)
  values ('vat-report-' || txid_current()::text, 'VAT report fixture', 'SQL')
  returning id into v_device;

  insert into public.shifts (opened_by, opened_at, opening_float, device_id)
  values (v_owner, v_base, 100, v_device)
  returning id into v_shift;

  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at, created_by
  ) values (
    false, 0.15, null, v_base - interval '1 hour', v_owner
  ) returning id into v_disabled_policy;

  v_disabled_sale := public.complete_sale_keyed_at_policy(
    'vat-report-disabled-' || txid_current()::text,
    v_shift, null, v_owner, 0, v_items, v_payments, '[]'::jsonb,
    v_disabled_policy, v_base + interval '1 hour'
  );

  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at, created_by
  ) values (
    true, 0.15, 'VAT-REPORT-15', v_base + interval '90 minutes', v_owner
  ) returning id into v_enabled_policy;

  v_enabled_sale := public.complete_sale_keyed_at_policy(
    'vat-report-enabled-' || txid_current()::text,
    v_shift, null, v_owner, 0, v_items, v_payments, '[]'::jsonb,
    v_enabled_policy, v_base + interval '2 hours'
  );

  select id into v_disabled_line
  from public.sale_items where sale_id = v_disabled_sale;
  select id into v_enabled_line
  from public.sale_items where sale_id = v_enabled_sale;

  -- The current policy is enabled when the disabled source is returned.
  v_disabled_note := public.create_credit_note(
    v_disabled_sale, v_shift, v_owner, 'Disabled source return', 'cash',
    jsonb_build_array(jsonb_build_object('sale_item_id', v_disabled_line, 'qty', 1)),
    false, v_owner
  );
  update public.credit_notes
  set created_at = v_base + interval '3 hours'
  where id = v_disabled_note;

  -- Make the opposite policy current before returning the enabled source.
  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at, created_by
  ) values (
    false, 0.20, 'PREPARED-20', v_base + interval '210 minutes', v_owner
  ) returning id into v_later_policy;

  v_enabled_note := public.create_credit_note(
    v_enabled_sale, v_shift, v_owner, 'Enabled source return', 'cash',
    jsonb_build_array(jsonb_build_object('sale_item_id', v_enabled_line, 'qty', 1)),
    false, v_owner
  );
  update public.credit_notes
  set created_at = v_base + interval '4 hours'
  where id = v_enabled_note;

  perform pg_temp.assert_true(
    (select vat_policy_id = v_disabled_policy
       and vat_enabled is false and vat_rate = 0 and vat_amount = 0
     from public.credit_notes where id = v_disabled_note),
    'a disabled sale returned while enabled must remain outside VAT'
  );
  perform pg_temp.assert_true(
    (select vat_policy_id = v_enabled_policy
       and vat_enabled is true and vat_rate = 0.15 and vat_amount = 15
     from public.credit_notes where id = v_enabled_note),
    'an enabled sale returned while disabled must reverse its frozen 15 percent band'
  );

  insert into public.suppliers (name)
  values ('VAT report supplier ' || txid_current()::text)
  returning id into v_supplier;

  insert into public.purchases (
    supplier_id, invoice_no, purchase_date, total_amount, created_by, created_at
  ) values (
    v_supplier, 'VAT-DISABLED', v_day, 230, v_owner, v_base + interval '5 hours'
  ) returning id into v_disabled_purchase;
  perform public.receive_purchase(v_disabled_purchase);

  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at, created_by
  ) values (
    true, 0.15, 'VAT-PURCHASE-15', v_base + interval '6 hours', v_owner
  ) returning id into v_enabled_policy;

  insert into public.purchases (
    supplier_id, invoice_no, purchase_date, total_amount, created_by, created_at
  ) values (
    v_supplier, 'VAT-ENABLED', v_day, 230, v_owner, v_base + interval '7 hours'
  ) returning id into v_enabled_purchase;
  perform public.receive_purchase(v_enabled_purchase);

  perform pg_temp.assert_true(
    (select vat_enabled is false and vat_rate = 0 and vat_amount = 0
     from public.purchases where id = v_disabled_purchase),
    'a purchase received while disabled must freeze zero input VAT'
  );
  perform pg_temp.assert_true(
    (select vat_enabled is true and vat_rate = 0.15 and vat_amount = 30
     from public.purchases where id = v_enabled_purchase),
    'a purchase received while enabled must freeze its input VAT'
  );

  -- Keep the current immutable policy opposite to the historical enabled
  -- transactions, and remove the legacy settings pointers entirely. Report
  -- reads must work from document snapshots under both conditions.
  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at, created_by
  ) values (
    false, 0.20, 'CURRENT-PREPARED-20', v_base + interval '8 hours', v_owner
  ) returning id into v_later_policy;
  delete from public.settings
  where key in ('vat_enabled', 'vat_rate', 'vat_number');

  v_x := public.z_totals(v_shift, v_base + interval '12 hours');
  perform pg_temp.assert_true(
    (v_x ->> 'sales_total')::numeric = 460,
    'disabled turnover must remain in the mixed shift gross total'
  );
  perform pg_temp.assert_true(
    jsonb_array_length(v_x -> 'vat') = 1
    and (v_x -> 'vat' -> 0 ->> 'rate')::numeric = 15
    and (v_x -> 'vat' -> 0 ->> 'incl')::numeric = 115
    and (v_x -> 'vat' -> 0 ->> 'vat')::numeric = 15,
    'the frozen enabled sale less its return must be the only VAT band'
  );
  perform pg_temp.assert_true(
    v_x -> 'vat_identities' = jsonb_build_array(jsonb_build_object(
      'policyId', (select vat_policy_id from public.sales where id = v_enabled_sale),
      'rate', 0.15,
      'vatNumber', 'VAT-REPORT-15'
    )),
    'the live X read must expose distinct frozen enabled identities only'
  );

  v_daily := public.daily_summary(v_day, v_day);
  perform pg_temp.assert_true(
    v_daily -> 'taxes' = '["15.00"]'::jsonb,
    'daily VAT headers must omit disabled turnover and today''s 20 percent setting'
  );
  perform pg_temp.assert_true(
    (v_daily -> 'rows' -> 0 -> 'by_tax' -> '15.00' ->> 'incl')::numeric = 115
    and (v_daily -> 'rows' -> 0 -> 'by_tax' -> '15.00' ->> 'vat')::numeric = 15,
    'daily VAT bands must subtract the return at its copied source rate'
  );

  v_close := public.close_shift_z(v_shift, 330, 'VAT report fixture');
  v_z_id := (v_close ->> 'z_id')::bigint;
  select totals, vat_identity_snapshot
  into v_frozen_totals, v_frozen_identities
  from public.z_reports where id = v_z_id;

  perform pg_temp.assert_true(
    v_frozen_identities = v_x -> 'vat_identities',
    'close must copy the exact live identity array into its own frozen column'
  );

  insert into public.vat_policies (
    enabled, configured_rate, vat_number, created_at, created_by
  ) values (
    true, 0.25, 'LATER-VAT-25', v_base + interval '13 hours', v_owner
  );

  perform pg_temp.assert_true(
    (select totals = v_frozen_totals
       and vat_identity_snapshot = v_frozen_identities
     from public.z_reports where id = v_z_id),
    'later policy changes must not rewrite closed totals or identity snapshots'
  );
end;
$$;

rollback;
