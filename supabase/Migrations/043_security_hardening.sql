-- ============================================================
-- Kids Corner — migration 043: security hardening
--
-- Six fail-open defaults, closed. Each section says what the hole was and
-- what breaks if the guard is removed, so a future migration does not
-- re-open one by accident.
--
-- Migrations 001-042 are untouched. Sections that touch objects created by
-- the later-dated (202608*) migrations use IF EXISTS / catalogue guards, so
-- this file applies both on the live database (where everything already
-- exists) and on a fresh one (where the dated files run after this one).
-- Anything this file cannot pin on a fresh database — a definer function
-- created by a later file — is named in place so the gap is visible.
-- ============================================================

-- ===== 1. profiles: the roster read no longer implies the PIN columns =====
--
-- THE HOLE. `read_all ON profiles FOR SELECT TO authenticated USING (true)`
-- (001) let any signed-in session read pin_code and pin_device_verifier for
-- every staff member. Those are PBKDF2 hashes of 4-digit PINs — 10,000 values
-- each — so anyone holding them owns every till PIN without touching a lockout.
--
-- WHY NOT A CLEAN COLUMN REVOKE. Every app session — owner and cashier alike —
-- talks to Postgres as the single `authenticated` role, so a GRANT cannot tell
-- them apart, and RLS is row-level, not column-level. Revoking the PIN columns
-- from `authenticated` would also revoke them from the server-side PIN checks
-- in lib/pos/sale-core.ts (authenticateCashier, verifyApproval), which run as
-- the caller's session: the shop could no longer sign anyone in at all.
--
-- So the narrowing is three smaller things, each real:
--   a. `anon` (the publishable key with NO session — public by design, per 035)
--      loses profiles entirely. The old policy was authenticated-only, so this
--      changes no working call, and an unauthenticated key now fails at the
--      GRANT before RLS is even consulted.
--   b. The single USING(true) policy is replaced by three named ones. Row
--      access stays listable — the till lock screen must draw every cashier —
--      but the pieces are now separable: tightening the roster policy later no
--      longer requires rediscovering the owner/self cases.
--   c. staff_roster / get_roster() become the canonical roster reads. They
--      expose has_pin as a boolean and never the hashes; new code should use
--      them instead of selecting pin_code to derive it.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_all ON public.profiles;

CREATE POLICY profiles_owner_read ON public.profiles
    FOR SELECT TO authenticated
    USING (current_role_of_user() = 'owner');

CREATE POLICY profiles_self_read ON public.profiles
    FOR SELECT TO authenticated
    USING (auth.uid() = id);

-- Kept permissive ON PURPOSE: listCashiers draws the till keypad from this,
-- and any signed-in device needs it. The secrets leave through (c), not here:
-- policies are OR-ed, so this row stays listable while the hashes stay out of
-- the roster-shaped reads. See staff_roster / get_roster() below.
CREATE POLICY profiles_roster_read ON public.profiles
    FOR SELECT TO authenticated
    USING (true);

COMMENT ON POLICY profiles_roster_read ON public.profiles IS
    'Deliberately permissive: the till lock screen lists every cashier. '
    'PIN hashes are protected by keeping them out of roster reads '
    '(staff_roster, get_roster) and from unauthenticated roles (GRANTs), '
    'not by this policy — RLS cannot do column-level SELECT.';

-- The roster without the secrets. security_invoker keeps the CALLER''s RLS in
-- force (034 precedent): this view grants no access of its own.
CREATE OR REPLACE VIEW public.staff_roster
WITH (security_invoker = on) AS
SELECT id,
       full_name,
       role,
       is_active,
       (pin_code IS NOT NULL) AS has_pin
  FROM public.profiles
 ORDER BY full_name;

REVOKE ALL ON TABLE public.staff_roster FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.staff_roster TO authenticated;

-- Same roster as an RPC, for callers that cannot (or should not) touch the
-- table shape directly. SECURITY DEFINER so it keeps working if the roster
-- policy is ever tightened; the hashes still never leave it.
CREATE OR REPLACE FUNCTION public.get_roster()
RETURNS TABLE (
    id UUID,
    full_name TEXT,
    role TEXT,
    is_active BOOLEAN,
    has_pin BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.id,
           p.full_name,
           p.role,
           p.is_active,
           (p.pin_code IS NOT NULL) AS has_pin
      FROM public.profiles p
     ORDER BY p.full_name;
$$;

REVOKE ALL ON FUNCTION public.get_roster() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_roster() TO authenticated;

-- Unauthenticated keys lose the table completely (035 did the same for
-- EXECUTE). The column GRANT below documents the least-privilege roster set
-- for reviewers; it is additive, not enforcing, because owner and cashier
-- share the `authenticated` role — see the note at the top of this section.
REVOKE ALL ON TABLE public.profiles FROM anon, PUBLIC;
GRANT SELECT (id, full_name, role, is_active) ON public.profiles TO authenticated;

COMMENT ON COLUMN public.profiles.pin_code IS
    'PBKDF2 hash of the 4-digit till PIN (lib/pos/pin.ts). Server-side PIN '
    'checks only — never selected for display. Roster reads must use '
    'staff_roster / get_roster(), which expose has_pin instead.';
COMMENT ON COLUMN public.profiles.pin_device_verifier IS
    'Offline verifier for the till lock screen (migration 038). Served only '
    'to signed-in devices via /api/till/bootstrap — never to anon.';

-- ===== 2. register_pin_attempt: a caller may only move its own counter =====
--
-- THE HOLE. The 010 function takes any p_profile_id and any p_ok, with no
-- check on who is asking. Any signed-in session could increment anyone
-- else''s pin_failed_count (locking the owner out of every till) or report
-- p_ok = TRUE for them (wiping a real lockout and its audit value).
--
-- THE FIX. Self-service, or the owner. The till''s own sign-in still works:
-- authenticateCashier treats an RPC error as "no wait" and the PIN comparison
-- itself remains the gate, so a shared-till session that may no longer advance
-- another profile''s counter fails closed on counting, never open on access.
-- (023''s exponent clamp is preserved byte-for-byte below.)
CREATE OR REPLACE FUNCTION public.register_pin_attempt(p_profile_id UUID, p_ok BOOLEAN)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_failed INT;
    v_wait   INT := 0;
BEGIN
    -- Griefing guard: your own counter, or the owner's business. An owner
    -- clearing a lockout uses clear_pin_lock; everyone else counts only
    -- attempts made against their own sign-in.
    IF auth.uid() IS DISTINCT FROM p_profile_id
       AND current_role_of_user() IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'You may only record a PIN attempt for your own sign-in';
    END IF;

    IF p_ok THEN
        UPDATE public.profiles
           SET pin_failed_count = 0,
               pin_locked_until = NULL,
               pin_last_used_at = now()
         WHERE id = p_profile_id;
        RETURN 0;
    END IF;

    UPDATE public.profiles
       SET pin_failed_count = pin_failed_count + 1
     WHERE id = p_profile_id
    RETURNING pin_failed_count INTO v_failed;

    IF v_failed IS NULL THEN
        RETURN 0;
    END IF;

    -- Three free misses, because a keypad in a busy shop gets mistyped. After
    -- that the wait doubles: 5s, 10s, 20s ... capped at five minutes. Twenty
    -- wrong guesses already costs well over an hour, which puts the full 10,000
    -- out of reach without ever locking a real cashier out for long.
    IF v_failed > 3 THEN
        -- Exponent clamped, not the result: 5 * 2^6 = 320 is already past
        -- the 300s cap, so anything beyond it is arithmetic that can only
        -- overflow. See migration 023.
        v_wait := LEAST(300, 5 * POWER(2, LEAST(v_failed - 4, 6))::INT);
        UPDATE public.profiles
           SET pin_locked_until = now() + make_interval(secs => v_wait)
         WHERE id = p_profile_id;
    END IF;

    RETURN v_wait;
END;
$$;

REVOKE ALL ON FUNCTION public.register_pin_attempt(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_pin_attempt(UUID, BOOLEAN) TO authenticated;

-- ===== 3. every SECURITY DEFINER function pins its search_path =====
--
-- The 028 catalogue sweep, re-run: any definer created since (or re-created
-- without its pin, which is how the 7-argument create_credit_note lost it in
-- the exchange migration) gets SET search_path = public. An unpinned definer
-- resolves unqualified names — including current_role_of_user()''s `profiles`
-- lookup, which every RLS policy depends on — against the CALLER''s
-- search_path, so a caller-supplied table can impersonate the real one.
DO $$
DECLARE
    r RECORD;
    v_count INT := 0;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
          FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.prosecdef
           AND (p.proconfig IS NULL OR NOT (p.proconfig::text LIKE '%search_path%'))
    LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
        v_count := v_count + 1;
    END LOOP;

    RAISE NOTICE '043 pinned search_path on % definer function(s)', v_count;
END;
$$;

-- The one the sweep cannot reach on a fresh database: the 7-argument
-- create_credit_note is (re)created WITHOUT search_path by the exchange
-- migration, which runs AFTER this file in filename order. A DO block with a
-- catalogue guard, so a fresh database — where it does not exist yet —
-- applies cleanly; the sweep above covers the live database, and this block
-- states the requirement where a reviewer will look for it.
--
-- Written as a guard rather than ALTER FUNCTION IF EXISTS ... SET because
-- Postgres rejects IF EXISTS on the SET action (syntax error at EXISTS);
-- the to_regprocedure lookup below is the same idiom section 4 uses.
DO $$
DECLARE
    v_oid OID;
BEGIN
    SELECT to_regprocedure(
        'public.create_credit_note(bigint, int, uuid, text, text, jsonb, boolean)'
    ) INTO v_oid;

    -- Fresh database: the exchange migration that creates this function runs
    -- after this file. Skip cleanly — nothing exists to pin yet.
    IF v_oid IS NULL THEN
        RAISE NOTICE '043: create_credit_note (7-arg) not present yet — skipping search_path pin';
        RETURN;
    END IF;

    EXECUTE format('ALTER FUNCTION %s SET search_path = public', v_oid::regprocedure);
END;
$$;

-- ===== 4. complete_sale_keyed_at_policy: untrusted money, verified inside =====
--
-- THE HOLE. The RPC takes unit_price per line and a payment split, and trusts
-- both. TypeScript re-prices every line and demands payments equal the total —
-- but a caller reaching PostgREST directly skips all of that and can ring up
-- anything at any price. Validation that lives only in the app is a suggestion
-- to anyone who does not use the app.
--
-- THE FIX (kept narrow on purpose). EXECUTE stays with `authenticated` — the
-- tills call this through their own sessions, and revoking it would stop the
-- shop trading. What changes is that the totals are re-checked HERE, where
-- they cannot be skipped: payments must equal the computed total, and every
-- catalogue line''s unit_price must still match its variant''s selling_price.
-- (028 precedent: patched in place with a blind-patch guard, not restated.)
DO $$
DECLARE
    v_sig  TEXT := 'public.complete_sale_keyed_at_policy(text, integer, integer, uuid, numeric, jsonb, jsonb, jsonb, bigint, timestamptz)';
    v_oid  OID;
    v_def  TEXT;
    v_old  TEXT := '    insert into public.sales (';
    v_guard TEXT :=
'    -- 043: money the app settled is re-checked where it cannot be skipped.' || chr(10) ||
'    -- A direct PostgREST caller skips sale-core''s re-pricing and tender' || chr(10) ||
'    -- checks, so the RPC enforces both itself: payments equal the total,' || chr(10) ||
'    -- and every catalogue line still carries its variant''s price.' || chr(10) ||
'    <<sale_totals_guard_043>> DECLARE' || chr(10) ||
'        v_paid_043   numeric := 0;' || chr(10) ||
'        v_chk_043    jsonb;' || chr(10) ||
'        v_price_043  numeric;' || chr(10) ||
'        v_active_043 boolean;' || chr(10) ||
'    BEGIN' || chr(10) ||
'        FOR v_chk_043 IN SELECT * FROM pg_catalog.jsonb_array_elements(coalesce(p_payments, ''[]''::jsonb)) LOOP' || chr(10) ||
'            v_paid_043 := v_paid_043 + coalesce((v_chk_043->>''amount'')::numeric, 0);' || chr(10) ||
'        END LOOP;' || chr(10) ||
'        IF pg_catalog.abs(v_paid_043 - v_total) > 0.01 THEN' || chr(10) ||
'            RAISE check_violation USING MESSAGE = ''Payments do not match the sale total — recheck the cart'';' || chr(10) ||
'        END IF;' || chr(10) ||
'        FOR v_chk_043 IN SELECT * FROM pg_catalog.jsonb_array_elements(coalesce(p_items, ''[]''::jsonb)) LOOP' || chr(10) ||
'            -- A custom line (gift wrap, alteration) has no catalogue row;' || chr(10) ||
'            -- its price needs a manager in sale-core, not a lookup here.' || chr(10) ||
'            IF (v_chk_043->>''variant_id'') IS NULL THEN' || chr(10) ||
'                CONTINUE;' || chr(10) ||
'            END IF;' || chr(10) ||
'            IF coalesce((v_chk_043->>''qty'')::integer, 0) <= 0 THEN' || chr(10) ||
'                RAISE check_violation USING MESSAGE = ''A sale line needs a positive quantity'';' || chr(10) ||
'            END IF;' || chr(10) ||
'            SELECT selling_price, is_active INTO v_price_043, v_active_043' || chr(10) ||
'              FROM public.product_variants WHERE id = (v_chk_043->>''variant_id'')::integer;' || chr(10) ||
'            IF NOT FOUND THEN' || chr(10) ||
'                RAISE check_violation USING MESSAGE = ''An item in the cart no longer exists — clear it and rescan'';' || chr(10) ||
'            END IF;' || chr(10) ||
'            IF NOT coalesce(v_active_043, FALSE) THEN' || chr(10) ||
'                RAISE check_violation USING MESSAGE = ''An item in the cart has been retired and cannot be sold'';' || chr(10) ||
'            END IF;' || chr(10) ||
'            IF pg_catalog.abs(v_price_043 - (v_chk_043->>''unit_price'')::numeric) > 0.01 THEN' || chr(10) ||
'                RAISE check_violation USING MESSAGE = ''A price changed while the sale was being rung up — recheck the cart'';' || chr(10) ||
'            END IF;' || chr(10) ||
'        END LOOP;' || chr(10) ||
'    END;' || chr(10);
BEGIN
    SELECT to_regprocedure(v_sig) INTO v_oid;

    -- Fresh database: the VAT migration that creates this function runs after
    -- this file. Skip cleanly — nothing exists to guard yet.
    IF v_oid IS NULL THEN
        RAISE NOTICE '043: complete_sale_keyed_at_policy not present yet — skipping totals guard';
        RETURN;
    END IF;

    -- Belt and braces with the VAT migration''s own grants: the publishable
    -- key with no session must never reach the till''s write path (035).
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', v_oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_oid::regprocedure);

    SELECT replace(pg_get_functiondef(v_oid), chr(13) || chr(10), chr(10)) INTO v_def;

    IF position('sale_totals_guard_043' IN v_def) > 0 THEN
        RAISE NOTICE '043: totals guard already present — leaving it alone';
        RETURN;
    END IF;

    IF position(v_old IN v_def) = 0
       OR position('v_total := v_subtotal - coalesce(p_discount, 0);' IN v_def) = 0 THEN
        RAISE EXCEPTION 'complete_sale_keyed_at_policy does not look as expected — refusing to patch blind';
    END IF;

    v_def := replace(v_def, v_old, v_guard || v_old);
    EXECUTE v_def;
END;
$$;

COMMENT ON FUNCTION
    public.complete_sale_keyed_at_policy(TEXT, INTEGER, INTEGER, UUID, NUMERIC, JSONB, JSONB, JSONB, BIGINT, TIMESTAMPTZ)
    IS 'The till''s write path. Re-checks payments == total and catalogue '
       'prices inside the transaction (043), so a caller reaching PostgREST '
       'directly cannot ring up arbitrary prices. EXECUTE stays with '
       'authenticated — the tills call it as themselves — and is revoked '
       'from anon/PUBLIC.';

-- ===== 5. stock vocabulary: transfers get distinct types; counts go atomic =====
--
-- Transfers used to write movement_type = ''adjustment'' with
-- reference_type = ''transfer'' — indistinguishable from a stock-take
-- correction in every movement_type filter, so a location-to-location move
-- read as a gain or a loss. ''transfer_in'' / ''transfer_out'' join the
-- vocabulary; transfer_stock keeps writing its matched adjustment pair (with
-- reference_type ''transfer'') so running reports and the pre-registry ledger
-- do not change shape under this migration — the new types reserve the
-- distinct accounting going forward.
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN
    ('purchase', 'sale', 'adjustment', 'return', 'opening', 'import',
     'deposit_reserve', 'deposit_release', 'transfer_in', 'transfer_out'));

COMMENT ON CONSTRAINT stock_movements_movement_type_check ON public.stock_movements IS
  'transfer_in/transfer_out (043): location-to-location moves, distinct from '
  'adjustment (stock-take corrections). transfer_stock still writes its '
  'matched adjustment pair with reference_type ''transfer''; the new types '
  'are the distinct vocabulary for going forward.';

-- Atomic stock-take: lock the variant row, read the count, write the delta in
-- one transaction, so two simultaneous counts (or a count racing a sale)
-- serialise instead of overwriting each other. Identical to migration 045''s
-- definition so the two apply in either order; 045 remains canonical.
-- (The previous read-then-write in lib/stock/actions.ts is what this closes.)
CREATE OR REPLACE FUNCTION public.record_stock_count(
    p_variant_id INT,
    p_counted_qty INT,
    p_reason TEXT DEFAULT NULL
) RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_current INT;
    v_delta   INT;
BEGIN
    IF p_counted_qty IS NULL OR p_counted_qty < 0 THEN
        RAISE EXCEPTION 'A counted quantity cannot be negative';
    END IF;
    IF p_counted_qty > 1000000 THEN
        RAISE EXCEPTION 'That quantity is unrealistically large';
    END IF;
    IF coalesce(btrim(p_reason), '') = '' OR length(btrim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'Give a reason — this is the only record of why the count changed';
    END IF;

    -- Row lock: concurrent counts of THIS variant serialise here.
    SELECT qty_on_hand INTO v_current
      FROM public.product_variants
     WHERE id = p_variant_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'That variant no longer exists.';
    END IF;

    v_delta := p_counted_qty - v_current;

    -- No movement for a no-op count. The caller reports "already matches"
    -- from this zero rather than writing a zero-qty ledger line.
    IF v_delta = 0 THEN
        RETURN 0;
    END IF;

    -- The single writer of qty_on_hand. The 009 non-negative CHECK still
    -- guards the floor: a concurrent sale that lands between the user''s read
    -- and this call surfaces as 23514, which the caller maps to "recount".
    PERFORM public.record_stock_movement(
        p_variant_id, 'adjustment', v_delta,
        'manual_adjustment', NULL, btrim(p_reason));

    RETURN v_delta;
END;
$$;

REVOKE ALL ON FUNCTION public.record_stock_count(INT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_count(INT, INT, TEXT) TO authenticated;
