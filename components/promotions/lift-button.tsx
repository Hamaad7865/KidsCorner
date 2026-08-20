"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Undo2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { liftPromotion } from "@/lib/promotions/actions"
import { IDLE_STATE } from "@/lib/forms"

/**
 * Ends a promotion and puts the price back. The server restores the original
 * price only if nobody changed it by hand in the meantime, and the toast says
 * which happened.
 */
export function LiftButton({ promotionId }: { promotionId: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function lift() {
    const fd = new FormData()
    fd.set("promotionId", String(promotionId))
    startTransition(async () => {
      const result = await liftPromotion(IDLE_STATE, fd)
      if (result.status === "success") {
        toast.success(result.message ?? "Promotion lifted.")
        router.refresh()
      } else {
        toast.error(result.error ?? "Could not lift the promotion.")
      }
    })
  }

  return (
    <Button variant="outline" size="sm" onClick={lift} disabled={pending}>
      <Undo2 aria-hidden />
      {pending ? "Lifting…" : "Lift"}
    </Button>
  )
}
