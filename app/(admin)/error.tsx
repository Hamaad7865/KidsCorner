"use client"

import { useEffect } from "react"
import { AlertCircle, RotateCw } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

/**
 * Error boundary for the whole `(admin)` group.
 *
 * Back-office pages read from Supabase on every request, so the realistic
 * failures are a migration that hasn't been applied, an RLS policy that denies
 * a read, or the database being briefly unreachable. Without this the segment
 * renders a blank 500 with the reason only visible in the server log.
 *
 * The digest is surfaced deliberately: in production React replaces the message
 * with a generic string, and the digest is the only way to tie what the user
 * saw to the server-side stack trace.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[admin] render failed:", error)
  }, [error])

  return (
    <div className="mx-auto max-w-lg py-12">
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>
          <p>
            This page couldn’t load. If you’ve just set the project up, the most
            likely cause is that migration 001 hasn’t been applied yet.
          </p>
          {error.digest ? (
            <p className="text-muted-foreground mt-2 font-mono text-xs">
              Reference: {error.digest}
            </p>
          ) : null}
        </AlertDescription>
      </Alert>

      <Button className="mt-4" onClick={reset}>
        <RotateCw aria-hidden />
        Try again
      </Button>
    </div>
  )
}
