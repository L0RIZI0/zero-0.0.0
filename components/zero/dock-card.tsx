"use client"

import { useMemo } from "react"
import { motion } from "motion/react"
import { getOpenTaskCount, getSpace, type ContextItem } from "@/lib/zero/data"
import { MORPH_SOURCE_ATTR, MORPH_WHERE_ATTR } from "@/lib/zero/motion"
import { useRowSelection } from "@/lib/zero/nav-store"
import { NodeGlyph } from "./node-glyph"

/**
 * A pinned entity in the Dock — uniform across all kinds (space / task / event /
 * instant): the kind glyph sits in the top-left corner, a compact detail line
 * showing the number of open child tasks ({n} + task square) sits to its right,
 * and the title runs below.
 *
 * MORPH SOURCE: this card tags itself with `data-morph-source={id}` (and
 * `data-morph-where="dock"`) so opening it lets EntityFrame measure this exact
 * box and grow the window out of it — and shrink back into it on close.
 */
export function DockCard({
  item,
  onOpen,
  onContextMenu,
}: {
  item: ContextItem
  onOpen: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  // Accent comes from the entity's home space: itself for a space, else its
  // origin parent (tasks/events inherit their container's tint).
  const homeSpaceId = item.kind === "space" ? item.entity.id : item.entity.parentId ?? "s_root"
  const accent = getSpace(homeSpaceId)?.accent ?? "var(--muted-foreground)"

  // Every entity is a container, so the detail counts the open DIRECT child
  // tasks of the entity itself (a pinned task shows its own open subtasks).
  const openCount = useMemo(() => getOpenTaskCount(item.entity.id), [item])

  const { lift, hoverProps, ref } = useRowSelection("dock", item.entity.id)

  return (
    // Neutral wrapper is the direct AnimatePresence child (mode="popLayout"
    // applies position:absolute here on exit).
    <div className="shrink-0">
      <motion.button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        {...{ [MORPH_SOURCE_ATTR]: item.entity.id, [MORPH_WHERE_ATTR]: "dock" }}
        onClick={onOpen}
        onContextMenu={onContextMenu}
        {...hoverProps}
        style={{ borderRadius: 4 }}
        animate={{ scale: lift ? 1.03 : 1 }}
        className="group relative flex h-[64px] w-[112px] flex-col justify-between overflow-hidden border border-border bg-card-solid px-2.5 py-2 text-left"
      >
        {/* accent edge */}
        <span className="absolute left-0 top-0 h-full w-[3px]" style={{ backgroundColor: accent }} />

        {/* Top row: kind glyph (top-left) + detail stats pinned to top-right. */}
        <div className="flex items-start justify-between gap-1.5">
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-foreground">
            <NodeGlyph kind={item.kind} strokeWidth={item.kind === "task" ? 2 : 1.75} />
          </span>
          <div className="flex min-w-0 items-center gap-1 truncate whitespace-nowrap text-[10px] text-muted-foreground/70">
            <span className="font-medium tabular-nums">{openCount}</span>
            <span className="flex h-2.5 w-2.5 items-center justify-center text-muted-foreground/70">
              <NodeGlyph kind="task" strokeWidth={1.5} />
            </span>
          </div>
        </div>

        {/* Title below the icon + details. */}
        <h3 className="truncate text-[12px] font-medium leading-tight tracking-tight text-foreground">
          {item.title}
        </h3>
      </motion.button>
    </div>
  )
}
