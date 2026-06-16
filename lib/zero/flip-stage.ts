"use client"

import gsap from "gsap"
import { Flip } from "gsap/Flip"
import { CustomEase } from "gsap/CustomEase"

/**
 * The GSAP Flip morph engine for Zero's focus-window region — a faithful port of
 * the `flip-demo` prototype's SINGLE-NODE technique into the real app.
 *
 * The load-bearing idea: every entity is ONE persistent DOM node (see
 * `EntityNode`). A do-list row / dock card and the window it opens into are the
 * SAME element — it merely swaps between its collapsed (row/card) classes and
 * its expanded (fixed window) classes. Nothing unmounts on open or close, so
 * there is never a duplicate to fade out and never a stale captured rect: the
 * window literally morphs back into the row it came from.
 *
 * Each transition is exactly ONE `Flip.getState` (captured BEFORE the React
 * commit) + ONE `Flip.from` (run AFTER it). A single pass keeps every frame and
 * its nested glyph/title measured against the same before/after snapshot.
 *
 *   - frames  → `absolute: "[data-flip-role='frame']"`, so Flip tweens REAL
 *               width/height (edge-to-edge growth, zero text distortion).
 *   - glyph + title → stay in the header's flex flow and animate via transforms
 *               (+ a real `fontSize` tween), so the header keeps its true height
 *               and the body never jumps. `nested: true` lets these in-flow
 *               children compensate for their absolutely-flipping ancestor.
 *
 * Chrome that only exists while open (body, close button, divider) is NOT a flip
 * target — it just fades. Deeper levels removed in a multi-level close telescope
 * inward (scale + fade) so they read as retracting into their parent.
 */
if (typeof window !== "undefined") {
  gsap.registerPlugin(Flip, CustomEase)
  // Derived from the Figma "Smart Animate DIVE" curve (0.13, 0.8, 0, 0.97) but
  // adjusted in two ways:
  //   1. The original second control point sat at x=0 — BEHIND the first control
  //      point's x=0.13 — so the curve's x folded backward. CSS tolerates that,
  //      but GSAP CustomEase samples the path left→right and the fold stalls
  //      progress for the first frames, which read as a "delay" before the morph
  //      started. Keeping every control point x-monotonic removes that hitch.
  //   2. The second control point is pulled toward the end (0.32, 1) so the long,
  //      floaty deceleration tail is much shorter — it still launches hard
  //      (y≈0.82 by x=0.13) but settles crisply instead of crawling the last few
  //      percent across most of the timeline.
  CustomEase.create("zeroDive", "M0,0 C0.13,0.82 0.32,1 1,1")
}

export { gsap }

/** Quick, elegant motion shared by every window — the Figma DIVE curve: launches
 *  fast, then a long gentle deceleration that settles at the very end. */
export const MORPH_DURATION = 0.66
export const MORPH_EASE = "zeroDive"
/** Same duration as a CSS string, for the fade/transition chrome (spine bg,
 *  divider, close-button reposition) that rides along with the Flip morph. */
export const DURATION_S = `${MORPH_DURATION}s`
/** The DIVE curve as a CSS timing function, so chrome that fades along with the
 *  morph (spine cover, divider) decelerates on the exact same beat as the Flip. */
export const MORPH_CSS_EASE = "cubic-bezier(0.13, 0.82, 0.32, 1)"

type FlipState = ReturnType<typeof Flip.getState>

// The live focus-window region (registered by WorkSurface). Captured Flip
// snapshots are scoped to it so we never pick up stray flip-ids elsewhere, and
// its viewport rect is the origin for every fixed-positioned window.
let stageEl: HTMLElement | null = null

export function registerStage(el: HTMLElement | null) {
  stageEl = el
}

/** Current viewport rect of the focus-window region — the origin every window's
 *  fixed geometry is measured from. Falls back to a sane full-ish box before the
 *  region has mounted (windows only appear after interaction, by which point it
 *  is measured). */
export function getRegionRect(): { top: number; left: number; width: number; height: number } {
  if (!stageEl) return { top: 0, left: 0, width: 0, height: 0 }
  const r = stageEl.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

/** A window node's stable key for imperative lookups during a morph. */
export function windowKey(id: string, depth: number) {
  return `${depth}::${id}`
}

/**
 * Snapshot the positions of EVERY flip part in the stage (frames + their
 * glyph/title). MUST be called synchronously BEFORE the stack state change so it
 * records the pre-morph layout; pair it with `playStage` after the React commit.
 * Returns null when there is nothing to capture yet.
 */
export function captureStage(): FlipState | null {
  if (!stageEl) return null
  const targets = stageEl.querySelectorAll("[data-flip-id]")
  if (!targets.length) return null
  return Flip.getState(targets, { props: "fontSize,borderRadius" })
}

type Key = { id: string; depth: number }

/**
 * Animate the whole stage from a captured snapshot to its just-committed layout.
 * One `Flip.from` morphs every persistent node (rows growing into windows,
 * windows shrinking back into rows, ancestor headers gliding to/from their
 * vertical spine). Layered on top: the opening window's chrome fades in; a
 * closing window's body scales down into its row; deeper levels telescope away.
 */
export function playStage(
  state: FlipState | null,
  opts: { opening: boolean; top: Key | null; closing: Key | null; fading: Key[] },
) {
  const stage = stageEl
  if (state) {
    Flip.from(state, {
      duration: MORPH_DURATION,
      ease: MORPH_EASE,
      absolute: "[data-flip-role='frame']",
      nested: true,
    })
  }
  if (!stage) return

  const sel = (k: Key, rest: string) => `[data-window="${k.id}"][data-depth="${k.depth}"] ${rest}`

  if (opts.opening && opts.top) {
    // Fade the open-only chrome (body, close button) in immediately — no delay,
    // so the content does not appear to lag behind the frame at the start (which
    // contributed to the "delayed start" feel). Duration scales with the morph so
    // it stays proportional at any MORPH_DURATION.
    const chrome = stage.querySelectorAll(sel(opts.top, "[data-fade]"))
    if (chrome.length) gsap.fromTo(chrome, { opacity: 0 }, { opacity: 1, duration: MORPH_DURATION * 0.45 })
  }

  if (opts.closing) {
    const body = stage.querySelector<HTMLElement>(sel(opts.closing, "[data-body]"))
    if (body) {
      gsap.fromTo(
        body,
        { opacity: 1, scale: 1 },
        { opacity: 0, scale: 0.15, transformOrigin: "top left", duration: MORPH_DURATION * 0.7, ease: MORPH_EASE },
      )
    }
    // Deeper levels removed in the same gesture telescope inward toward the same
    // top-left origin, scaling down + fading. Pure transform/opacity (GPU cheap),
    // and it keeps covering the parent's do-list until they're gone.
    opts.fading.forEach(({ id, depth }) => {
      const win = stage.querySelector<HTMLElement>(`[data-window="${id}"][data-depth="${depth}"][data-flip-role="frame"]`)
      if (!win) return
      gsap.fromTo(
        win,
        { opacity: 1, scale: 1 },
        {
          opacity: 0,
          scale: Math.max(0.1, 0.4 - depth * 0.08),
          transformOrigin: "top left",
          duration: MORPH_DURATION * 0.7,
          ease: MORPH_EASE,
        },
      )
    })
  }
}

/** Clear the transient inline props the telescope tween wrote, so persistent
 *  nodes are clean if shown again. */
export function clearFadingProps(fading: Key[]) {
  const stage = stageEl
  if (!stage) return
  fading.forEach(({ id, depth }) => {
    const win = stage.querySelector<HTMLElement>(`[data-window="${id}"][data-depth="${depth}"][data-flip-role="frame"]`)
    if (win) gsap.set(win, { clearProps: "opacity,scale,transform" })
  })
}
