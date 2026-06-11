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
  onContextMenu,
}: {
  space: Space
  onOpen: (spaceId: string) => void
  onContextMenu?: (e: React.MouseEvent) => void
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
        className="h-[64px] w-[112px] shrink-0 rounded-sm border border-dashed border-border/60 bg-secondary/30"
      />
    )
  }

  return (
    <motion.button
      type="button"
      layoutId={spaceLayoutId(space.id)}
      transition={layerTransition}
      onClick={() => onOpen(space.id)}
      onContextMenu={onContextMenu}
      style={{ borderRadius: 4 }}
      whileHover={{
        scale: 1.03,
        boxShadow: "0 14px 32px -12px rgba(0,0,0,0.3)",
      }}
      className="group relative flex h-[64px] w-[112px] shrink-0 flex-col justify-between overflow-hidden border border-border bg-card-solid px-2.5 py-2 text-left"
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
          className="truncate text-[13px] font-medium leading-tight tracking-tight text-foreground"
        >
          {space.name}
        </motion.h3>
        <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
      </div>

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
        {childCount > 0 && <span>{childCount} spaces</span>}
        <span>{taskCount} open</span>
        <span>{resourceCount} res</span>
      </div>
    </motion.button>
  )
}
