"use client"

import { motion } from "motion/react"
import { ArrowUpRight } from "lucide-react"
import type { Space } from "@/lib/zero/types"
import { getChildSpaces, getSpaceResources, getSpaceTasks } from "@/lib/zero/data"
import { layerTransition, spaceLayoutId, spaceTitleId } from "@/lib/zero/motion"
import { useZeroNav } from "@/lib/zero/nav-store"
import { useMemo } from "react"

export function SpaceButton({
  space,
  onOpen,
}: {
  space: Space
  onOpen: (spaceId: string) => void
}) {
  const { stack } = useZeroNav()
  const accent = space.accent ?? "var(--muted-foreground)"
  const childCount = space.childSpaceIds.length
  const taskCount = useMemo(() => getSpaceTasks(space.id).filter((t) => !t.completed).length, [space.id])
  const resourceCount = useMemo(() => getSpaceResources(space.id).length, [space.id])

  // While this space is open as a frame in the stack, render an inert
  // placeholder so the shared layoutId lives only on the active frame.
  const isOpen = stack.includes(space.id)
  if (isOpen) {
    return (
      <div
        aria-hidden
        className="min-h-[148px] w-full rounded-[18px] border border-dashed border-border/60 bg-secondary/30"
      />
    )
  }

  return (
    <motion.button
      type="button"
      layoutId={spaceLayoutId(space.id)}
      transition={layerTransition}
      onClick={() => onOpen(space.id)}
      style={{ borderRadius: 18 }}
      className="group relative flex h-full min-h-[148px] w-full flex-col justify-between overflow-hidden border border-border bg-card/70 p-4 text-left transition-colors hover:border-foreground/20 hover:bg-card"
    >
      {/* accent edge */}
      <motion.span
        layoutId={`${spaceLayoutId(space.id)}-accent`}
        transition={layerTransition}
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ backgroundColor: accent }}
      />

      <div className="flex items-start justify-between gap-2">
        <motion.h3
          layoutId={spaceTitleId(space.id)}
          transition={layerTransition}
          className="font-serif text-[19px] leading-tight tracking-tight text-foreground"
        >
          {space.name}
        </motion.h3>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
      </div>

      <div className="flex flex-col gap-3">
        <p className="line-clamp-2 text-pretty text-[12px] leading-relaxed text-muted-foreground">
          {space.description}
        </p>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
          {childCount > 0 && <span>{childCount} spaces</span>}
          <span>{taskCount} open</span>
          <span>{resourceCount} resources</span>
        </div>
      </div>
    </motion.button>
  )
}
