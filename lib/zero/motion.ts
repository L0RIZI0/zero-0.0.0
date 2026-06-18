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
 * Clip-path shapes for the single-node morph. Spaces render as a hexagon (dock
 * card + open window); everything else stays a rounded rectangle. Both are
 * expressed as clip-paths so GSAP Flip can tween BETWEEN them in one pass (a
 * Space row reshaping rect → hex on open, and back on close). Ported from the
 * hexagon-dock prototype.
 *
 * The hexagon's six sharp vertices are SOFTENED into small rounded corners (so a
 * Space reads with gentle corners like every other rounded-rect entity, instead
 * of razor points). A clip-path `polygon()` can only draw straight segments, so
 * each corner is a short quadratic-Bézier fillet SAMPLED into a few points — see
 * `roundedPolygonPoints`. The same generator builds both the hexagon and its
 * flattened rectangle from the SAME vertex count, so every output point keeps a
 * 1:1 counterpart and Flip still interpolates the two clip-paths point-for-point.
 */
// Corner-fillet fraction + segment count for the HEXAGON clip. The rectangle clip
// is left perfectly SHARP (fillet 0) and rounds its corners with a real CSS
// border-radius on the frame instead — that's how a Space rectangle matches every
// other rounded-rect window's 8px corners exactly. Both shapes are still sampled
// into the SAME point count so GSAP Flip morphs one into the other point-for-point.
const CORNER_FILLET = 0.02
const CORNER_SEG = 4

// Base (sharp) vertices, clockwise from the top. The rectangle is the hexagon
// "flattened": the two slanted upper vertices ride to the top edge and the two
// lower vertices drop to the bottom edge — the shape an EXPANDED Space takes once
// a child opens over it. Same order + count as the hexagon (point-for-point morph).
const HEX_VERTS: [number, number][] = [
  [50, 0],
  [100, 25],
  [100, 75],
  [50, 100],
  [0, 75],
  [0, 25],
]
const RECT_VERTS: [number, number][] = [
  [50, 0],
  [100, 0],
  [100, 100],
  [50, 100],
  [0, 100],
  [0, 0],
]

/**
 * Round a polygon's corners (coords in 0..100 percent space) by replacing each
 * sharp vertex with a quadratic-Bézier fillet (control = the vertex, endpoints =
 * `f` of the way along each adjacent edge), sampled into `seg + 1` straight
 * points. A colinear corner (e.g. the rectangle's flat top edge) stays flat, so
 * the generator is safe to run on both shapes and still yields matching counts.
 */
function roundedPolygonPoints(verts: [number, number][], f: number, seg: number): [number, number][] {
  const n = verts.length
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const [px, py] = verts[(i - 1 + n) % n]
    const [vx, vy] = verts[i]
    const [nx, ny] = verts[(i + 1) % n]
    const ex = vx + f * (px - vx)
    const ey = vy + f * (py - vy)
    const xx = vx + f * (nx - vx)
    const xy = vy + f * (ny - vy)
    for (let s = 0; s <= seg; s++) {
      const t = s / seg
      const mt = 1 - t
      const x = mt * mt * ex + 2 * mt * t * vx + t * t * xx
      const y = mt * mt * ey + 2 * mt * t * vy + t * t * xy
      out.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100])
    }
  }
  return out
}

const toPolygon = (pts: [number, number][]) => `polygon(${pts.map(([x, y]) => `${x}% ${y}%`).join(", ")})`

/** Rounded HEXAGON corner points (0..100 space). Also drives the leaf hexagon's
 *  SVG boundary outline, so its visible edge traces the exact same shape as the
 *  clip. */
export const SPACE_HEX_POINTS = roundedPolygonPoints(HEX_VERTS, CORNER_FILLET, CORNER_SEG)
export const SPACE_CLIP_HEX = toPolygon(SPACE_HEX_POINTS)
/** The expanded-ancestor rectangle clip is a PERFECT full-box rectangle (fillet 0,
 *  but the SAME 30-point structure as the hexagon so Flip morphs between them
 *  cleanly). Its visible corners are rounded by a real CSS border-radius on the
 *  frame — identical to a task/event window — not by this clip. */
export const SPACE_CLIP_RECT = toPolygon(roundedPolygonPoints(RECT_VERTS, 0, CORNER_SEG))

/**
 * Telescopic, theme-aware, CAPPED surface model. A surface is the page
 * `--background` mixed `level` fixed steps toward `--foreground`. The mix
 * direction is the same in both themes, so a higher level is BRIGHTER in dark
 * mode (foreground is light) and DARKER in light mode (foreground is dark).
 *
 * Colour tracks a window's DISTANCE FROM THE LEAF, not its absolute depth, and is
 * clamped to `SURFACE_CAP_LEVEL` so the UI stays unmistakably "dark in dark mode /
 * light in light mode" no matter how deep the stack goes — a deep leaf never burns
 * the eyes, and window text/icons stay readable WITHOUT any per-depth ink flip.
 *
 * The themes are intentionally ASYMMETRIC:
 *   - Dark mode: leaf is ELEVATED toward the light foreground (capped); ancestors
 *     recede toward the dark `--background`; home (window 0) lands on pure
 *     `--background`. This is what keeps a deep leaf from burning the eyes.
 *   - Light mode: a NO-OP. Every window stays on the bright `--background`
 *     (level 0); depth is conveyed entirely by the existing drop shadows, so the
 *     UI never trends darker than the chosen light theme.
 * On shallow stacks dark mode degrades gracefully (leaf ≤ cap; home at level 0).
 */
export const SURFACE_STEP_PCT = 9
export const SURFACE_CAP_LEVEL = 3

export function surfaceAt(level: number) {
  if (level <= 0) return "var(--background)"
  return `color-mix(in oklab, var(--background), var(--foreground) ${level * SURFACE_STEP_PCT}%)`
}

export function telescopicLevel(depth: number, leafDepth: number, isDark: boolean) {
  // Light mode: every window stays on --background; drop shadows alone show depth.
  if (!isDark) return 0
  // Dark mode: leaf elevated (capped) → min(cap, leafDepth); each ancestor one step
  // dimmer; home (largest distance) reaches level 0 = pure --background.
  const distance = Math.max(0, leafDepth - depth) // 0 at the leaf, grows for ancestors
  return Math.max(0, Math.min(SURFACE_CAP_LEVEL, leafDepth) - distance)
}

export function telescopicSurface(depth: number, leafDepth: number, isDark: boolean) {
  return surfaceAt(telescopicLevel(depth, leafDepth, isDark))
}

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

// How many levels an ancestor must sit BEHIND the frontmost leaf before its
// header collapses from a horizontal band into a vertical SPINE (glyph at top,
// title rotated to read up a narrow left strip). At distance ≥ 3 the window is so
// deeply buried that a horizontal header would only waste a top peek and push the
// leaf further down screen; a spine reclaims that by stacking these ancestors
// HORIZONTALLY (left strips) instead of vertically. distance = leafDepth - depth.
export const VERTICAL_BEHIND = 3
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
// Right peek reveals an ancestor's collapsed Outs rail beside the child window.
// Only the leaf's DIRECT parent gets this full peek (so its OUT rail reads
// clearly); the home view shows its own rail via WINDOW_BASE_SIDE instead.
export const RIGHT_PEEK = 24
// In-between ancestors (everything from the home view's first child down to the
// leaf's grandparent) collapse their right peek to a barely-there sliver. Their
// OUT rails would only crowd the stack and steal horizontal space from the leaf,
// so they recede to a hairline while the leaf, its parent, and home stay legible.
export const RIGHT_PEEK_SLIVER = 8
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
  // Per-ancestor flag (parallel to `ancestorKinds`) marking spine ancestors —
  // those collapsed to a vertical left strip because they sit ≥ VERTICAL_BEHIND
  // levels behind the leaf. A spine ancestor reserves its left/right peeks (so its
  // strip + IN/OUT rails stay visible) but NO top peek: its child aligns to the
  // SAME top, so deeply-stacked spines fan out horizontally instead of marching
  // the leaf ever further down the screen.
  ancestorVertical?: boolean[],
  // Depth of the frontmost (leaf) window in the stack. Used to size right peeks:
  // the leaf's DIRECT parent shows a full OUT rail, every other ancestor only a
  // sliver. When omitted (e.g. the transient closing animation), all ancestors
  // fall back to the full peek so geometry stays consistent with older callers.
  leafDepth?: number,
): Rect {
  let top = 0
  let left = WINDOW_BASE_SIDE
  let right = WINDOW_BASE_SIDE
  let bottom = 0
  // EVERY ancestor — space, task, event or instant — uses the same nested-doll
  // profile. The LEFT strip always accumulates (IN rail / spine stays visible);
  // the TOP peek is skipped for spine ancestors so their child shares their top.
  ancestorKinds.forEach((_kind, i) => {
    // `i`-th ancestor sits at stack depth `i + 1`. Its right peek is the OUT-rail
    // sliver THIS ancestor shows beside its child. Full only for the leaf's direct
    // parent (depth leafDepth − 1); all in-between ancestors get the thin sliver so
    // they stop eating the leaf's width. (Home, depth 0, isn't in this list — its
    // rail shows via WINDOW_BASE_SIDE.)
    const isLeafParent = leafDepth != null && i + 1 === leafDepth - 1
    right += leafDepth == null || isLeafParent ? RIGHT_PEEK : RIGHT_PEEK_SLIVER
    left += TASK_SIDE
    if (!ancestorVertical?.[i]) top += TASK_TOP_PEEK
  })
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
 * Fraction of the visible region height (`rect.height`) that the hexagon's four
 * SIDE corners (the 25%- and 75%-height vertices: upper-/lower-left and -right)
 * are allowed to span. The hexagon is centered in the region, so its side-corner
 * band measures `0.5 × height`; capping that band at `HEX_CORNER_BAND × region`
 * guarantees the four side corners land inside the region with a small margin
 * (here ~8% top and bottom), while the top/bottom POINTS still overflow off-screen
 * (behind the header / past the bottom). Driven by viewport height — NOT width —
 * so a "full-screen" hexagon on a wide monitor no longer grows so tall that those
 * corners disappear.
 */
const HEX_CORNER_BAND = 0.84

/**
 * Largest perfect (regular) hexagon that fits inside `rect` while keeping its
 * four SIDE corners visible. Used for every Space window (leaf or ancestor).
 *
 * Two constraints, whichever is smaller wins:
 *   1. WIDTH — never wider than the parent-allowed width (`rect.width`, which
 *      already reserves the side peek so IN/OUT rails stay visible beside it).
 *      This dominates on tall/narrow viewports.
 *   2. HEIGHT — the side-corner band (`0.5 × height`) must fit within
 *      `HEX_CORNER_BAND × rect.height`, i.e. `height ≤ HEX_CORNER_BAND × 2 ×
 *      rect.height`. This dominates on WIDE viewports, where a width-driven
 *      hexagon would be far too tall and push the side corners off-screen.
 *
 * The result is centered both axes within `rect`. The shape stays a perfect
 * regular hexagon (ratio √3/2 preserved); only its overall scale adapts to the
 * viewport. Its top/bottom points still bleed off-screen by design.
 */
export function perfectHexInside(rect: Rect): Rect {
  // Start width-driven (full available width)…
  let width = rect.width
  let height = width / HEX_W_OVER_H
  // …then cap by the viewport-height constraint so the side corners stay in view.
  const maxHeight = HEX_CORNER_BAND * 2 * rect.height
  if (height > maxHeight) {
    height = maxHeight
    width = height * HEX_W_OVER_H
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
