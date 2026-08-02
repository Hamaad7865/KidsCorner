-- ═══════════════════════════════════════════════════════════════════════════
-- A staff PIN gets a second hash, one that is safe to hand to a till.
--
-- The tablet's offline sale queue has always been able to park a sale through
-- an outage. What it could not do was let anybody IN: the lock screen posts to
-- /api/till/pin, so a cashier switch — or an app restart — while the line is
-- down left the till dead behind its own keypad, holding a queue nobody could
-- add to. Offline selling that stops at the first cashier switch is not
-- offline selling.
--
-- So the tablet needs to check a PIN itself. It must not be given `pin_code`:
-- that is the value the server compares against, and a rooted tablet would
-- then hold the shop's own credential. This column is a SECOND derivation of
-- the same PIN — its own salt, its own iteration count — minted at the two
-- moments the plaintext PIN legitimately passes through server code:
--
--   · setCashierPin       — the owner types it in Settings
--   · authenticateCashier — a successful ONLINE sign-in, which backfills
--                           every existing PIN at its next use
--
-- Be clear-eyed, as lib/pos/pin.ts already is: four digits is 10,000 values,
-- and no iteration count makes that space large. A verifier on a stolen tablet
-- is a PIN in the attacker's hands within the minute. What this buys is that
-- it is not ALSO the server's hash, and that it can be revoked from here — a
-- deactivated login or a cleared PIN stops unlocking tills at their next sync,
-- without anybody touching the tablet.
--
-- Format is `pbkdf2:sha256:<iterations>:<salt b64>:<dk b64>` — COLONS, where
-- pin_code uses dollars. Deliberately: the two must never be interchangeable
-- by accident, so neither one parses as the other.
-- ═══════════════════════════════════════════════════════════════════════════

alter table profiles add column if not exists pin_device_verifier text;

comment on column profiles.pin_device_verifier is
  'PBKDF2-SHA256 verifier of the till PIN, served to signed-in devices so the '
  'lock screen works with no network. Never the same value as pin_code. '
  'Null means this person cannot sign in offline until their next online '
  'sign-in mints one.';

-- ── a verifier may not outlive the PIN it was made from ─────────────────────
-- lib/pos/actions.ts writes both columns together, but that is application
-- discipline and this is the thing that opens a till. A raw UPDATE from psql,
-- or any future caller that forgets, would otherwise leave a verifier for a
-- PIN the owner has already changed still unlocking every tablet in the shop.
create or replace function public.forget_verifier_with_pin()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- No PIN, no verifier. Checked on INSERT too: offline sign-in consults only
  -- the verifier, so a row carrying one with no pin_code would unlock a till
  -- that the online path would refuse.
  if new.pin_code is null then
    new.pin_device_verifier := null;
    return new;
  end if;

  -- The PIN moved and the verifier did not, so the verifier is for the OLD
  -- PIN. Dropped rather than kept: offline sign-in then needs the network once
  -- more, which is a delay. Keeping it would be a hole.
  if tg_op = 'UPDATE'
     and new.pin_code is distinct from old.pin_code
     and new.pin_device_verifier is not distinct from old.pin_device_verifier
  then
    new.pin_device_verifier := null;
  end if;

  return new;
end $$;

drop trigger if exists profiles_forget_verifier_with_pin on profiles;
create trigger profiles_forget_verifier_with_pin
  before insert or update on profiles
  for each row execute function public.forget_verifier_with_pin();

-- ── prove the shape, then leave the table as it was found ───────────────────
do $$
declare
  v_id uuid;
  v_verifier text;
  v_probe constant text := 'pbkdf2:sha256:1:AA==:AA==';
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'pin_device_verifier'
  ) then
    raise exception 'pin_device_verifier column missing';
  end if;

  select id into v_id from profiles where pin_code is not null limit 1;
  if v_id is null then
    raise notice 'no profile has a PIN — the trigger was not exercised';
    return;
  end if;

  -- A verifier set beside an unchanged PIN survives (the sign-in backfill).
  update profiles set pin_device_verifier = v_probe where id = v_id;
  select pin_device_verifier into v_verifier from profiles where id = v_id;
  if v_verifier is null then
    raise exception 'the trigger dropped a verifier set beside an unchanged PIN';
  end if;

  -- A PIN change that does not carry a new verifier drops the old one.
  update profiles set pin_code = pin_code || 'x' where id = v_id;
  select pin_device_verifier into v_verifier from profiles where id = v_id;
  if v_verifier is not null then
    raise exception 'a verifier survived a PIN change';
  end if;

  -- Clearing the PIN clears the verifier.
  update profiles set pin_device_verifier = v_probe, pin_code = 'pbkdf2$1$AA==$AA=='
   where id = v_id;
  update profiles set pin_code = null where id = v_id;
  select pin_device_verifier into v_verifier from profiles where id = v_id;
  if v_verifier is not null then
    raise exception 'a verifier survived its PIN being cleared';
  end if;

  -- Everything above happened to a real staff PIN, so none of it may stand.
  raise exception 'rollback the probe';
exception
  when others then
    if sqlerrm <> 'rollback the probe' then raise; end if;
    raise notice 'trigger verified; probe rolled back';
end $$;
