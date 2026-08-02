-- ============================================================================
-- 037 — let a customer's details be corrected
--
-- `customers` shipped with a SELECT policy and an INSERT policy and nothing
-- else. So a customer could be created and never fixed: a phone number
-- mistyped at the counter was permanent, and the shop's only recourse was to
-- add a second record for the same person — which splits the purchase history
-- that is the entire reason the customer record exists.
--
-- UPDATE only, and only for owner and manager. Three reasons it is not opened
-- to cashiers the way INSERT is:
--
--   * INSERT is additive and part of the sale flow — a cashier captures a
--     customer mid-sale and nothing existing changes. UPDATE rewrites a row
--     that past sales point at.
--   * `/customers` is a back-office route. A cashier cannot reach the screen,
--     so a policy that let them write would be a hole with no door.
--   * A typo at the counter is fixed later by whoever notices the duplicate,
--     and that is the person in the back office.
--
-- No DELETE. A customer attached to sales must not be able to vanish out from
-- under them, and "we no longer deal with them" is a note, not a deletion.
--
-- WITH CHECK as well as USING. On an UPDATE, USING decides which rows may be
-- touched and WITH CHECK decides what they may become; Postgres falls back to
-- USING when WITH CHECK is absent, so for a row-independent role test the two
-- are equivalent — but 028 set the precedent of saying it out loud rather than
-- relying on the fallback.
-- ============================================================================

DROP POLICY IF EXISTS update_customers ON customers;

CREATE POLICY update_customers ON customers FOR UPDATE TO authenticated
    USING (current_role_of_user() IN ('owner', 'manager'))
    WITH CHECK (current_role_of_user() IN ('owner', 'manager'));
