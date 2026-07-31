-- ============================================================
-- Kids Corner — migration 008: atomic barcode scheme updates
--
-- WHY THIS EXISTS.
--
-- 007 made *allocation* atomic but left *configuration* racy. Saving the
-- barcode scheme used to read the counter in one round trip and write it in
-- another, with the "you cannot wind this back" check sitting in JavaScript
-- between the two. An allocation landing in that gap was silently rolled back,
-- and the shop would then re-issue serials that were already printed on labels
-- and stuck to stock. `barcode` is UNIQUE, so the damage shows up later as an
-- insert failure on a variant that did nothing wrong.
--
-- The fix is to do the read, the check and the write in one transaction that
-- holds a lock on the counter row. SELECT ... FOR UPDATE takes the same row
-- lock allocate_barcode_serials takes when it UPDATEs, so the two now queue
-- behind each other instead of interleaving.
--
-- RETURNS the counter in force after the call, rather than raising on a
-- rewind. The caller compares it with what it asked for: equal means saved,
-- greater means refused — and the number returned is exactly what the error
-- message needs to say. That avoids parsing an exception string to recover it.
--
-- Migrations 001-007 are untouched.
-- ============================================================

CREATE OR REPLACE FUNCTION set_barcode_scheme(
    p_auto   BOOLEAN,
    p_prefix TEXT,
    p_next   INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current INT;
BEGIN
    -- Mirrors the owner-only RLS policy on `settings`, which SECURITY DEFINER
    -- has just stepped around.
    IF current_role_of_user() <> 'owner' THEN
        RAISE EXCEPTION 'Only the owner can change the barcode scheme';
    END IF;

    -- The prefix has to leave at least three digits for the serial, matching
    -- prefixProblem() in lib/barcodes/ean13.ts. Checked here too: this function
    -- is reachable from any authenticated client, not only through that form.
    IF p_prefix IS NULL OR p_prefix !~ '^[0-9]{1,9}$' THEN
        RAISE EXCEPTION 'The shop prefix must be 1 to 9 digits';
    END IF;

    IF p_next IS NULL OR p_next < 0 THEN
        RAISE EXCEPTION 'The next number cannot be negative';
    END IF;

    -- Locks the counter row for the rest of this transaction. Any concurrent
    -- allocate_barcode_serials blocks here rather than slipping between the
    -- read below and the write further down.
    SELECT (value #>> '{}')::INT INTO v_current
      FROM settings
     WHERE key = 'barcode_next'
       FOR UPDATE;

    IF v_current IS NULL THEN
        RAISE EXCEPTION 'The barcode_next setting is missing — re-run migration 007';
    END IF;

    -- Refused, and nothing is written: auto and prefix are not saved either, so
    -- the form comes back exactly as the shop left it rather than half-applied.
    IF p_next < v_current THEN
        RETURN v_current;
    END IF;

    UPDATE settings SET value = to_jsonb(p_next)   WHERE key = 'barcode_next';
    UPDATE settings SET value = to_jsonb(p_prefix) WHERE key = 'barcode_prefix';
    UPDATE settings SET value = to_jsonb(p_auto)   WHERE key = 'barcode_auto';

    RETURN p_next;
END;
$$;

REVOKE ALL ON FUNCTION set_barcode_scheme(BOOLEAN, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_barcode_scheme(BOOLEAN, TEXT, INT) TO authenticated;
