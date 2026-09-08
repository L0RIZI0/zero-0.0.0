"use client"

import type { ReactNode } from "react"

/**
 * The shared SHOW/HIDE animation for every § frame in the canvas stack (AGENDA · ACTIVITY ·
 * ZERO HEADER · §4 PINS · …). One unified 0.8s move: the frame's HEIGHT opens/collapses (the
 * dep-free grid-rows `0fr↔1fr` trick, so every frame below slides up/down naturally) WHILE its
 * content simultaneously fades in/out. Height + opacity share the same 0.8s window and easing,
 * so a frame appears/disappears as a single smooth gesture rather than two sequenced phases.
 *
 * Kept ALWAYS MOUNTED (the parent decides whether to render it at all) so BOTH directions
 * animate; `inert` drops a hidden frame from tab-order + hit-testing. Honors reduced-motion via
 * the `motion-reduce:transition-none` utility (instant snap).
 */
export const FRAME_ANIM_MS = 800

export function Zero0Frame({
  open,
  children,
  className,
  allowOverflow = false,
}: {
  /** Whether the frame is shown (height 1fr + opacity 1) or collapsed (0fr + opacity 0). */
  open: boolean
  children: ReactNode
  /** Extra classes for the outer grid wrapper (rarely needed). */
  className?: string
  /** When true AND the frame is open, the inner clip is `overflow-visible` so intentional bottom
   *  overflow (e.g. the AGENDA dayline's sky-bleed curves) can spill past the frame onto whatever sits
   *  below. While collapsed/animating it stays `overflow-hidden` so the grid-rows 0fr↔1fr collapse still
   *  clips cleanly. Default false — every other frame keeps the original hard clip. */
  allowOverflow?: boolean
}) {
  return (
    <div
      className={"grid transition-[grid-template-rows] duration-[800ms] ease-in-out motion-reduce:transition-none " + (className ?? "")}
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      inert={!open}
    >
      <div className={allowOverflow && open ? "overflow-visible" : "overflow-hidden"}>
        {/* Opacity layer — fades over the SAME 0.8s window as the height move, so the frame
            content dissolves in/out while the stack below slides. */}
        <div
          className="transition-opacity duration-[800ms] ease-in-out motion-reduce:transition-none"
          style={{ opacity: open ? 1 : 0 }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
