-- ============================================================
-- Kids Corner — migration 035: the publishable key could run the shop
--
-- Migrations 001-034 are untouched.
-- ============================================================
--
-- Supabase grants EXECUTE on everything in `public` to `anon` and
-- `authenticated` by default. Thirty-three of this schema's functions are
-- SECURITY DEFINER, which means they run as their owner and row-level security
-- does not apply to what they touch. The two together hand the `anon` role a
-- set of keys to the shop.
--
-- `anon` is not a hypothetical attacker. It is the role the PUBLISHABLE KEY
-- maps to — the key that ships in the web bundle, sits in `.env.local` under
-- NEXT_PUBLIC_, and is compiled into the Android APK as a BuildConfig field.
-- It is public by design and by construction.
--
-- Confirmed by execution, not by reading the source. As `anon`:
--
--   daily_summary(...)   returned the shop's takings, day by day, with VAT
--   z_totals(...)        returned a shift's full Z: totals and VAT breakdown
--   shift_totals(...)    returned takings by payment method and by cashier
--   complete_sale(...)   ACCEPTED A WRITE and returned a new sale id
--
-- That last one is the serious one. Anybody holding a key that is meant to be
-- public could ring up sales in this shop's ledger.
--
-- Nothing in the app needs any of it. Every call site is server-side under a
-- signed-in session, and the Android till reaches the database through
-- /api/till/* with a bearer token that resolves to an authenticated session —
-- it never calls an RPC directly. So `anon` can lose EXECUTE entirely.
--
-- Trigger functions lose it too, and keep working: a trigger fires as part of
-- the statement under the table owner's rights and never consults the calling
-- role's EXECUTE privilege. That is asserted by test, not assumed.

DO $$
DECLARE
    fn RECORD;
    n  INT := 0;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS sig
          FROM pg_proc p
          JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public'
    LOOP
        -- PUBLIC as well as anon: PUBLIC includes anon, so revoking only the
        -- named role would leave the grant reachable through the other.
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', fn.sig);
        n := n + 1;
    END LOOP;
    RAISE NOTICE 'revoked EXECUTE from anon/PUBLIC on % functions', n;
END;
$$;

-- Newly created functions would otherwise inherit the default grant again.
-- This only binds functions created by the role that runs this migration, so
-- it is a guard rather than a guarantee — the check in 035's verification
-- script is what should be re-run after any migration that adds a function.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;

-- `authenticated` keeps everything it had. Every guard that already existed —
-- the owner-only checks inside `clear_pin_lock`, the role checks in RLS — is
-- unchanged and still doing its job. This closes the door that was never meant
-- to be open; it does not narrow the one that was.
