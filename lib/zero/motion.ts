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
export const HEADER_H = 57
export const TASK_TOP_PEEK = 56
export const TASK_SIDE = 10
export const SPACE_SPINE = 56
export const SPACE_TOP_PEEK = 28
// Right peek is wide enough (was 14) to reveal an ancestor space's collapsed
// Outs rail beside the child window — so each ancestor in the stack keeps its
// Inputs/Outputs reachable. It compounds per ancestor, so deeper dives let each
// successive parent peek a little more on the right.
export const SPACE_RIGHT_PEEK = 46
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
    if (kind === "space") {
      left += SPACE_SPINE
      top += SPACE_TOP_PEEK
      right += SPACE_RIGHT_PEEK
      bottom += SPACE_BOTTOM_PEEK
    } else {
      top += TASK_TOP_PEEK
      left += TASK_SIDE
      right += TASK_SIDE
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
