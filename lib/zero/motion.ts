import type { Transition } from "motion/react"
import type { EntityKind } from "./types"
import { VIEW_PAD_X } from "./layout"

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
 * ASSETS / PUBLISHED side panels sliding in/out as an opaque overlay over the View.
 * Deliberately DECOUPLED from the 2s morph beat: the panel is not part of the window
 * shared-element morph, so it should feel snappy and immediate — the shortcut spine
 * stays put and the panel just pops in from the edge. A pronounced ease-OUT curve
 * (fast entry, long decelerating tail) so it lands SOFTLY at the edge — a clearly
 * visible, cushioned glide rather than a hard pop. Lengthened to 0.55s so the soft
 * landing actually reads (the shorter versions felt instantaneous).
 */
export const panelSlideTransition: Transition = { duration: 0.55, ease: [0.16, 1, 0.3, 1] }

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
 *   octagon   = spaceLeafInsets(w,h) → the opened LEAF (true 120° corners, max width)
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

// Top peek for a task/event/instant (non-space, non-spine) ancestor: how much of
// it shows above its child. A non-space ancestor keeps its LEAF header height
// (HEADER_H) — becoming an ancestor no longer shrinks its header — so the child's
// top must clear that FULL header: it aligns to the ancestor's View top (header
// bottom) rather than overlapping the header. Derived as HEADER_H + 1 so the child
// sits just past the header divider (the +1 is the leaf's 43→44 hairline gap) and
// stays in sync if the header height changes. (Space ancestors are spines and
// reserve NO top peek — their child shares their top — so this only governs
// non-space ancestors.)
export const TASK_TOP_PEEK = HEADER_H + 1
// Extra top peek for a Space ancestor's child. Now 0: a child's window top reaches
// the TOP of its ancestor Space's View (flush) rather than sitting a few px lower —
// a covered ancestor Space is a spine (its header is the LEFT strip, so there's no
// top header band to peek), so the child shares its top edge. Kept as a named seam
// (still added in stackTargetRect) in case a deliberate top sliver is wanted later.
export const SPACE_CHILD_TOP_PEEK = 0
// Left peek reserved per ancestor: the width of the ancestor's left "spine" (its
// summary edge — glyph, optional rotated title for spaces, excerpt counters, and
// its resources in peek form) that stays visible beside the child window. Unified
// to the SAME width as a focused window's spine (PANEL_SPINE_W = 48) so a spine is
// the SAME width at every depth — focused OR ancestor — instead of shrinking when
// an entity becomes an ancestor. Kept in sync with entity-body's PANEL_SPINE_W and
// the ancestor strip width in entity-node (w-[48px]).
export const TASK_SIDE = 48
// Right peek reveals an ancestor's collapsed Outs spine beside the child window.
// Unified to the same 48px so the right spine mirrors the left at every depth: a
// clean succession of equal-width OUT-spine panels, one per ancestor (the home view
// shows its own spine via WINDOW_BASE_SIDE instead).
export const RIGHT_PEEK = 48
/**
 * Base horizontal inset applied to EVERY focus window (even the depth-1 child of
 * the home view, which has no ancestors). It makes each window a touch narrower
 * on both sides so the home view's collapsed Inputs/Outputs spines �� which hug the
 * region's left/right edges — stay visible peeking out beside the open window.
 * Only the sides inset; the vertical inset (a top of 0 and the bottom gutter) is
 * applied to `liftedRegion` in nav-store.
 *
 * This IS the View's horizontal padding: an open window spans its parent View minus
 * the View padding, so the side inset is derived from VIEW_PAD_X (single source) —
 * change the View gutter and every window's side inset follows.
 */
export const WINDOW_BASE_SIDE = VIEW_PAD_X

/**
 * Resting box for a window whose frame ANCESTORS (the in-stack windows above the
 * root backdrop and below this one) have the given `ancestorKinds`, within a
 * region of `region` px. Walking the kinds keeps the per-ancestor reservation
 * uniform across kinds now that Spaces no longer use a special centered profile.
 */
export function stackTargetRect(
  ancestorKinds: EntityKind[],
  region: { w: number; h: number },
  // Per-ancestor flag (parallel to `ancestorKinds`) marking spine ancestors — those
  // collapsed to a vertical left strip. Only SPACE ancestors spine (see nav-store's
  // `ancestorVertical` / entity-node's `isSpine`). A spine ancestor reserves its
  // left/right peeks (so its strip + IN/OUT spines stay visible) but NO top peek: its
  // child aligns to the SAME top, so spines fan out horizontally instead of marching
  // the leaf ever further down the screen.
  ancestorVertical?: boolean[],
  // True when the window BEING computed is itself a Space. A Space child rises to
  // OVERLAP its immediate parent's top ONLY when that parent is ALSO a Space — i.e.
  // space-in-space shares the top edge, so the IMMEDIATE parent (last ancestor)
  // reserves NO top peek. When a Space opens inside a NON-Space parent (task/event),
  // it instead sits just below the parent's header like any other child. Deeper
  // ancestors always reserve their peeks.
  selfIsSpace?: boolean,
): Rect {
  let top = 0
  let left = WINDOW_BASE_SIDE
  let right = WINDOW_BASE_SIDE
  let bottom = 0
  // EVERY ancestor — space, task, event or instant — uses the same nested-doll
  // profile. The LEFT strip always accumulates (IN spine / spine stays visible);
  // the TOP peek is skipped for spine ancestors so their child shares their top.
  ancestorKinds.forEach((kind, i) => {
    // `i`-th ancestor sits at stack depth `i + 1`. EVERY ancestor reserves a full
    // RIGHT_PEEK so its OUT spine shows in a clean succession, mirroring the left
    // side's IN spines. (Home, depth 0, isn't in this list — its spine shows via
    // WINDOW_BASE_SIDE.)
    right += RIGHT_PEEK
    left += TASK_SIDE
    // A Space child overlaps its IMMEDIATE parent's top ONLY when that parent is a
    // Space too: skip the last ancestor's top reservations so the Space rises onto
    // its parent's top edge. A Space inside a non-Space parent keeps the normal peek
    // and sits below the parent's header.
    const skipTopPeek =
      selfIsSpace === true && i === ancestorKinds.length - 1 && kind === "space"
    if (!ancestorVertical?.[i] && !skipTopPeek) top += TASK_TOP_PEEK
    // When THIS ancestor is a Space, nudge its child an extra few px down so the
    // Space's top border peeks above the child — UNLESS the child is itself a Space
    // (skipTopPeek), which instead overlaps this border. Applied regardless of the
    // spine check: an ancestor Space is always in rectangle mode (hexagon is
    // leaf-only). The accumulating `top` carries the shift to all deeper descendants.
    if (kind === "space" && !skipTopPeek) top += SPACE_CHILD_TOP_PEEK
  })
  return { top, left, width: region.w - left - right, height: region.h - top - bottom }
}

/** A rectangle in viewport coordinates — the box a window morphs from / to. */
export type Rect = { top: number; left: number; width: number; height: number }

export const SQRT3 = Math.sqrt(3)

/**
 * Morph progress (measured from the LEAF end, 0..1) at which the hexagon apex SPLITS
 * into the wide octagon's flat edge. Below it the Space is a 120° HEXAGON that simply
 * GROWS and TRAVELS with the frame as a single merged apex; only above it do the
 * top/bottom points split apart.
 *
 * The PRE-SPLIT leg (q below this) always ends with the merged apex pinned to the top
 * edge — so the apex "reaches the top" exactly at the split boundary regardless of where
 * that boundary sits. That means this threshold does NOT need to be near 1 to satisfy
 * "the apex only splits once it has reached the top"; the geometry guarantees it.
 *
 * It is deliberately kept AWAY from the driver's slow ease-out tail. The `driver.p`
 * (zeroLand) reaches ~0.9 around the time-midpoint and then CRAWLS through 0.9→1.0 over
 * the whole back half of the morph. With the threshold at 0.9 the entire hexagon→octagon
 * SPLIT was crammed into that crawling tail, so the shape reached the pointy hexagon and
 * then appeared to HOLD / ease-out for a long beat before finally blooming. Dropping it
 * to 0.5 puts the split squarely in the driver's FAST middle: the apex rises and the
 * point carves over the first half, then the bloom into the octagon flows immediately
 * and continuously through the back half (the driver's natural ease-out becomes the
 * octagon's soft landing, not a pre-bloom pause).
 */
export const SPACE_SPLIT_AT = 0.5

/** A Space frame's shape role, used to choose the morph path between two states. */
export type SpaceKind = "leaf" | "ancestor" | "row" | "card"

/** Aspect ratio (height ÷ width) of a REGULAR pointy-top hexagon: width = √3·s,
 *  height = 2·s ⇒ height/width = 2/√3 ≈ 1.1547. */
const HEX_H_OVER_W = 2 / SQRT3

/**
 * Eight points of a do-list ROW source clip. Visually a plain full rectangle, BUT its
 * DOUBLED vertices sit at the MIDDLE of the top & bottom edges — (50,0) and (50,100) —
 * not at the corners. When the row morphs into the hexagon those mid-edge points travel
 * STRAIGHT UP/DOWN into the apexes (no sideways sweep ⇒ no diamond), while the real
 * corners (100,0)/(0,0)/… become the hexagon's four side points. (Contrast
 * SPACE_CLIP_RECT, whose doubled points are at the corners — correct for the ancestor
 * rectangle, which morphs corners → octagon brackets.)
 */
export const ROW_RECT_POINTS: [number, number][] = [
  [50, 0],
  [50, 0],
  [100, 0],
  [100, 100],
  [50, 100],
  [50, 100],
  [0, 100],
  [0, 0],
]
export const ROW_RECT_CLIP = toPolygon(ROW_RECT_POINTS)

/**
 * Eight points of the LARGEST REGULAR (perfect, all-120°) pointy-top hexagon that fits
 * inside a `W × H` frame, CENTERED. Unlike spaceClipPoints — which pins the apex to the
 * frame's top/bottom and the side points to its left/right edges, so the hexagon is
 * forced to fill the box and STRETCHES with the frame's aspect — this keeps the hexagon
 * perfectly regular at ANY frame size (it simply gains top/side margins). The apex is
 * doubled so it shares the 8-point winding with the octagon for point-by-point morphing.
 */
export function regularHexPoints(W: number, H: number): [number, number][] {
  if (W <= 0 || H <= 0) return spaceClipPoints(50, LEAF_HY)
  let hw: number
  let hh: number
  if (H / W >= HEX_H_OVER_W) {
    hw = W // frame tall enough → width-limited: hexagon spans full width
    hh = W * HEX_H_OVER_W
  } else {
    hh = H // frame too wide/short → height-limited: spans full height, narrower & centered
    hw = H / HEX_H_OVER_W
  }
  const ix = (((W - hw) / 2 / W) * 100) // side-point x inset (%)
  const apexY = (((H - hh) / 2 / H) * 100) // apex y inset (%)
  const sideY = apexY + (hh / 4 / H) * 100 // side points sit hh/4 below the hexagon's top
  return [
    [50, apexY],
    [50, apexY],
    [100 - ix, sideY],
    [100 - ix, 100 - sideY],
    [50, 100 - apexY],
    [50, 100 - apexY],
    [ix, 100 - sideY],
    [ix, sideY],
  ]
}

/** Component-wise lerp between two equal-length point lists. */
function lerpPoints(a: [number, number][], b: [number, number][], t: number): [number, number][] {
  return a.map(([ax, ay], i) => [ax + (b[i][0] - ax) * t, ay + (b[i][1] - ay) * t] as [number, number])
}

/** Resting LEAF octagon points (full width, true-120° corners) for a live frame size. */
const octagonPoints = (W: number, H: number): [number, number][] => {
  const { ax, hy } = spaceLeafInsets(W, H)
  return spaceClipPoints(ax, hy)
}

/**
 * The eight clip points for a Space mid-morph, interpolated point-by-point at the LIVE
 * frame size so shapes stay correct as the frame resizes. `q` is "leaf-ness" (1 at the
 * leaf end of the morph). The hexagon WAYPOINT (at SPACE_SPLIT_AT) depends on the source:
 *
 *   • dock CARD ⇄ leaf — a perfect centered REGULAR hexagon. The card is already a
 *     regular hexagon and must STAY regular as it grows (no stretch), so the waypoint is
 *     regularHexPoints and the card→hex leg is an identity.
 *   • do-list ROW ⇄ leaf — a FULL-WIDTH pinned hexagon (spaceClipPoints(50, LEAF_HY)).
 *     The row's left/right corners stay pinned to the frame's side edges and only move
 *     VERTICALLY to y=LEAF_HY; the apex twins (already at the top/bottom mid-edge) stay
 *     put. Result: NO width shrink — the shape spans the full frame the whole time, the
 *     hexagon is shaped purely by the corners sliding up/down.
 *   • ancestor ⇄ leaf — no hexagon: full-box rectangle ⇄ octagon directly.
 *
 * Past the split, the waypoint hexagon morphs to the resting octagon (apex splits, side
 * points rise). Endpoints are exact; transient split frames may deviate from 120°.
 */
export function spaceMorphPoints(
  p: number,
  W: number,
  H: number,
  source: SpaceKind,
  target: SpaceKind,
): [number, number][] {
  // PIN / UNPIN: a DIRECT dock-card ⇄ do-list-row morph. Neither end is a leaf
  // window, so the leaf/octagon waypoint logic below does NOT apply — routing this
  // pair through it sent the shape through a stretched, full-width hexagon (the
  // "stretched diamond"). Instead morph the row's full-box rectangle straight to
  // the card's centered REGULAR hexagon. `regularHexPoints` recomputes from the
  // LIVE frame size every frame, so the hexagon stays perfectly regular (never
  // stretches with the frame's changing aspect) across the whole flight. `p` runs
  // source→target, so anchor the hexagon at whichever end is the card.
  if ((source === "card" && target === "row") || (source === "row" && target === "card")) {
    const hex = regularHexPoints(W, H)
    return source === "card" ? lerpPoints(hex, ROW_RECT_POINTS, p) : lerpPoints(ROW_RECT_POINTS, hex, p)
  }
  const leafTarget = target === "leaf"
  const other = leafTarget ? source : target
  const q = leafTarget ? p : 1 - p
  if (other === "ancestor") {
    // Octagon ⇄ full-box rectangle (corner-based points), no hexagon waypoint.
    return lerpPoints(spaceClipPoints(0, 0), octagonPoints(W, H), q)
  }
  // The hexagon WAYPOINT is a genuinely POINTY, TOP-PINNED hexagon — apex twins merged
  // at the very top/bottom edges (50,0)/(50,100), side points at the frame edges, and
  // SHOULDERS at LEAF_HY (25%), the same shoulder proportion as the dock-glyph hexagons.
  // It is the SAME waypoint for both the card and the row source, which is essential:
  // the pre-split leg must actually CARRY the merged apex up to the top edge so that,
  // by the time the split begins, the apex is already AT the top (honoring "apex only
  // splits once it has reached the top"). An earlier version used the dock's own centered
  // regular hexagon AS the card waypoint, which made the card's pre-split leg a no-op
  // (regularHex → regularHex): the card sat as a static regular hexagon for the whole
  // pre-split and only transformed during the split — which read as a long ease-out HOLD
  // before it became an octagon. Using the top-pinned waypoint makes the apex rise and
  // the point carve continuously across the pre-split instead.
  const octagon = octagonPoints(W, H)
  const hexWaypoint = spaceClipPoints(50, LEAF_HY)
  if (q >= SPACE_SPLIT_AT) {
    // SPLIT leg: the pointy hexagon blooms into the resting octagon — the merged apex
    // splits apart horizontally and the shoulders rise/flatten from 25% to the octagon's
    // resting height. The apex stays pinned to the top/bottom edge the whole way, so the
    // split only ever happens AT the top, never before.
    const f = (q - SPACE_SPLIT_AT) / (1 - SPACE_SPLIT_AT)
    return lerpPoints(hexWaypoint, octagon, f)
  }
  // PRE-SPLIT leg. The shape morphs from the source toward the top-pinned pointy hexagon,
  // so the merged apex RISES to the top edge and the point carves continuously — there is
  // no static hold. The CARD starts from the dock's centered regular hexagon; the do-list
  // ROW starts from its full rectangle.
  //
  // The eight points are paced on decoupled curves (all still reach 1 exactly at
  // SPACE_SPLIT_AT, so the endpoints are unchanged and the bloom hands off with no dwell).
  // The two sources need OPPOSITE treatment because the shape's "point" is carved by
  // different vertices in each:
  //
  //   • dock CARD (regularHexPoints → top-pinned hexagon): the point already exists; the
  //     side shoulders (2,3,6,7) must WIDEN outward (x: inset → frame edge) and the apex
  //     (0,1,4,5) must RISE (y → top/bottom edge). Here we FRONT-LOAD the apex (rise early)
  //     and HOLD BACK the sides (ease-in) so the hexagon stays narrow/pointy and does not
  //     flatten into a wide slab too soon.
  //
  //   • do-list ROW (full rectangle → top-pinned hexagon): the apex twins do NOT move at
  //     all (already at the top/bottom mid-edge); the point is carved ENTIRELY by the side
  //     corners (2,3,6,7) sliding their Y inward. So for the row those corners must be
  //     FRONT-LOADED — otherwise the rectangle just GROWS as a rectangle for many frames
  //     before abruptly becoming a hexagon. Front-loading them makes the rectangle morph
  //     into a hexagon right away, with almost no rectangle phase.
  //
  // The shape is a pure function of q, so each curve also serves the close direction.
  const isCard = other === "card"
  const src = isCard ? regularHexPoints(W, H) : ROW_RECT_POINTS
  const fLin = q / SPACE_SPLIT_AT
  const easeOut = 1 - Math.pow(1 - fLin, 7) // front-loaded: fast/far early
  const easeIn = Math.pow(fLin, 3) // held back: moves late
  const fApex = easeOut
  const fSides = isCard ? easeIn : easeOut
  const APEX = new Set([0, 1, 4, 5])
  return src.map(([sx, sy], i) => {
    const [wx, wy] = hexWaypoint[i]
    const t = APEX.has(i) ? fApex : fSides
    return [sx + (wx - sx) * t, sy + (wy - sy) * t] as [number, number]
  })
}

/**
 * Resting LEAF insets. The leaf Space is now a POINTY-TOP HEXAGON (octagon dropped):
 * a single top/bottom apex (ax=50) with shoulders at LEAF_HY. Its CENTRAL RECTANGLE
 * (between the shoulders) is what covers the parent's View; the top/bottom wedges
 * extend BEYOND the box and are hidden (behind the header at depth 1, cropped at the
 * parent frame top deeper). This is the SAME shape as the morph's `hexWaypoint`
 * (spaceClipPoints(50, LEAF_HY)), so the row/card→leaf morph no longer has to split
 * the apex into an octagon — the leaf endpoint IS the hexagon. `width`/`height` are
 * unused now (kept for call-site compatibility and a possible future stretch knob).
 */
export function spaceLeafInsets(_width: number, _height: number): { ax: number; hy: number } {
  return { ax: 50, hy: LEAF_HY }
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
