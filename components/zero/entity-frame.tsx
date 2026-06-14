"use client"

import { useLayoutEffect, useState } from "react"
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
 * Generic window for ANY entity kind. Replaces the old per-kind SpaceFrame /
 * TaskFrame / EventFrame / InstantFrame. Kind-specific chrome is a handful of
 * small conditionals (task checkbox, space accent strip, event/instant time).
 *
 * MORPH MODEL (the reason this rewrite exists): the window does NOT use Framer's
 * shared-`layoutId` projection (which applied non-uniform scale between a tiny
 * row/card and a fullscreen window, stretching the text). Instead it is a plain
 * absolutely-positioned box that tweens {top,left,width,height} between its
 * measured SOURCE rect (the clicked row/card/marker) and its static DEPTH-target
 * rect, while its body crossfades. Box scaling is therefore never visible on
 * text, and there is no ancestor-transform fragility.
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
  const isSpace = entity.kind === "space"
  // Spaces carry their own accent; other kinds borrow their parent space's.
  const accent = isSpace
    ? entity.accent ?? "var(--accent)"
    : getSpace(entity.parentId ?? "s_root")?.accent ?? "var(--accent)"
  const [done, setDone] = useState(!!entity.completed)

  const from = sourceRect ?? targetRect
  const initialBox = mode === "open" ? from : targetRect
  const settleBox = mode === "open" ? targetRect : from

  const [box, setBox] = useState<Rect>(initialBox)
  // Body is hidden while the box is small/animating and revealed once open; on
  // close it hides immediately so only the header "thread" rides the shrink.
  const [bodyVisible, setBodyVisible] = useState(false)

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => {
      setBox(settleBox)
      setBodyVisible(mode === "open")
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showBody = bodyVisible && isTop
  const hasRange = typeof entity.start === "number" && typeof entity.end === "number"

  return (
    <motion.div
      className="absolute overflow-hidden rounded-md border bg-card shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
      // Top window is fully interactive; ancestors are click-through EXCEPT their
      // header bar (which re-enables pointer events so its close button works).
      style={{ borderColor: isSpace ? accent : "var(--border)", pointerEvents: isTop ? "auto" : "none" }}
      initial={{ top: initialBox.top, left: initialBox.left, width: initialBox.width, height: initialBox.height }}
      animate={{ top: box.top, left: box.left, width: box.width, height: box.height }}
      transition={layerTransition}
      onAnimationComplete={() => {
        if (mode === "closing") onClosed?.()
      }}
    >
      {/* Space accent strip so spaces read as containers. */}
      {isSpace && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5" style={{ backgroundColor: accent }} aria-hidden />
      )}

      {/* Header / nav bar — glyph + title + bare-X close. Always shown (this is
          also the peeking bar for receded ancestors, whose header re-enables
          pointer events so the user can click it to cascade-close to here). */}
      <div
        className="relative z-10 flex items-center gap-2 px-3"
        style={{ height: HEADER_H, pointerEvents: "auto" }}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-foreground">
          <NodeGlyph kind={entity.kind} />
        </span>
        {isTask && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setDone((d) => !d)
            }}
            aria-label={done ? "Mark task incomplete" : "Mark task complete"}
            className="flex size-4 shrink-0 items-center justify-center rounded-sm border border-border text-foreground"
          >
            {done && <Check size={12} />}
          </button>
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
      <motion.div
        className="absolute inset-x-0 bottom-0 overflow-hidden"
        style={{ top: HEADER_H }}
        initial={false}
        animate={{ opacity: showBody ? 1 : 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {showBody ? <EntityBody nodeId={entity.id} /> : <div className="size-full" aria-hidden />}
      </motion.div>
    </motion.div>
  )
}
