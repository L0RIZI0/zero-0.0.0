"use client"

import { useEffect, useState } from "react"
import { motion, useAnimationControls } from "motion/react"
import { Check, X } from "lucide-react"
import type { Entity } from "@/lib/zero/types"
import { getSpace } from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import {
  layerTransition,
  FRAME_RADIUS,
  frameLayoutId,
  accentLayoutId,
  glyphLayoutId,
  titleLayoutId,
  type Rect,
} from "@/lib/zero/motion"
import { NodeGlyph } from "./node-glyph"
import { EntityBody } from "./entity-body"

/** Height of the window's title bar — also the strip a receded ancestor peeks. */
const HEADER_H = 44

/** Minutes-from-midnight → "9:00 AM". */
function fmtTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

/**
 * One open window — the EXPANDED state of an entity. A window is NOT a
 * self-contained div: the pieces it shares with its collapsed button (the visual
 * FRAME, the ACCENT strip, the GLYPH, the TITLE) are `motion` elements carrying
 * the entity's shared `layoutId`s, so Framer flies each one between the button's
 * layout and this window's layout — and back, on close — with no scale
 * distortion and no end-state jump. The title literally travels from beneath the
 * glyph (dock-card layout) to beside it (header layout), growing en route,
 * because it is the very same element.
 *
 * The outer container is the "invisible technical container": it only reserves
 * the window's resting box at its depth. It has no border/surface of its own
 * (those live on the shared frame) and never animates its geometry — all motion
 * is the shared pieces morphing. Non-shared chrome (close button, time range,
 * body) just fades in on the focused window; on close the window unmounts and
 * the body goes with it while the shared pieces morph home — exactly the
 * "collapse into the button" the button's design implies (a button has no body).
 *
 * There is ONE frame component for every kind; kind only tweaks small details:
 * a task's glyph doubles as its completion toggle, and timed entities show their
 * range. Only the frontmost window renders its body; receded ancestors show just
 * the header strip (and, crucially, NOT their children's sources — which is what
 * frees those layoutIds for the open child to own).
 */
export function EntityFrame({
  entity,
  isTop,
  depth,
  rect,
  onClose,
}: {
  entity: Entity
  /** Frontmost window — only it shows its body; ancestors show just the header. */
  isTop: boolean
  /** Absolute stack depth (>= 1); also the z-index so deeper windows sit on top. */
  depth: number
  /** Static resting box for this depth, region-relative. */
  rect: Rect
  /** Header close button — closes THIS window (and anything above it). */
  onClose: () => void
}) {
  const { pulse } = useZeroNav()
  const bounce = useAnimationControls()

  const isTask = entity.kind === "task"
  // Accent comes from the entity's home space (itself for a space, else its
  // parent), shown as a thin LEFT strip — the border itself stays neutral.
  const homeSpaceId = entity.kind === "space" ? entity.id : entity.parentId ?? "s_root"
  const accent = getSpace(homeSpaceId)?.accent ?? "var(--muted-foreground)"
  const [done, setDone] = useState(!!entity.completed)
  const hasRange = typeof entity.start === "number" && typeof entity.end === "number"

  // Re-click on an already-open entity requests an attention "pulse" — a quick
  // scale nudge on the whole window. It never disturbs the shared-layout morph.
  useEffect(() => {
    if (isTop && pulse && pulse.id === entity.id) {
      bounce.start({ scale: [1, 1.012, 1], transition: { duration: 0.3, ease: "easeOut" } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse?.id, pulse?.n])

  return (
    <motion.div
      className="absolute"
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, zIndex: depth }}
      animate={bounce}
    >
      {/* FRAME — the shared visual box (border + surface + shadow), behind all
          content. The very same element is the button's background collapsed. */}
      <motion.div
        layoutId={frameLayoutId(entity.id)}
        transition={layerTransition}
        style={{ borderRadius: FRAME_RADIUS, pointerEvents: isTop ? "auto" : "none" }}
        className="absolute inset-0 border border-border bg-card-solid shadow-[0_20px_60px_-28px_rgba(0,0,0,0.6)]"
      />

      {/* ACCENT — shared left strip; marks the window as belonging to its kind. */}
      <motion.div
        layoutId={accentLayoutId(entity.id)}
        transition={layerTransition}
        aria-hidden
        className="absolute left-0 top-0 z-10 h-full w-[3px]"
        style={{
          backgroundColor: accent,
          borderTopLeftRadius: FRAME_RADIUS,
          borderBottomLeftRadius: FRAME_RADIUS,
        }}
      />

      {/* HEADER — shared glyph + title (fly in from the button), plus non-shared
          time range + close button. Pointer events on so a receded ancestor's
          header is still clickable to cascade-close to it. */}
      <div
        className="absolute left-0 right-0 top-0 z-20 flex items-center gap-2.5 px-3.5"
        style={{ height: HEADER_H, pointerEvents: "auto" }}
      >
        {isTask ? (
          // A task's glyph IS its completion toggle — one square, no second box.
          <motion.button
            layoutId={glyphLayoutId(entity.id)}
            transition={layerTransition}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setDone((d) => !d)
            }}
            aria-label={done ? "Mark task incomplete" : "Mark task complete"}
            className="relative flex size-5 shrink-0 items-center justify-center text-foreground"
          >
            <NodeGlyph kind="task" filled={done} strokeWidth={2} />
            {done && <Check className="absolute h-3 w-3 text-background" strokeWidth={3.5} />}
          </motion.button>
        ) : (
          <motion.span
            layoutId={glyphLayoutId(entity.id)}
            transition={layerTransition}
            className="flex size-5 shrink-0 items-center justify-center text-foreground"
          >
            <NodeGlyph kind={entity.kind} />
          </motion.span>
        )}

        <motion.span
          layoutId={titleLayoutId(entity.id)}
          transition={layerTransition}
          className="min-w-0 flex-1 truncate text-[15px] font-medium tracking-tight text-foreground"
        >
          {entity.title}
        </motion.span>

        {hasRange && isTop && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: 0.1 }}
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
          >
            {fmtTime(entity.start!)} – {fmtTime(entity.end!)}
          </motion.span>
        )}

        {isTop && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: 0.1 }}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            aria-label={`Close ${entity.title}`}
            className="flex size-6 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <X size={16} />
          </motion.button>
        )}
      </div>

      {/* BODY — only the focused window renders content; it fades in so it reads
          as spawning inside the grown frame, and is clipped to the rounded box.
          On close the window unmounts and the body simply goes with it. */}
      {isTop && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.22, ease: "easeOut", delay: 0.06 }}
          className="absolute inset-0 z-10 overflow-hidden"
          style={{ borderRadius: FRAME_RADIUS, paddingTop: HEADER_H }}
        >
          <EntityBody entityId={entity.id} />
        </motion.div>
      )}
    </motion.div>
  )
}
