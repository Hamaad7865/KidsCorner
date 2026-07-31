-- ============================================================
-- 017 — a per-line discount has to name what it applies to
--
-- `discounts.scope` and `discounts.category_id` are as old as migration 005:
--
--     scope       'sale' comes off the basket total; 'line' off a single line.
--     category_id When set, only applies to lines in this category.
--
-- Neither was ever honoured in settlement. Every rule was measured against the
-- whole basket, so "10% off Babywear" took 10% off the entire cart — the shop
-- giving away money on every sale wider than the category. `settleDiscounts`
-- now picks the base per rule, and refuses a line-scoped rule that names no
-- category, because such a rule has no target the till can identify.
--
-- This constraint stops that row existing at all. There is no back-office form
-- for discounts yet — rules are written straight into this table — so the
-- database is the only place the shape can be enforced.
--
-- Migrations 001-016 are untouched.
-- ============================================================

-- Any existing offender is widened to a sale discount rather than deleted: it
-- is what the rule has been behaving as all along, so this changes no past
-- sale's arithmetic and leaves the row for an owner to correct deliberately.
UPDATE discounts
   SET scope = 'sale'
 WHERE scope = 'line'
   AND category_id IS NULL;

ALTER TABLE discounts
  DROP CONSTRAINT IF EXISTS discounts_line_scope_needs_category;

ALTER TABLE discounts
  ADD CONSTRAINT discounts_line_scope_needs_category
  CHECK (scope <> 'line' OR category_id IS NOT NULL);

COMMENT ON COLUMN discounts.category_id IS
  'When set, the rule is measured against the lines in this category only, '
  'not the basket. Required when scope = ''line''.';
