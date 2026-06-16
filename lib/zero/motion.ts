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

/** Geometry of the nested-doll window stack (px), keyed off absolute depth. */
export const TOP_PEEK_PX = 40
export const SIDE_PX = 10

/**
 * Window-stack geometry. Region-relative: a depth-1 window fills the focus-window
 * region exactly (no base inset); each deeper level reserves space according to
 * its ancestors so every ancestor stays partly visible behind it. EVERY ancestor
 * kind — including a Space — uses the same TOP-peek nested-doll profile: a Space
 * is a perfect hexagon only while it is the frontmost leaf, and widens into a
 * standard rounded-rect ancestor (top band + side IN/OUT peeks) the moment a
 * child opens over it.
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
// Right peek reveals just a sliver of an ancestor's collapsed Outs rail beside
// the child window.
export const RIGHT_PEEK = 24
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
 * region of `region` px. Walking the kinds keeps the per-ancestor reservation
 * uniform across kinds now that Spaces no longer use a special centered profile.
 */
export function stackTargetRect(
  ancestorKinds: EntityKind[],
  region: { w: number; h: number },
): Rect {
  let top = 0
  let left = WINDOW_BASE_SIDE
  let right = WINDOW_BASE_SIDE
  let bottom = 0
  // EVERY ancestor — space, task, event or instant — now uses the same top-peek
  // nested-doll profile. A space stops being a centered hexagon the moment a
  // child opens over it: it widens into a standard rounded-rect ancestor whose
  // top band shows its glyph/title and whose left/right slivers expose its
  // collapsed IN/OUT rails (matching the prototype's other entity kinds, and
  // letting the fixed child window escape what used to be a clipping hexagon).
  for (const _kind of ancestorKinds) {
    right += RIGHT_PEEK
    top += TASK_TOP_PEEK
    left += TASK_SIDE
  }
  return { top, left, width: region.w - left - right, height: region.h - top - bottom }
}

/** A rectangle in viewport coordinates — the box a window morphs from / to. */
export type Rect = { top: number; left: number; width: number; height: number }

/**
 * For the pointy-top hexagon clip `polygon(50% 0, 100% 25%, 100% 75%, 50% 100%,
 * 0 75%, 0 25%)`, a TRUE regular hexagon has width : height = √3 : 2, i.e.
 * width = height × 0.8660. Below this ratio the clip renders as a stretched
 * (too-wide) hexagon; above it, too-narrow. We size the frontmost leaf Space
 * window to honour it exactly so a freshly opened Space is a perfect hexagon.
 */
const HEX_W_OVER_H = Math.sqrt(3) / 2

/**
 * Largest perfect (regular) hexagon that fits inside `rect`, centered within it.
 * Used for a Space window that is the frontmost LEAF (no child open): it ignores
 * the wide focus region and instead occupies a true hexagon. As soon as a child
 * opens the Space is no longer the leaf and reverts to the full `stackTargetRect`
 * box — i.e. it "widens" to host the child.
 */
export function perfectHexInside(rect: Rect): Rect {
  let height = rect.height
  let width = height * HEX_W_OVER_H
  if (width > rect.width) {
    width = rect.width
    height = width / HEX_W_OVER_H
  }
  return {
    top: rect.top + (rect.height - height) / 2,
    left: rect.left + (rect.width - width) / 2,
    width,
    height,
  }
}

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
