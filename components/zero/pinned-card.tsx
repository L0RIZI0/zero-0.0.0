"use client"

import { useMemo } from "react"
import { motion } from "motion/react"
import { getChildSpaces, getSpaceTasks, getSpace, type ContextItem } from "@/lib/zero/data"
import { layerTransition, spaceLayoutId, spaceTitleId } from "@/lib/zero/motion"
import { useZeroNav } from "@/lib/zero/nav-store"
import { NodeGlyph } from "./node-glyph"

/**
 * A pinned item in the SPACES row — uniform across all kinds (space / task /
 * event): the kind glyph sits in the top-left corner, a compact detail line
 * ({n} spaces · {n} open) sits to its right, and the title runs below. Spaces
 * carry the shared layoutId so the card morphs into the opened window.
 *
 * The two stats are read from the item's "home" space: the space itself for a
 * pinned space, or the parent space for a pinned task/event. The resource count
 * is intentionally omitted.
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

  const isSpace = item.kind === "space"

  // Spaces share their frame's layoutId for the expand morph; tasks/events use
  // a plain hover transition (their morph, if any, is driven from the list).
  //
  // NOTE: we deliberately keep this card continuously mounted (no
  // placeholder-swap while the space is open). `closeSpace` pops the stack
  // synchronously, so a swap would remount this layoutId node *during* the
  // frame's exit animation — two owners of the same layoutId mid-exit, which
  // strands the card at opacity:0 with a frozen projection transform. Keeping
  // one stable element lets Framer treat the frame + (occluded) card as a
  // single shared element and morph cleanly in both directions.
  const morphProps = isSpace
    ? { layoutId: spaceLayoutId(item.space!.id), transition: layerTransition }
    : { transition: layerTransition }

  return (
    <motion.button
      type="button"
      {...morphProps}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      style={{ borderRadius: 4 }}
      whileHover={{ scale: 1.03, boxShadow: "0 14px 32px -12px rgba(0,0,0,0.3)" }}
      className="group relative flex h-[64px] w-[112px] shrink-0 flex-col justify-between overflow-hidden border border-border bg-card-solid px-2.5 py-2 text-left"
    >
      {/* accent edge — shares the element with the space frame for spaces */}
      <motion.span
        {...(isSpace
          ? { layoutId: `${spaceLayoutId(item.space!.id)}-accent`, transition: layerTransition }
          : {})}
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
      {isSpace ? (
        <motion.h3
          layoutId={spaceTitleId(item.space!.id)}
          transition={layerTransition}
          className="truncate text-[12px] font-medium leading-tight tracking-tight text-foreground"
        >
          {item.title}
        </motion.h3>
      ) : (
        <h3 className="truncate text-[12px] font-medium leading-tight tracking-tight text-foreground">
          {item.title}
        </h3>
      )}
    </motion.button>
  )
}
