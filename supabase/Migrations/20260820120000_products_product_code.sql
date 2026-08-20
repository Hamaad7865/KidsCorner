-- A product-level code staff use to identify it directly, distinct from a
-- variant's SKU or barcode (which exist to be scanned, not read aloud).
-- Case-insensitive unique so "PC-1023" and "pc-1023" cannot both exist, but
-- punctuation and spacing are otherwise preserved as staff typed them —
-- unlike name/category matching elsewhere, a code is a precise identifier,
-- not free text meant for fuzzy matching. NULL stays valid and un-unique, so
-- every existing product keeps working with no code.
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS product_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS products_product_code_unique_idx
    ON public.products (lower(product_code))
    WHERE product_code IS NOT NULL;
