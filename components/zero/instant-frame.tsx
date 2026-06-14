"use client"

import { motion } from "motion/react"
import { X, Clock, Hash } from "lucide-react"
import type { Entity } from "@/lib/zero/types"
import { getSpace } from "@/lib/zero/data"
import {
  layerTransition,
  instantLayoutId,
  instantTitleId,
  instantRowLayoutId,
  instantRowTitleId,
  glyphId,
  contentTransition,
} from "@/lib/zero/motion"
import { usePulse } from "@/lib/zero/use-pulse"
import { useZeroNav } from "@/lib/zero/nav-store"
import { NodeGlyph } from "./node-glyph"
import { EntityBody } from "./entity-body"

/** Minutes-from-midnight (+ optional seconds) → "9:00:30 AM". */
function fmtInstant(min: number, seconds = 0): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  const ss = seconds.toString().padStart(2, "0")
  return `${h12}:${m.toString().padStart(2, "0")}:${ss} ${period}`
}

/**
 * An Instant window — the fourth first-class kind. It mirrors the Event frame
 * exactly (bordered frame, title band, transparent middle) but represents a
 * single POINT in time rather than a span, so its time chip shows one precise
 * moment (down to the second) instead of a start–end range. Its shared layoutId
 * morphs between the timeline marker and this window.
 */
export function InstantFrame({
  instant,
  isActive,
  onClose,
}: {
  instant: Entity
  isActive: boolean
  onClose: () => void
}) {
  const parentSpaceId = instant.parentId ?? "s_root"
  const parentSpace = getSpace(parentSpaceId)
  const accent = parentSpace?.accent ?? "var(--accent)"
  const spaceNames = [parentSpaceId, ...instant.taggedSpaceIds]
    .map((id) => getSpace(id)?.title)
    .filter(Boolean) as string[]

  const hasMoment = typeof instant.at === "number"
  const pulseControls = usePulse(instant.id)

  // Morph to/from the source it was opened from — its DO-list ROW or its
  // TIMELINE marker — by adopting that source's shared ids.
  const { openSourceOf } = useZeroNav()
  const fromRow = openSourceOf(instant.id) === "row"
  // Morph to/from whichever source the window was opened from. On close the
  // frame unmounts immediately (SpaceLayerStack has no AnimatePresence), so the
  // source is the sole owner of these ids and morphs back cleanly — no ghost.
  const frameLayoutId = fromRow ? instantRowLayoutId(instant.id) : instantLayoutId(instant.id)
  const frameTitleId = fromRow ? instantRowTitleId(instant.id) : instantTitleId(instant.id)
  const accentMorphId = `${instantLayoutId(instant.id)}-accent`
  const glyphMorphId = glyphId(instant.id)

  return (
    <motion.div
      layoutId={frameLayoutId}
      transition={layerTransition}
      animate={pulseControls}
      style={{ borderRadius: 4 }}
      className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-secondary/40 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
    >
      {/* accent edge keyed to the timeline morph (a no-op when opened from row). */}
      <motion.span
        layoutId={accentMorphId}
        transition={layerTransition}
        className="absolute left-0 top-0 z-10 h-full w-[3px]"
        style={{ backgroundColor: accent }}
      />

      {isActive && (
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div className="flex min-w-0 items-start gap-3">
            <motion.span
              layoutId={glyphMorphId}
              transition={layerTransition}
              className="mt-1 flex h-[26px] w-[26px] shrink-0 items-center justify-center text-foreground"
            >
              <NodeGlyph kind="instant" />
            </motion.span>
            <div className="flex min-w-0 flex-col">
              <motion.h2
                layoutId={frameTitleId}
                transition={layerTransition}
                className="text-pretty text-[22px] font-medium leading-tight tracking-tight text-foreground"
              >
                {instant.title}
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
                {hasMoment && (
                  <span className="flex items-center gap-1.5 rounded-sm border border-border bg-card/50 px-2 py-1 text-[11.5px] text-foreground">
                    <Clock className="h-3 w-3" style={{ color: accent }} />
                    {fmtInstant(instant.at!, instant.seconds ?? 0)}
                  </span>
                )}
                {(instant.tags ?? []).map((t) => (
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
            aria-label={`Close ${instant.title}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Body (this instant's inputs / related items / outputs) renders inside
          the frame when active, at full opacity (no fade) so that on close the
          source morphing within it stays visible as the window shrinks back. */}
      {isActive ? (
        <EntityBody nodeId={instant.id} />
      ) : (
        <div className="min-h-0 flex-1" aria-hidden />
      )}
    </motion.div>
  )
}
