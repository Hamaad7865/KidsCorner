-- ============================================================
-- Kids Corner — migration 029: a transfer needs stock to transfer
--
-- THE DEFECT. `transfer_stock` (006) checked only that the quantity was
-- positive and the two locations differed. It never asked whether the SOURCE
-- location actually held what was being moved.
--
-- Nothing else could catch it either. A transfer writes a matching pair of
-- movements — minus at the source, plus at the destination — so it nets to
-- zero against `qty_on_hand`, leaving both the ledger invariant and 009's
-- non-negative CHECK satisfied. Those guard the shop-wide figure, which a
-- transfer never moves.
--
-- So: a variant with 10 units, all on the shop floor. Someone transfers 10
-- from the storeroom, which holds none. Both rows insert. `stock_by_location`
-- then reports the storeroom at MINUS ten and the floor at twenty — the shop
-- appears to hold twice what it owns, and a stock count against the floor
-- comes up ten short with no explanation anywhere in the ledger.
--
-- THE FIX. Check the source's own balance, under a lock, before writing.
--
-- Migrations 001-028 are untouched.
-- ============================================================

CREATE OR REPLACE FUNCTION transfer_stock(
    p_variant_id INT,
    p_qty INT,
    p_from_location INT,
    p_to_location INT,
    p_notes TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_available INT;
    v_where     TEXT;
BEGIN
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'A transfer needs a positive quantity';
    END IF;
    IF p_from_location = p_to_location THEN
        RAISE EXCEPTION 'Pick two different locations';
    END IF;

    -- Serialised per variant, so two transfers of the same goods cannot both
    -- read the same balance and both pass. hashtext over a per-variant key
    -- rather than the variant id alone, to stay clear of other advisory locks.
    PERFORM pg_advisory_xact_lock(hashtext('transfer_stock:' || p_variant_id::TEXT));

    SELECT coalesce(sum(qty), 0) INTO v_available
      FROM stock_movements
     WHERE variant_id = p_variant_id
       AND location_id = p_from_location;

    IF v_available < p_qty THEN
        -- `stock_locations`, not `locations` — the table 006 actually created.
        SELECT name INTO v_where FROM stock_locations WHERE id = p_from_location;
        RAISE EXCEPTION
            'Only % of that item at %, so % cannot be moved',
            v_available, coalesce(v_where, 'that location'), p_qty;
    END IF;

    -- Out of one, into the other. Net effect on qty_on_hand is zero, which is
    -- correct: the goods have not left the shop.
    INSERT INTO stock_movements (variant_id, movement_type, qty, location_id,
            reference_type, notes, created_by)
    VALUES (p_variant_id, 'adjustment', -p_qty, p_from_location,
            'transfer', coalesce(p_notes, 'Transfer out'), auth.uid());

    INSERT INTO stock_movements (variant_id, movement_type, qty, location_id,
            reference_type, notes, created_by)
    VALUES (p_variant_id, 'adjustment', p_qty, p_to_location,
            'transfer', coalesce(p_notes, 'Transfer in'), auth.uid());
END;
$$;
