-- ============================================================
-- Kids Corner — migration 034: two views were reading past RLS
--
-- Migrations 001-033 are untouched.
-- ============================================================
--
-- A Postgres view runs as its OWNER unless it is created with
-- `security_invoker=on`. These four are owned by `postgres`, so a view without
-- that setting reads its underlying tables with the owner's rights and the
-- caller's row-level security never applies.
--
-- `low_stock_variants` and `stock_by_location` were created with it.
-- `late_sales` and `shift_z_variance` were not.
--
-- The consequence, confirmed rather than theorised: reading as `anon` —
-- the role the PUBLISHABLE KEY maps to, the one shipped in the web bundle and
-- inside the Android APK — returned real rows from `shift_z_variance`. That
-- view carries `z_total` and `actual_total`: the shop's takings, per shift,
-- per day. Anyone holding a key that is public by design could read them.
--
-- `sales` and `z_reports` both restrict SELECT to `authenticated`. The policies
-- were right the whole time; the views walked around them.
--
-- `late_sales` has the same hole and happens to leak nothing today only because
-- no sale has yet landed after a Z. It would start leaking sale numbers and
-- totals the first time one did.
--
-- Setting `security_invoker` does not change what the app sees. Both views are
-- read server-side under an owner or manager session, and the underlying
-- policies grant `authenticated` an unconditional SELECT — so the back office
-- keeps working and `anon` stops getting an answer.

ALTER VIEW late_sales       SET (security_invoker = on);
ALTER VIEW shift_z_variance SET (security_invoker = on);

-- Belt and braces on the write side. These grants are Supabase's blanket
-- default for the public schema, not a decision anybody made. With
-- security_invoker on they are already harmless — a write would meet the
-- caller's own RLS — but a view nobody writes to should not advertise that it
-- can be written to.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON late_sales       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON shift_z_variance FROM anon, authenticated;

COMMENT ON VIEW late_sales IS
    'Sales that arrived after their shift''s Z was frozen. security_invoker=on '
    '(migration 034) so the caller''s RLS applies — without it this view read '
    'sales as the postgres owner and answered the anon key.';

COMMENT ON VIEW shift_z_variance IS
    'What each frozen Z claimed against what its shift actually holds. '
    'security_invoker=on (migration 034): without it this view returned the '
    'shop''s takings to the anon key, which is public by design.';
