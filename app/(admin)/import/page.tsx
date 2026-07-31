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
        <h1 className="font-heading text-xl font-semibold">Excel import</h1>
        <p className="text-muted-foreground text-sm">
          Bulk-load the catalogue from a spreadsheet. One row per variant — the
          product name repeats across its size and colour rows.
        </p>
      </header>

      <ImportWizard master={master} />
    </div>
  )
}
