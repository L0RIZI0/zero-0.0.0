"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Check, X } from "lucide-react"
import type { Entity } from "@/lib/zero/types"
import { getSpace } from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { HEADER_H, type Rect } from "@/lib/zero/motion"
import { gsap, MORPH_DURATION, MORPH_EASE } from "@/lib/zero/flip-stage"
import { NodeGlyph } from "./node-glyph"
import { EntityBody } from "./entity-body"

/** Minutes-from-midnight → "9:00 AM". */
function fmtTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

/**
 * Generic GSAP-driven window for ANY entity kind — one frame component, no
 * per-kind variants. Ported from the `flip-demo` prototype: Framer no longer
 * touches a window; GSAP owns all window geometry + the header morph.
 *
 * GEOMETRY (gsap, not React): the frame is absolutely positioned and GSAP owns
 * its {top,left,width,height}. React's `style` only seeds the FIRST paint; after
 * mount GSAP is the sole writer (the seed prop never changes, so React never
 * fights it). On open the frame grows source→target; on close it shrinks
 * target→source and dissolves, then unmounts.
 *
 * SPINE: a SPACE that is open but not frontmost collapses its header to a
 * vertical left rail (rotated title). The frame BOX is unchanged — only the
 * header layout switches — and the glyph + title morph between horizontal and
 * vertical via GSAP Flip (orchestrated in nav-store as the stack changes), which
 * is why they carry `data-flip-id`. The spine background + divider crossfade.
 *
 * Unlike the prototype, Zero's frames are flat SIBLINGS in the region (not
 * nested), so a parent's `overflow-hidden` never clips the child window — the
 * clipping gymnastics the prototype needed simply don't apply here.
 */
export function EntityFrame({
  entity,
  isTop,
  depth,
  spine,
  targetRect,
  sourceRect,
  mode,
  onClose,
  onClosed,
}: {
  entity: Entity
  /** Frontmost window — only it shows its body; ancestors show just the header. */
  isTop: boolean
  /** Absolute stack index; scopes this window's flip-ids so two same-id nodes
   *  (the same entity can live in several do-lists at once) never collide. */
  depth: number
  /** This space is receded behind one of its own open children → vertical rail. */
  spine: boolean
  /** Static destination box for this stack position (where the open window rests). */
  targetRect: Rect
  /** Measured box of the source row/card/marker; null falls back to the target. */
  sourceRect: Rect | null
  /** "open" grows source→target; "closing" shrinks target→source then unmounts. */
  mode: "open" | "closing"
  /** Header close button — closes THIS window (and anything above it). */
  onClose: () => void
  /** Called once a "closing" window finishes shrinking, so the store drops it. */
  onClosed?: () => void
}) {
  const { pulse } = useZeroNav()
  const frameRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)

  const closing = mode === "closing"
  const isTask = entity.kind === "task"
  const homeSpaceId = entity.kind === "space" ? entity.id : entity.parentId ?? "s_root"
  const accent = getSpace(homeSpaceId)?.accent ?? "var(--muted-foreground)"
  const [done, setDone] = useState(!!entity.completed)

  // Body is mounted only for the frontmost open window and the closing overlay;
  // receded ancestors (incl. spines) show just their header strip + card peeks.
  const renderBody = isTop || closing
  const hasRange = typeof entity.start === "number" && typeof entity.end === "number"

  // --- Geometry: open grow / close shrink + dissolve (runs once on mount). ---
  useLayoutEffect(() => {
    const el = frameRef.current
    if (!el) return
    const target = {
      top: targetRect.top,
      left: targetRect.left,
      width: targetRect.width,
      height: targetRect.height,
    }
    if (closing) {
      const dest = sourceRect ?? targetRect
      gsap.set(el, target)
      // Pure geometry shrink back into the source row — the EXACT inverse of the
      // open grow, NOT the old "duplicate that fades its opacity out" workaround.
      // The frame keeps full opacity the whole way; it simply collapses into the
      // row's box and unmounts, revealing the live row that has reappeared there.
      gsap.to(el, {
        top: dest.top,
        left: dest.left,
        width: dest.width,
        height: dest.height,
        duration: MORPH_DURATION,
        ease: MORPH_EASE,
        onComplete: () => onClosed?.(),
      })
      // Mirror open's body crossfade: open fades the body IN as it grows, so close
      // fades it OUT as it shrinks. This is content-level only (matching open) —
      // the frame chrome itself never changes opacity.
      if (bodyRef.current) {
        gsap.to(bodyRef.current, { opacity: 0, duration: MORPH_DURATION * 0.5, ease: "power2.in" })
      }
      return
    }
    // open: grow from the captured source box into the resting target.
    const src = sourceRect ?? target
    gsap.fromTo(
      el,
      { top: src.top, left: src.left, width: src.width, height: src.height },
      { top: target.top, left: target.left, width: target.width, height: target.height, duration: MORPH_DURATION, ease: MORPH_EASE },
    )
    if (bodyRef.current) {
      gsap.fromTo(bodyRef.current, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: "power2.out", delay: 0.05 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Keep the resting box in sync on later target changes (resize), AFTER the
  // initial open. Skips the first invocation so it never clobbers the grow. ---
  const mountedRef = useRef(false)
  useLayoutEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    const el = frameRef.current
    if (!el || closing) return
    gsap.set(el, {
      top: targetRect.top,
      left: targetRect.left,
      width: targetRect.width,
      height: targetRect.height,
    })
  }, [targetRect.top, targetRect.left, targetRect.width, targetRect.height, closing])

  // --- Attention pulse (re-click an already-open marker): a quick scale bounce
  // on the inner wrapper so it never disturbs the outer geometry. ---
  useEffect(() => {
    if (isTop && pulse && pulse.id === entity.id && innerRef.current) {
      gsap.fromTo(innerRef.current, { scale: 1 }, { scale: 1.015, duration: 0.16, ease: "power2.out", yoyo: true, repeat: 1 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse?.id, pulse?.n])

  // flip-ids are stack-position-scoped (not bare ids) so the same entity in two
  // do-lists never shares a flip-id. Only resident OPEN frames flip; the closing
  // overlay shrinks via gsap geometry and must NOT carry flip-ids.
  const flipGlyph = closing ? undefined : `glyph:${depth}`
  const flipTitle = closing ? undefined : `title:${depth}`

  // Seed only the FIRST paint; gsap owns geometry after mount.
  const seed = closing ? targetRect : sourceRect ?? targetRect

  return (
    <div
      ref={frameRef}
      className="absolute flex flex-col overflow-hidden rounded-md border border-border bg-card shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
      style={{
        top: seed.top,
        left: seed.left,
        width: seed.width,
        height: seed.height,
        // Top window is fully interactive; ancestors are click-through except
        // their header bar / close button (which re-enable pointer events).
        pointerEvents: isTop ? "auto" : "none",
      }}
    >
      <div ref={innerRef} className="absolute inset-0 flex flex-col" style={{ transformOrigin: "center" }}>
        {/* Left accent strip — belongs-to-space cue; never overpainted by the spine. */}
        <span className="absolute left-0 top-0 z-10 h-full w-[3px]" style={{ backgroundColor: accent }} aria-hidden />

        {/* Spine background — a fixed narrow left rail that crossfades when this
            space spines/un-spines. z-[8]: above the (unmounted-here) body, below
            the glyph/title (z-10). */}
        <span
          aria-hidden
          style={{ transitionDuration: `${MORPH_DURATION}s` }}
          className={`pointer-events-none absolute inset-y-0 left-[3px] z-[8] w-14 bg-card transition-opacity ease-out ${
            spine ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* Header — horizontal bar, or vertical spine rail when receded. */}
        <div
          className={
            spine
              ? "absolute inset-y-0 left-[3px] z-10 flex w-14 flex-col items-center gap-7 pt-4"
              : "relative z-10 flex shrink-0 items-center gap-3 pl-5 pr-12"
          }
          style={spine ? undefined : { height: HEADER_H, pointerEvents: "auto" }}
        >
          {isTask ? (
            <button
              type="button"
              data-flip-id={flipGlyph}
              onClick={(e) => {
                e.stopPropagation()
                setDone((d) => !d)
              }}
              aria-label={done ? "Mark task incomplete" : "Mark task complete"}
              className="relative flex size-5 shrink-0 items-center justify-center text-foreground"
            >
              <NodeGlyph kind="task" filled={done} strokeWidth={1.75} />
              {done && <Check className="absolute h-3 w-3 text-background" strokeWidth={3.5} />}
            </button>
          ) : (
            <span
              data-flip-id={flipGlyph}
              className="relative flex size-5 shrink-0 items-center justify-center text-foreground"
            >
              <NodeGlyph kind={entity.kind} strokeWidth={1.75} />
            </span>
          )}

          <h3
            data-flip-id={flipTitle}
            style={{
              fontSize: spine ? 15 : 18,
              // Rotation via the transform channel so GSAP Flip animates it
              // smoothly through the matrix (Tailwind's `rotate` is a separate
              // CSS property Flip can't tween cleanly).
              transform: spine ? "rotate(-90deg)" : undefined,
              transformOrigin: "center",
            }}
            className="relative whitespace-nowrap font-semibold tracking-tight text-foreground"
          >
            {entity.title}
          </h3>

          {hasRange && isTop && !spine && (
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
              {fmtTime(entity.start!)} – {fmtTime(entity.end!)}
            </span>
          )}
        </div>

        {/* Close button — corner-pinned, fades only, never a flip target. Tucks
            tighter into the corner when spined so the slim top peek never crops it. */}
        {!closing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            aria-label={`Close ${entity.title}`}
            style={{ transitionDuration: `${MORPH_DURATION}s`, pointerEvents: "auto" }}
            className={`absolute z-20 flex size-6 items-center justify-center rounded-[4px] text-muted-foreground transition-all ease-out hover:bg-foreground/5 hover:text-foreground ${
              spine ? "right-1 top-1" : "right-3 top-3"
            }`}
          >
            <X size={16} />
          </button>
        )}

        {/* Header divider — a dedicated fading line (not a border) so it eases
            in/out instead of snapping between the header's bottom and side. */}
        <span
          aria-hidden
          style={{ top: HEADER_H, transitionDuration: `${MORPH_DURATION}s` }}
          className={`pointer-events-none absolute left-0 right-0 z-[5] h-px bg-border transition-opacity ease-out ${
            spine || closing ? "opacity-0" : "opacity-100"
          }`}
        />

        {/* Body — only the frontmost window (and the closing overlay) renders it.
            EntityBody owns its own padding/scroll; here we just position + clip. */}
        {renderBody && (
          <div
            ref={bodyRef}
            className={
              closing
                ? "pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden"
                : "flex min-h-0 flex-1 flex-col overflow-hidden"
            }
            style={closing ? { top: HEADER_H } : undefined}
          >
            <EntityBody entityId={entity.id} />
          </div>
        )}
      </div>
    </div>
  )
}
