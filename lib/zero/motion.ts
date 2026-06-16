import type { Transition } from "motion/react"
import type { EntityKind } from "./types"

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

/** Geometry of the nested-doll window stack (px), keyed off absolute depth. */
export const TOP_PEEK_PX = 40
export const SIDE_PX = 10

/**
 * Window-stack geometry, ported from the `flip-demo` prototype. Region-relative:
 * a depth-1 window fills the focus-window region exactly (no base inset); each
 * deeper level reserves space according to its ANCESTORS' kinds so every
 * ancestor stays partly visible behind it. Two reservation profiles:
 *
 *   - a SPACE ancestor collapses its header to a vertical left rail (the
 *     "spine"), so its child insets from the LEFT (and peeks a little on the
 *     other three sides, keeping the parent's corner + close button clear);
 *   - any other ancestor (task/event/instant) peeks from the TOP, the original
 *     nested-doll inset.
 */
// Horizontal entity header height. Trimmed ~1/4 (was 57) for a more compact band.
export const HEADER_H = 43
export const TASK_TOP_PEEK = 56
// A non-space (task/event/instant) ancestor used to peek ONLY from the top (side
// inset was just 10px), so a child window covered almost its entire body — hiding
// the parent's collapsed IN/OUT rails. This side peek leaves a strip of the
// parent on the left and right so those rails stay visible and reachable. Pared
// back ~1/3 (was 48) so the peek is present but not overly generous.
export const TASK_SIDE = 32
export const SPACE_SPINE = 56
export const SPACE_TOP_PEEK = 28
// Right peek is wide enough to reveal an ancestor's collapsed Outs rail beside
// the child window — so each ancestor in the stack keeps its Outputs reachable.
// Applied uniformly to EVERY ancestor kind (space or task/event/instant): the
// right margin no longer differs by parent type, only the LEFT does (spine vs.
// task side inset). Compounds per ancestor, so deeper dives peek a little more.
export const RIGHT_PEEK = 46
export const SPACE_BOTTOM_PEEK = 14
/**
 * Base horizontal inset applied to EVERY focus window (even the depth-1 child of
 * the home view, which has no ancestors). It makes each window a touch narrower
 * on both sides so the home view's collapsed Inputs/Outputs rails — which hug the
 * region's left/right edges — stay visible peeking out beside the open window.
 * Only the sides inset; top/bottom still fill the region.
 */
export const WINDOW_BASE_SIDE = 44

/**
 * Resting box for a window whose frame ANCESTORS (the in-stack windows above the
 * root backdrop and below this one) have the given `ancestorKinds`, within a
 * region of `region` px. Walking the kinds — rather than using a flat depth
 * step — is what lets a task open to the RIGHT of its parent space's spine
 * instead of merely below it.
 */
export function stackTargetRect(
  ancestorKinds: EntityKind[],
  region: { w: number; h: number },
): Rect {
  let top = 0
  let left = WINDOW_BASE_SIDE
  let right = WINDOW_BASE_SIDE
  let bottom = 0
  for (const kind of ancestorKinds) {
    // Right peek is uniform across ancestor kinds; only the left differs.
    right += RIGHT_PEEK
    if (kind === "space") {
      left += SPACE_SPINE
      top += SPACE_TOP_PEEK
      bottom += SPACE_BOTTOM_PEEK
    } else {
      top += TASK_TOP_PEEK
      left += TASK_SIDE
    }
  }
  return { top, left, width: region.w - left - right, height: region.h - top - bottom }
}

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
