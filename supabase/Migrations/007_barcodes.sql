-- ============================================================
-- Kids Corner — migration 007: in-store barcodes
--
-- Every variant should carry a barcode so the till can scan it, but the shop
-- has no barcode source of its own: supplier goods arrive with one printed on,
-- and anything made in-house has nothing. This migration adds the numbering
-- scheme for the second case.
--
-- THREE THINGS WORTH KNOWING.
--
-- 1. THE SCHEME IS EAN-13 with a shop prefix. The default prefix 6291041 sits
--    in the GS1 Mauritius range but is NOT a registered company prefix, so
--    these codes are valid EAN-13 and safe to scan in-store, yet must never be
--    used on goods that leave for another retailer. Supplier barcodes are kept
--    exactly as they come — this only fills the blanks.
--
-- 2. ALLOCATION IS ATOMIC. Two managers adding variants at the same moment must
--    not be handed the same serial: `barcode` is UNIQUE in 001, so a collision
--    is a hard insert failure, not a cosmetic glitch. allocate_barcode_serials
--    reserves a whole block in one UPDATE, whose row lock is held for the
--    statement, so concurrent callers get disjoint ranges.
--
-- 3. IT IS SECURITY DEFINER ON PURPOSE. `settings` is owner-only under the 001
--    RLS policy, but a *manager* creating a product needs a serial. The
--    function is the narrow hole through that: it can only bump one counter,
--    and it returns a number rather than exposing the table.
--
-- Migrations 001-006 are untouched.
-- ============================================================

-- ===== Settings keys =====
-- DO NOTHING on conflict so re-running never resets a shop's live counter back
-- to 1 and starts re-issuing codes it has already printed.
INSERT INTO settings (key, value) VALUES
    ('barcode_auto',   'true'),
    ('barcode_prefix', '"6291041"'),
    ('barcode_next',   '1')
ON CONFLICT (key) DO NOTHING;

-- ===== allocate_barcode_serials =====
-- Reserves `p_count` consecutive serials and returns the FIRST one. The caller
-- builds prefix + serial + check digit; the database only owns the counter.
CREATE OR REPLACE FUNCTION allocate_barcode_serials(p_count INT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_next INT;
BEGIN
    IF p_count IS NULL OR p_count < 1 THEN
        RAISE EXCEPTION 'Ask for at least one barcode';
    END IF;
    -- A sanity ceiling. Nothing legitimate reserves ten thousand codes in one
    -- call, and without it a typo could burn the whole 5-digit serial space.
    IF p_count > 10000 THEN
        RAISE EXCEPTION 'Too many barcodes in one go (limit 10000)';
    END IF;

    -- Only owners and managers create stock. Checked here because SECURITY
    -- DEFINER has just stepped around the RLS policy that would have said so.
    IF current_role_of_user() NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Only an owner or manager can issue barcodes';
    END IF;

    -- One statement, so the row lock spans the read and the write: two callers
    -- racing here come out with adjacent blocks, never the same one.
    UPDATE settings
       SET value = to_jsonb(((value #>> '{}')::INT) + p_count)
     WHERE key = 'barcode_next'
    RETURNING ((value #>> '{}')::INT) - p_count INTO v_next;

    IF v_next IS NULL THEN
        RAISE EXCEPTION 'The barcode_next setting is missing — re-run migration 007';
    END IF;

    RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION allocate_barcode_serials(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION allocate_barcode_serials(INT) TO authenticated;

-- ===== Lookup index =====
-- The "which variants still have no barcode" query runs on every visit to a
-- product page. A partial index costs almost nothing and keeps it off a scan.
CREATE INDEX IF NOT EXISTS idx_variants_without_barcode
    ON product_variants (product_id) WHERE barcode IS NULL;
