-- ============================================================
-- Kids Corner — migration 015: sales that arrived after their Z
--
-- THE PROBLEM THIS MAKES VISIBLE.
--
-- The till queues a sale it could not send (migration 011's idempotency key is
-- what makes that safe). `close_shift_z` freezes the Z from what the database
-- holds at that instant. If a queued sale is still on the tablet when the till
-- is closed, it is not in that snapshot — and when it drains minutes later it
-- lands in a shift whose Z is already frozen and cannot be corrected.
--
-- The result is a Z that is short by that sale, permanently, and a drawer that
-- is over by its cash with nothing on the slip to explain why.
--
-- The tablet now refuses to close while anything is queued, which prevents this
-- in the normal case. But "the app was reinstalled", "the tablet died flat" and
-- "someone closed on a second device" are all real, and a silent discrepancy in
-- a fiscal record is the worst kind. So this makes it findable.
--
-- Detection, not prevention. Rejecting the sale would be far worse: the shop
-- has already taken the customer's money.
--
-- Migrations 001-014 are untouched.
-- ============================================================

-- ===== late_sales =====
-- Sales that were written into a shift after that shift's Z was frozen.
--
-- A view rather than a flag on `sales`: this is a question asked occasionally by
-- the back office, not a fact worth denormalising onto every ticket, and a view
-- cannot drift out of date the way a stored flag would.
CREATE OR REPLACE VIEW late_sales AS
SELECT
    s.id            AS sale_id,
    s.sale_no,
    s.shift_id,
    s.total,
    s.sale_date,
    z.z_no,
    z.closed_at,
    -- How long after the Z it landed. A few seconds is a close racing a drain;
    -- an hour is a tablet that was offline and came back.
    s.sale_date - z.closed_at AS arrived_after
  FROM sales s
  JOIN z_reports z ON z.shift_id = s.shift_id
 WHERE s.status = 'completed'
   -- `sale_date` is stamped by `complete_sale` when the row is written, so for
   -- a queued sale it is the moment it finally reached the server — which is
   -- exactly the comparison wanted here.
   AND s.sale_date > z.closed_at;

COMMENT ON VIEW late_sales IS
  'Completed sales written into a shift after its Z report was frozen. Each one '
  'means that Z understates the shift by its total. Should normally be empty.';

-- ===== shift_z_variance =====
-- What a shift's Z says against what its sales now add up to.
--
-- The honest reconciliation: `z_total` is the frozen figure on the paper,
-- `actual_total` is what the ledger holds today. They should be identical, and
-- the difference is the amount of money the slip in the shop's file does not
-- account for.
CREATE OR REPLACE VIEW shift_z_variance AS
SELECT
    z.shift_id,
    z.z_no,
    z.closed_at,
    (z.totals->>'sales_total')::NUMERIC AS z_total,
    coalesce((
      SELECT round(sum(s.total), 2) FROM sales s
       WHERE s.shift_id = z.shift_id AND s.status = 'completed'
    ), 0) AS actual_total,
    coalesce((
      SELECT round(sum(s.total), 2) FROM sales s
       WHERE s.shift_id = z.shift_id AND s.status = 'completed'
    ), 0) - (z.totals->>'sales_total')::NUMERIC AS unreported,
    (SELECT count(*) FROM late_sales l WHERE l.shift_id = z.shift_id)::INT AS late_count
  FROM z_reports z;

COMMENT ON VIEW shift_z_variance IS
  'Frozen Z total against what the shift holds now. `unreported` should be 0.00 '
  'on every row; anything else is money the printed slip does not account for.';

GRANT SELECT ON late_sales TO authenticated;
GRANT SELECT ON shift_z_variance TO authenticated;
