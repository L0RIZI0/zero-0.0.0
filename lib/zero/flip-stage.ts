"use client"

import gsap from "gsap"
import { Flip } from "gsap/Flip"

/**
 * The GSAP morph engine for Zero's focus-window region — the same language as
 * the `flip-demo` prototype, brought into the real app. Framer no longer drives
 * any window; GSAP owns every window frame + its header, and the two engines
 * never touch the same node (Framer stays on the surrounding chrome only).
 *
 * Two distinct motions run, synchronized on ONE shared duration/ease:
 *
 *   1. NEW / CLOSING windows tween their geometry ({top,left,width,height})
 *      between a captured SOURCE rect (the clicked row/card/marker) and their
 *      static depth/stack target. This is `EntityFrame`'s own `gsap.fromTo`
 *      (the proven Zero path, just moved off Framer) — it needs no "before"
 *      snapshot because a row and its window are different DOM nodes here.
 *
 *   2. RESIDENT ancestor headers (the glyph + title of windows that STAY open
 *      across the transition) morph via real `Flip.from`. This is what makes a
 *      space's header glide between its horizontal bar and the vertical left
 *      "spine" as a child opens/closes — Flip computes the translate + rotate +
 *      font-size deltas automatically. Only in-stack frames carry `data-flip-id`;
 *      the closing overlay deliberately does NOT (it shrinks via #1 instead), so
 *      Flip never fights the geometry tween for the same element.
 */
if (typeof window !== "undefined") {
  gsap.registerPlugin(Flip)
}

export { gsap }

/** Quick, elegant ease-out shared by every window motion (matches the prototype:
 *  launches fast, decelerates gently — no easing in). */
export const MORPH_DURATION = 0.66
export const MORPH_EASE = "power3.out"

type FlipState = ReturnType<typeof Flip.getState>

// The live focus-window region (registered by EntityLayerStack). Captured Flip
// snapshots are scoped to it so we never pick up stray flip-ids elsewhere.
let stageEl: HTMLElement | null = null

export function registerStage(el: HTMLElement | null) {
  stageEl = el
}

/**
 * Snapshot the current positions of every RESIDENT window header part (glyph +
 * title) in the stage. MUST be called synchronously BEFORE the stack state
 * change so it records the pre-morph layout; pair it with `playHeaderMorph`
 * after the React commit. Returns null when there is nothing to morph (e.g.
 * opening the very first window — no ancestor headers exist yet).
 */
export function captureHeaders(): FlipState | null {
  if (!stageEl) return null
  const targets = stageEl.querySelectorAll("[data-flip-id]")
  if (!targets.length) return null
  // `fontSize` is animated too: the title grows/shrinks between the horizontal
  // header (18px) and the vertical spine (15px).
  return Flip.getState(targets, { props: "fontSize" })
}

/**
 * Animate the resident headers from a captured snapshot to their just-committed
 * layout. `nested: true` lets in-flow children compensate for any flipping
 * ancestor. No `absolute` selector here (unlike the prototype): we are NOT
 * flipping the frames themselves — GSAP `fromTo` (in EntityFrame) owns frame
 * geometry — only the in-flow glyph/title transform between header and spine.
 */
export function playHeaderMorph(state: FlipState | null) {
  if (!state) return
  Flip.from(state, {
    duration: MORPH_DURATION,
    ease: MORPH_EASE,
    nested: true,
  })
}
