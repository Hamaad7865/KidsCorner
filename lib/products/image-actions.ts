"use server"

import { canManageCatalog } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"

/**
 * Putting a photograph of a garment somewhere the shop can reach it.
 *
 * The product form has always had an "Image URL" field, and it has always been
 * empty, because it asks a shopkeeper to host nineteen photographs elsewhere
 * first. This is the missing half: pick a file, and the field fills itself in.
 *
 * The upload goes through the SERVER rather than straight from the browser to
 * storage. The bucket's RLS already refuses a cashier, so this is not the only
 * guard — but it is the one that can say why in words a person understands,
 * and it means the size and type rules are enforced somewhere the browser
 * cannot skip. Storage's own limits stay in place underneath as the backstop.
 */

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024

/** Must match `allowed_mime_types` on the bucket (migration 033). */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

export async function uploadProductImage(
  formData: FormData,
): Promise<UploadResult> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return { ok: false, error: "Your session has expired. Sign in again." }
  }
  if (!canManageCatalog(profile.role)) {
    return { ok: false, error: "Only an owner or manager can add product photos." }
  }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No image was chosen." }
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return { ok: false, error: "That file isn't a JPEG, PNG or WebP image." }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      // The browser shrinks a photo before it gets here, so reaching this
      // means the resize did not run — worth saying plainly rather than
      // "upload failed".
      error: "That image is over 3 MB even after resizing. Try a smaller photo.",
    }
  }

  // A random name, not the product's. The photo is chosen before a new product
  // has an id, and naming by product would mean either a rename on save or a
  // second upload — and a stale name that no longer matches the product it
  // sits under is worse than an opaque one.
  const extension = EXTENSIONS[file.type] ?? "jpg"
  const path = `p/${crypto.randomUUID()}.${extension}`

  const supabase = await createClient()
  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) {
    return { ok: false, error: `Couldn't save that image. ${error.message}` }
  }

  const { data } = supabase.storage.from("product-images").getPublicUrl(path)
  return { ok: true, url: data.publicUrl }
}
