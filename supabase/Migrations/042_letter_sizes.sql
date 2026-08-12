-- A third way to size stock: letter sizes (S–XXXL) for clothing sold by size
-- rather than by age.
--
-- `sizes.size_type` (migration 001) allowed only 'age_range' and 'shoe_size'.
-- The whole app reads the allowed set from `SIZE_TYPES` in lib/db-enums.ts, and
-- every size-grouping surface — the size manager, the variant generator, the
-- variant matrix, the import — is driven by it, so widening the CHECK to match
-- that constant is all the database has to do.
--
-- The existing rows are all age_range/shoe_size, which the widened set still
-- permits, so the constraint swap validates without touching a single row.

ALTER TABLE sizes DROP CONSTRAINT IF EXISTS sizes_size_type_check;
ALTER TABLE sizes ADD CONSTRAINT sizes_size_type_check
    CHECK (size_type IN ('age_range', 'letter_size', 'shoe_size'));

-- Starter set, matching the seed style in 001. sort_order 40+ sits after the
-- age ranges (1–10) and shoe sizes (20+); ON CONFLICT keeps re-runs idempotent
-- and leaves a shop's own edits alone.
INSERT INTO sizes (size_type, label, sort_order) VALUES
    ('letter_size', 'S', 40),
    ('letter_size', 'M', 41),
    ('letter_size', 'L', 42),
    ('letter_size', 'XL', 43),
    ('letter_size', 'XXL', 44),
    ('letter_size', 'XXXL', 45)
ON CONFLICT (size_type, label) DO NOTHING;
