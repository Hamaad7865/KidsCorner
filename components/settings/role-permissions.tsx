import { Check, Minus } from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ROLE_LABELS,
  canManageCatalog,
  canManageSettings,
  canManageUsers,
  canSeeCostPrice,
  isAdminRole,
} from "@/lib/auth/roles"
import { ROLES, type Role } from "@/lib/db-enums"

/**
 * What each role can do, read straight out of the role helpers.
 *
 * Every cell calls the same predicate the app calls, so this table cannot
 * drift from the real rules the way a hand-written one would — change a helper
 * and this changes with it. Roles are fixed, so there is nothing to edit here;
 * per-role *visibility* is the separate access panel below.
 */

const PERMISSIONS: Array<{ label: string; allows: (role: Role) => boolean }> = [
  { label: "Use the till and complete sales", allows: () => true },
  { label: "Open and close a shift", allows: () => true },
  { label: "Open the back office", allows: isAdminRole },
  { label: "Add and edit products, variants and stock", allows: canManageCatalog },
  { label: "Import from Excel", allows: canManageCatalog },
  { label: "Receive purchases", allows: canManageCatalog },
  { label: "See cost prices and margins", allows: canSeeCostPrice },
  { label: "Change shop settings and VAT", allows: canManageSettings },
  { label: "Manage users, roles and PINs", allows: canManageUsers },
]

export function RolePermissions() {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-heading text-base font-medium">
          What each role can do
        </h2>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Three roles with fixed permissions. Cost prices and margins stay with
          owners and managers. This is a reference, not a form — the database
          enforces these rules regardless of what any screen shows.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Permission</TableHead>
              {ROLES.map((role) => (
                <TableHead key={role} className="w-28 text-center">
                  {ROLE_LABELS[role]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {PERMISSIONS.map((permission) => (
              <TableRow key={permission.label}>
                <TableCell className="font-medium">{permission.label}</TableCell>
                {ROLES.map((role) => {
                  const allowed = permission.allows(role)
                  return (
                    <TableCell key={role} className="text-center">
                      {/* The icon carries the meaning, so it gets the label —
                          a bare tick is silent to a screen reader. */}
                      {allowed ? (
                        <Check
                          className="text-success mx-auto size-4"
                          aria-label="Allowed"
                        />
                      ) : (
                        <Minus
                          className="text-muted-foreground/50 mx-auto size-4"
                          aria-label="Not allowed"
                        />
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
