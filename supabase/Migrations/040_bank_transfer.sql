-- ═══════════════════════════════════════════════════════════════════════════
-- The shop takes bank transfers, and stops offering my.t money.
--
-- TWO DIFFERENT LISTS, and the difference is the whole migration.
--
--   The CHECK constraint is every method that has EVER been valid. It is the
--   vocabulary the ledger is written in, and it only ever grows: 10 sale
--   payments totalling Rs 22,678.47 are already recorded as 'myt_money', and
--   a receipt reprinted next year still has to render them. Removing the value
--   would either invalidate those rows or force a rewrite of history to make
--   a UI change true, and a fiscal record is not a place to do that.
--
--   `settings.payment_methods` is what the shop offers TODAY. Both tills read
--   it — the tablet through /api/till/bootstrap, the web till through
--   getPaymentMethods — so retiring a method is a change to this list and
--   nothing else. The tile stops being drawn at the next sync.
--
-- So: 'bank' is ADDED to the constraint, 'myt_money' is LEFT in it, and the
-- offered list swaps one for the other.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the vocabulary grows ────────────────────────────────────────────────────
alter table sale_payments drop constraint if exists sale_payments_method_check;
alter table sale_payments add constraint sale_payments_method_check
  check (method in ('cash', 'card', 'juice', 'myt_money', 'bank'));

alter table credit_notes drop constraint if exists credit_notes_refund_method_check;
alter table credit_notes add constraint credit_notes_refund_method_check
  check (refund_method in ('cash', 'card', 'juice', 'myt_money', 'bank', 'exchange'));

comment on constraint sale_payments_method_check on sale_payments is
  'Every method the ledger has ever been written in. Only grows — retiring a '
  'method is a change to settings.payment_methods, not to this.';

-- ── what the shop offers changes ────────────────────────────────────────────
update settings
   set value = '["cash","card","juice","bank"]'::jsonb
 where key = 'payment_methods';

-- ── prove it ────────────────────────────────────────────────────────────────
do $$
declare
  v_offered jsonb;
  v_kept    int;
begin
  select value into v_offered from settings where key = 'payment_methods';
  if not (v_offered ? 'bank') then
    raise exception 'bank is not offered';
  end if;
  if v_offered ? 'myt_money' then
    raise exception 'my.t money is still offered';
  end if;

  -- The history must still be readable, which is the point of keeping the
  -- value in the constraint.
  select count(*) into v_kept from sale_payments where method = 'myt_money';
  raise notice '% historical my.t money payment(s) still valid', v_kept;

  -- And a bank payment must now be insertable. Exercised for real, then undone.
  begin
    insert into sale_payments (sale_id, method, amount)
    select id, 'bank', 0.01 from sales order by id desc limit 1;
    raise exception 'rollback the probe';
  exception
    when others then
      if sqlerrm <> 'rollback the probe' then raise; end if;
      raise notice 'a bank payment inserts cleanly; probe rolled back';
  end;
end $$;
