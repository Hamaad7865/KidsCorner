import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { round2 } from "@/lib/format"

/**
 * Customer lookup for the "attach customer" step.
 *
 * Searched server-side rather than cached on the device like the catalog. A
 * shop's customer list is personal data — names and phone numbers — and there
 * is no reason for all of it to sit on a tablet that lives on a counter. The
 * catalog is public information about what is for sale; this is not.
 *
 * Read from `customer_credit_accounts` rather than `customers`, because the till
 * needs the account state in the same breath as the name: whether "On account"
 * may be offered at all, and how much room is left on it. Sending the balance
 * lets the tablet grey the tender out and say why, instead of letting a cashier
 * choose it and be refused after the customer has been told a total.
 *
 * The figures are for the screen only. `sale-core` re-reads the account and the
 * database re-checks the limit under a lock, so a stale balance here can show an
 * old number but can never authorise a charge.
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
    .from("customer_credit_accounts")
    .select("customer_id, full_name, phone, credit_enabled, credit_on_hold, balance")
    .or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%`)
    .order("full_name")
    .limit(20)

  if (error) return apiError(error.message, 500)

  return NextResponse.json({
    ok: true,
    customers: (data ?? []).map((row) => ({
      id: row.customer_id,
      fullName: row.full_name,
      phone: row.phone,
      // Named so an older APK that does not know about credit simply ignores
      // them. `creditEnabled` false is the "no account" case the till keys off.
      creditEnabled: row.credit_enabled ?? false,
      creditBalance: round2(Number(row.balance ?? 0)),
      creditOnHold: row.credit_on_hold ?? false,
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

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({
        ok: false,
        error: "A customer with that phone number already exists.",
      })
    }
    return NextResponse.json({ ok: false, error: error.message })
  }
  if (!data) return NextResponse.json({ ok: false, error: "The customer was not saved." })

  return NextResponse.json({
    ok: true,
    // A brand-new customer has no account: the owner opens one in the back
    // office. Sent explicitly so the till does not have to guess.
    customer: {
      id: data.id,
      fullName: data.full_name,
      phone: data.phone,
      creditEnabled: false,
      creditBalance: 0,
      creditOnHold: false,
    },
  })
}
