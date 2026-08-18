-- VAT policy ledger acceptance test.
--
-- Run as a database owner. Every mutation is enclosed in this transaction and
-- rolled back so the test never changes the configured shop policy.
begin;

-- Keep the schema probe first: the pre-feature RED run must fail because the
-- ledger is absent, before any transactional test helper is installed.
select id from public.vat_policies limit 0;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'VAT policy acceptance failure: %', p_message;
  end if;
end;
$$;

do $$
declare
  v_legacy public.vat_policies%rowtype;
  v_current public.vat_policies%rowtype;
begin
  select * into v_legacy
  from public.vat_policies
  where is_legacy;

  perform pg_temp.assert_true(
    (select count(*) = 1 from public.vat_policies where is_legacy),
    'exactly one legacy policy must exist'
  );

  select * into v_current
  from public.vat_policies
  order by id desc
  limit 1;

  perform pg_temp.assert_true(v_current.id > v_legacy.id, 'current policy must be selected by highest id');
  perform pg_temp.assert_true(v_current.enabled is false, 'the migration must start with VAT disabled');
  perform pg_temp.assert_true(
    v_current.configured_rate = coalesce(
      case
        when v_legacy.configured_rate > 0 and v_legacy.configured_rate <= 1
          then v_legacy.configured_rate
      end,
      0.15
    ),
    'the prepared rate must be preserved and 0.15 used only as fallback'
  );
  perform pg_temp.assert_true(
    v_current.vat_number is not distinct from nullif(btrim(v_legacy.vat_number), ''),
    'the prepared VAT number must be normalized and preserved'
  );

  perform pg_temp.assert_true(
    not exists (
      select 1 from public.sales
      where vat_policy_id is null or vat_enabled is null or vat_rate is null
    ),
    'every historical sale must have a frozen policy snapshot'
  );
  perform pg_temp.assert_true(
    not exists (
      select 1
      from public.credit_notes cn
      join public.sales s on s.id = cn.sale_id
      where cn.vat_policy_id is distinct from s.vat_policy_id
         or cn.vat_enabled is distinct from s.vat_enabled
         or cn.vat_rate is distinct from s.vat_rate
         or cn.vat_number is distinct from s.vat_number
    ),
    'credit notes must inherit their source sale policy snapshot'
  );
  perform pg_temp.assert_true(
    not exists (
      select 1 from public.purchases
      where (status = 'received' and (
        vat_policy_id is distinct from v_legacy.id
        or vat_enabled is distinct from true
        or vat_rate is distinct from v_legacy.configured_rate
        or vat_amount is distinct from round(total_amount - total_amount / (1 + vat_rate), 2)
      )) or (status in ('draft', 'cancelled') and (
        vat_policy_id is not null or vat_enabled is not null or vat_rate is not null or vat_amount is not null
      ))
    ),
    'only received purchases must carry a complete frozen VAT snapshot'
  );
  perform pg_temp.assert_true(
    not exists (
      select 1 from public.z_reports
      where jsonb_typeof(vat_identity_snapshot) <> 'array'
         or jsonb_array_length(vat_identity_snapshot) <> 1
         or not (vat_identity_snapshot -> 0 ?& array['policyId', 'rate', 'vatNumber'])
         or vat_identity_snapshot -> 0 ->> 'policyId' <> v_legacy.id::text
         or (vat_identity_snapshot -> 0 ->> 'rate')::numeric <> v_legacy.configured_rate
         or vat_identity_snapshot -> 0 ->> 'vatNumber' is distinct from v_legacy.vat_number
    ),
    'closed Z reports must retain one stable legacy identity record'
  );
end;
$$;

do $$
begin
  begin
    insert into public.vat_policies (enabled, configured_rate, vat_number)
    values (true, 0.15, '   ');
    raise exception 'enabled policy accepted a blank VAT number';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.vat_policies (enabled, configured_rate, vat_number)
    values (false, 0, null);
    raise exception 'policy accepted a zero configured rate';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.vat_policies (enabled, configured_rate, vat_number)
    values (false, 1.000001, null);
    raise exception 'policy accepted a configured rate above one';
  exception
    when check_violation then null;
  end;

  begin
    update public.vat_policies set vat_number = 'MUTATED' where is_legacy;
    raise exception 'legacy policy was mutable';
  exception
    when raise_exception then
      if sqlerrm = 'legacy policy was mutable' then
        raise;
      end if;
  end;
end;
$$;

select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.vat_policies', 'SELECT'),
  'authenticated staff need SELECT privilege'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.vat_policies', 'SELECT'),
  'anon must not receive policy read privilege'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.vat_policies', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.vat_policies', 'INSERT,UPDATE,DELETE'),
  'client roles must not receive policy mutation privileges'
);
select pg_temp.assert_true(
  not has_function_privilege(
    'anon',
    'public.set_vat_policy(boolean,numeric,text)',
    'EXECUTE'
  ),
  'anon must not execute set_vat_policy'
);
select pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.set_vat_policy(boolean,numeric,text)',
    'EXECUTE'
  ),
  'authenticated callers need RPC execute privilege'
);

do $$
declare
  v_owner uuid;
  v_original_role text;
  v_original_active boolean;
begin
  select id, role, is_active
  into v_owner, v_original_role, v_original_active
  from public.profiles
  where role = 'owner' and is_active
  order by created_at
  limit 1;

  perform pg_temp.assert_true(v_owner is not null, 'test target needs an active owner profile');
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  update public.profiles set role = 'manager' where id = v_owner;
  begin
    perform public.set_vat_policy(false, 0.15, null);
    raise exception 'manager changed VAT policy';
  exception
    when insufficient_privilege then null;
  end;

  update public.profiles set role = 'owner', is_active = false where id = v_owner;
  begin
    perform public.set_vat_policy(false, 0.15, null);
    raise exception 'inactive owner changed VAT policy';
  exception
    when insufficient_privilege then null;
  end;

  update public.profiles
  set role = v_original_role, is_active = v_original_active
  where id = v_owner;
end;
$$;

do $$
declare
  v_owner uuid;
  v_before_id bigint;
  v_new_id bigint;
  v_before_events bigint;
  v_after_events bigint;
  v_detail jsonb;
begin
  select id into v_owner
  from public.profiles
  where role = 'owner' and is_active
  order by created_at
  limit 1;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  select max(id) into v_before_id from public.vat_policies;
  select count(*) into v_before_events
  from public.audit_events
  where event_type = 'setting.changed'
    and ref_type = 'setting'
    and ref_id = 'vat_policy';

  v_new_id := public.set_vat_policy(true, 0.20, '  TEST-VAT-001  ');

  perform pg_temp.assert_true(v_new_id > v_before_id, 'RPC must append a new policy');
  perform pg_temp.assert_true(
    (select enabled and configured_rate = 0.20 and vat_number = 'TEST-VAT-001'
       from public.vat_policies where id = v_new_id),
    'RPC must normalize and save the new policy'
  );
  perform pg_temp.assert_true(
    (select value = 'true'::jsonb from public.settings where key = 'vat_enabled')
    and (select value = '0.20'::jsonb from public.settings where key = 'vat_rate')
    and (select value = '"TEST-VAT-001"'::jsonb from public.settings where key = 'vat_number'),
    'RPC must atomically update all three VAT settings'
  );

  select count(*)
  into v_after_events
  from public.audit_events
  where event_type = 'setting.changed'
    and ref_type = 'setting'
    and ref_id = 'vat_policy';

  select detail into v_detail
  from public.audit_events
  where event_type = 'setting.changed'
    and ref_type = 'setting'
    and ref_id = 'vat_policy'
  order by id desc
  limit 1;

  perform pg_temp.assert_true(
    v_after_events = v_before_events + 1,
    'one policy change must emit exactly one VAT setting event'
  );
  perform pg_temp.assert_true(
    v_detail -> 'old' ?& array['enabled', 'rate', 'vatNumber']
    and v_detail -> 'new' = jsonb_build_object(
      'enabled', true,
      'rate', 0.20,
      'vatNumber', 'TEST-VAT-001'
    ),
    'VAT activity metadata must carry old/new enabled, rate, and number values'
  );

  begin
    perform public.set_vat_policy(true, 0.20, '   ');
    raise exception 'RPC enabled VAT without a number';
  exception
    when check_violation then null;
  end;
  perform pg_temp.assert_true(
    (select max(id) = v_new_id from public.vat_policies),
    'a rejected transition must not append a policy'
  );
end;
$$;

do $$
declare
  v_owner uuid;
  v_key text;
  v_rows bigint;
begin
  select id into v_owner
  from public.profiles
  where role = 'owner' and is_active
  order by created_at
  limit 1;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  set local role authenticated;
  foreach v_key in array array['vat_enabled', 'vat_rate', 'vat_number'] loop
    update public.settings set value = 'null'::jsonb where key = v_key;
    get diagnostics v_rows = row_count;
    perform pg_temp.assert_true(v_rows = 0, 'generic settings update changed ' || v_key);
  end loop;
  reset role;
end;
$$;

do $$
declare
  v_staff uuid;
  v_rows bigint;
begin
  select id into v_staff
  from public.profiles
  where is_active
  order by created_at
  limit 1;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);

  set local role authenticated;
  select count(*) into v_rows from public.vat_policies;
  perform pg_temp.assert_true(v_rows > 0, 'active authenticated staff must read policies');
  reset role;

  update public.profiles set is_active = false where id = v_staff;
  set local role authenticated;
  select count(*) into v_rows from public.vat_policies;
  perform pg_temp.assert_true(v_rows = 0, 'inactive authenticated staff must not read policies');
  reset role;
  update public.profiles set is_active = true where id = v_staff;

  set local role anon;
  begin
    perform count(*) from public.vat_policies;
    raise exception 'anon read VAT policies';
  exception
    when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

rollback;
