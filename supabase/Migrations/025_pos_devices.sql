-- A registry of the tills.
--
-- The back office needs to talk about tills as things the owner has named —
-- "Counter", "Upstairs", "Back office" — not as anonymous shifts. Without a
-- registry the only handle on a till is whoever happened to open it, which is
-- the wrong axis: a shop wants to know that the counter till is short, not that
-- Priya is.
--
-- HOW A DEVICE GETS HERE
--
-- It registers itself. The Android till already calls `/api/till/bootstrap`
-- before it can draw anything, so it announces its own id there and a row
-- appears. The owner then renames it in the back office.
--
-- The alternative — the owner creates a row, reads a code off the screen and
-- types it into the tablet — puts a setup step between a shop and a working
-- till, and gets skipped or mistyped. A till that shows up as "New till"
-- waiting for a name is a smaller problem than one that will not start.

CREATE TABLE IF NOT EXISTS pos_devices (
    id            SERIAL PRIMARY KEY,

    -- Stable per install. The Android till generates one on first run and
    -- keeps it; the web back office uses the fixed code below.
    code          TEXT NOT NULL UNIQUE,

    -- What the owner calls it. Seeded from the platform so a new till is
    -- identifiable before anybody renames it.
    name          TEXT NOT NULL,

    -- Reported by the device: "SM-X406B", "Web". Never edited by hand — it is
    -- evidence about the hardware, not a label.
    model         TEXT,
    app_version   TEXT,

    /* The web till is not a device anyone can pick up, and it cannot be
       deactivated or go offline. Flagged so the UI can say so rather than
       showing a meaningless "last seen". */
    is_back_office BOOLEAN NOT NULL DEFAULT FALSE,

    -- Touched on every bootstrap. "Online" is derived from this, not stored:
    -- a stored flag is wrong the moment a tablet loses power.
    last_seen_at  TIMESTAMPTZ,

    -- Retired rather than deleted. A device's shifts and their variances stay
    -- attributable to it forever.
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pos_devices IS
    'Tills the shop has registered. Devices self-register on bootstrap; the '
    'owner renames them. Retired with is_active, never deleted.';

CREATE INDEX IF NOT EXISTS idx_pos_devices_active
    ON pos_devices (is_active, name);

-- ===== which till a shift was opened on =====
--
-- Nullable, and deliberately so: every shift already in the table predates the
-- registry and there is no honest way to say which till it was. Backfilling
-- them to "the counter" would invent a fact. They read as "—" instead.

ALTER TABLE shifts
    ADD COLUMN IF NOT EXISTS device_id INT REFERENCES pos_devices(id);

CREATE INDEX IF NOT EXISTS idx_shifts_device ON shifts (device_id, opened_at DESC);

COMMENT ON COLUMN shifts.device_id IS
    'The till this shift was opened on. Null for shifts that predate the '
    'device registry — not backfilled, because the answer is unknown.';

-- ===== the web back office till =====
--
-- Fixed code, seeded once. The web till is always present and cannot register
-- itself the way a tablet does, because it has no install to generate an id.

INSERT INTO pos_devices (code, name, model, is_back_office, is_active)
VALUES ('back-office', 'Back office (web)', 'Web', TRUE, TRUE)
ON CONFLICT (code) DO NOTHING;

-- ===== access =====

ALTER TABLE pos_devices ENABLE ROW LEVEL SECURITY;

-- Readable by any signed-in staff member: the till itself has to look itself
-- up on bootstrap, and the back office lists them.
DROP POLICY IF EXISTS read_pos_devices ON pos_devices;
CREATE POLICY read_pos_devices ON pos_devices
    FOR SELECT TO authenticated USING (true);

-- Registering and touching `last_seen_at` happens through the RPC below, which
-- is SECURITY DEFINER. Renaming and retiring are owner/manager work and go
-- through the same role check the rest of the back office uses.
DROP POLICY IF EXISTS write_pos_devices ON pos_devices;
CREATE POLICY write_pos_devices ON pos_devices
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND p.is_active
              AND p.role IN ('owner', 'manager')
        )
    );

-- ===== register / heartbeat =====
--
-- One call, done on every bootstrap. Inserts on first sight and touches
-- `last_seen_at` after that, so "online" is a question about recency rather
-- than a flag somebody has to remember to clear.

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
    v_id INT;
BEGIN
    IF coalesce(trim(p_code), '') = '' THEN
        RAISE EXCEPTION 'A device needs a code';
    END IF;

    INSERT INTO pos_devices (code, name, model, app_version, last_seen_at)
    VALUES (
        trim(p_code),
        -- A name only on FIRST sight. After that the owner's name wins, and a
        -- reinstall reporting its model again must not overwrite it.
        coalesce(nullif(trim(p_model), ''), 'New till'),
        nullif(trim(p_model), ''),
        nullif(trim(p_app_version), ''),
        now()
    )
    ON CONFLICT (code) DO UPDATE
        SET last_seen_at = now(),
            model       = coalesce(nullif(trim(p_model), ''), pos_devices.model),
            app_version = coalesce(nullif(trim(p_app_version), ''), pos_devices.app_version)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION register_pos_device(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_pos_device(TEXT, TEXT, TEXT) TO authenticated;
