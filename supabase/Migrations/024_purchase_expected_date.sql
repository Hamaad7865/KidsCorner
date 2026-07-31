-- When a purchase is expected to arrive.
--
-- The back-office design shows Ordered and Expected as separate columns, and
-- the dashboard's "Awaiting delivery" card promises a date. Neither had one to
-- read: the order date was standing in as a proxy, which is the wrong answer
-- whenever a supplier quotes a lead time — the two are the same day only when
-- the goods arrive the moment they are ordered.
--
-- Nullable with no default. A shop that has not been given a date should see an
-- empty cell rather than an invented one that somebody then plans around; and
-- backfilling existing drafts with their order date would manufacture exactly
-- the false precision this column exists to remove.

ALTER TABLE purchases
    ADD COLUMN IF NOT EXISTS expected_date DATE;

COMMENT ON COLUMN purchases.expected_date IS
    'When the supplier says the goods will arrive. Null when unknown — never '
    'defaulted to the order date, which would look like a real commitment.';

-- Drafts, oldest expected first, is how the dashboard picks "what lands next".
CREATE INDEX IF NOT EXISTS idx_purchases_expected
    ON purchases (expected_date)
    WHERE status = 'draft' AND expected_date IS NOT NULL;
