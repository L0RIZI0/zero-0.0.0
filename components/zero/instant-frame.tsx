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
 * An Instant window — like the Event frame but for a single POINT in time, so
 * its time chip shows one precise moment (down to the second) rather than a
 * range. Same compact nested-doll header as the other kinds.
 */
export function InstantFrame({
  instant,
  depth,
  isTop,
  onCloseTo,
}: {
  instant: Entity
  depth: number
  isTop: boolean
  onCloseTo: (targetTopIndex: number) => void
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
      className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-card shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
    >
      {/* accent edge keyed to the timeline morph (a no-op when opened from row). */}
      <motion.span
        layoutId={accentMorphId}
        transition={layerTransition}
        className="absolute left-0 top-0 z-10 h-full w-[3px]"
        style={{ backgroundColor: accent }}
      />

      {/* Compact nav-bar header — always rendered so this instant's title peeks
          above its children; pointer-events stay live for ancestor close. */}
      <div
        className="relative flex min-h-[40px] items-center gap-2 px-3"
        style={{ pointerEvents: "auto" }}
      >
        <motion.span
          layoutId={glyphMorphId}
          transition={layerTransition}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-foreground"
        >
          <NodeGlyph kind="instant" />
        </motion.span>

        <motion.h2
          layoutId={frameTitleId}
          transition={layerTransition}
          className="min-w-0 flex-1 truncate whitespace-nowrap text-sm font-medium leading-tight tracking-tight text-foreground"
        >
          {instant.title}
        </motion.h2>

        <button
          type="button"
          onClick={() => onCloseTo(depth - 1)}
          aria-label={`Close ${instant.title}`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Meta line — top window only (ancestors are covered below their peek). */}
      {isTop && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...contentTransition, delay: 0.08 }}
          className="flex flex-wrap items-center gap-2 px-3 pb-2 pl-4"
        >
          <span className="truncate text-[12.5px] text-muted-foreground">{spaceNames.join(" · ")}</span>
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
      )}

      {/* Body renders at full opacity so the close shrink stays fully visible. */}
      <EntityBody nodeId={instant.id} />
    </motion.div>
  )
}
