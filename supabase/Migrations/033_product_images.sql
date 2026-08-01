-- ============================================================
-- Kids Corner — migration 033: somewhere to put a photo of the garment
--
-- Migrations 001-032 are untouched.
-- ============================================================
--
-- `products.image_url` has existed since 001 and the product form has always
-- had a field for it — but the field asks for a URL, and nobody is going to
-- host nineteen photographs somewhere else first. So the column has stayed
-- empty, and every screen that would show a picture shows a grey box instead:
-- the product list, the product page, the POS quick keys, and the till's
-- Browse overlay.
--
-- The missing piece was never the column. It was a place to put the file.
--
-- The bucket is PUBLIC. What lives in it is a photograph of a child's t-shirt
-- on a shop's own shelf — it is going to be shown to every customer who looks
-- at the till, and signing each read would buy nothing but a slower screen.
-- Writing is a different matter, and is restricted below.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'product-images',
    'product-images',
    TRUE,
    -- 3 MB. A phone photo off a modern camera is bigger than this, so the app
    -- resizes before it uploads; the cap is here to make that non-optional. A
    -- catalogue of 4 MB originals would make the till's Browse overlay crawl
    -- on the shop's connection, which is the whole reason the pictures exist.
    3145728,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
   SET public             = EXCLUDED.public,
       file_size_limit    = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ===== who may read =====
--
-- Everyone, including a signed-out browser: the bucket is public, and this
-- policy is what makes the object reachable through the API path as well as
-- the CDN one. Scoped to this bucket by name, so it cannot become a blanket
-- read over any bucket added later.

DROP POLICY IF EXISTS product_images_read ON storage.objects;
CREATE POLICY product_images_read ON storage.objects
    FOR SELECT
    USING (bucket_id = 'product-images');

-- ===== who may write =====
--
-- Only the roles that may already change the catalogue. `current_role_of_user`
-- reads `profiles` for `auth.uid()` and is SECURITY DEFINER with a pinned
-- search_path (migration 028), so a cashier cannot reach these even with a
-- valid session — which matters because an unrestricted write policy on a
-- public bucket is an open file host on the shop's domain.
--
-- Update and delete are separate policies rather than FOR ALL: replacing a
-- photograph and removing one are both things a manager does, but spelling
-- them out means a future change to one cannot silently widen the others.

DROP POLICY IF EXISTS product_images_insert ON storage.objects;
CREATE POLICY product_images_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'product-images'
        AND public.current_role_of_user() IN ('owner', 'manager')
    );

DROP POLICY IF EXISTS product_images_update ON storage.objects;
CREATE POLICY product_images_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'product-images'
        AND public.current_role_of_user() IN ('owner', 'manager')
    )
    WITH CHECK (
        bucket_id = 'product-images'
        AND public.current_role_of_user() IN ('owner', 'manager')
    );

DROP POLICY IF EXISTS product_images_delete ON storage.objects;
CREATE POLICY product_images_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'product-images'
        AND public.current_role_of_user() IN ('owner', 'manager')
    );
