import type { Transition } from "motion/react"
import type { EntityKind } from "./types"

/**
 * Zero motion language: calm, precise, deterministic. No bounce.
 * A single shared transition keeps the shared-element morph coherent.
 */
// ── Timing ──────────────────────────────────────────────────────────────────
// ONE canonical duration drives the entire shared-element morph, so the GSAP Flip
// (frames) and the Framer-driven chrome (surfaces, header, panels) always land on
// the exact same beat. Deliberately 2s: shorter felt like dropped frames on the
// heavier reshape/clip morphs. Tune the whole system from here — `flip-stage.ts`
// derives its `MORPH_DURATION` from this same constant.
export const MORPH_SECONDS = 2

// Shared easing: cubic-bezier(.62, .02, .07, .99). A smooth ease-in-out with a
// firm pull through the middle and a soft settle so the motion feels deliberate.
// Mirrored in flip-stage.ts as a GSAP CustomEase ("zeroLand") and a CSS string
// (MORPH_CSS_EASE) so Flip, CSS chrome and Framer chrome share one curve.
export const MORPH_EASE: [number, number, number, number] = [0.62, 0.02, 0.07, 0.99]

// All three are the same beat as the morph; kept as distinct named exports so
// their intent stays legible at call sites (and so any one can diverge later).
const morphBeat: Transition = { duration: MORPH_SECONDS, ease: MORPH_EASE }
/** Surfaces / backdrops receding or advancing as the window stack changes. */
export const layerTransition: Transition = morphBeat
/** Body content fading / sliding along with its window. */
export const contentTransition: Transition = morphBeat
/** IN / OUT side panels expanding & collapsing. The open panel OVERLAYS the
 *  content (it doesn't reflow the center list), so this animation never waits on
 *  any sibling layout — it starts the instant the panel toggles. */
export const panelTransition: Transition = morphBeat

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
 * Unified Space clip — ONE 8-vertex polygon parameterized by two inset percents,
 * so EVERY Space state (dock-card hexagon, wide leaf octagon, flat ancestor
 * rectangle) is the SAME eight points in the SAME winding order. GSAP Flip then
 * tweens between ANY two states point-for-point in a single pass with nothing to
 * snap, and the SVG boundary traces the exact same points as the clip.
 *
 *   ax = horizontal inset of the flat TOP & BOTTOM edges (% of width)
 *        50 → the two top points (and the two bottom points) coincide → a pointy-
 *             top regular HEXAGON (the dock card / collapsed source shape)
 *         0 → the flat edge spans the full width → a rectangle edge
 *   hy = vertical inset of the LEFT & RIGHT bracket vertices (% of height)
 *        25 → the hexagon's four side corners; 0 → full-height rectangle edge
 *
 * Points, clockwise from the top-left corner of the flat top edge:
 *   (ax,0) (100-ax,0) (100,hy) (100,100-hy) (100-ax,100) (ax,100) (0,100-hy) (0,hy)
 *
 * State map:
 *   hexagon   = (50, 25)        → SPACE_HEX_POINTS / SPACE_CLIP_HEX (dock source)
 *   rectangle = (0,  0)         → SPACE_CLIP_RECT (do-list row source, ancestor)
 *   octagon   = (spaceLeafAx, 25) → the opened LEAF (true 120° corners, max width)
 *
 * Going hexagon → octagon, only `ax` changes: the doubled top/bottom points SPLIT
 * and slide apart horizontally into the wide flat edges (the user-described "the
 * hexagon keeps growing sideways"). Going octagon → rectangle, the bracket
 * vertices ride to the corners and the flat edges spread to full width — the
 * shape an EXPANDED Space takes once a child opens over it.
 */
export function spaceClipPoints(ax: number, hy: number): [number, number][] {
  return [
    [ax, 0],
    [100 - ax, 0],
    [100, hy],
    [100, 100 - hy],
    [100 - ax, 100],
    [ax, 100],
    [0, 100 - hy],
    [0, hy],
  ]
}

const toPolygon = (pts: [number, number][]) => `polygon(${pts.map(([x, y]) => `${x}% ${y}%`).join(", ")})`

/** Clip-path string for a Space state from its two insets (see spaceClipPoints). */
export const spaceClip = (ax: number, hy: number) => toPolygon(spaceClipPoints(ax, hy))

/**
 * Vertical inset (% of height) of the leaf octagon's bracket vertices. Matches the
 * hexagon's side corners (25%), so opening only has to SPLIT/SLIDE the top & bottom
 * points outward — the left/right bracket edges stay put — for a calm morph.
 */
export const LEAF_HY = 25

// Eight hexagon vertices (top & bottom points doubled at 50%). Still a pointy-top
// regular hexagon (the coincident points draw a zero-length edge). Exported so any
// SVG boundary can trace the exact same shape as the clip.
export const SPACE_HEX_POINTS = spaceClipPoints(50, LEAF_HY)
export const SPACE_CLIP_HEX = spaceClip(50, LEAF_HY)
export const SPACE_CLIP_RECT = spaceClip(0, 0)

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
// Extra top peek added ONLY when the ancestor is a Space: its child sits this many
// px lower so a sliver of the Space's top border shows above the child. Because the
// loop accumulates `top` across ancestors, this shift cascades — grandchildren and
// deeper descendants move down by the same amount relative to the Space.
export const SPACE_CHILD_TOP_PEEK = 4
// A non-space (task/event/instant) ancestor used to peek ONLY from the top (side
// inset was just 10px), so a child window covered almost its entire body — hiding
// the parent's collapsed IN/OUT rails. This side peek leaves a strip of the
// parent on the left so its IN rail stays visible and reachable. Trimmed to sit
// close to RIGHT_PEEK so the left strip isn't noticeably wider than the right.
export const TASK_SIDE = 26
// Right peek reveals an ancestor's collapsed Outs rail beside the child window.
// EVERY ancestor gets this full peek so the right side mirrors the left: a clean
// succession of OUT-rail panels, one per ancestor (the home view shows its own
// rail via WINDOW_BASE_SIDE instead).
export const RIGHT_PEEK = 24
/**
 * Base horizontal inset applied to EVERY focus window (even the depth-1 child of
 * the home view, which has no ancestors). It makes each window a touch narrower
 * on both sides so the home view's collapsed Inputs/Outputs rails �� which hug the
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
): Rect {
  let top = 0
  let left = WINDOW_BASE_SIDE
  let right = WINDOW_BASE_SIDE
  let bottom = 0
  // EVERY ancestor — space, task, event or instant — uses the same nested-doll
  // profile. The LEFT strip always accumulates (IN rail / spine stays visible);
  // the TOP peek is skipped for spine ancestors so their child shares their top.
  ancestorKinds.forEach((kind, i) => {
    // `i`-th ancestor sits at stack depth `i + 1`. EVERY ancestor reserves a full
    // RIGHT_PEEK so its OUT rail shows in a clean succession, mirroring the left
    // side's IN rails. (Home, depth 0, isn't in this list — its rail shows via
    // WINDOW_BASE_SIDE.)
    right += RIGHT_PEEK
    left += TASK_SIDE
    if (!ancestorVertical?.[i]) top += TASK_TOP_PEEK
    // When THIS ancestor is a Space, nudge its child an extra 2px down so the
    // Space's top border peeks above the child. This is applied REGARDLESS of the
    // spine check above: an ancestor Space is always in rectangle mode (the hexagon
    // is leaf-only), so even when it's a vertical spine — which normally shares its
    // top with its child — its child should still drop 2px so the Space's top edge
    // shows. The accumulating `top` carries the shift to all deeper descendants.
    if (kind === "space") top += SPACE_CHILD_TOP_PEEK
  })
  return { top, left, width: region.w - left - right, height: region.h - top - bottom }
}

/** A rectangle in viewport coordinates — the box a window morphs from / to. */
export type Rect = { top: number; left: number; width: number; height: number }

/**
 * The opened LEAF Space fills its WHOLE allowed box (full width minus the side
 * peeks, full height); the unified 8-point clip then carves a wide OCTAGON out of
 * it — maximizing content width instead of squeezing it into a centered regular
 * hexagon, and avoiding a giant mostly-offscreen shape. Identity for now; kept as a
 * named seam should we ever want a small inset.
 */
export function octagonLeafInside(rect: Rect): Rect {
  return rect
}

/**
 * Horizontal inset (% of width) of the leaf octagon's flat top/bottom edges that
 * makes the slanted corners a TRUE 120° interior angle at the given frame size.
 * The slant runs `ax%·W` horizontally over `hy%·H` vertically; a 120° corner needs
 * rise : run = √3 : 1, i.e. `ax%·W = (hy%·H)/√3` → `ax = hy·H / (√3·W)` (in percent).
 * Clamped to [0, 50] so a very tall/narrow frame can't push the flat edge past the
 * brackets (which would invert the octagon).
 */
export function spaceLeafAx(width: number, height: number, hy = LEAF_HY): number {
  if (width <= 0) return 0
  const ax = (hy * height) / (Math.sqrt(3) * width)
  return Math.max(0, Math.min(50, ax))
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
