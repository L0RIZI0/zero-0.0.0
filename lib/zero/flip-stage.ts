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
  // "zeroLand": cubic-bezier(.62, .02, .07, .99). A smooth ease-in-out with a firm
  // pull through the middle and a soft settle so the motion reads deliberate. Kept
  // identical to MORPH_EASE in motion.ts so the GSAP Flip and the Framer-driven
  // chrome share one curve.
  CustomEase.create("zeroLand", "M0,0 C0.62,0.02 0.07,0.99 1,1")
}
// (CSS equivalent of the curve above lives in MORPH_CSS_EASE below.)

export { gsap }

/** Quick, elegant motion shared by every window — the `zeroLand` ease-in-out curve
 *  (defined above): accelerates into a fast expansion/shrink, then eases out over
 *  the final ~40% for a soft, gentle landing. */
export const MORPH_DURATION = 2
export const MORPH_EASE = "zeroLand"
/** Same duration as a CSS string, for the fade/transition chrome (spine bg,
 *  divider, close-button reposition) that rides along with the Flip morph. */
export const DURATION_S = `${MORPH_DURATION}s`
/** The `zeroLand` curve as a CSS timing function, so chrome that fades along with
 *  the morph (spine cover, divider) lands on the same beat as the Flip. */
export const MORPH_CSS_EASE = "cubic-bezier(0.62, 0.02, 0.07, 0.99)"

type FlipState = ReturnType<typeof Flip.getState>

// The live focus-window region (registered by WorkSurface). Captured Flip
// snapshots are scoped to it so we never pick up stray flip-ids elsewhere, and
// its viewport rect is the origin for every fixed-positioned window.
let stageEl: HTMLElement | null = null

// Per-frame background colour snapshot from the most recent `captureStage`, keyed
// by flip-id. Consumed once by the next `playStage` to drive the manual colour FLIP.
let capturedBg: Map<string, string> | null = null

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
  // Record every FRAME's pre-morph background colour, keyed by flip-id, so
  // `playStage` can replay it into a real CSS transition (a manual colour FLIP —
  // see playStage for why). Only frames carry a surface colour.
  const colors = new Map<string, string>()
  stageEl.querySelectorAll<HTMLElement>("[data-flip-role='frame'][data-flip-id]").forEach((f) => {
    const id = f.getAttribute("data-flip-id")
    if (id) colors.set(id, getComputedStyle(f).backgroundColor)
  })
  capturedBg = colors
  // `clipPath` is captured so a Space's hexagon ⇄ rectangle reshape (dock card /
  // row → hex window and back) tweens smoothly in the same single Flip pass that
  // already morphs size, fontSize and borderRadius. Proven in the hexagon-dock
  // prototype: without it the clip snapped at the end of the morph.
  // NOTE: `backgroundColor` is deliberately NOT captured/animated by Flip. Flip
  // would interpolate it from a bad captured value — flashing black for a newly
  // entering window (it has no prior colour, so GSAP tweens up from transparent
  // black) and fighting the CSS transition on receding ancestors. We drive the
  // colour ourselves in playStage instead.
  return Flip.getState(targets, { props: "fontSize,borderRadius,clipPath" })
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
    // Space windows carry NO filter (their boundary is an SVG outline, not a
    // drop-shadow), so there is nothing to strip here — the morph stays cheap
    // because no layer is re-rasterized blurred on every frame as it grows.
    Flip.from(state, {
      duration: MORPH_DURATION,
      ease: MORPH_EASE,
      absolute: "[data-flip-role='frame']",
      nested: true,
      // Only `clipPath` rides the morph (hexagon ⇄ rectangle). Background colour is
      // intentionally left to its own CSS transition (see captureStage + entity-node)
      // so entering windows and receding ancestors don't interpolate from a bad
      // captured "from" colour.
      props: "clipPath",
      // Clear leftover sub-pixel transforms / will-change on the inner glyph+title
      // when the morph lands so they settle crisply instead of shaking at the very
      // end (prototype fix).
      onComplete: () => {
        const inner = stageEl?.querySelectorAll("[data-flip-role='inner']")
        if (inner?.length) gsap.set(inner, { clearProps: "transform,willChange" })
      },
    })

    // Manual colour FLIP. `Flip.from` makes every frame `position:absolute` and
    // hard-sets `transition:none` for the whole morph (GSAP Flip internals), which
    // kills the CSS `background-color` transition on the frame — so the per-depth
    // surface recede (ancestors darkening when the stack crosses the cap) would
    // SNAP. We replay it by hand: for each frame that existed before the morph,
    // pin its OLD colour with no transition, force a reflow, then re-enable the
    // colour transition and set the NEW (already-committed) colour so the browser
    // tweens old→new over the morph. CSS colour interpolation is premultiplied, so
    // there is no black midpoint. Entering windows have no captured colour → they
    // are skipped and simply render at their target (no flash). Background colour
    // is NOT a Flip prop, so nothing fights this tween (no dark dip).
    if (capturedBg && stage) {
      const from = capturedBg
      stage.querySelectorAll<HTMLElement>("[data-flip-role='frame'][data-flip-id]").forEach((f) => {
        const id = f.getAttribute("data-flip-id")
        const prev = id ? from.get(id) : undefined
        if (!prev) return
        const target = getComputedStyle(f).backgroundColor
        if (prev === target) return
        f.style.transition = "none"
        f.style.backgroundColor = prev
        void f.offsetWidth // force reflow so the old colour is committed first
        f.style.transition = `background-color ${DURATION_S} ${MORPH_CSS_EASE}`
        f.style.backgroundColor = target
      })
    }
  }
  capturedBg = null
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
