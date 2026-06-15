"use client"

import { useMemo } from "react"
import { motion } from "motion/react"
import { getOpenTaskCount, getSpace, type ContextItem } from "@/lib/zero/data"
import {
  layerTransition,
  FRAME_RADIUS,
  frameLayoutId,
  accentLayoutId,
  glyphLayoutId,
  titleLayoutId,
} from "@/lib/zero/motion"
import { useZeroNav, useRowSelection } from "@/lib/zero/nav-store"
import { NodeGlyph } from "./node-glyph"

/**
 * A pinned entity in the Dock — the COLLAPSED state of an entity: the kind glyph
 * sits top-left, a compact "open child tasks" stat sits top-right, and the title
 * runs below.
 *
 * SHARED-ELEMENT MORPH: the frame / accent / glyph / title are `motion` elements
 * carrying this entity's shared `layoutId`s, so opening the card hands those ids
 * to its window (EntityFrame), which flies them into the expanded layout — and
 * back here on close. While the entity is open the card RELEASES its layoutIds
 * (renders a faint placeholder of the same size) so only the window owns them;
 * one id may have a single on-screen owner at a time.
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
  const { stack } = useZeroNav()
  // Accent comes from the entity's home space: itself for a space, else its
  // origin parent (tasks/events inherit their container's tint).
  const homeSpaceId = item.kind === "space" ? item.entity.id : item.entity.parentId ?? "s_root"
  const accent = getSpace(homeSpaceId)?.accent ?? "var(--muted-foreground)"

  // Every entity is a container, so the detail counts the open DIRECT child
  // tasks of the entity itself (a pinned task shows its own open subtasks).
  const openCount = useMemo(() => getOpenTaskCount(item.entity.id), [item])

  const { lift, hoverProps, ref } = useRowSelection("dock", item.entity.id)

  // Released while this entity's window is open — its shared pieces live there.
  const released = stack.includes(item.entity.id)

  return (
    // Neutral wrapper is the direct AnimatePresence child (mode="popLayout"
    // applies position:absolute here on exit).
    <div className="shrink-0">
      <motion.button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        onClick={onOpen}
        onContextMenu={onContextMenu}
        {...hoverProps}
        animate={{ scale: lift && !released ? 1.03 : 1 }}
        className="group relative h-[64px] w-[112px] text-left"
      >
        {released ? (
          // Placeholder holding the slot while the window owns the shared pieces.
          <span
            aria-hidden
            className="absolute inset-0 border border-dashed border-border/60"
            style={{ borderRadius: FRAME_RADIUS }}
          />
        ) : (
          <>
            {/* FRAME — shared box (becomes the window's frame on open). */}
            <motion.span
              layoutId={frameLayoutId(item.entity.id)}
              transition={layerTransition}
              style={{ borderRadius: FRAME_RADIUS }}
              className="absolute inset-0 border border-border bg-card-solid"
            />
            {/* ACCENT — shared left strip. */}
            <motion.span
              layoutId={accentLayoutId(item.entity.id)}
              transition={layerTransition}
              aria-hidden
              className="absolute left-0 top-0 h-full w-[3px]"
              style={{
                backgroundColor: accent,
                borderTopLeftRadius: FRAME_RADIUS,
                borderBottomLeftRadius: FRAME_RADIUS,
              }}
            />

            {/* Content layer above the frame. */}
            <span className="absolute inset-0 z-10 flex flex-col justify-between px-2.5 py-2">
              <span className="flex items-start justify-between gap-1.5">
                <motion.span
                  layoutId={glyphLayoutId(item.entity.id)}
                  transition={layerTransition}
                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-foreground"
                >
                  <NodeGlyph kind={item.kind} strokeWidth={item.kind === "task" ? 2 : 1.75} />
                </motion.span>
                <span className="flex min-w-0 items-center gap-1 truncate whitespace-nowrap text-[10px] text-muted-foreground/70">
                  <span className="font-medium tabular-nums">{openCount}</span>
                  <span className="flex h-2.5 w-2.5 items-center justify-center text-muted-foreground/70">
                    <NodeGlyph kind="task" strokeWidth={1.5} />
                  </span>
                </span>
              </span>

              <motion.span
                layoutId={titleLayoutId(item.entity.id)}
                transition={layerTransition}
                className="block truncate text-[12px] font-medium leading-tight tracking-tight text-foreground"
              >
                {item.title}
              </motion.span>
            </span>
          </>
        )}
      </motion.button>
    </div>
  )
}
