-- ============================================================
-- Kids Corner — migration 036: a refund may be made to need a manager
--
-- Migrations 001-035 are untouched.
-- ============================================================
--
-- The shop already demands a manager's PIN before Rs 200 comes off a shirt:
-- `discounts.requires_manager` gates it and `sale_discounts.approved_by`
-- records who said yes. Handing Rs 500 in cash back across the counter needed
-- nobody, and recorded no approver — `credit_notes` had no such column.
--
-- That is the wrong way round. A refund moves more money than a discount, it
-- moves it OUT of the drawer, and a return against a past sale is the oldest
-- till fraud there is. Demonstrated rather than assumed: a profile with
-- role='cashier' called `create_credit_note` and got a credit note back.
--
-- DEFAULT OFF. Whether a cashier may refund unsupervised is the shop's
-- decision, not this migration's — a queue moves faster when it does not need
-- a manager fetched, and plenty of shops choose that. So the capability is
-- built and the switch is left where the owner found it. Nothing about today
-- changes until somebody turns it on in Settings.

-- ===== 1. the switch =====
INSERT INTO settings (key, value)
VALUES ('refund_requires_manager', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ===== 2. who said yes =====
--
-- Nullable, and stays null while the setting is off — an approver column full
-- of the cashier's own id would read like oversight that never happened.
ALTER TABLE credit_notes
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id);

COMMENT ON COLUMN credit_notes.approved_by IS
    'The manager or owner who authorised this refund, when '
    'settings.refund_requires_manager is on. Null otherwise — see migration 036.';

-- ===== 3. the gate, in the function =====
--
-- Enforced HERE and not in the route, for the same reason every other money
-- rule lives in SQL: there are two clients, a browser and an Android till, and
-- a check that lives in one of them is a check the other can be built without.
-- A till that forgets to ask now fails closed.
--
-- The whole rebuild happens inside one block because the definition has to be
-- READ BEFORE THE DROP. `CREATE OR REPLACE` cannot add a parameter — it would
-- define a second function, and a 7-argument call would then match both and
-- fail as ambiguous. The same trap migration 026 hit with `log_audit`.

DO $outer$
DECLARE
    v_def TEXT;
    v_old TEXT;
    v_new TEXT;
BEGIN
    -- Captured from the live function, so every rule already in there — the
    -- FOR UPDATE lock, the already-returned check, the paid factor, migration
    -- 032's cap — survives untouched. Only the signature and the guard differ.
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10))
      INTO v_def
      FROM pg_proc
     WHERE proname = 'create_credit_note'
       AND pronamespace = 'public'::regnamespace
       AND pronargs = 7;

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'the 7-argument create_credit_note was not found';
    END IF;
    IF position('p_approved_by' IN v_def) > 0 THEN
        RAISE NOTICE '036 already applied — leaving create_credit_note alone';
        RETURN;
    END IF;

    -- ---- the signature -------------------------------------------------
    v_old := 'p_restock boolean DEFAULT true)';
    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'signature not as expected — refusing to patch blind';
    END IF;
    v_def := replace(v_def, v_old,
        'p_restock boolean DEFAULT true, p_approved_by uuid DEFAULT NULL)');

    -- ---- the guard -----------------------------------------------------
    -- Placed immediately after the row lock and before anything is read or
    -- written: a refused refund must leave no trace but the refusal.
    v_old := 'PERFORM 1 FROM sales WHERE id = p_sale_id FOR UPDATE;';
    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'lock line not found — refusing to patch blind';
    END IF;

    v_new := v_old || chr(10) || chr(10) ||
        '    -- A manager, only when the shop has asked for one (migration 036).' || chr(10) ||
        '    IF coalesce((SELECT value::text = ''true'' FROM settings' || chr(10) ||
        '                  WHERE key = ''refund_requires_manager''), false) THEN' || chr(10) ||
        '        IF p_approved_by IS NULL THEN' || chr(10) ||
        '            RAISE EXCEPTION ''This shop needs a manager to approve a return'';' || chr(10) ||
        '        END IF;' || chr(10) ||
        '        IF NOT EXISTS (SELECT 1 FROM profiles' || chr(10) ||
        '                        WHERE id = p_approved_by' || chr(10) ||
        '                          AND is_active' || chr(10) ||
        '                          AND role IN (''owner'', ''manager'')) THEN' || chr(10) ||
        '            RAISE EXCEPTION ''Only an owner or a manager can approve a return'';' || chr(10) ||
        '        END IF;' || chr(10) ||
        '    END IF;';
    v_def := replace(v_def, v_old, v_new);

    -- ---- record who it was ---------------------------------------------
    v_old := 'INSERT INTO credit_notes (credit_no, sale_id, shift_id, cashier_id, reason,';
    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'credit_notes insert not found — refusing to patch blind';
    END IF;
    v_def := replace(v_def, v_old,
        'INSERT INTO credit_notes (approved_by, credit_no, sale_id, shift_id, cashier_id, reason,');

    v_old := 'VALUES (' || chr(10) || '        next_doc_no(''credit''),';
    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'credit_notes VALUES not found — refusing to patch blind';
    END IF;
    v_def := replace(v_def, v_old,
        'VALUES (' || chr(10) || '        p_approved_by, next_doc_no(''credit''),');

    -- Only now is the old one safe to remove: everything above is a string.
    DROP FUNCTION create_credit_note(BIGINT, INT, UUID, TEXT, TEXT, JSONB, BOOLEAN);
    EXECUTE v_def;
END;
$outer$;

-- Matching what migration 035 established: nothing public, nothing anonymous.
REVOKE ALL ON FUNCTION create_credit_note(BIGINT, INT, UUID, TEXT, TEXT, JSONB, BOOLEAN, UUID)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_credit_note(BIGINT, INT, UUID, TEXT, TEXT, JSONB, BOOLEAN, UUID)
    TO authenticated;
