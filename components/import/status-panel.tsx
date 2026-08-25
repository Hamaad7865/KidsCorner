"use client"

import type { UIEvent } from "react"
import { ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { ValidatedRow } from "@/lib/import/validate"
import { cn } from "@/lib/utils"

export type StatusEntry = {
  rowNumber: number
  validated?: ValidatedRow
}

/**
 * The status panel, deliberately OUT of the sheet: a sticky column inside the
 * table floats over whichever columns it is wider than, so the statuses live
 * beside the grid instead, in their own collapsible card. Rows are a fixed
 * height — the same height as the grid's — and the two panes' scroll is
 * mirrored by the parent, so row 27 lines up with row 27 all the way down.
 */
export function StatusPanel({
  entries,
  onCollapse,
  onScroll,
  scrollRef,
}: {
  entries: StatusEntry[]
  onCollapse: () => void
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    // Fixed height, flex column: the header takes what it takes and the list
    // scrolls in what is left — the SAME 26rem the sheet pane is set to, so
    // the card never grows unevenly.
    <div className="flex h-[26rem] w-72 shrink-0 flex-col border-l">
      {/* The header mirrors the sheet header's structure and its fixed 68px,
          so both panes' first data row starts at the same pixel. */}
      <div className="h-[68px] border-b px-3 py-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-muted-foreground font-mono text-[10px] tracking-wide uppercase">
            Status
          </p>
          <button
            type="button"
            onClick={onCollapse}
            title="Collapse the status panel"
            className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-0.5"
          >
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </div>
        <div className="flex h-8 items-center">
          <p className="text-muted-foreground truncate text-xs">
            What each row will do
          </p>
        </div>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <ul>
          {entries.map(({ rowNumber, validated }) => (
            <li
              key={rowNumber}
              className="flex h-9 items-center gap-1.5 border-b px-3 text-xs last:border-b-0"
            >
              <span className="text-muted-foreground w-7 shrink-0 text-right font-mono tabular-nums">
                {rowNumber}
              </span>
              <StatusLine validated={validated} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Badge + one-line reason. The full text is on hover, where it belongs. */
function StatusLine({ validated }: { validated?: ValidatedRow }) {
  if (!validated) {
    return <span className="text-muted-foreground truncate">—</span>
  }

  const hasError = validated.errors.length > 0
  const missing = validated.missing[0]
  const message = hasError
    ? validated.errors.join(" ")
    : missing
      ? validated.missing
          .map((m) => `${m.name} will be created as a new ${m.kind}`)
          .join(", ")
      : "New variant"

  return (
    <span className="flex min-w-0 items-center gap-1.5" title={message}>
      {hasError ? (
        <Badge variant="destructive" className="shrink-0">
          Error
        </Badge>
      ) : missing ? (
        <Badge
          variant="outline"
          className="border-warning-foreground/30 text-warning-foreground shrink-0"
        >
          New {missing.kind}
        </Badge>
      ) : (
        <Badge variant="outline" className="border-success/30 text-success shrink-0">
          Ready
        </Badge>
      )}
      <span
        className={cn(
          "min-w-0 truncate",
          hasError && "text-destructive",
          !hasError && missing && "text-warning-foreground",
          !hasError && !missing && "text-muted-foreground",
        )}
      >
        {message}
      </span>
    </span>
  )
}
