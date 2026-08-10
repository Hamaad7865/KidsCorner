"use client"

import { useActionState, useEffect } from "react"
import { useFormStatus } from "react-dom"
import { Check, LoaderCircle, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { setModuleAccess } from "@/lib/access/actions"
import { MODULES, MODULE_LABELS, type ModuleKey } from "@/lib/access/modules"
import type { AccessMap } from "@/lib/access/queries"
import { ROLE_LABELS } from "@/lib/auth/roles"
import type { Role } from "@/lib/db-enums"
import { IDLE_STATE } from "@/lib/forms"
import { cn } from "@/lib/utils"

const ROLES: Role[] = ["owner", "manager", "cashier"]

/**
 * Role × module grid. Each cell is its own tiny form, so a toggle is one
 * request and nothing else on the page can be disturbed by it.
 */
export function AccessPanel({
  grid,
  canManage,
}: {
  grid: Record<Role, AccessMap>
  canManage: boolean
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-heading text-base font-medium">Module access</h2>
        <p className="text-muted-foreground text-sm">
          What each role is shown. This hides menu items and blocks the routes —
          it is <strong>not</strong> the security boundary. Row-level security
          decides what the database will actually allow, and granting a module
          here grants no permission at all. The owner sees every module — only
          a manager or a cashier can be restricted.
          {canManage ? "" : " Only the owner can change these."}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50">
              <th className="px-3 py-2 text-left font-medium">Module</th>
              {ROLES.map((role) => (
                <th key={role} className="w-32 px-3 py-2 font-medium">
                  {ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((module) => (
              <tr key={module} className="border-t">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {MODULE_LABELS[module]}
                  {module === "pos" ? (
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      always on
                    </span>
                  ) : null}
                </th>
                {ROLES.map((role) => (
                  <td key={role} className="border-l p-0 text-center">
                    <Toggle
                      role={role}
                      module={module}
                      value={grid[role][module]}
                      // The till can never be hidden, and the owner sees
                      // everything. This used to lock only the owner's
                      // settings cell — enough to keep this screen reachable,
                      // but it left every other module switchable, and the
                      // shop ran a week with the owner's own Products turned
                      // off. Nobody notices a nav item that was never there;
                      // they notice that a link stops working.
                      //
                      // The owner's lock is one-directional: `&& value` holds
                      // a module that is ON, and leaves one that is somehow
                      // OFF clickable so it can be put back. A flat lock would
                      // freeze exactly the broken state it exists to prevent.
                      locked={
                        !canManage ||
                        module === "pos" ||
                        (role === "owner" && grid[role][module])
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Toggle({
  role,
  module,
  value,
  locked,
}: {
  role: Role
  module: ModuleKey
  value: boolean
  locked: boolean
}) {
  const [state, formAction] = useActionState(setModuleAccess, IDLE_STATE)

  useEffect(() => {
    if (state.status === "error" && state.error) toast.error(state.error)
  }, [state])

  return (
    <form action={formAction}>
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="module" value={module} />
      {/* Submits the value we want AFTER the click, not the current one. */}
      {value ? null : <input type="hidden" name="canView" value="true" />}
      <ToggleButton value={value} locked={locked} label={`${MODULE_LABELS[module]} for ${ROLE_LABELS[role]}`} />
    </form>
  )
}

function ToggleButton({
  value,
  locked,
  label,
}: {
  value: boolean
  locked: boolean
  label: string
}) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant="ghost"
      size="icon-sm"
      disabled={locked || pending}
      title={locked ? `${label} — fixed` : `${value ? "Hide" : "Show"} ${label}`}
      aria-label={`${value ? "Hide" : "Show"} ${label}`}
      aria-pressed={value}
      className={cn(value ? "text-success" : "text-muted-foreground")}
    >
      {pending ? (
        <LoaderCircle className="animate-spin" aria-hidden />
      ) : value ? (
        <Check aria-hidden />
      ) : (
        <X aria-hidden />
      )}
    </Button>
  )
}
