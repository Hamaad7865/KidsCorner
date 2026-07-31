-- ============================================================
-- Kids Corner — migration 012: a record of every receipt printed
--
-- WHY.
--
-- Reprinting a receipt is the ordinary answer to "can I have another copy",
-- and it is also how a refund that never happened gets justified: print an old
-- receipt, present it as today's, take the money back. Until now nothing
-- recorded that a receipt had been printed twice, and the till screen added in
-- this same pass puts reprinting in every cashier's hands rather than only a
-- manager's — which is convenient, and widens exactly that hole.
--
-- WHAT THIS DOES AND DOES NOT TELL YOU.
--
-- The signal that matters is the COUNT and the TIMES: one receipt printed four
-- times over three days is worth a question. `printed_by` is the Supabase
-- session, which on a shared till is the DEVICE account rather than the person
-- — the PIN-selected cashier is app-level state and the receipt opens in a new
-- tab that has none of it. Cross-reference the timestamp with the shift to get
-- from the device to the person. Recording it as if it named an individual
-- would be worse than not recording it: an audit trail that looks
-- authoritative and is not.
--
-- Migrations 001-011 are untouched.
-- ============================================================

CREATE TABLE IF NOT EXISTS receipt_prints (
    id          BIGSERIAL PRIMARY KEY,
    sale_id     BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    -- Nullable: a print is still worth recording even if the session cannot be
    -- resolved to a profile, and losing the row would defeat the point.
    printed_by  UUID REFERENCES profiles(id),
    printed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The question asked of this table is always "everything for one sale, newest
-- first", so the index matches that rather than being a bare FK index.
CREATE INDEX IF NOT EXISTS idx_receipt_prints_sale
    ON receipt_prints (sale_id, printed_at DESC);

ALTER TABLE receipt_prints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_all ON receipt_prints;
CREATE POLICY read_all ON receipt_prints FOR SELECT TO authenticated USING (true);

-- No INSERT, UPDATE or DELETE policy on purpose. Rows arrive only through the
-- SECURITY DEFINER function below, exactly as sales and stock movements do, so
-- the trail cannot be edited or thinned by whoever is standing at the till.

-- ===== record_receipt_print =====
-- Returns how many times this receipt has now been printed, so the caller can
-- tell an original from a reprint without a second round trip.
CREATE OR REPLACE FUNCTION record_receipt_print(p_sale_id BIGINT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INT;
BEGIN
    -- A print of a sale that does not exist is a bug somewhere, not an audit
    -- event. Refused rather than recorded against nothing.
    IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id) THEN
        RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
    END IF;

    INSERT INTO receipt_prints (sale_id, printed_by)
    VALUES (p_sale_id, auth.uid());

    SELECT count(*)::INT INTO v_count
      FROM receipt_prints WHERE sale_id = p_sale_id;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION record_receipt_print(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_receipt_print(BIGINT) TO authenticated;
