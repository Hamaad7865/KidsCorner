-- ============================================================
-- Kids Corner — migration 048: till diagnostic logs
--
-- THE NEED. A misbehaving shop-floor tablet cannot plug into USB and has no
-- developer options worth mentioning. The till's Settings screen offers
-- "Send diagnostic log", which POSTs the device's own logcat here through
-- /api/till/diagnostics — so support reads the failure in the back office
-- (or straight SQL) instead of playing telephone with symptoms.
--
-- SHAPE. Append-only: devices write, nobody updates or deletes. device_id is
-- deliberately NOT a foreign key — a log must survive the device row being
-- re-registered or removed, since that is exactly when logs matter most.
-- The log body is capped both here (100k) and on the device (50k), so a
-- runaway logger cannot grow this table without bound.
--
-- PRIVACY. A logcat holds the app's own lines: screen transitions, focus
-- traces, network errors, PIN-lockout counters — never PINs, tokens, or
-- card numbers, none of which the app logs. Authenticated staff may read;
-- the publishable key with no session may do nothing (035 precedent).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.till_diagnostics (
    id            BIGSERIAL PRIMARY KEY,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    device_id     INTEGER NULL,
    app_version   TEXT NOT NULL DEFAULT '',
    device_model  TEXT NOT NULL DEFAULT '',
    android_release TEXT NOT NULL DEFAULT '',
    log           TEXT NOT NULL DEFAULT '' CHECK (char_length(log) <= 100000)
);

ALTER TABLE public.till_diagnostics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS write_own ON public.till_diagnostics;
CREATE POLICY write_own ON public.till_diagnostics
    FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS read_all ON public.till_diagnostics;
CREATE POLICY read_all ON public.till_diagnostics
    FOR SELECT TO authenticated
    USING (true);

REVOKE ALL ON TABLE public.till_diagnostics FROM anon, PUBLIC;

COMMENT ON TABLE public.till_diagnostics IS
    'Append-only device logs sent by the till itself (Settings → Send '
    'diagnostic log). Read them newest-first when a tablet misbehaves.';
