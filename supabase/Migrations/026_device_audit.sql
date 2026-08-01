-- ============================================================
-- Kids Corner — migration 026: audit events know which till
--
-- The till page's Traceability tab reads the ledgers a sale leaves behind, so
-- payments, refunds and cash movements already reach the right device through
-- sale → shift → device. Four kinds of event never touch a sale and so never
-- reach any device: a terminal starting, an app version changing, an operator
-- signing in, a till being retired or restored. Carfectionist shows all four,
-- and until now Kids Corner could not attribute them without guessing.
--
-- The fix is a `device_id` on audit_events, filled at the moment each event is
-- recorded — by the registration RPC, which knows the device because the
-- device is announcing itself; by the PIN check, which is told the device by
-- the till asking; and by a trigger on pos_devices, which sees a retire from
-- any direction including the SQL editor.
--
-- Old events keep a NULL device_id. They happened before the shop recorded
-- which till, and backfilling would invent facts — the same rule shifts took
-- in migration 025.
--
-- Migrations 001–025 are untouched.
-- ============================================================

ALTER TABLE audit_events
    ADD COLUMN IF NOT EXISTS device_id INT REFERENCES pos_devices(id);

CREATE INDEX IF NOT EXISTS idx_audit_events_device
    ON audit_events (device_id, at DESC);

COMMENT ON COLUMN audit_events.device_id IS
    'The till this happened at, when the recorder knew. Null for events that '
    'predate migration 026 and for changes that are not about any till.';

-- ===== log_audit learns the device =====
--
-- Dropped and recreated rather than overloaded: an overload would leave the
-- old five-argument function in place, and every existing call site would then
-- match BOTH signatures and fail as ambiguous. The 016 triggers keep working —
-- their five-argument calls now resolve through the default.

DROP FUNCTION IF EXISTS log_audit(TEXT, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION log_audit(
    p_event_type TEXT,
    p_ref_type   TEXT,
    p_ref_id     TEXT,
    p_summary    TEXT,
    p_detail     JSONB DEFAULT '{}'::jsonb,
    p_device_id  INT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO audit_events (actor_id, event_type, ref_type, ref_id, summary, detail, device_id)
    VALUES (auth.uid(), p_event_type, p_ref_type, p_ref_id, p_summary, p_detail, p_device_id);
END;
$$;

REVOKE ALL ON FUNCTION log_audit(TEXT, TEXT, TEXT, TEXT, JSONB, INT) FROM PUBLIC;
-- Callable by signed-in staff: the PIN check runs as the till's session, not as
-- a service role. The function only ever writes auth.uid() as the actor, so a
-- caller can not impersonate anybody — the worst a hostile session can do is
-- write a noisy event under its own name, which is what an audit trail is for.
GRANT EXECUTE ON FUNCTION log_audit(TEXT, TEXT, TEXT, TEXT, JSONB, INT) TO authenticated;

-- ===== registration events =====
--
-- Same contract as before — insert on first sight, touch last_seen_at after —
-- plus three events Carfectionist's Traceability shows:
--
--   till_registered      first time this code is ever seen
--   terminal_started     checked in after more than half an hour away; the
--                        bootstrap IS the app starting, but a flaky network
--                        re-bootstrapping all day must not fill the feed
--   app_version_changed  the tablet came back running something else
--
-- All three carry the device id by construction.

CREATE OR REPLACE FUNCTION register_pos_device(
    p_code TEXT,
    p_model TEXT DEFAULT NULL,
    p_app_version TEXT DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id       INT;
    v_existing BOOLEAN;
    v_old_seen TIMESTAMPTZ;
    v_old_ver  TEXT;
    v_name     TEXT;
    v_ver      TEXT := nullif(trim(p_app_version), '');
BEGIN
    IF coalesce(trim(p_code), '') = '' THEN
        RAISE EXCEPTION 'A device needs a code';
    END IF;

    -- Read what was known before the write, so the events below can compare.
    -- FOR UPDATE so two racing bootstraps from the same tablet serialise here
    -- rather than both deciding the other's changes are news.
    SELECT id, last_seen_at, app_version INTO v_id, v_old_seen, v_old_ver
      FROM pos_devices WHERE code = trim(p_code)
      FOR UPDATE;
    v_existing := FOUND;

    INSERT INTO pos_devices (code, name, model, app_version, last_seen_at)
    VALUES (
        trim(p_code),
        -- A name only on FIRST sight. After that the owner's name wins, and a
        -- reinstall reporting its model again must not overwrite it.
        coalesce(nullif(trim(p_model), ''), 'New till'),
        nullif(trim(p_model), ''),
        v_ver,
        now()
    )
    ON CONFLICT (code) DO UPDATE
        SET last_seen_at = now(),
            model       = coalesce(nullif(trim(p_model), ''), pos_devices.model),
            app_version = coalesce(v_ver, pos_devices.app_version)
    RETURNING id, name INTO v_id, v_name;

    IF NOT v_existing THEN
        PERFORM log_audit(
            'till_registered', 'pos_device', v_id::text,
            v_name || ' registered itself',
            jsonb_strip_nulls(jsonb_build_object('model', nullif(trim(p_model), ''), 'version', v_ver)),
            v_id
        );
    ELSE
        -- A seeded row has no last_seen_at at all; its first check-in is a
        -- start, not a registration.
        IF v_old_seen IS NULL OR now() - v_old_seen > interval '30 minutes' THEN
            PERFORM log_audit(
                'terminal_started', 'pos_device', v_id::text,
                v_name || ' started',
                jsonb_strip_nulls(jsonb_build_object('model', nullif(trim(p_model), ''), 'version', v_ver)),
                v_id
            );
        END IF;
        IF v_ver IS NOT NULL AND v_ver IS DISTINCT FROM v_old_ver THEN
            PERFORM log_audit(
                'app_version_changed', 'pos_device', v_id::text,
                v_name || ' now runs v' || v_ver,
                jsonb_build_object('from', v_old_ver, 'to', v_ver),
                v_id
            );
        END IF;
    END IF;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION register_pos_device(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_pos_device(TEXT, TEXT, TEXT) TO authenticated;

-- ===== retiring and restoring =====
--
-- A trigger rather than a line in the web action, per 016: the app is not the
-- only way in, and a till quietly retired from the SQL editor is precisely the
-- kind of change a trail exists to catch.

CREATE OR REPLACE FUNCTION audit_pos_device_state()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
        PERFORM log_audit(
            CASE WHEN NEW.is_active THEN 'till_restored' ELSE 'till_retired' END,
            'pos_device', NEW.id::text,
            NEW.name || CASE WHEN NEW.is_active THEN ' brought back' ELSE ' retired' END,
            '{}'::jsonb,
            NEW.id
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_device_state ON pos_devices;
CREATE TRIGGER trg_pos_device_state
    AFTER UPDATE ON pos_devices
    FOR EACH ROW EXECUTE FUNCTION audit_pos_device_state();
