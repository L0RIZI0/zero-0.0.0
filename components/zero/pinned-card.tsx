"use client"

import { useMemo } from "react"
import { motion } from "motion/react"
import { getOpenTaskCount, getSpace, type ContextItem } from "@/lib/zero/data"
import {
  layerTransition,
  spaceLayoutId,
  spaceTitleId,
  taskLayoutId,
  taskTitleId,
  glyphId,
} from "@/lib/zero/motion"
import { useZeroNav } from "@/lib/zero/nav-store"
import { NodeGlyph } from "./node-glyph"

/**
 * A pinned item in the SPACES row — uniform across all kinds (space / task /
 * event): the kind glyph sits in the top-left corner, a compact detail line
 * showing the number of open tasks ({n} + task square) sits to its right, and
 * the title runs below.
 *
 * The open-task count is read from the item's "home" space: the space itself
 * for a pinned space, or the parent space for a pinned task/event. Subspace and
 * resource counts are intentionally omitted.
 *
 * Spaces carry the SAME shared layoutId as the window frame (and as the
 * task-list SpaceRow) so opening/closing morphs the card ↔ frame directly. The
 * card is only ever rendered in its parent/pin context; opening it switches the
 * active context away, so the card naturally unmounts and the frame becomes the
 * sole layoutId owner. While the space sits in the stack we also swap in an
 * inert placeholder (mirroring SpaceRow) so the id never has two live owners.
 * Tasks/events have no frame morph, so they use a plain enter/exit fade.
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
  // Accent comes from the item's home space: itself for a space, else its
  // origin parent (tasks/events inherit their container's tint).
  const homeSpaceId = item.kind === "space" ? item.entity.id : item.entity.parentId ?? "s_root"
  const accent = getSpace(homeSpaceId)?.accent ?? "var(--muted-foreground)"

  // Every entity is a container, so the detail counts the open DIRECT child
  // tasks of the item itself (a pinned task shows its own open subtasks).
  const openCount = useMemo(
    () => getOpenTaskCount(item.entity.id),
    [item],
  )

  const isSpace = item.kind === "space"
  const isTask = item.kind === "task"
  // Every kind morphs between its DO-list row and this dock card via a shared
  // layoutId. Spaces and tasks ALSO own a window frame that shares the same id,
  // so while their frame is open we release the id to the frame (placeholder
  // swap below). Events have no frame, so they never need that swap.
  const hasFrame = isSpace || isTask
  const { stack } = useZeroNav()

  // While this space/task is open as a frame, release the shared layoutId to
  // the frame via an inert placeholder so the morph has exactly one live owner.
  // (Same neutral wrapper as the live card so popLayout sizing stays stable.)
  if (hasFrame && stack.includes(item.entity.id)) {
    return (
      <div className="shrink-0">
        <div
          aria-hidden
          className="h-[64px] w-[112px] rounded-sm border border-dashed border-border/60 bg-secondary/30"
        />
      </div>
    )
  }

  // Per-kind shared ids so the card morphs continuously to/from the DO-list row
  // (and, for spaces/tasks, the window frame too). Events are the exception:
  // they morph only between the TIMELINE and their window, so a pinned event
  // card is static (no shared ids) — otherwise it would fight the timeline
  // overlay for the same layoutId.
  const isEvent = item.kind === "event"
  const morphLayoutId = isSpace
    ? spaceLayoutId(item.entity.id)
    : isTask
      ? taskLayoutId(item.entity.id)
      : undefined
  const morphTitleId = isSpace
    ? spaceTitleId(item.entity.id)
    : isTask
      ? taskTitleId(item.entity.id)
      : undefined
  const morphProps = morphLayoutId ? { layoutId: morphLayoutId, transition: layerTransition } : {}

  return (
    // Neutral wrapper is the direct AnimatePresence child. CRITICAL for
    // mode="popLayout": when a space card exits (context switches as its frame
    // opens), AnimatePresence applies position:absolute to THIS wrapper. If the
    // layoutId element were the direct child instead, popLayout's absolute
    // positioning would collide with the layout projection and strand the card
    // at opacity:0 on close. The task-list rows use the same <li> wrapper trick.
    <div className="shrink-0">
      <motion.button
        type="button"
        {...morphProps}
        onClick={onOpen}
        onContextMenu={onContextMenu}
        style={{ borderRadius: 4 }}
        whileHover={{ scale: 1.03, boxShadow: "0 14px 32px -12px rgba(0,0,0,0.3)" }}
        className="group relative flex h-[64px] w-[112px] flex-col justify-between overflow-hidden border border-border bg-card-solid px-2.5 py-2 text-left"
      >
        {/* accent edge — shares the element with the frame's accent strip for spaces */}
        {isSpace ? (
          <motion.span
            layoutId={`${spaceLayoutId(item.space!.id)}-accent`}
            transition={layerTransition}
            className="absolute left-0 top-0 h-full w-[3px]"
            style={{ backgroundColor: accent }}
          />
        ) : (
          <span
            className="absolute left-0 top-0 h-full w-[3px]"
            style={{ backgroundColor: accent }}
          />
        )}

        {/* Top row: kind glyph (top-left) + detail stats pinned to top-right.
            The glyph carries the shared per-entity glyphId so the icon travels
            continuously between the DO-list row and this card. */}
        <div className="flex items-start justify-between gap-1.5">
          <motion.span
            layoutId={isEvent ? undefined : glyphId(item.entity.id)}
            transition={layerTransition}
            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-foreground"
          >
            <NodeGlyph kind={item.kind} strokeWidth={item.kind === "task" ? 2 : 1.75} />
          </motion.span>
          <div className="flex min-w-0 items-center gap-1 truncate whitespace-nowrap text-[10px] text-muted-foreground/70">
            <span className="font-medium tabular-nums">{openCount}</span>
            <span className="flex h-2.5 w-2.5 items-center justify-center text-muted-foreground/70">
              <NodeGlyph kind="task" strokeWidth={1.5} />
            </span>
          </div>
        </div>

        {/* Title below the icon + details. Every kind shares a title layoutId
            so the label travels continuously between row and card (and the
            window frame too, for spaces/tasks) instead of cross-fading. */}
        <motion.h3
          layoutId={morphTitleId}
          transition={layerTransition}
          className="truncate text-[12px] font-medium leading-tight tracking-tight text-foreground"
        >
          {item.title}
        </motion.h3>      </motion.button>
    </div>
  )
}
