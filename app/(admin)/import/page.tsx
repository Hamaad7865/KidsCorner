import type { Metadata } from "next"

import { ImportWizard } from "@/components/import/import-wizard"
import { requireAdminProfile } from "@/lib/auth/session"
import { getMasterData } from "@/lib/master-data/queries"

export const metadata: Metadata = { title: "Excel import" }

export default async function ImportPage() {
  await requireAdminProfile()

  // Master data is loaded once on the server and handed to the wizard so every
  // row can be validated in the browser without a round trip per keystroke.
  const master = await getMasterData()

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold">Import from Excel</h1>
        <p className="text-muted-foreground text-sm">
          Bring in a supplier list or a stock count sheet. Nothing is saved until
          you confirm on the last step.
        </p>
      </header>

      <ImportWizard master={master} />
    </div>
  )
}
