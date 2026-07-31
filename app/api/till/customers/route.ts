import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"

/**
 * Customer lookup for the "attach customer" step.
 *
 * Searched server-side rather than cached on the device like the catalog. A
 * shop's customer list is personal data — names and phone numbers — and there
 * is no reason for all of it to sit on a tablet that lives on a counter. The
 * catalog is public information about what is for sale; this is not.
 */
export async function GET(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? ""
  // Two characters minimum, so an empty box does not stream the whole list back.
  if (query.length < 2) return NextResponse.json({ ok: true, customers: [] })

  // Escaped before interpolation: % and _ are wildcards in LIKE, and a comma
  // would end the PostgREST `or` filter and let the rest be read as new
  // conditions.
  const safe = query.replace(/[%_,()]/g, "")
  if (safe.length < 2) return NextResponse.json({ ok: true, customers: [] })

  const { data, error } = await session.supabase
    .from("customers")
    .select("id, full_name, phone")
    .or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%`)
    .order("full_name")
    .limit(20)

  if (error) return apiError(error.message, 500)

  return NextResponse.json({
    ok: true,
    customers: (data ?? []).map((row) => ({
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
    })),
  })
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer's name.").max(120),
  phone: z.string().trim().max(40).nullish(),
})

/** Adds a customer from the till, for the walk-in who wants to be on file. */
export async function POST(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("Malformed request.", 400)
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid customer.",
    })
  }

  const { data, error } = await session.supabase
    .from("customers")
    .insert({
      full_name: parsed.data.name,
      phone: parsed.data.phone?.trim() || null,
    })
    .select("id, full_name, phone")
    .maybeSingle()

  if (error) return NextResponse.json({ ok: false, error: error.message })
  if (!data) return NextResponse.json({ ok: false, error: "The customer was not saved." })

  return NextResponse.json({
    ok: true,
    customer: { id: data.id, fullName: data.full_name, phone: data.phone },
  })
}
