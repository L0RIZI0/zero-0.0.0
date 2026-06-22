"use client"

import gsap from "gsap"
import { Flip } from "gsap/Flip"
import { CustomEase } from "gsap/CustomEase"
import { MORPH_SECONDS, spaceMorphPoints, spaceInnerShadow, type SpaceKind } from "./motion"

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
 *  the final ~40% for a soft, gentle landing. Duration is the single canonical
 *  `MORPH_SECONDS` from motion.ts so the GSAP morph and all Framer/CSS chrome share
 *  one beat. */
export const MORPH_DURATION = MORPH_SECONDS
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

// Per-frame drop-shadow snapshot from the most recent `captureStage`, keyed by
// flip-id. Only NON-space frames are recorded (space frames are clip-path'd, which
// hides any box-shadow). Consumed once by the next `playStage` so a closing window's
// shadow can FADE OUT over the morph instead of vanishing the instant its window
// classes (incl. `shadow-2xl`) are swapped for shadowless row/card classes.
let capturedShadow: Map<string, string> | null = null

// Per-frame SOURCE Space shape kind (leaf/ancestor/row/card) from the most recent
// `captureStage`, keyed by flip-id. The clip-path is NOT animated by Flip (Flip would
// interpolate the polygon percentages while the frame resizes, STRETCHING the hexagon
// and drifting the angle). Instead `playStage` drives the clip itself, per frame, from
// the LIVE pixel size via spaceMorphPoints — keeping the hexagon phase a PERFECT
// regular hexagon and splitting it late into the octagon — interpolating between this
// source kind and the committed target kind.
let capturedSpaceKind: Map<string, SpaceKind> | null = null

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
  // Drop-shadow snapshot for the close-shadow fade (see capturedShadow). A frame
  // that carries a clip-path is a Space window — its clip hides any box-shadow, so
  // there is no visible shadow to fade and it is skipped. Only un-clipped (task /
  // event / non-space) frames with a real shadow are recorded.
  const shadows = new Map<string, string>()
  const kinds = new Map<string, SpaceKind>()
  stageEl.querySelectorAll<HTMLElement>("[data-flip-role='frame'][data-flip-id]").forEach((f) => {
    const id = f.getAttribute("data-flip-id")
    if (!id) return
    const cs = getComputedStyle(f)
    colors.set(id, cs.backgroundColor)
    if ((!cs.clipPath || cs.clipPath === "none") && cs.boxShadow && cs.boxShadow !== "none") {
      shadows.set(id, cs.boxShadow)
    }
    const kind = f.dataset.spaceKind as SpaceKind | undefined
    if (kind) kinds.set(id, kind)
  })
  capturedBg = colors
  capturedShadow = shadows
  capturedSpaceKind = kinds
  // NOTE: `clipPath` is deliberately NOT a Flip prop. Flip interpolates the polygon
  // PERCENTAGES linearly while the frame's pixel size changes, so the corner angle
  // drifts off 120° and the hexagon splits early. `playStage` instead drives the clip
  // per frame from the live pixel size (true 120° throughout, late split) — see
  // capturedSpaceKind. `backgroundColor` is likewise NOT a Flip prop: Flip would
  // interpolate it from a bad captured value (black flash for entering windows, and a
  // fight with the CSS transition on receding ancestors); we drive colour in playStage.
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
    // Space windows carry NO filter (their boundary is an SVG outline, not a
    // drop-shadow), so there is nothing to strip here — the morph stays cheap
    // because no layer is re-rasterized blurred on every frame as it grows.
    Flip.from(state, {
      duration: MORPH_DURATION,
      ease: MORPH_EASE,
      absolute: "[data-flip-role='frame']",
      nested: true,
      // Flip animates only size/position here. The Space clip-path is driven SEPARATELY
      // per frame (see the Space clip driver below) so the corner holds a true 120° and
      // the hexagon splits late; background colour rides its own CSS transition.
      // Clear leftover sub-pixel transforms / will-change on the inner glyph+title
      // when the morph lands so they settle crisply instead of shaking at the very
      // end (prototype fix).
      onComplete: () => {
        const inner = stageEl?.querySelectorAll("[data-flip-role='inner']")
        if (inner?.length) gsap.set(inner, { clearProps: "transform,willChange" })
      },
    })

    // Per-frame Space CLIP driver. Flip is NOT animating clipPath (it would interpolate
    // polygon percentages while the frame resizes, stretching the hexagon and drifting
    // the angle — see captureStage). Instead we tween progress 0→1 over the SAME
    // duration/ease and, every frame, recompute each Space frame's clip points from its
    // LIVE pixel size via spaceMorphPoints — which keeps the hexagon phase a PERFECT
    // regular hexagon (centered, never stretched) and splits it late into the octagon.
    // We rewrite the light-mode SVG outline polygon from the same points so the rim
    // tracks the body exactly. `p` runs from the SOURCE shape (captured kind) to the
    // committed TARGET shape (current data-space-kind).
    if (stage && capturedSpaceKind) {
      const sourceKinds = capturedSpaceKind
      const frames = Array.from(
        stage.querySelectorAll<HTMLElement>("[data-flip-role='frame'][data-flip-id][data-space-kind]"),
      )
        .map((f) => {
          const id = f.getAttribute("data-flip-id") || ""
          return {
            el: f,
            source: sourceKinds.get(id) ?? (f.dataset.spaceKind as SpaceKind),
            target: f.dataset.spaceKind as SpaceKind,
            outline: f.querySelector<SVGPolygonElement>("polygon[data-space-outline]"),
          }
        })
        // Only drive frames whose SHAPE actually changes. A frame that stays the same
        // kind (e.g. a settled leaf on an incidental re-render, or an ancestor pushed
        // deeper) keeps React's committed clip — driving it would needlessly animate it
        // from a degenerate q=0 rectangle and, if interrupted, leave it stuck as a rect.
        .filter((fr) => fr.source !== fr.target)
      if (frames.length) {
        // Inner-shadow strength per shape: the expanded octagon (leaf) and the ancestor
        // it becomes carry the full inset shadow; the collapsed row/card carry none. The
        // shadow blooms in/out as the frame morphs between these (see spaceInnerShadow).
        const isDark = !document.documentElement.classList.contains("light")
        const shadowStrength = (k: SpaceKind) => (k === "leaf" || k === "ancestor" ? 1 : 0)
        const driver = { p: 0 }
        gsap.to(driver, {
          p: 1,
          duration: MORPH_DURATION,
          ease: MORPH_EASE,
          onUpdate: () => {
            for (const fr of frames) {
              // Live pixel size — read each frame because Flip resizes them per frame.
              const r = fr.el.getBoundingClientRect()
              if (r.width <= 0 || r.height <= 0) continue
              const pts = spaceMorphPoints(driver.p, r.width, r.height, fr.source, fr.target)
              fr.el.style.clipPath = `polygon(${pts.map(([x, y]) => `${x}% ${y}%`).join(", ")})`
              if (fr.outline) {
                fr.outline.setAttribute("points", pts.map(([x, y]) => `${x},${y}`).join(" "))
              }
              // Tween the inner shadow from the source strength to the target strength.
              // At p=1 this equals React's committed boxShadow for the target shape, so —
              // like the clipPath above — we leave the inline value (no pop on settle).
              const from = shadowStrength(fr.source)
              const to = shadowStrength(fr.target)
              fr.el.style.boxShadow = spaceInnerShadow(from + (to - from) * driver.p, isDark)
            }
          },
          // No onComplete reset: the final frame (p=1) already equals React's
          // committed clip/outline for the target shape, so we LEAVE the inline value.
          // Clearing it would briefly unclip the frame until React next re-renders
          // (React set clipPath via inline style and won't re-apply an unchanged value).
          // A later layout change (e.g. resize) re-renders and overrides it correctly.
        })
      }
    }

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
  // Grab the shadow snapshot into a local before clearing the module slot — it is
  // consumed later (in the closing block below), after this reset point.
  const shadowSnap = capturedShadow
  capturedBg = null
  capturedShadow = null
  capturedSpaceKind = null
  if (!stage) return

  const sel = (k: Key, rest: string) => `[data-window="${k.id}"][data-depth="${k.depth}"] ${rest}`

  if (opts.opening && opts.top) {
    // Fade any pure-fade chrome in immediately — no delay, so it doesn't appear to lag
    // behind the frame at the start. The do-list BODY is handled separately below (it
    // also scales), so exclude it here to avoid two competing opacity tweens.
    const chrome = stage.querySelectorAll(sel(opts.top, "[data-fade]:not([data-body])"))
    if (chrome.length) gsap.fromTo(chrome, { opacity: 0 }, { opacity: 1, duration: MORPH_DURATION * 0.45 })

    // Open body: scale UP + fade IN from center — the exact mirror of the close (which
    // scales the body down to 0.15 + fades out). Previously the body only faded, so it
    // looked static/full-size while the hexagon simply unveiled it; now it grows into
    // the leaf frame as the frame expands.
    const body = stage.querySelector<HTMLElement>(sel(opts.top, "[data-body]"))
    if (body) {
      gsap.fromTo(
        body,
        { opacity: 0, scale: 0.15 },
        {
          opacity: 1,
          scale: 1,
          transformOrigin: "center",
          duration: MORPH_DURATION * 0.7,
          ease: MORPH_EASE,
          // Clear the inline transform afterward so the settled body has no leftover
          // scale (it's a persistent node reused as a row/ancestor later).
          onComplete: () => gsap.set(body, { clearProps: "scale,transform" }),
        },
      )
    }

    // Late chrome (the close button) eases in starting at 0.3 of the morph (0.6s at
    // the default 2s) over 0.4 of it (0.8s), so it is fully visible at 0.7 (1.4s) and
    // then keeps sliding to its target with the rest of the animation — rather than
    // popping in early alongside the body. Scaled to MORPH_DURATION so it stays
    // proportional at any duration.
    const lateChrome = stage.querySelectorAll(sel(opts.top, "[data-fade-late]"))
    if (lateChrome.length)
      gsap.fromTo(
        lateChrome,
        { opacity: 0 },
        { opacity: 1, duration: MORPH_DURATION * 0.4, delay: MORPH_DURATION * 0.3, ease: MORPH_EASE },
      )
  }

  if (opts.closing) {
    // Fade the closing window's drop shadow out over the FIRST ~HALF of the morph
    // instead of letting it vanish instantly. The frame morphs into its row/card
    // (it does NOT fade its opacity like the deeper telescoping frames), so when
    // React swaps its window classes — incl. `shadow-2xl` — for the shadowless
    // row/card classes, the shadow disappeared in one frame (very obvious in light
    // mode). We re-apply the captured shadow inline and tween its colour alpha to 0
    // so it lingers, shrinking with the frame, then gently fades as it nears the row.
    const closingFrame = stage.querySelector<HTMLElement>(
      `[data-window="${opts.closing.id}"][data-depth="${opts.closing.depth}"][data-flip-role="frame"]`,
    )
    const prevShadow = closingFrame ? shadowSnap?.get(closingFrame.getAttribute("data-flip-id") ?? "") : undefined
    if (closingFrame && prevShadow) {
      // Same shadow geometry (offset/blur/spread), but every colour stop forced to
      // zero alpha — GSAP tweens the alpha down so the shadow fades rather than
      // popping to `none` (which is not interpolable).
      const fadedShadow = prevShadow.replace(/rgba?\([^)]*\)/g, "rgba(0, 0, 0, 0)")
      gsap.fromTo(
        closingFrame,
        { boxShadow: prevShadow },
        {
          boxShadow: fadedShadow,
          duration: MORPH_DURATION * 0.55,
          ease: MORPH_EASE,
          // Drop the inline boxShadow afterward so the persistent node falls back to
          // its class-driven shadow when it is opened as a window again.
          onComplete: () => gsap.set(closingFrame, { clearProps: "boxShadow" }),
        },
      )
    }

    const body = stage.querySelector<HTMLElement>(sel(opts.closing, "[data-body]"))
    if (body) {
      // Shrink toward the body's CENTER (was "top left", which made the content
      // collapse into the upper-left corner of the window). Centering reads as the
      // window's content imploding into the middle as it closes.
      gsap.fromTo(
        body,
        { opacity: 1, scale: 1 },
        { opacity: 0, scale: 0.15, transformOrigin: "center", duration: MORPH_DURATION * 0.7, ease: MORPH_EASE },
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
