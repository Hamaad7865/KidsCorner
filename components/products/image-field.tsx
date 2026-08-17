"use client"

import { useRef, useState, useTransition } from "react"
import Image from "next/image"
import { ImageUp, LoaderCircle, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { uploadProductImage } from "@/lib/products/image-actions"
import { PRODUCT_IMAGE_ACCEPT } from "@/lib/products/image-config"

/**
 * The product photo: pick one, see it, replace it, remove it.
 *
 * It still posts a plain `imageUrl` string, so `saveProduct` and the zod schema
 * are untouched — the field simply fills itself in now instead of asking a
 * shopkeeper to go and host a file somewhere first. Pasting a URL is still
 * possible for a supplier's own image, which is the case the old field was
 * built for and the only one it served.
 *
 * The photo is SHRUNK IN THE BROWSER before it is sent. A phone camera writes
 * four or five megabytes; the bucket refuses anything over three, and more to
 * the point the till has to load these over a shop's connection while somebody
 * waits at the counter. 1200px on the long edge is more than any screen here
 * shows, and it turns a 5 MB photograph into about 200 KB.
 */

const MAX_EDGE = 1200
const JPEG_QUALITY = 0.85

/**
 * Draws the image onto a canvas at a sane size and returns a JPEG.
 *
 * Returns the original when it is already small, or when anything at all goes
 * wrong — an image the browser cannot decode is the server's problem to
 * report, and silently uploading nothing would be worse than uploading a big
 * file. Transparency is lost to JPEG, which is the right trade for photographs
 * of clothes; a PNG small enough to skip this path keeps its alpha.
 */
async function shrink(file: File): Promise<File> {
  if (file.size <= 400_000) return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size <= 1_000_000) {
      bitmap.close()
      return file
    }

    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext("2d")
    if (!context) {
      bitmap.close()
      return file
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    )
    if (!blob || blob.size >= file.size) return file

    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
      type: "image/jpeg",
    })
  } catch {
    return file
  }
}

export function ImageField({
  defaultValue,
  error,
}: {
  defaultValue: string | null
  error?: string
}) {
  const [url, setUrl] = useState(defaultValue ?? "")
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const picker = useRef<HTMLInputElement>(null)

  function choose(file: File | undefined) {
    if (!file) return
    setProblem(null)

    startTransition(async () => {
      const data = new FormData()
      data.set("file", await shrink(file))
      const result = await uploadProductImage(data)
      if (result.ok) setUrl(result.url)
      else setProblem(result.error)
      // Cleared so choosing the SAME file again still fires a change event —
      // which is what a person does after a failed upload.
      if (picker.current) picker.current.value = ""
    })
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="product-image">Photo</Label>

      <div className="flex items-start gap-3">
        <div className="bg-muted relative size-24 shrink-0 overflow-hidden rounded-lg border">
          {url ? (
            <Image
              src={url}
              alt=""
              fill
              sizes="96px"
              className="object-cover"
              // A pasted URL can point anywhere, and `next/image` refuses a host
              // it was not configured for. Unoptimised keeps the field working
              // for both cases rather than only for our own bucket.
              unoptimized
            />
          ) : (
            <span className="text-muted-foreground absolute inset-0 grid place-items-center text-[11px]">
              No photo
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={picker}
              type="file"
              accept={PRODUCT_IMAGE_ACCEPT}
              className="sr-only"
              onChange={(e) => choose(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => picker.current?.click()}
            >
              {pending ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <ImageUp aria-hidden />
              )}
              {pending ? "Uploading…" : url ? "Replace photo" : "Upload a photo"}
            </Button>
            {url ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setUrl("")
                  setProblem(null)
                }}
              >
                <Trash2 aria-hidden />
                Remove
              </Button>
            ) : null}
          </div>

          {/* Still a plain text field: a supplier's own image URL pasted in
              works exactly as it did before, and the value is visible rather
              than hidden inside the component. */}
          <Input
            id="product-image"
            name="imageUrl"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="…or paste an image address"
            spellCheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "product-image-error" : undefined}
          />
        </div>
      </div>

      {error ? (
        <p id="product-image-error" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {problem ? (
        <p className="text-destructive text-sm" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
