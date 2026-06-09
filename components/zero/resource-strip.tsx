"use client"

import { useMemo } from "react"
import { AnimatePresence } from "motion/react"
import { Plus } from "lucide-react"
import { getSpaceResources } from "@/lib/zero/data"
import { ResourceChip } from "./resource-chip"

export function ResourceStrip({ spaceId }: { spaceId: string }) {
  const resources = useMemo(() => getSpaceResources(spaceId), [spaceId])

  return (
    <section aria-label="Contextual resources" className="px-1">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Resources in context
        </h2>
        <span className="text-[11px] tracking-tight text-muted-foreground/70">
          {resources.length} assigned
        </span>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        <AnimatePresence mode="popLayout" initial={false}>
          {resources.map((r, i) => (
            <ResourceChip key={r.id} resource={r} index={i} />
          ))}
        </AnimatePresence>

        <button
          type="button"
          aria-label="Assign a resource to this space"
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground/60 transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </section>
  )
}
