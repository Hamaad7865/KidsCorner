import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"

/**
 * A till sending home its own log.
 *
 * The shop-floor tablet cannot plug into USB and has no developer options
 * worth mentioning, so Settings offers "Send diagnostic log": the app dumps
 * its own logcat lines and POSTs them here. Support then reads the failure
 * in the back office instead of playing telephone with symptoms.
 *
 * Append-only by design — no update, no delete, no listing. Reading happens
 * in the back office straight off the table, newest first.
 */
const DiagnosticsBody = z.object({
  appVersion: z.string().max(32).default(""),
  deviceModel: z.string().max(128).default(""),
  androidRelease: z.string().max(32).default(""),
  /** Capped well under the column CHECK — a runaway logger stays bounded. */
  log: z.string().max(60_000).default(""),
  deviceId: z.number().int().positive().nullish(),
})

export async function POST(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const parsed = DiagnosticsBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return apiError("That diagnostic report was malformed.", 400)

  const { data, error } = await session.supabase
    .from("till_diagnostics")
    .insert({
      device_id: parsed.data.deviceId ?? null,
      app_version: parsed.data.appVersion,
      device_model: parsed.data.deviceModel,
      android_release: parsed.data.androidRelease,
      log: parsed.data.log,
    })
    .select("id")
    .single()

  if (error) return apiError(error.message, 500)
  return NextResponse.json({ ok: true, id: data.id })
}
