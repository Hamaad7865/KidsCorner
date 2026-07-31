import { Info } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { supabaseEnvError } from "@/lib/env"

/**
 * Shown when `.env.local` has no Supabase credentials yet. Sign-in cannot work
 * without them, so say exactly what is missing instead of failing opaquely.
 */
export function SetupNotice() {
  return (
    <Alert className="border-warning/40 bg-warning-muted">
      <Info aria-hidden />
      <AlertTitle>Supabase isn&apos;t connected yet</AlertTitle>
      <AlertDescription className="space-y-2">
        <p className="text-foreground/80">
          {supabaseEnvError} Add them to{" "}
          <code className="bg-background/70 rounded px-1 py-0.5 text-xs">
            .env.local
          </code>{" "}
          and restart <code className="bg-background/70 rounded px-1 py-0.5 text-xs">npm run dev</code>.
        </p>
        <pre className="bg-background/70 overflow-x-auto rounded-md p-2 text-[11px] leading-relaxed">
          {`NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key>`}
        </pre>
        <p className="text-muted-foreground text-xs">
          Both values are in your Supabase dashboard under Project Settings →
          API.
        </p>
      </AlertDescription>
    </Alert>
  )
}
