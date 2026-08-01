-- ============================================================
-- Kids Corner — migration 028: search_path hardening, drawer locks, Z numbers
--
-- Six defects, found by an adversarial review of the whole schema and
-- confirmed against the live database before this was written.
--
-- Migrations 001-027 are untouched.
-- ============================================================

-- ===== 1. SECURITY DEFINER without SET search_path =====
--
-- Eleven definer functions inherited the CALLER's search_path. The worst is
-- current_role_of_user(), because every RLS policy in the schema resolves
-- through it: a cashier could create a temp table called `profiles` holding a
-- row that claims they are the owner, put pg_temp first on their search_path,
-- and the definer function would read the fake table and agree. That defeats
-- `manage ON settings` and `manage_profiles` — VAT rate and staff roles.
--
-- ALTER rather than CREATE OR REPLACE: it pins the setting without restating
-- a single line of any body, so every money function is hardened with no
-- opportunity to mistype one of them.
--
-- Driven off pg_proc rather than a hand-written list of signatures. Argument
-- lists have shifted across twenty-seven migrations — `discount_report` alone
-- no longer takes the (DATE, DATE) an earlier file gave it — and a list that
-- has drifted fails loudly on the names it still knows while silently leaving
-- the renamed ones unpinned. Asking the catalogue cannot drift.
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

    RAISE NOTICE 'pinned search_path on % definer function(s)', v_count;
END;
$$;

-- ===== 2. shifts was writable by any signed-in session =====
--
-- `manage_shifts FOR ALL TO authenticated USING (true)` — with no WITH CHECK,
-- so INSERT, UPDATE and DELETE were all open. A cashier could rewrite
-- counted_cash and variance after close_shift_z froze them (the Z slip would
-- still hold the truth, and the two would disagree), reopen a closed shift, or
-- DELETE it — and z_reports.shift_id is ON DELETE CASCADE, so the fiscal record
-- would go with it.
--
-- INSERT stays open because opening a till is a direct insert from the app and
-- is the one write staff legitimately make; it is now constrained to opening a
-- shift in your OWN name. UPDATE and DELETE get no policy at all, which leaves
-- close_shift_z — SECURITY DEFINER, and owned by a role that bypasses RLS — as
-- the only way a shift is ever closed.
DROP POLICY IF EXISTS manage_shifts ON shifts;

CREATE POLICY open_own_shift ON shifts
    FOR INSERT TO authenticated
    WITH CHECK (opened_by = auth.uid());

COMMENT ON TABLE shifts IS
    'Till sessions. INSERT by the person opening; UPDATE and DELETE only '
    'through close_shift_z, which is SECURITY DEFINER. A shift that staff '
    'could edit after its Z was frozen would make the Z unfalsifiable.';

-- ===== 3. two tills could open two shifts on the same device =====
--
-- openShiftFor SELECTs for an open shift and then INSERTs, with no lock. Two
-- opens in the same second both see nothing and both insert; sales then land in
-- whichever the query happens to return first, and at night each Z reconciles
-- against half the cash in one physical drawer.
--
-- Enforced in the database because that is the only place the check cannot be
-- raced. coalesce(device_id, -1) so the pre-registry shifts — all of which
-- carry NULL — count as one till rather than as unlimited distinct ones, which
-- is what a bare partial index on a nullable column would have allowed.
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_per_device
    ON shifts (coalesce(device_id, -1))
    WHERE closed_at IS NULL;

-- ===== 4. the drawer floor was computed without a lock =====
--
-- Found independently by two reviewers. record_till_movement reads closed_at
-- and the float, sums cash and movements, checks the total covers the pay-out,
-- and inserts — all without locking the shift. Drawer holds 500; a cashier
-- takes 400 out at the till while a manager takes 400 out from the back office;
-- both compute 500 available, both pass, the drawer is at -300. The ledger is
-- append-only, so it cannot even be corrected — only annotated.
--
-- The FOR UPDATE also stops a movement landing in a shift that close_shift_z is
-- concurrently freezing, which would leave the frozen Z disagreeing with the
-- movement ledger beneath it.
DO $$
DECLARE
    v_def TEXT;
BEGIN
    -- Normalised to LF via chr(): migrations authored on Windows left CRLF
    -- inside the stored bodies, so an LF-anchored marker silently finds
    -- nothing and the guard below would abort a patch that is in fact needed.
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'record_till_movement' AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL OR position('FROM shifts WHERE id = p_shift_id;' IN v_def) = 0 THEN
        RAISE EXCEPTION 'record_till_movement does not look as expected — refusing to patch blind';
    END IF;

    -- Patching the live definition text rather than restating the body, so
    -- everything except the lock is byte-for-byte what ran before.
    v_def := replace(v_def,
        'FROM shifts WHERE id = p_shift_id;',
        'FROM shifts WHERE id = p_shift_id FOR UPDATE;');

    EXECUTE v_def;
END;
$$;

-- ===== 5. concurrent refunds of one sale could exceed what was paid =====
--
-- create_credit_note asks returned_qty() how much of a line has already come
-- back and refuses to exceed it — but nothing locks the sale, so two refunds of
-- the same line both read zero returned and both proceed. The customer is paid
-- twice for one item AND the variant is restocked twice, so stock gains a unit
-- that never came back through the door.
--
-- Serialised on the sale row: refunds of DIFFERENT sales still run in parallel,
-- which is the only concurrency a shop actually has.
DO $$
DECLARE
    v_def TEXT;
    v_marker TEXT := 'BEGIN' || chr(10);
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'create_credit_note' AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL OR position(v_marker IN v_def) = 0 THEN
        RAISE EXCEPTION 'create_credit_note does not look as expected — refusing to patch blind';
    END IF;

    IF position('FOR UPDATE' IN v_def) > 0 THEN
        RAISE NOTICE 'create_credit_note already locks — leaving it alone';
    ELSE
        v_def := overlay(
            v_def PLACING
                'BEGIN' || chr(10)
                || '    -- Serialise refunds of THIS sale: the already-returned check' || chr(10)
                || '    -- below is check-then-act, so two tills refunding one line would' || chr(10)
                || '    -- both see nothing returned, pay the customer twice, and restock' || chr(10)
                || '    -- the item twice.' || chr(10)
                || '    PERFORM 1 FROM sales WHERE id = p_sale_id FOR UPDATE;' || chr(10)
            FROM position(v_marker IN v_def)
            FOR length(v_marker));
        EXECUTE v_def;
    END IF;
END;
$$;

-- ===== 6. Z numbers came from count(*) and were not unique =====
--
-- `'Z' || lpad(count(*) + 1)` over z_reports, with uniqueness only on shift_id.
-- Two managers closing different tills at the same moment both count 40 and
-- both write Z00041 — two shifts carrying one fiscal number, and both inserts
-- succeed. 027 built exactly the machinery for this and seeded only sales and
-- credit notes, so the Z path kept the old scheme.
-- The CHECK is widened FIRST: 027 wrote it as ('sale','credit'), so seeding
-- the Z counter before this point violates it.
ALTER TABLE doc_counters DROP CONSTRAINT IF EXISTS doc_counters_kind_check;
ALTER TABLE doc_counters ADD CONSTRAINT doc_counters_kind_check
    CHECK (kind IN ('sale', 'credit', 'z'));

-- Seeded at the highest Z already printed on a slip, so no number is re-issued.
INSERT INTO doc_counters (kind, day, n)
SELECT 'z', 'all', coalesce(max((regexp_replace(z_no, '\D', '', 'g'))::int), 0)
  FROM z_reports
 WHERE z_no ~ '^Z[0-9]+$'
ON CONFLICT (kind, day) DO NOTHING;

INSERT INTO doc_counters (kind, day, n)
SELECT 'z', 'all', 0
 WHERE NOT EXISTS (SELECT 1 FROM doc_counters WHERE kind = 'z' AND day = 'all');

-- A Z is one continuous series for the shop's life, not per day, so it keeps a
-- single counter row under the fixed key 'all'.
CREATE OR REPLACE FUNCTION next_z_no()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_n INT;
BEGIN
    INSERT INTO doc_counters AS c (kind, day, n) VALUES ('z', 'all', 1)
    ON CONFLICT (kind, day) DO UPDATE SET n = c.n + 1
    RETURNING n INTO v_n;

    RETURN 'Z' || lpad(v_n::TEXT, 5, '0');
END;
$$;

REVOKE ALL ON FUNCTION next_z_no() FROM PUBLIC;

CREATE UNIQUE INDEX IF NOT EXISTS z_reports_z_no_unique ON z_reports (z_no);

DO $$
DECLARE
    v_def TEXT;
    v_old TEXT := 'SELECT ''Z'' || lpad((count(*) + 1)::TEXT, 5, ''0'') INTO v_z_no FROM z_reports;';
BEGIN
    SELECT replace(pg_get_functiondef(oid), chr(13) || chr(10), chr(10)) INTO v_def
      FROM pg_proc
     WHERE proname = 'close_shift_z' AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'close_shift_z does not look as expected — refusing to patch blind';
    END IF;

    v_def := replace(v_def, v_old, 'v_z_no := next_z_no();');
    EXECUTE v_def;
END;
$$;
