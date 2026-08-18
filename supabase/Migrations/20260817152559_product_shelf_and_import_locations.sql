-- A product has one human-readable shelf/bin reference shared by its variants.
-- Physical stock location remains movement-based in stock_locations.
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS shelf_location TEXT;

-- The tablet and import template use these two exact labels. Renaming keeps the
-- existing location id, so every historical movement stays attached to Shop.
UPDATE public.stock_locations
   SET name = 'Shop'
 WHERE name = 'Shop floor'
   AND NOT EXISTS (
       SELECT 1 FROM public.stock_locations WHERE name = 'Shop'
   );

-- Defensive for a database that never received the original seed location.
INSERT INTO public.stock_locations (name, is_default, is_active)
SELECT 'Shop', NOT EXISTS (
           SELECT 1 FROM public.stock_locations WHERE is_default
       ), TRUE
 WHERE NOT EXISTS (
       SELECT 1 FROM public.stock_locations WHERE name = 'Shop'
   );

UPDATE public.stock_locations SET is_active = TRUE WHERE name = 'Shop';

INSERT INTO public.stock_locations (name, is_default, is_active)
VALUES ('Warehouse', FALSE, TRUE)
ON CONFLICT (name) DO UPDATE SET is_active = TRUE;
