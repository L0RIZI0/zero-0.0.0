"use client"

import { useState } from "react"
import { motion } from "motion/react"
import { Check, X } from "lucide-react"
import type { Entity } from "@/lib/zero/types"
import { getSpace } from "@/lib/zero/data"
import { layerTransition, type Rect } from "@/lib/zero/motion"
import { NodeGlyph } from "./node-glyph"
import { EntityBody } from "./entity-body"

const HEADER_H = 40

/** Minutes-from-midnight → "9:00 AM". */
function fmtTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

/**
 * Generic window for ANY entity kind — there is exactly one frame component, no
 * per-kind variants. Kind only changes a few details inside: the leading glyph
 * doubles as a completion toggle for tasks, and events/instants show their time.
 *
 * MORPH MODEL: the window is a plain absolutely-positioned box that tweens
 * {top,left,width,height} between its measured SOURCE rect (the clicked
 * row/card/marker) and its static DEPTH-target rect, while the body crossfades.
 * Framer animates the box on mount from `initial`→`animate`, so:
 *   - open    : grows source → target, body fades IN (the "spawn from center").
 *   - closing : shrinks target → source, body fades OUT — the whole window
 *               collapses into its button, carrying the glyph + title with it.
 * Because the geometry is driven directly by initial/animate (not a post-mount
 * state flip), `onAnimationComplete` fires only after the real shrink — which is
 * what makes the close animation actually play.
 */
export function EntityFrame({
  entity,
  isTop,
  targetRect,
  sourceRect,
  mode,
  onClose,
  onClosed,
}: {
  entity: Entity
  /** Frontmost window — only it shows its body; ancestors show just the header. */
  isTop: boolean
  /** Static destination box for this depth (where the open window rests). */
  targetRect: Rect
  /** Measured box of the source row/card/marker; null falls back to a fade. */
  sourceRect: Rect | null
  /** "open" grows source→target; "closing" shrinks target→source then unmounts. */
  mode: "open" | "closing"
  /** Header close button — closes THIS window (and anything above it). */
  onClose: () => void
  /** Called once a "closing" window finishes shrinking, so the store drops it. */
  onClosed?: () => void
}) {
  const isTask = entity.kind === "task"
  // Accent comes from the entity's home space (itself for a space, else its
  // parent), shown as a thin LEFT strip — the border itself stays neutral.
  const homeSpaceId = entity.kind === "space" ? entity.id : entity.parentId ?? "s_root"
  const accent = getSpace(homeSpaceId)?.accent ?? "var(--muted-foreground)"
  const [done, setDone] = useState(!!entity.completed)

  const from = sourceRect ?? targetRect
  const initialBox = mode === "open" ? from : targetRect
  const animateBox = mode === "open" ? targetRect : from

  // Body is mounted (and fades) only for the frontmost open window and for the
  // closing overlay; receded ancestors show just their header strip.
  const renderBody = isTop || mode === "closing"
  const hasRange = typeof entity.start === "number" && typeof entity.end === "number"

  return (
    <motion.div
      className="absolute overflow-hidden rounded-md border border-border bg-card shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
      // Top window is fully interactive; ancestors are click-through EXCEPT their
      // header bar (which re-enables pointer events so its close button works).
      style={{ pointerEvents: isTop ? "auto" : "none" }}
      initial={{ top: initialBox.top, left: initialBox.left, width: initialBox.width, height: initialBox.height }}
      animate={{ top: animateBox.top, left: animateBox.left, width: animateBox.width, height: animateBox.height }}
      transition={layerTransition}
      onAnimationComplete={() => {
        if (mode === "closing") onClosed?.()
      }}
    >
      {/* Left accent strip so the window reads as belonging to its space. */}
      <div className="absolute left-0 top-0 z-10 h-full w-[3px]" style={{ backgroundColor: accent }} aria-hidden />

      {/* Header / nav bar — glyph + title + bare-X close. Always shown (this is
          also the peeking bar for receded ancestors, whose header re-enables
          pointer events so the user can click it to cascade-close to here). */}
      <div
        className="relative z-10 flex items-center gap-2 px-3"
        style={{ height: HEADER_H, pointerEvents: "auto" }}
      >
        {isTask ? (
          // For a task the glyph IS the completion toggle — a single square, so
          // there is no second checkbox box beside it.
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setDone((d) => !d)
            }}
            aria-label={done ? "Mark task incomplete" : "Mark task complete"}
            className="relative flex size-4 shrink-0 items-center justify-center text-foreground"
          >
            <NodeGlyph kind="task" filled={done} strokeWidth={2} />
            {done && <Check className="absolute h-2.5 w-2.5 text-background" strokeWidth={3.5} />}
          </button>
        ) : (
          <span className="flex size-4 shrink-0 items-center justify-center text-foreground">
            <NodeGlyph kind={entity.kind} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight text-foreground">
          {entity.title}
        </span>
        {hasRange && isTop && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {fmtTime(entity.start!)} – {fmtTime(entity.end!)}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          aria-label={`Close ${entity.title}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body crossfades so box scaling never distorts dense content. */}
      {renderBody && (
        <motion.div
          className="absolute inset-x-0 bottom-0 overflow-hidden"
          style={{ top: HEADER_H }}
          initial={{ opacity: mode === "open" ? 0 : 1 }}
          animate={{ opacity: mode === "open" ? 1 : 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <EntityBody entityId={entity.id} />
        </motion.div>
      )}
    </motion.div>
  )
}
