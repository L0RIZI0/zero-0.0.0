"use client"

import { useMemo } from "react"
import { motion } from "motion/react"
import { getChildSpaces, getSpaceTasks, getSpace, type ContextItem } from "@/lib/zero/data"
import { panelTransition } from "@/lib/zero/motion"
import { NodeGlyph } from "./node-glyph"

/**
 * A pinned item in the SPACES row — uniform across all kinds (space / task /
 * event): the kind glyph sits in the top-left corner, a compact detail line
 * ({n} spaces · {n} open) sits to its right, and the title runs below.
 *
 * The two stats are read from the item's "home" space: the space itself for a
 * pinned space, or the parent space for a pinned task/event. The resource count
 * is intentionally omitted.
 *
 * IMPORTANT — no shared layoutId here (unlike the task-list SpaceRow). The dock
 * re-filters to the active context, so a pinned space's card UNMOUNTS the moment
 * its space opens (the opened context has no pins of its own). That leaves the
 * window frame as the sole owner of the shared layoutId; on close, Framer would
 * match the remounting card to the *exiting frame's* box and strand it at
 * opacity:0 off-screen. A shared-layout morph only works when the anchor stays
 * mounted behind the modal, which isn't possible for a context-filtered dock.
 * So the card uses a plain enter/exit fade — reliably present before open and
 * after close. (The task list keeps the morph, since its rows stay mounted.)
 */
export function PinnedCard({
  item,
  onOpen,
  onContextMenu,
}: {
  item: ContextItem
  onOpen: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  // Resolve the home space for the detail stats.
  const homeSpaceId =
    item.kind === "space"
      ? item.space!.id
      : item.kind === "task"
        ? item.task!.spaceIds[item.task!.spaceIds.length - 1]
        : item.event!.spaceId

  const accent = getSpace(homeSpaceId)?.accent ?? "var(--muted-foreground)"
  const childCount = useMemo(() => getChildSpaces(homeSpaceId).length, [homeSpaceId, item])
  const openCount = useMemo(
    () => getSpaceTasks(homeSpaceId).filter((t) => !t.completed).length,
    [homeSpaceId, item],
  )

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={panelTransition}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      style={{ borderRadius: 4 }}
      whileHover={{ scale: 1.03, boxShadow: "0 14px 32px -12px rgba(0,0,0,0.3)" }}
      className="group relative flex h-[64px] w-[112px] shrink-0 flex-col justify-between overflow-hidden border border-border bg-card-solid px-2.5 py-2 text-left"
    >
      {/* accent edge */}
      <span
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ backgroundColor: accent }}
      />

      {/* Top row: kind glyph (top-left) + detail stats pinned to top-right. */}
      <div className="flex items-start justify-between gap-1.5">
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-foreground">
          <NodeGlyph kind={item.kind} strokeWidth={item.kind === "task" ? 2 : 1.75} />
        </span>
        <div className="flex min-w-0 items-center gap-1 truncate whitespace-nowrap text-[10px] text-muted-foreground/70">
          {childCount > 0 && <span>{childCount} sp</span>}
          {childCount > 0 && <span aria-hidden>·</span>}
          <span>{openCount} open</span>
        </div>
      </div>

      {/* Title below the icon + details. */}
      <h3 className="truncate text-[12px] font-medium leading-tight tracking-tight text-foreground">
        {item.title}
      </h3>
    </motion.button>
  )
}
