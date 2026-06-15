import type { Transition } from "motion/react"

/**
 * Zero motion language: calm, precise, deterministic. No bounce.
 * A single shared transition keeps the shared-element morph coherent.
 */
export const layerTransition: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 44,
  mass: 0.9,
}

export const contentTransition: Transition = {
  duration: 0.32,
  ease: [0.22, 0.61, 0.36, 1],
}

/** Quick, natural expand/collapse for the side panels (Inputs / Outputs). */
export const panelTransition: Transition = {
  duration: 0.24,
  ease: [0.22, 0.61, 0.36, 1],
}

/**
 * The single attribute name a morph SOURCE exposes so an opening window can
 * measure the exact box to grow from (and shrink back to on close). Every
 * DO-list row, dock card, and timeline marker tags itself with this + the entity
 * id; events/instants also tag `data-morph-where` ("row" | "timeline") since
 * they exist in two places at once. See `EntityFrame` for the geometry morph
 * that replaced Framer's shared-`layoutId` projection.
 */
export const MORPH_SOURCE_ATTR = "data-morph-source"
export const MORPH_WHERE_ATTR = "data-morph-where"

/**
 * Shared-element morph identity. An entity is rendered in two visual states —
 * COLLAPSED (a dock card / DO-list row / timeline marker) and EXPANDED (its
 * window) — and the transition between them is NOT a bespoke tween: it is a
 * Framer shared-layout animation. Three sub-elements carry a stable `layoutId`
 * per entity so each one independently flies between its collapsed and expanded
 * position while staying crisp (no whole-window scale distortion):
 *
 *   - frame : the visual box (border + surface + shadow), rendered BEHIND the
 *             content — conceptually "the window" is just this element, which
 *             happens to also be the button's background when collapsed.
 *   - glyph : the kind mark.
 *   - title : the entity title (slides from beneath the glyph on a dock card to
 *             beside it in the window header, growing in size en route).
 *
 * Only ONE on-screen element may own a given layoutId at a time (Framer matches
 * by id), so collapsed sources RELEASE their ids while the window is open, and
 * dual-presence entities (a timed event lives as both a row and a timeline
 * marker) elect a single owner via the nav store's open-source.
 */
export const frameLayoutId = (id: string) => `z-frame-${id}`
export const accentLayoutId = (id: string) => `z-accent-${id}`
export const glyphLayoutId = (id: string) => `z-glyph-${id}`
export const titleLayoutId = (id: string) => `z-title-${id}`

/** Geometry of the nested-doll window stack (px), keyed off absolute depth. */
export const TOP_PEEK_PX = 40
export const SIDE_PX = 10

/** A rectangle in viewport coordinates — the box a window morphs from / to. */
export type Rect = { top: number; left: number; width: number; height: number }

/**
 * Measure the on-screen morph source for an entity (its DO-list row, dock card,
 * or timeline marker) and return its VIEWPORT rect, or null if not mounted.
 * Captured at click time (when the element is guaranteed present) and stored in
 * the nav store, so the same box is reused for the close shrink even though the
 * source is unmounted while the window is open. `where` disambiguates the two
 * places an event/instant can live ("row" vs "timeline").
 */
export function captureSourceRect(id: string, where?: string): Rect | null {
  if (typeof document === "undefined") return null
  const esc = (window as unknown as { CSS?: typeof CSS }).CSS?.escape ?? ((s: string) => s)
  const sel = where
    ? `[${MORPH_SOURCE_ATTR}="${esc(id)}"][${MORPH_WHERE_ATTR}="${esc(where)}"]`
    : `[${MORPH_SOURCE_ATTR}="${esc(id)}"]`
  const el = document.querySelector(sel) as HTMLElement | null
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}
