"use client"

import type { ReactNode } from "react"
import { Plus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/**
 * Section shell shared by the four master data tabs: heading, count, add
 * button, and a friendly empty state (spec: "Friendly empty states with clear
 * CTAs").
 */
export function MasterDataPanel({
  title,
  description,
  count,
  addLabel,
  onAdd,
  emptyTitle,
  emptyBody,
  children,
}: {
  title: string
  description: string
  count: number
  addLabel: string
  onAdd: () => void
  emptyTitle: string
  emptyBody: string
  children: ReactNode
}) {
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-heading flex items-center gap-2 text-base font-medium">
            {title}
            <span className="text-muted-foreground text-sm font-normal tabular-nums">
              {count}
            </span>
          </h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <Button onClick={onAdd}>
          <Plus aria-hidden />
          {addLabel}
        </Button>
      </header>

      {count === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">{emptyTitle}</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            {emptyBody}
          </p>
          <Button className="mt-4" onClick={onAdd}>
            <Plus aria-hidden />
            {addLabel}
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">{children}</div>
      )}
    </section>
  )
}

/** Consistent active/inactive marker across all four tables. */
export function ActiveBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <Badge variant="secondary">Active</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Inactive
    </Badge>
  )
}
