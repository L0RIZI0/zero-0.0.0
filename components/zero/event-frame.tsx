"use client"

import { motion, useIsPresent } from "motion/react"
import { X, Clock, Hash } from "lucide-react"
import type { Entity } from "@/lib/zero/types"
import { getSpace } from "@/lib/zero/data"
import {
  layerTransition,
  eventLayoutId,
  eventTitleId,
  eventRowLayoutId,
  eventRowTitleId,
  glyphId,
  contentTransition,
} from "@/lib/zero/motion"
import { usePulse } from "@/lib/zero/use-pulse"
import { useZeroNav } from "@/lib/zero/nav-store"
import { NodeGlyph } from "./node-glyph"

/** Minutes-from-midnight → "9:00 AM". */
function fmtTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

/**
 * An Event window — chrome only, the third first-class kind alongside Space and
 * Task. Like the others it paints the bordered frame and owns the title band
 * (glyph + title + time range), leaving the middle transparent so the
 * persistent frontmost content reads in front of it. An event has no children
 * of its own to dock, so its bottom band is minimal.
 */
export function EventFrame({
  event,
  isActive,
  onClose,
}: {
  event: Entity
  isActive: boolean
  onClose: () => void
}) {
  // The event's origin parent provides the contextual accent + membership line.
  const parentSpaceId = event.parentId ?? "s_root"
  const parentSpace = getSpace(parentSpaceId)
  const accent = parentSpace?.accent ?? "var(--accent)"
  const spaceNames = [parentSpaceId, ...event.taggedSpaceIds]
    .map((id) => getSpace(id)?.title)
    .filter(Boolean) as string[]

  const hasRange = typeof event.start === "number" && typeof event.end === "number"
  // Bounce when the user re-clicks this event's timeline chip while it's open.
  const pulseControls = usePulse(event.id)

  // The window morphs to/from wherever it was opened: its DO-list ROW or its
  // TIMELINE marker. We adopt that source's shared ids so the expand/collapse
  // animation connects to the right element. (The non-source twin keeps its
  // own ids and simply stays in place.)
  const { openSourceOf } = useZeroNav()
  const fromRow = openSourceOf(event.id) === "row"
  // Drop shared layoutIds while exiting so the re-mounting source (row or
  // timeline marker) is the sole owner and morphs cleanly back into place.
  const isPresent = useIsPresent()
  const frameLayoutId = !isPresent
    ? undefined
    : fromRow
      ? eventRowLayoutId(event.id)
      : eventLayoutId(event.id)
  const frameTitleId = !isPresent
    ? undefined
    : fromRow
      ? eventRowTitleId(event.id)
      : eventTitleId(event.id)
  const accentMorphId = isPresent ? `${eventLayoutId(event.id)}-accent` : undefined
  const glyphMorphId = isPresent ? glyphId(event.id) : undefined

  return (
    <motion.div
      layoutId={frameLayoutId}
      transition={layerTransition}
      animate={pulseControls}
      style={{ borderRadius: 4 }}
      className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-secondary/40 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
    >
      {/* accent edge — shares element with the row/card accent. Only the
          timeline morph carries a matching accent twin, so this is keyed to the
          timeline layoutId regardless of source (a no-op when opened from row). */}
      <motion.span
        layoutId={accentMorphId}
        transition={layerTransition}
        className="absolute left-0 top-0 z-10 h-full w-[3px]"
        style={{ backgroundColor: accent }}
      />

      {/* Title band — only the active (frontmost) frame paints its header, so a
          receding parent frame reads as a blank backdrop instead of bleeding
          its glyph / metadata / close button through the active layer. */}
      {isActive && (
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div className="flex min-w-0 items-start gap-3">
            <motion.span
              layoutId={glyphMorphId}
              transition={layerTransition}
              className="mt-1 flex h-[26px] w-[26px] shrink-0 items-center justify-center text-foreground"
            >
              <NodeGlyph kind="event" />
            </motion.span>
            <div className="flex min-w-0 flex-col">
              <motion.h2
                layoutId={frameTitleId}
                transition={layerTransition}
                className="text-pretty text-[22px] font-medium leading-tight tracking-tight text-foreground"
              >
                {event.title}
              </motion.h2>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ ...contentTransition, delay: 0.08 }}
                className="mt-1 flex flex-wrap items-center gap-2"
              >
                <span className="truncate text-[12.5px] text-muted-foreground">
                  {spaceNames.join(" · ")}
                </span>
                {hasRange && (
                  <span className="flex items-center gap-1.5 rounded-sm border border-border bg-card/50 px-2 py-1 text-[11.5px] text-foreground">
                    <Clock className="h-3 w-3" style={{ color: accent }} />
                    {fmtTime(event.start!)} – {fmtTime(event.end!)}
                  </span>
                )}
                {(event.tags ?? []).map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 rounded-sm border border-border bg-card/50 px-2 py-1 text-[11.5px] text-muted-foreground"
                  >
                    <Hash className="h-3 w-3" />
                    {t}
                  </span>
                ))}
              </motion.div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${event.title}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Transparent middle — the persistent frontmost content renders over it. */}
      <div className="min-h-0 flex-1" aria-hidden />
    </motion.div>
  )
}
