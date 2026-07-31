-- ============================================================
-- Kids Corner — migration 011: a sale can only be rung up once
--
-- THE BUG THIS CLOSES.
--
-- complete_sale has always been atomic, which is not the same as safe to
-- retry. If it commits and the *response* is lost — a dropped connection at
-- the moment a shop's line wobbles, which is precisely when this app is used —
-- the till shows a failure over a sale that actually happened. The spec then
-- tells the cashier exactly the wrong thing: "keep the cart intact and allow
-- retry". Pressing Confirm again writes a SECOND sale, takes the money twice
-- and deducts the stock twice.
--
-- Atomicity cannot fix that, because nothing is wrong inside the transaction.
-- The fix is a key: the till names each sale ATTEMPT, and a second call under
-- the same name returns the first sale instead of making another.
--
-- WHY AN ADVISORY LOCK RATHER THAN CATCHING A UNIQUE VIOLATION.
--
-- Check-then-insert races: two retries arriving together both find nothing and
-- both proceed. Catching the unique violation afterwards does not help either,
-- because in plpgsql an exception block rolls back everything done inside it —
-- including the sale we would then want to return. Locking on the key first
-- serialises identical attempts, so the second one waits and then sees the
-- first one's row.
--
-- Migrations 001-010 are untouched.
-- ============================================================

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Partial: sales made before this migration, and any made without a key, stay
-- unconstrained. Only keyed attempts have to be unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_idempotency_key
    ON sales (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ===== complete_sale_keyed =====
-- The wrapper the till calls. Everything about pricing, VAT, stock and
-- discounts still happens in complete_sale_with_discounts (005) — this adds
-- only the "have I already done this?" question in front of it.
CREATE OR REPLACE FUNCTION complete_sale_keyed(
    p_key         TEXT,
    p_shift_id    INT,
    p_customer_id INT,
    p_cashier_id  UUID,
    p_discount    NUMERIC,
    p_items       JSONB,
    p_payments    JSONB,
    p_discounts   JSONB DEFAULT '[]'::jsonb
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing BIGINT;
    v_sale_id  BIGINT;
BEGIN
    -- No key means the caller accepts the old behaviour. Kept so an older
    -- client, or a script, still works rather than failing closed on a till.
    IF p_key IS NULL OR btrim(p_key) = '' THEN
        RETURN complete_sale_with_discounts(p_shift_id, p_customer_id, p_cashier_id,
                                            p_discount, p_items, p_payments, p_discounts);
    END IF;

    -- Held to the end of the transaction. A concurrent retry under the same key
    -- blocks here rather than racing past the check below.
    PERFORM pg_advisory_xact_lock(hashtext(p_key));

    SELECT id INTO v_existing FROM sales WHERE idempotency_key = p_key;
    IF v_existing IS NOT NULL THEN
        -- The replay. Deliberately returns the original sale rather than
        -- raising: from the till's side this attempt succeeded, and it did —
        -- just the first time.
        RETURN v_existing;
    END IF;

    v_sale_id := complete_sale_with_discounts(p_shift_id, p_customer_id, p_cashier_id,
                                              p_discount, p_items, p_payments, p_discounts);

    UPDATE sales SET idempotency_key = p_key WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION complete_sale_keyed(TEXT, INT, INT, UUID, NUMERIC, JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_sale_keyed(TEXT, INT, INT, UUID, NUMERIC, JSONB, JSONB, JSONB) TO authenticated;
