-- ============================================================
-- Kids Corner — migration 045: atomic stock count
--
-- THE DEFECT. recordAdjustment read qty_on_hand in one statement and called
-- record_stock_movement in a second. Two people stock-taking the SAME variant
-- at the same instant both computed a delta from the same starting number, so
-- the second write overwrote the first instead of building on it.
--
-- THE FIX. A single RPC that locks the variant row, reads the current count,
-- computes the delta, and records the movement inside one transaction. The
-- SELECT ... FOR UPDATE serialises concurrent counts of the same variant: the
-- second caller blocks until the first commits, then reads the new figure.
--
-- Migrations 001-044 are untouched.
-- ============================================================

CREATE OR REPLACE FUNCTION record_stock_count(
    p_variant_id INT,
    p_counted_qty INT,
    p_reason TEXT DEFAULT NULL
) RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_current INT;
    v_delta   INT;
BEGIN
    IF p_counted_qty IS NULL OR p_counted_qty < 0 THEN
        RAISE EXCEPTION 'A counted quantity cannot be negative';
    END IF;
    IF p_counted_qty > 1000000 THEN
        RAISE EXCEPTION 'That quantity is unrealistically large';
    END IF;
    IF coalesce(btrim(p_reason), '') = '' OR length(btrim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'Give a reason — this is the only record of why the count changed';
    END IF;

    -- Row lock: concurrent counts of THIS variant serialise here.
    SELECT qty_on_hand INTO v_current
      FROM product_variants
     WHERE id = p_variant_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'That variant no longer exists.';
    END IF;

    v_delta := p_counted_qty - v_current;

    -- No movement for a no-op count. The caller reports "already matches"
    -- from this zero rather than writing a zero-qty ledger line.
    IF v_delta = 0 THEN
        RETURN 0;
    END IF;

    -- The single writer of qty_on_hand. The 009 non-negative CHECK still
    -- guards the floor: a concurrent sale that lands between the user's read
    -- and this call surfaces as 23514, which the caller maps to "recount".
    PERFORM record_stock_movement(
        p_variant_id, 'adjustment', v_delta,
        'manual_adjustment', NULL, btrim(p_reason));

    RETURN v_delta;
END;
$$;

REVOKE ALL ON FUNCTION record_stock_count(INT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_stock_count(INT, INT, TEXT) TO authenticated;
