"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle } from "lucide-react"

import { signIn, type SignInState } from "@/lib/auth/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const INITIAL_STATE: SignInState = { error: null, fieldErrors: {} }

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      className="h-11 w-full text-base"
      disabled={pending || disabled}
    >
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Signing in…
        </>
      ) : (
        "Sign in"
      )}
    </Button>
  )
}

export function LoginForm({ next, disabled }: { next?: string; disabled?: boolean }) {
  const [state, formAction] = useActionState(signIn, INITIAL_STATE)

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
          placeholder="you@kidscorner.mu"
          className="h-11"
          aria-invalid={Boolean(state.fieldErrors.email)}
          aria-describedby={state.fieldErrors.email ? "email-error" : undefined}
        />
        {state.fieldErrors.email ? (
          <p id="email-error" className="text-destructive text-sm">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className="h-11"
          aria-invalid={Boolean(state.fieldErrors.password)}
          aria-describedby={
            state.fieldErrors.password ? "password-error" : undefined
          }
        />
        {state.fieldErrors.password ? (
          <p id="password-error" className="text-destructive text-sm">
            {state.fieldErrors.password}
          </p>
        ) : null}
      </div>

      <SubmitButton disabled={disabled} />
    </form>
  )
}
