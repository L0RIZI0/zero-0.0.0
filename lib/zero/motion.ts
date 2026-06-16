import type { Transition } from "motion/react"
import type { EntityKind } from "./types"

/**
 * Zero motion language: calm, precise, deterministic. No bounce.
 * A single shared transition keeps the shared-element morph coherent.
 */
// Shared easing: cubic-bezier(.62, .02, .07, .99). A smooth ease-in-out with a
// firm pull through the middle and a soft settle so the motion feels deliberate.
export const MORPH_EASE: [number, number, number, number] = [0.62, 0.02, 0.07, 0.99]

export const layerTransition: Transition = {
  duration: 0.66,
  ease: MORPH_EASE,
}

export const contentTransition: Transition = {
  duration: 0.66,
  ease: MORPH_EASE,
}

/** Quick, natural expand/collapse for the side panels (Inputs / Outputs). */
export const panelTransition: Transition = {
  duration: 0.66,
  ease: MORPH_EASE,
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
 * Clip-path shapes for the single-node morph. Spaces render as a regular hexagon
 * (dock card + open window); everything else stays a rounded rectangle. Both are
 * expressed as clip-paths so GSAP Flip can tween BETWEEN them in one pass (a
 * Space row reshaping rect → hex on open, and back on close). Ported from the
 * hexagon-dock prototype.
 */
export const SPACE_CLIP_HEX = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)"
export const RECT_CLIP = "inset(0px round 4px)"

/** The clip-path a node should wear given its kind, its collapsed variant, and
 *  whether it is (or is becoming) an open window. Only Spaces ever become
 *  hexagons. A Space's DOCK CARD is a hexagon even at rest (its clip tween on
 *  open is a no-op, so it purely grows); a Space ROW is a rectangle at rest and
 *  reshapes rect → hex as it opens (and back on close). */
export function clipFor(kind: EntityKind, variant: "row" | "dock", asWindow: boolean): string {
  if (kind !== "space") return RECT_CLIP
  if (asWindow) return SPACE_CLIP_HEX
  return variant === "dock" ? SPACE_CLIP_HEX : RECT_CLIP
}

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
// Horizontal entity header height (the frontmost LEAF window uses this).
// Trimmed ~1/4 (was 57) for a more compact band.
export const HEADER_H = 43
// Non-spine ANCESTOR (stacked, non-leaf) windows use a shorter header than the
// leaf — sized between the full leaf header (43) and a Space's thin top-peek
// (SPACE_TOP_PEEK, 20) — so stacked ancestors read as more recessed (smaller
// glyph + title too, see entity-node) without collapsing all the way to a spine.
export const ANCESTOR_HEADER_H = 35
// Top peek for a task/event/instant ancestor: how much of it shows above its
// child. Matches ANCESTOR_HEADER_H (+1, mirroring the leaf's 43→44 hairline gap)
// so the visible band equals the now-shorter ancestor header with no empty strip
// below the divider. Trimmed from 44 as part of making ancestors more compact.
export const TASK_TOP_PEEK = 36
// A non-space (task/event/instant) ancestor used to peek ONLY from the top (side
// inset was just 10px), so a child window covered almost its entire body — hiding
// the parent's collapsed IN/OUT rails. This side peek leaves a strip of the
// parent on the left so its IN rail stays visible and reachable. Trimmed to sit
// close to RIGHT_PEEK so the left strip isn't noticeably wider than the right.
export const TASK_SIDE = 26
export const SPACE_SPINE = 56
export const SPACE_TOP_PEEK = 20
// Right peek reveals just a sliver of an ancestor's collapsed Outs rail beside
// the child window. Applied uniformly to EVERY ancestor kind (space or
// task/event/instant) — the right margin no longer differs by parent type, only
// the LEFT does (spine vs. task side inset). Kept small (task-over-task sized),
// NOT as generous as the space spine on the left. Compounds per ancestor.
export const RIGHT_PEEK = 24
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
