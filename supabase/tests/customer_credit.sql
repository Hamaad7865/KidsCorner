-- Customer credit acceptance test.
--
-- Run as a database owner after 20260820100000_customer_credit.sql has been
-- applied. Every fixture, sale, ledger entry and stock movement is rolled back.
--
-- What this proves, in order: the objects exist and are reachable by the right
-- roles; the database itself — not the application — refuses a credit tender
-- that has nobody to bill, no account, a held account, or no room under the
-- limit; a legitimate one bills the account with the right due date; a split
-- tender bills only its credit part; settling reduces the balance and puts cash
-- in the drawer; over-settling is refused; and voiding or returning against an
-- account sale gives the money back.
begin;

-- Feature probes first, so this fails on a missing object before any fixture is
-- written.
select 'public.settle_customer_credit(integer,numeric,text,integer,text)'::regprocedure;
select 'public.write_off_customer_credit(integer,numeric,text)'::regprocedure;
select 'public.customer_credit_balance(integer)'::regprocedure;
select 'public.customer_credit_entries'::regclass;
select 'public.customer_credit_accounts'::regclass;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'Customer credit acceptance failure: %', p_message;
  end if;
end;
$$;

-- Did the statement we expected to be refused actually get refused?
create or replace function pg_temp.assert_refused(p_sql text, p_message text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      return;
  end;
  raise exception 'Customer credit acceptance failure: % (it was ALLOWED)', p_message;
end;
$$;

-- ── who may reach it ────────────────────────────────────────────────────────

select pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.settle_customer_credit(integer,numeric,text,integer,text)',
    'EXECUTE'
  ),
  'staff need to be able to take a payment on account'
);
select pg_temp.assert_true(
  not has_function_privilege(
    'anon',
    'public.settle_customer_credit(integer,numeric,text,integer,text)',
    'EXECUTE'
  ),
  'the publishable key must not settle accounts'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.customer_credit_entries', 'SELECT'),
  'the publishable key must not read who owes the shop money'
);
select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.customer_credit_entries', 'SELECT'),
  'a cashier must be able to see a balance before adding to it'
);

-- The ledger is append-only: reachable by SELECT and by nothing else.
select pg_temp.assert_true(
  (select count(*) = 1
     from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_credit_entries'),
  'the ledger should carry exactly one policy, and it should be the read one'
);
select pg_temp.assert_true(
  (select cmd = 'SELECT'
     from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_credit_entries'),
  'no INSERT, UPDATE or DELETE policy may exist on an append-only ledger'
);

do $$
declare
  v_staff        uuid;
  v_shift        integer;
  v_account      integer;
  v_no_account   integer;
  v_held         integer;
  v_sale         bigint;
  v_split_sale   bigint;
  v_legacy       public.vat_policies%rowtype;
  v_balance      numeric;
  v_available    numeric;
  v_due          date;
  v_movement     numeric;
  v_result       jsonb;
  v_note         bigint;

  -- A custom line, so nothing has to be in stock for this to run.
  v_items_600 jsonb := jsonb_build_array(jsonb_build_object(
    'variant_id', null, 'description', 'Credit acceptance item',
    'qty', 1, 'unit_price', 600, 'discount', 0
  ));
  v_items_400 jsonb := jsonb_build_array(jsonb_build_object(
    'variant_id', null, 'description', 'Credit split item',
    'qty', 1, 'unit_price', 400, 'discount', 0
  ));
  v_items_500 jsonb := jsonb_build_array(jsonb_build_object(
    'variant_id', null, 'description', 'Credit over-limit item',
    'qty', 1, 'unit_price', 500, 'discount', 0
  ));
begin
  select id into v_staff
  from public.profiles
  where is_active
  order by created_at
  limit 1;
  perform pg_temp.assert_true(v_staff is not null, 'fixtures need an active staff profile');

  select * into strict v_legacy from public.vat_policies where is_legacy;

  insert into public.shifts (opened_by, opening_float)
  values (v_staff, 0) returning id into v_shift;

  insert into public.customers (full_name, credit_limit, credit_terms_days)
  values ('Credit account probe', 1000, 14) returning id into v_account;

  insert into public.customers (full_name, credit_limit)
  values ('No account probe', 0) returning id into v_no_account;

  insert into public.customers (full_name, credit_limit, credit_on_hold)
  values ('Held account probe', 1000, true) returning id into v_held;

  -- ── the four refusals ────────────────────────────────────────────────────
  --
  -- Each goes through the real checkout RPC, so what is being proved is that a
  -- client cannot get past this by talking to the database directly.

  perform pg_temp.assert_refused(
    format(
      $q$select public.complete_sale_keyed_at_policy(
           'credit-no-customer', %s, null, %L, 0,
           %L::jsonb,
           '[{"method":"credit","amount":600,"tendered":null}]'::jsonb,
           '[]'::jsonb, null, null)$q$,
      v_shift, v_staff, v_items_600
    ),
    'a sale on account with no customer attached'
  );

  perform pg_temp.assert_refused(
    format(
      $q$select public.complete_sale_keyed_at_policy(
           'credit-no-account', %s, %s, %L, 0,
           %L::jsonb,
           '[{"method":"credit","amount":600,"tendered":null}]'::jsonb,
           '[]'::jsonb, null, null)$q$,
      v_shift, v_no_account, v_staff, v_items_600
    ),
    'a sale on account for a customer with no credit limit'
  );

  perform pg_temp.assert_refused(
    format(
      $q$select public.complete_sale_keyed_at_policy(
           'credit-held', %s, %s, %L, 0,
           %L::jsonb,
           '[{"method":"credit","amount":600,"tendered":null}]'::jsonb,
           '[]'::jsonb, null, null)$q$,
      v_shift, v_held, v_staff, v_items_600
    ),
    'a sale on account for a customer whose account is on hold'
  );

  -- ── the legitimate one ───────────────────────────────────────────────────

  v_sale := public.complete_sale_keyed_at_policy(
    'credit-ok', v_shift, v_account, v_staff, 0,
    v_items_600,
    '[{"method":"credit","amount":600,"tendered":null}]'::jsonb,
    '[]'::jsonb, null, null
  );

  select balance, available into v_balance, v_available
  from public.customer_credit_accounts where customer_id = v_account;

  perform pg_temp.assert_true(
    v_balance = 600, format('a 600 credit sale should leave 600 owing, not %s', v_balance)
  );
  perform pg_temp.assert_true(
    v_available = 400, format('a 1000 limit with 600 owing leaves 400, not %s', v_available)
  );

  perform pg_temp.assert_true(
    (select count(*) = 1
       from public.customer_credit_entries
      where sale_id = v_sale and entry_type = 'charge' and amount = 600),
    'a credit tender should write exactly one charge for its own amount'
  );

  -- The due date is the terms in force on the day of the sale, frozen.
  select due_on into v_due
  from public.customer_credit_entries
  where sale_id = v_sale and entry_type = 'charge';
  perform pg_temp.assert_true(
    v_due = ((select sale_date from public.sales where id = v_sale)
             at time zone 'Indian/Mauritius')::date + 14,
    format('a 14-day account should fall due 14 days after the sale, not %s', v_due)
  );

  -- Changing the terms must NOT re-age money already on the books.
  update public.customers set credit_terms_days = 60 where id = v_account;
  perform pg_temp.assert_true(
    (select due_on = v_due from public.customer_credit_entries
      where sale_id = v_sale and entry_type = 'charge'),
    'an existing charge must keep the due date it was given'
  );
  update public.customers set credit_terms_days = 14 where id = v_account;

  -- ── the limit actually holds ─────────────────────────────────────────────

  perform pg_temp.assert_refused(
    format(
      $q$select public.complete_sale_keyed_at_policy(
           'credit-over-limit', %s, %s, %L, 0,
           %L::jsonb,
           '[{"method":"credit","amount":500,"tendered":null}]'::jsonb,
           '[]'::jsonb, null, null)$q$,
      v_shift, v_account, v_staff, v_items_500
    ),
    'a credit sale taking the balance past the limit'
  );

  perform pg_temp.assert_true(
    public.customer_credit_balance(v_account) = 600,
    'a refused credit sale must leave the balance untouched'
  );

  -- ── a deposit plus the rest on account ───────────────────────────────────
  --
  -- The reason credit is a tender and not a second kind of sale: this needs no
  -- special case anywhere.

  v_split_sale := public.complete_sale_keyed_at_policy(
    'credit-split', v_shift, v_account, v_staff, 0,
    v_items_400,
    '[{"method":"cash","amount":100,"tendered":100},
      {"method":"credit","amount":300,"tendered":null}]'::jsonb,
    '[]'::jsonb, null, null
  );

  perform pg_temp.assert_true(
    public.customer_credit_balance(v_account) = 900,
    format('600 + a 300 credit part should owe 900, not %s',
           public.customer_credit_balance(v_account))
  );
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.customer_credit_entries
      where sale_id = v_split_sale),
    'only the credit part of a split tender belongs on the account'
  );

  -- ── settling ─────────────────────────────────────────────────────────────

  perform pg_temp.assert_refused(
    format('select public.settle_customer_credit(%s, 5000, ''cash'')', v_account),
    'a payment larger than the balance'
  );
  perform pg_temp.assert_refused(
    format('select public.settle_customer_credit(%s, 100, ''credit'')', v_account),
    'settling an account with more account'
  );
  perform pg_temp.assert_refused(
    format('select public.settle_customer_credit(%s, 0, ''cash'')', v_account),
    'a payment of nothing'
  );

  v_result := public.settle_customer_credit(v_account, 200, 'cash', v_shift, 'probe payment');

  perform pg_temp.assert_true(
    (v_result->>'balance')::numeric = 700,
    format('900 less a 200 payment is 700, not %s', v_result->>'balance')
  );

  -- Cash taken at a till has to be in that drawer at close, or the cashier
  -- comes up over by exactly this much.
  select coalesce(sum(amount), 0) into v_movement
  from public.till_movements where shift_id = v_shift;
  perform pg_temp.assert_true(
    v_movement = 200,
    format('a 200 cash payment on account should add 200 to the drawer, not %s', v_movement)
  );

  -- The same payment away from a till must NOT claim to be in one.
  v_result := public.settle_customer_credit(v_account, 100, 'cash', null, 'office payment');
  select coalesce(sum(amount), 0) into v_movement
  from public.till_movements where shift_id = v_shift;
  perform pg_temp.assert_true(
    v_movement = 200,
    'a payment taken with no shift must not touch a drawer'
  );
  perform pg_temp.assert_true(
    public.customer_credit_balance(v_account) = 600,
    'the office payment should still have reduced the balance'
  );

  -- A card payment never goes in the drawer either.
  v_result := public.settle_customer_credit(v_account, 100, 'card', v_shift, 'card payment');
  select coalesce(sum(amount), 0) into v_movement
  from public.till_movements where shift_id = v_shift;
  perform pg_temp.assert_true(
    v_movement = 200, 'a card payment on account must not add cash to the drawer'
  );

  -- ── returning against an account ─────────────────────────────────────────

  insert into public.credit_notes (
    credit_no, sale_id, shift_id, cashier_id, reason,
    subtotal, vat_amount, total, refund_method,
    vat_policy_id, vat_enabled, vat_rate
  ) values (
    'CN-CREDIT-PROBE', v_split_sale, v_shift, v_staff, 'probe return',
    100, 0, 100, 'credit',
    v_legacy.id, false, 0
  ) returning id into v_note;

  perform pg_temp.assert_true(
    (select count(*) = 1 from public.customer_credit_entries
      where credit_note_id = v_note and entry_type = 'refund' and amount = -100),
    'a return to account should credit the account by the value of the return'
  );
  perform pg_temp.assert_true(
    public.customer_credit_balance(v_account) = 400,
    format('500 less a 100 return is 400, not %s',
           public.customer_credit_balance(v_account))
  );

  -- ── voiding an account sale ──────────────────────────────────────────────
  --
  -- A void says it never happened, so the charge must come off — and come off
  -- as a visible reversal, not a deletion.

  update public.sales set status = 'void' where id = v_sale;

  perform pg_temp.assert_true(
    (select count(*) = 1 from public.customer_credit_entries
      where sale_id = v_sale and entry_type = 'adjustment' and amount = -600),
    'voiding an account sale should reverse its charge'
  );
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.customer_credit_entries
      where sale_id = v_sale and entry_type = 'charge'),
    'the original charge must survive the void, as history'
  );

  v_balance := public.customer_credit_balance(v_account);
  perform pg_temp.assert_true(
    v_balance = -200,
    format('after the void the shop owes 200 back, not %s', v_balance)
  );

  -- Voiding twice must not credit twice.
  update public.sales set status = 'void' where id = v_sale;
  perform pg_temp.assert_true(
    public.customer_credit_balance(v_account) = -200,
    'a second void must not reverse the same charge again'
  );

  -- A negative balance is real — the shop holds the customer's money — so
  -- there is nothing left to settle.
  perform pg_temp.assert_refused(
    format('select public.settle_customer_credit(%s, 50, ''cash'')', v_account),
    'settling an account that is already in credit'
  );

  -- ── the view agrees with the ledger, for everyone ────────────────────────

  perform pg_temp.assert_true(
    (select count(*) = 0
       from public.customer_credit_accounts a
      where a.balance <> public.customer_credit_balance(a.customer_id)),
    'the accounts view and the balance function must never disagree'
  );

  raise notice 'customer credit: all acceptance checks passed';
end $$;

rollback;
