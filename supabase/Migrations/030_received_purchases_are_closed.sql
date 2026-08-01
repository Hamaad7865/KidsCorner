-- ============================================================
-- Kids Corner — migration 030: a received purchase's lines are closed
--
-- THE DEFECT. `savePurchase` reads the status, refuses if it is not 'draft',
-- and re-asserts `status = 'draft'` on the header UPDATE — but the DELETE that
-- clears the lines is keyed on `purchase_id` alone, and the re-insert is
-- unguarded too.
--
-- So a receipt landing between that read and the write survives the header
-- guard and loses to the line guard that is not there: the UPDATE matches no
-- row and `total_amount` stays at what was received, while the DELETE fires
-- anyway and replaces the received lines with whatever the editor had open.
-- The purchase then carries lines summing to one figure against a total of
-- another, and the unit costs the stock was actually received at are gone —
-- which is what the margin report reads.
--
-- THE FIX. Enforce it where it cannot be raced or bypassed. `purchase_items`
-- describes what was ordered and, once received, what stock was booked in at;
-- after that it is a record, not a draft.
--
-- Migrations 001-029 are untouched.
-- ============================================================

CREATE OR REPLACE FUNCTION forbid_received_purchase_lines()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_purchase BIGINT := coalesce(NEW.purchase_id, OLD.purchase_id);
    v_status   TEXT;
BEGIN
    SELECT status INTO v_status FROM purchases WHERE id = v_purchase;

    -- A purchase that has gone is not this trigger's business: the cascade
    -- from deleting the parent must still work.
    IF NOT FOUND THEN
        RETURN coalesce(NEW, OLD);
    END IF;

    IF v_status <> 'draft' THEN
        RAISE EXCEPTION
            'Purchase % is % — its lines record what was received and cannot be changed',
            v_purchase, v_status;
    END IF;

    RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_items_draft_only ON purchase_items;
CREATE TRIGGER trg_purchase_items_draft_only
    BEFORE INSERT OR UPDATE OR DELETE ON purchase_items
    FOR EACH ROW EXECUTE FUNCTION forbid_received_purchase_lines();

COMMENT ON TABLE purchase_items IS
    'Lines of a purchase. Editable only while the purchase is a draft — once '
    'received they are the record of what stock was booked in and at what '
    'cost, which the margin report reads.';
