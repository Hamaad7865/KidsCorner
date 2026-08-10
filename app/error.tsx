"use client"

import { useEffect } from "react"
import { AlertCircle, RotateCw } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

/**
 * Root error boundary.
 *
 * `(admin)/error.tsx` covers admin PAGES, but a boundary cannot catch a throw
 * in its own segment's layout — and the chrome those layouts render (the
 * account menu, the top bar) is exactly where a client component can blow up.
 * When that happened there was nothing above the route-group layouts to catch
 * it, so the whole document died and the browser showed its own blank "this
 * page couldn't load". This is that missing rung: it sits above every route
 * group, so a layout-level failure degrades to a message and a retry instead.
 *
 * The digest is surfaced deliberately: in production React replaces the message
 * with a generic string, and the digest is the only thread back to the
 * server-side log for what the user actually saw.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[root] render failed:", error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center p-6">
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>
          <p>
            This screen hit an error and stopped. Try again — if it keeps
            happening, reload the page.
          </p>
          {error.digest ? (
            <p className="text-muted-foreground mt-2 font-mono text-xs">
              Reference: {error.digest}
            </p>
          ) : null}
        </AlertDescription>
      </Alert>

      <div className="mt-4 flex gap-2">
        <Button onClick={reset}>
          <RotateCw aria-hidden />
          Try again
        </Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  )
}
