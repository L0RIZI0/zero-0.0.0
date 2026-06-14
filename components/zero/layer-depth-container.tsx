"use client"

/**
 * Positions one framed window in the stack by its ABSOLUTE depth.
 *
 * THE WHOLE POINT (close-morph fix): a window's geometry here is a pure function
 * of its absolute `depth`, so a window NEVER moves for its entire life. Opening a
 * deeper child adds a new window ON TOP; it does not shift any existing window.
 * Closing removes the top window; it does not shift the others. Because the
 * button/row <-> window morph is a Framer shared-`layoutId` animation — which
 * Framer projects by measuring bounding boxes and writing a corrective transform
 * — the morph is clean ONLY when the morphing element's ancestors are not
 * themselves animating their geometry. The previous design positioned windows by
 * depth-FROM-TOP and animated the inset on every open/close, which corrupted the
 * scale projection of any row morphing inside (size snapped, only position eased:
 * the "jump + tiny slide"). Static per-depth geometry removes the animating
 * ancestor entirely, so DO-list rows morph exactly like dock cards.
 *
 * This is also the "nested dolls" UI that replaces the breadcrumb: each child is
 * inset inside its parent, revealing one more ancestor header strip at the top
 * and keeping all four borders of every ancestor visible.
 *
 * Depth 0 is the root home body (rendered as the z-0 backdrop in WorkSurface);
 * framed windows are depth >= 1. Depth 1 fills the whole window region (its inset
 * is 0) and grows over the home body; each deeper level peeks one header strip.
 */

// Each deeper level reveals this much of its parent's header at the top (px).
const TOP_PEEK_PX = 40
// ...and insets this much on the left/right/bottom so all parent borders show.
const SIDE_PX = 10

export function LayerDepthContainer({
  depth,
  isTop,
  children,
}: {
  depth: number
  isTop: boolean
  children: React.ReactNode
}) {
  // depth 1 -> step 0 (fills region); depth 2 -> step 1; etc.
  const step = Math.max(0, depth - 1)

  return (
    <div
      aria-hidden={!isTop}
      className="absolute"
      style={{
        top: step * TOP_PEEK_PX,
        left: step * SIDE_PX,
        right: step * SIDE_PX,
        bottom: step * SIDE_PX,
        zIndex: depth,
        // Only the top window is interactive as a whole. Ancestor windows are
        // inert EXCEPT their header bar (which re-enables pointer events itself
        // so its close button still works) — this lets the user click any
        // ancestor's close to cascade back to that level.
        pointerEvents: isTop ? "auto" : "none",
      }}
    >
      {children}
    </div>
  )
}
