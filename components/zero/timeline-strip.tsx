"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion, animate, AnimatePresence } from "motion/react"
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  Ban,
  RotateCcw,
  Eye,
} from "lucide-react"
import {
  getInheritedAccent,
  isInSubtree,
  getEntity,
  entities,
  directChildOfFocus,
  type TimelineOccurrence,
  deleteEntity,
  setEventCancelled,
  materializeOccurrence,
} from "@/lib/zero/data"
import {
  queryTimeline,
  clusterInstants,
  applySemanticRollup,
  entityInterval,
  RECUR_FADE_TAIL,
  type StreamSeries,
  type RollupBand,
} from "@/lib/zero/timeline-index"
import {
  makeScale,
  timelineTicks,
  lodGrain,
  scrubLabel,
  clampSpan,
  VIEW_SPAN_MS,
  MIN_SPAN_MS,
  MAX_SPAN_MS,
} from "@/lib/zero/timeline-scale"
import type { Entity } from "@/lib/zero/types"
import { panelTransition, layerTransition } from "@/lib/zero/motion"
import { TIMELINE_TOP_PAD } from "@/lib/zero/layout"
import { useZeroNav } from "@/lib/zero/nav-store"
import { placementKey, resolveOriginRect } from "@/lib/zero/placement"
import { useTimelineGestures } from "@/hooks/use-timeline-gestures"
import { NodeGlyph, type NodeKind } from "./node-glyph"
import { ContextMenu, type ContextMenuState } from "./context-menu"
import { cn } from "@/lib/utils"

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// ZOOM-DRIVEN VIEW SWITCH. The Lifelane (linear) morphs into the Atlas (this-week
// grid) when zoomed OUT past a threshold span. That threshold is DYNAMIC — it scales
// with the viewport WIDTH so a wide screen (which has room to show more days
// comfortably as a linear strip) only flips to the grid once the days get genuinely
// cramped. We express "comfortable" as a MINIMUM legible day width in px: keep the
// linear strip until a single day would shrink below ATLAS_PX_PER_DAY, i.e.
// thresholdDays = clamp(width / ATLAS_PX_PER_DAY, MIN, MAX). Below ~28px/day, daily
// occurrences visually merge and a chip can't host even a tiny label — that's the
// point where the linear lane stops carrying meaning, so that's when we fold.
// This is deliberately tuned to stay expanded as LONG as possible and to scale with
// the viewport: e.g. ~1280px → ~46d, ~1700px → ~61d, ~2560px (ultrawide) → capped 90d,
// narrow ~800px → ~29d. (Previously 560px/day + a 6-day cap folded everything after
// only ~3 days regardless of how wide the screen was — far too eager.)
// Open and close share the threshold (minus a tiny epsilon for anti-flicker) so the
// switch is symmetric. See `atlasOpenMs`/`atlasCloseMs` (computed from width below).
const ATLAS_PX_PER_DAY = 28
const ATLAS_MIN_DAYS = 10
const ATLAS_MAX_DAYS = 90
const ATLAS_CLOSE_EPSILON_MS = 0.04 * DAY_MS
// SMOOTH PRE-FOLD CONDENSE. Instead of lanes snapping from full size straight to thin
// rails at the fold threshold, they CONDENSE continuously over the last stretch of
// zoom-out before the fold: lane heights, gaps and label type all scale down with the
// span, so the eventual collapse is just the final sliver of a motion already underway —
// the fold reads as the LIMIT of a smooth shrink, not a separate jump. This is what makes
// the today→life zoom feel continuous. `condense` is 0 until the span passes
// CONDENSE_ONSET_FRAC of the fold span, then ramps (smoothstep) to 1 AT the fold.
// CONDENSE_MIN_SCALE is how small a lane gets right before folding — close to the rail's
// share of a lane (RAIL_H/LANE_H ≈ 0.29) so the chip→tick morph has little left to travel,
// but not so small that chips become unreadable too early.
  const CONDENSE_ONSET_FRAC = 0.42
  const CONDENSE_MIN_SCALE = 0.48
  // STAGGERED, SCROLL-DRIVEN AUTO-FOLD. Instead of every ribbon folding at one threshold, each
  // ribbon gets its OWN span threshold and folds as you keep scrolling out — starting with the
  // ribbon in the CENTER of the stack and working outward, so the timeline visibly thins from the
  // middle. The OUTERMOST ribbon folds at the full threshold (`atlasOpenMs`, == `zoomCollapsed`),
  // and each more-central ribbon folds `FOLD_STEP_RATIO`× sooner (a smaller span). The ratio is set
  // to ~two wheel notches (one notch ≈ e^(100·ZOOM_K) ≈ 1.25× span; see use-timeline-gestures), so
  // a couple of scroll ticks separate each ribbon's fold. Raising it spreads the cascade wider and
  // starts the first fold sooner; lowering it tightens the cascade toward the single threshold.
  const FOLD_STEP_RATIO = 1.5
// HEADER GROUP geometry. The [date label + NOW backlink] and the timestamp graduation float
// just ABOVE the lane stack (anchored to the band-div top, i.e. the top of the lanes — NOT
// pinned to the band FRAME, which can grow past them). As the band grows and the group is
// pushed up, BOTH rows CLAMP so neither rises above the header bar (HEADER_CLEAR_Y, in card
// coords): the graduation can now rise all the way to the header bar too (overlapping the date
// row, which has a bg chip and stays readable on top). The lanes are NOT clamped — they bleed up
// past the graduation and the label (and behind the header).
const GRAD_ROW_H = 14 // timestamp row height (matches the old h-3.5 ruler)
const GRAD_LANE_GAP = 6 // graduation floats this far above the top lane
const LABEL_ROW_H = 22 // the date+NOW pill row (comfortable)
// Natural gap between the label row and the graduation (in the roomy, unclamped home view).
// NOTE the jump-to-NOW chip hangs BELOW the date pill (absolute top-full), so it eats into this
// gap — at the old 15 the NOW chip ended only ~2px above the graduation, reading cramped. Raised
// so the white [date + NOW] labels float clearly higher, leaving ~13px of air below NOW before the
// graduations. Only affects the natural regime; the compressed/clamped regime still overlaps the
// rows on purpose (the pill's bg chip keeps it readable), and this is a static layout constant so
// it adds no per-frame cost — safe for the upcoming vertical-drag / floating-lean work.
const LABEL_GRAD_GAP = 30
// Smallest card-Y either header row may reach when the strip is pushed up under the header.
// This is what actually BINDS the date+NOW row in the centered home view (its natural top would
// be even higher, so the clamp holds it here). The card's own top edge sits ~19px below the
// header bar, so a small NEGATIVE value lets the date rise INTO that gap and sit closer to the
// header (it still clears the bar — verified ~7px gap remains). The date pill's bg chip keeps it
// readable where it overlaps the graduation in the fully-clamped (short viewport) case.
const HEADER_CLEAR_Y = -12
// --- Float layer tuning (vertical drag + lean-toward-cursor) ---------------
// How far the strip may be dragged from its home position: a little UP (header is close above)
// and more DOWN (open space below). Clamped so it can never be lost off-screen.
const DRAG_Y_MIN = -80
const DRAG_Y_MAX = 340
// Max lean displacement (px) toward the cursor — a very subtle "alive/eager" drift. Kept small so
// the effect reads as elegant ambient motion rather than an obvious follow. HORIZONTAL ONLY.
const MAX_LEAN = 5
// The lean now reacts to the cursor ANYWHERE on screen (no proximity gating), so the pull is
// normalized over half the viewport width: the strip leans gently toward whichever side the cursor
// is on, reaching full MAX_LEAN only near the screen edges.
// Per-frame ease factors (0..1) for the float loop. Y is snappy (drag feels direct). The lean is
// asymmetric: a soft ease-IN toward the cursor and an even softer, longer ease-OUT back to rest, so
// settling feels especially gentle. Lower = softer/longer.
const Y_EASE = 0.4
const LEAN_EASE_IN = 0.05
const LEAN_EASE_OUT = 0.022
// PERF: a recurring series carries up to MAX_RECUR_OCCURRENCES (366) timestamps. When the whole
// series packs into view (fully zoomed out / collapsed) that's hundreds of absolutely-positioned
// 1px divs re-positioned every frame — the dominant cost of the zoomed-out render (~21fps). Since
// 1px segments packed tighter than a couple px are visually indistinguishable from a denser set,
// we paint at most this many and uniformly downsample beyond it (always keeping the fade tail).
const RECUR_RENDER_MAX = 130
// Uniformly thin an already-visible list of occurrence indices down to at most `max`, while
// ALWAYS keeping the final RECUR_FADE_TAIL entries so the fade-out tail still lands on the true
// last points. Visible-culling happens BEFORE this, so a zoomed-IN window (few occurrences on
// screen) renders every one; only a zoomed-OUT window dense enough to exceed the cap is thinned.
function downsampleKeepingTail(indices: number[], max: number): number[] {
  if (indices.length <= max) return indices
  const tail = Math.min(RECUR_FADE_TAIL, indices.length)
  const body = max - tail
  const bodyEnd = indices.length - tail
  const step = bodyEnd / body
  const out: number[] = []
  for (let j = 0; j < body; j++) out.push(indices[Math.floor(j * step)])
  for (let k = tail; k >= 1; k--) out.push(indices[indices.length - k])
  return out
}
// Duration of the ribbon (un)collapse morph. Longer (was 300) so the vertical-height
// transform + the mother-title rotation read as a deliberate, smooth unfold rather than
// a quick snap. The morphing elements (chip wrapper, mother column, band height) drive
// their transitions off this exact value so they all land together; the fold-animation
// window (per-mother `animatingMothers`, or `autoFoldDir` for a zoom fold) then clears,
// unmounting the hidden layer.
const COLLAPSE_MS = 620
// UN-COLLAPSE (expand) is intentionally treated DIFFERENTLY from collapse. Collapse uses
// the snappy `easeOut` above (fast start, gentle settle) which reads well shrinking into
// a rail. Expansion with that same curve felt "too hard early" — easeOut front-loads the
// motion so the ribbon LURCHED open. So expand is 50% longer and uses a soft ease-IN-out
// curve (low initial velocity → it builds up gently, then eases to rest). Direction is
// known per element (`!collapsedTarget` / `!blk.collapsed`), so each morph picks its
// duration/ease via `morphTween`. CSS twins (`EXPAND_EASE_CSS`) mirror the same curve.
const EXPAND_MS = Math.round(COLLAPSE_MS * 1.5)
// The pushed stack + band + do-list reflow runs a touch longer than the ribbon morph so
// the glide reads slow/smooth after its prompt start.
const REFLOW_MS = Math.round(COLLAPSE_MS * 1.75)
// Two expand curves, by ROLE:
//  • EXPAND_EASE — soft ease-IN-out (low initial velocity). Used ONLY for the FOLDING
//    ribbon's own "fall" (its chips/column), where a gentle build-up reads well: the
//    ribbon shouldn't lurch open.
//  • REFLOW_EASE — prompt ease-OUT (high initial velocity, long gentle tail). Used for the
//    BAND height + the whole pushed stack + (via the band → ResizeObserver) the do-list.
//    A slow-start curve here made the do-list look like it only began moving AFTER the
//    timeline (the lag the user flagged): the band barely moved for the first ~150ms. An
//    ease-out moves immediately, so the do-list starts a hair after the timeline and still
//    eases slowly to rest. Collapse already used "ease-out" everywhere (also prompt).
const EXPAND_EASE: [number, number, number, number] = [0.45, 0, 0.25, 1]
const EXPAND_EASE_CSS = "cubic-bezier(0.45, 0, 0.25, 1)"
// BACK-LOADED ease-in (easeInQuad-ish): stays low through the first part of the fold then ramps up,
// but begins inking in around the MIDDLE rather than only at the very end. Used for the collapse fill
// of the morphing chip (the sole visible actor during a fold) so it reads faint early and solid as it
// lands on its tick (user: "mostly at the end, but not so late"). NOT used for geometry.
const FILL_IN_EASE_CSS = "cubic-bezier(0.5, 0, 0.7, 0.35)"
// PURE LONG EASE-OUT, NO EASE-IN (user: do-list "should have no ease-in just a long
// ease-out"). The previous ease-out-cubic had p1x=0.215 — a slight ease-IN lip that delayed
// the very start, so the do-list still read as moving "too late". This curve has p1x=0 (no
// horizontal hold → it moves on frame 1) with a high initial velocity (p1y=0.7) that decays
// smoothly to rest over the long REFLOW_MS — i.e. fastest at the start, gently slowing,
// never accelerating. Used for the band height + pushed stack + (via the band) the do-list.
const REFLOW_EASE: [number, number, number, number] = [0, 0.7, 0.2, 1]
const REFLOW_EASE_CSS = "cubic-bezier(0, 0.7, 0.2, 1)"
// DO-LIST GLIDE (band height only). The do-list rides the BAND's height transition (it
// reserves the band's measured bottom), so the band height alone governs how the do-list
// slides. The user wanted that slide to "last longer with a generous ease-out" WITHOUT
// changing the loved ribbon collapse/uncollapse — so the band gets its OWN longer duration
// + deeper ease-out, decoupled from the sibling REFLOW and the folding ribbon's fall.
// Used in BOTH directions (collapse + expand). The curve keeps p1x=0 (no ease-in lip → the
// do-list still starts on frame 1, per the earlier fix) but with a very high initial
// velocity (p1y=0.85) and a long, gentle decel tail so it settles slowly and softly. It
// reaches ~95% well before EXPAND_MS, so a just-expanded bottom ribbon isn't left poking
// under the do-list while the band finishes its lazy tail.
  // MAIN TIMELINE FRAME glide (band height → strip height → nav-arrow height, and the do-list
  // rides its measured bottom). Was ×3.6 (≈2.2s) — an elegant soft settle originally tuned for
  // the do-list, but it left the FRAME trailing the ribbons (which settle in `reflowMs`, ~0.6–
  // 1.1s) by >1s, reading as laggy/unreactive. Shortened to ×2.4 (≈1.5s): still clearly the
  // longest, lingering glide in the stack (keeps the elegant tail) but reaches the user's eye
  // much sooner after the ribbons land.
  const DOLIST_MS = Math.round(COLLAPSE_MS * 2.4)
  // Now MODERATELY front-loaded (was even-velocity p1≈(0.4,0.4), slope ~1). Initial slope here
  // is 0.72/0.22 ≈ 3.3, so the frame covers most of its travel in the first ~40% of the duration
  // — a reactive "responds to your click" feel — then decays into a long, gentle soft landing
  // (the elegant part). p1x>0 stays small so there's still no perceptible ease-in lip. This is
  // the sweet spot between the old constant crawl and a hard front-loaded dump (which, at the
  // OLD 2.2s length, felt like it "finished instantly then crawled"); at 1.5s it reads lively.
  const DOLIST_EASE_CSS = "cubic-bezier(0.22, 0.72, 0.25, 1)"
// Framer transition for a morphing element. `animating` = mid (un)collapse; `expanding` =
// the un-collapse direction. `soft` picks the slow-start fall curve (folding ribbon) vs the
// prompt reflow curve (pushed siblings). Outside a morph it's the 300ms repack glide.
function morphTween(animating: boolean, expanding: boolean, soft = true) {
  if (!animating) return { duration: 0.3, ease: "easeOut" as const }
  return expanding
    ? { duration: (soft ? EXPAND_MS : REFLOW_MS) / 1000, ease: soft ? EXPAND_EASE : REFLOW_EASE }
    : { duration: COLLAPSE_MS / 1000, ease: "easeOut" as const }
}
// Approx height (px) of the collapsed-rail tick tooltip — used to decide whether it
// fits above the rail or must flip below to avoid the ruler cropping it.
const TOOLTIP_H = 16

// Fallback color for items whose space chain has no accent (created directly
// under the root "Space 0"). A neutral light grey so they still read as real
// markers without claiming a brand color.
const NEUTRAL_MARKER = "oklch(0.72 0.004 75)"

/** Local midnight of `epoch`'s day, epoch ms. */
function startOfDay(epoch: number): number {
  const d = new Date(epoch)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// --- Track layout -----------------------------------------------------------
const TRACK_H = 56 // base (resting) track height — one centered lane
// The label/ruler band rendered ABOVE the track (h-10 = 40px + mb-1 = 4px). The
// linear track grows to `viewHeightPx − this` so the whole Timeline band (label +
// track) fills the zoom-driven target height.
const LIFELANE_LABEL_BAND_H = 44
const LANE_H = 24
const LANE_GAP = 4
// Below this on-screen width (px) a span chip can no longer show a useful label
// (≈3 chars + dot + padding), so it COLLAPSES into a compact "marker": a smooth
// horizontal line the length of the span, a vertical color edge on its left, and
// the title floated above-left (free to overflow past the tiny span, like a pin).
 const CHIP_COLLAPSE_PX = 46
// Master switch for the "minimal chip" collapse. Disabled for now: since chip titles
// bleed past their frame, narrow chips stay fully labeled rather than collapsing to a
// line+title marker. Flip back to `true` to re-enable the marker behavior below.
const CHIP_COLLAPSE_ENABLED = false
// Vertical breathing room above+below the stacked lanes when the track grows.
const TRACK_PAD_Y = 6
// Hard ceiling on how many lanes can grow the track, so a truly pathological pile-up
// can't push the entire focus region off-screen. Beyond this, extra lanes overflow
// (clipped) rather than growing further. Sized to comfortably fit the FULL set of
// top-level life ribbons (each space ribbon can span several lanes during overlaps),
// so a populated homeview shows every ribbon — the timeline grows and pushes region 0
// down rather than cropping a ribbon (e.g. Health/Workout) at the bottom.
const MAX_STACK_LANES = 18

// --- Mother ribbons (folding) ----------------------------------------------
// A "mother ribbon" groups every lane sharing the same TOP-LEVEL ancestor (the
// child of root) — e.g. mother "Zero" gathers the pink lanes Zero / Product /
// Deck / Research. Collapsing a mother hides its lanes, leaving a thin RAIL the
// user can click to reopen; the lanes' chips "fall" onto the still-visible lanes
// as faint minimal markers. Entering a space auto-collapses the OTHER mothers.
  const RAIL_H = 7 // height of a collapsed mother's reopen rail
  const HIDDEN_H = 1 // height of a fully-hidden mother's lane (a 1px sliver between neighbours)
const MOTHER_GAP = 6 // vertical gap between mother blocks (rails or lane stacks)
const MOTHER_COL_W = 20 // width of the left column holding an EXPANDED mother's vertical title

/** A contiguous block of lanes sharing one top-level ancestor. `motherId === null`
 *  means the lanes live directly at root (no mother ribbon — left ungrouped). */
interface MotherBlock {
  motherId: string | null
  title: string
  color: string
  baseLane: number // first global lane of the block
  laneCount: number // total lanes across all member ribbons
  spaceIds: string[] // member ribbon space ids, in stack order
}

// Horizontal chrome flanking the scrolling viewport, in px. The viewport is the
// shared coordinate space for gridlines, the now-marker and every marker. Any
// OVERLAY that must line up with it has to use these exact insets.
const ARROW_W = 40
// The left view-indicator column was removed (unused), so the selector inset is now 0;
// the viewport's left edge is flush against the pan arrow and all overlay insets follow.
const SELECTOR_W = 0
const VIEWPORT_INSET_LEFT = SELECTOR_W + ARROW_W
const VIEWPORT_INSET_RIGHT = ARROW_W

// Instant-pin geometry (px), measured from the TRACK's top edge (negative =
// ABOVE the track). A pin is a down-triangle HEAD with its title to the LEFT and
// a thin vertical STEM to the track bottom. Heads sit above the ruler.
const INSTANT_TRI = 10
const INSTANT_HEAD_CLEARANCE = 22
const INSTANT_ROW_STEP = 16
const INSTANT_STEM_GAP = 1
const INSTANT_CHAR_W = 5.6
const INSTANT_LABEL_PAD = 26

// Pixel proximity under which instants merge into one density bubble (coarse zoom).
const CLUSTER_GAP_PX = 22

// A unified horizontal "bar" on the track — events, scheduled spaces, rolled-up
// context bands, and recurring series all lane-pack together as bars. A "recur"
// bar reserves its ribbon row like any other, but paints as a row of individual
// occurrence DOTS (see `times`) rather than a chip/band.
interface Bar {
  key: string
  from: number
  to: number
  color: string
  title: string
  kind: "event" | "space" | "band" | "recur"
  entity?: Entity
  count?: number
  cancelled?: boolean
  childId?: string
  /** recur only: materialised occurrence timestamps (capped), oldest→newest. */
  times?: number[]
  /** recur only: more occurrences exist past the last point → fade the tail. */
  truncated?: boolean
}

/** Greedy interval lane-packing within ONE group — items sorted by start, each
 *  placed in the first sub-lane whose previous item's VISUAL footprint has ended;
 *  else a new sub-lane opens. `rightEdge(b)` is the bar's effective right edge in
 *  ms (extended past `to` when its label bleeds beyond the span), so time-adjacent
 *  items whose labels would overlap get separate sub-lanes. Returns the per-key
 *  sub-lane and how many sub-lanes the group needed. */
function packGroup(bars: Bar[], rightEdge: (b: Bar) => number): { subLane: Map<string, number>; count: number } {
  const sorted = [...bars].sort((a, b) => a.from - b.from)
  const laneEnds: number[] = []
  const subLane = new Map<string, number>()
  for (const b of sorted) {
    let idx = laneEnds.findIndex((end) => end <= b.from)
    if (idx === -1) {
      idx = laneEnds.length
      laneEnds.push(rightEdge(b))
    } else {
      laneEnds[idx] = rightEdge(b)
    }
    subLane.set(b.key, idx)
  }
  return { subLane, count: Math.max(1, laneEnds.length) }
}

export interface Ribbon {
  spaceId: string
  title: string
  color: string
  baseLane: number // first global lane this ribbon occupies
  laneCount: number // how many sub-lanes it spans
}

/** Lexicographic compare of two numeric "tree path" keys (shorter-prefix first). */
function compareKey(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

/** SPACE-GROUPED ribbon packing (the time.graphics "folder" model). Bars are
 *  grouped by their containing space; each group becomes a horizontal RIBBON that
 *  occupies a contiguous block of global lanes. Within a ribbon, overlapping items
 *  still stack into sub-lanes (via `packGroup`). Ribbons are ordered by the SPACE
 *  TREE (depth-first, via `orderKey`) so a parent space and all its descendant
 *  spaces stay contiguous in the stack — e.g. Zero, then Product and Deck right
 *  below it — rather than scattering by earliest event time. */
function packRibbons(
  bars: Bar[],
  rightEdge: (b: Bar) => number,
  groupOf: (b: Bar) => string,
  spaceMeta: (spaceId: string) => { title: string; color: string },
  orderKey: (spaceId: string) => number[],
): { lane: Map<string, number>; count: number; ribbons: Ribbon[] } {
  // Bucket bars by their containing space.
  const groups = new Map<string, Bar[]>()
  for (const b of bars) {
    const g = groupOf(b)
    const entry = groups.get(g)
    if (entry) entry.push(b)
    else groups.set(g, [b])
  }
  // Order ribbons by their space's depth-first position in the tree.
  const ordered = [...groups.keys()].sort((a, b) => compareKey(orderKey(a), orderKey(b)))

  const lane = new Map<string, number>()
  const ribbons: Ribbon[] = []
  let baseLane = 0
  for (const spaceId of ordered) {
    const groupBars = groups.get(spaceId)!
    const { subLane, count } = packGroup(groupBars, rightEdge)
    for (const b of groupBars) lane.set(b.key, baseLane + (subLane.get(b.key) ?? 0))
    const meta = spaceMeta(spaceId)
    ribbons.push({ spaceId, title: meta.title, color: meta.color, baseLane, laneCount: count })
    baseLane += count
  }
  return { lane, count: Math.max(1, baseLane), ribbons }
}

export function TimelineStrip({
  contextId,
  accent,
  centerZoneH = 0,
  overlayTopPx = 0,
}: {
  contextId: string
  accent?: string
  // Region-1 ZONE height in px (the fixed "first third" the strip is vertically centered
  // within). When > 0, WorkSurface flex-centers this strip inside a `centerZoneH`-tall
  // overlay; we use the same value to compute the band's true card-Y for the Atlas morph
  // (the only consumer of `laneBandTopY`) so chip flight origins stay aligned with the
  // centered band. 0 = legacy top-anchored behaviour (e.g. when a focus window is open).
  centerZoneH?: number
  // Card-Y of the overlay's top edge (0 at home, the window header bottom otherwise) —
  // the reference point the centered band's card-Y is measured from.
  overlayTopPx?: number
}) {
  const { stack, dataVersion, notifyDataChanged, open } = useZeroNav()
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  const openFromChip = (id: string) => {
    const key = placementKey("timeline", contextId, id)
    open(id, resolveOriginRect(id, { placement: key, preferSource: "timeline" }) ?? undefined)
  }

  // Open a timeline bar, MATERIALIZING the occurrence first if it's an untouched day
  // of a recurring series (D1). A bar's `key` is its occKey: `${seriesId}@${dayStart}`
  // for a recurrence, or just the entity id for a one-off. An UNTOUCHED occurrence still
  // points `entity` at the mother (whose schedule carries `repeat`); touching it creates
  // a real override and we open THAT (its own id) so edits/completion affect this day
  // alone. An already-materialized day has `entity` = the override (no `repeat`), so it
  // falls through to the plain open. One-offs (key === entity.id) are unchanged.
  const openOccurrence = (b: { key: string; entity?: Entity }) => {
    const e = b.entity
    if (!e) return
    const isUntouchedOccurrence = b.key !== e.id && !!e.schedule?.repeat
    if (isUntouchedOccurrence) {
      // Key is `${seriesId}@${dayStart}` or, for a multi-block span, `…@${dayStart}#${i}`.
      // Take the segment after '@' and strip any '#blockIndex' suffix.
      const dayStart = Number(b.key.slice(b.key.lastIndexOf("@") + 1).split("#")[0])
      if (Number.isFinite(dayStart)) {
        const override = materializeOccurrence(e.id, dayStart)
        if (override) {
          notifyDataChanged()
          openFromChip(override.id)
          return
        }
      }
    }
    openFromChip(e.id)
  }

  const stage: number = Math.min(stack.length - 1, 2)

  // Right-click any marker: cancel/restore or delete.
  const openMenu = (e: React.MouseEvent, entity: Entity) => {
    e.preventDefault()
    e.stopPropagation()
    const isCancelled = !!entity.cancelled
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: isCancelled ? "Restore" : "Cancel",
          icon: isCancelled ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />,
          onSelect: () => {
            setEventCancelled(entity.id, !isCancelled)
            notifyDataChanged()
          },
        },
        {
          label: "Delete",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          onSelect: () => {
            deleteEntity(entity.id)
            notifyDataChanged()
          },
        },
      ],
    })
  }

  // --- Continuous lifeline viewport ----------------------------------------
  // The viewport is fully described by `{ startMs, spanMs }`: epoch ms at the left
  // edge, and how much time is visible. Zoom = change spanMs; pan = change startMs.
  // Default: a Day-preset window framing this morning.
  const [vp, setVp] = useState(() => ({
    startMs: startOfDay(Date.now()) + 6 * HOUR_MS,
    spanMs: VIEW_SPAN_MS.D,
  }))
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const animRef = useRef<ReturnType<typeof animate> | null>(null)

  // --- Float layer (vertical drag-to-reposition + lean-toward-cursor) -------
  // Both effects are expressed as ONE imperative `transform: translate3d(leanX, yOffset+leanY, 0)`
  // written to `floatRef` (the strip <section>) by a single self-stopping rAF loop. This lives
  // entirely in refs — NO React state — so it never re-renders the component and never touches the
  // tuned morph animations (keeps the "identical, just smoother" guarantee). A compositor transform
  // on one layer is GPU-cheap.
  const floatRef = useRef<HTMLElement | null>(null)
  const yTargetRef = useRef(0) // committed vertical offset (persists after release, "stay where dropped")
  const yRenderRef = useRef(0)
  const leanXTargetRef = useRef(0) // horizontal-only lean toward the cursor
  const leanXRenderRef = useRef(0)
  const floatRafRef = useRef<number | null>(null)
  const ensureFloatRef = useRef<() => void>(() => {})
  const draggingRef = useRef(false) // any active gesture — suppresses lean so a drag/zoom stays clean
  // True while a band fold/collapse is animating. Like `draggingRef`, it suppresses the
  // cursor-lean: the band's height + ribbon morph is settling, and a lean re-reading the
  // cursor and nudging the strip horizontally in those last frames shows up as a shake at
  // the very end of the collapse. We freeze the lean (homing it to 0) for the duration so
  // the settle is clean; pointer-moves re-engage it once the fold finishes.
  const foldingRef = useRef(false)

  // The entire strip is positioned from wall-clock time (`startMs`, `now`), which the
  // server can't know, so SSR markup can never match the first client paint. Rather
  // than fight per-element hydration mismatches, we render a same-height placeholder
  // until mounted, then reveal the real (time-accurate) timeline. This is a one-frame
  // deferral, invisible in practice, and keeps hydration clean.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Viewport pixel width, tracked so the d3 scale, ticks and clustering reason in
  // real pixels. Defaults to a sane guess until first measure (one frame).
  const [width, setWidth] = useState(800)
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth || 800)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
    // Re-run after `mounted` flips so the observer attaches to the REAL viewport
    // element (the pre-hydration placeholder also carries `viewportRef`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted])

  // WIDTH-DRIVEN Atlas threshold (see tuning constants above). Wider viewport ⇒ more
  // days fit comfortably as a linear strip ⇒ higher span before it flips to the grid.
  const { atlasOpenMs, atlasCloseMs } = useMemo(() => {
    const days = Math.max(ATLAS_MIN_DAYS, Math.min(ATLAS_MAX_DAYS, width / ATLAS_PX_PER_DAY))
    const open = days * DAY_MS
    return { atlasOpenMs: open, atlasCloseMs: open - ATLAS_CLOSE_EPSILON_MS }
  }, [width])

  // Live "now", refreshed each ~30s so the now-marker creeps along the lifeline.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const [hoveredInstant, setHoveredInstant] = useState<string | null>(null)

  // The Lifelane (this linear horizontal track) is the ONLY timeline view at every zoom
  // level. Zooming OUT past the width-driven threshold COLLAPSES every ribbon down to its
  // thin rail (`zoomCollapsed`) rather than switching to a separate grid view.
  // Zoom-driven "collapse all ribbons" flag. Hysteresis (open/close epsilon) keeps it
  // from flickering when a gesture parks right on the boundary. When it flips, the
  // auto-fold effect below folds EVERY ribbon through the SAME per-block mechanism a
  // manual click uses (it batch-flips `override`), instead of a separate global crossfade.
  const [zoomCollapsed, setZoomCollapsed] = useState(false)
  // Identity used in `override`/animation maps for the ungrouped ROOT lane, which has no
  // motherId but must fold along with the real ribbons on a zoom auto-fold.
  const ROOT_KEY = "__root__"
  // AUTO (zoom) FOLD reuses the manual mechanism per ribbon, but is now SCROLL-DRIVEN: each ribbon
  // folds/unfolds as the span crosses its own threshold (see `foldOrder` + the crossing effect),
  // center-of-stack first, so the timeline thins out progressively as you scroll. `autoFoldDir`
  // marks that SOME ribbon (un)folded this gesture and which way — it IS the "a zoom fold is
  // animating" window (covers the rootlane crossfade, which has no per-mother window). It's pulsed
  // open for one morph (DOLIST_MS) whenever a threshold is crossed.
  const [autoFoldDir, setAutoFoldDir] = useState<"collapse" | "expand" | null>(null)
  const autoFoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Last span the scroll-driven fold effect reconciled against, so it only acts on ribbons whose
  // threshold was actually CROSSED this gesture (leaving manual per-ribbon (un)folds untouched in
  // between crossings).
  const prevSpanFold = useRef(0)
  // True while an auto (zoom) fold is mid-morph: BOTH layers stay mounted and crossfade,
  // exactly as during a manual per-mother window. (Kept under this name since many call
  // sites read it; now derived from `autoFoldDir` rather than a lagging display flag.)
  const collapseAnimating = autoFoldDir !== null

  // --- Mother-ribbon folding state -----------------------------------------
  // `override` pins a mother's collapsed state to the user's explicit choice; it
  // is CLEARED whenever the focus context changes so each navigation re-derives
  // the auto-collapse (entering a space folds the others). `hiddenMothers` tracks
  // mothers the user has fully HIDDEN via the eye toggle: their lane disappears to a
  // 1px sliver (not even the thin rail with highlights), keeping only the title chip
  // with its reopen controls. A hidden mother is also implicitly collapsed.
  // `hoveredMother` brightens a collapsed mother's rail ticks while its rail is hovered.
  const [override, setOverride] = useState<Record<string, boolean>>({})
  const [hiddenMothers, setHiddenMothers] = useState<Record<string, boolean>>({})
  const [hoveredMother, setHoveredMother] = useState<string | null>(null)
  // The mother whose TITLE chip is currently hovered. The eye (hide) control only ever shows
  // on title hover — NOT on plain rail hover (which still brightens the rail ticks via
  // `hoveredMother`). Tracked separately so hovering the rail body doesn't reveal the eye.
  const [hoveredTitleId, setHoveredTitleId] = useState<string | null>(null)
  // MANUAL-FOLD animation window. A click toggle flips a mother's `override`
  // instantly, so (unlike a zoom collapse, which is driven by `displayCollapsed`
  // lagging `zoomCollapsed`) there's no global window to ride. We open a PER-MOTHER
  // window here: the mother's id stays in `animatingMothers` for COLLAPSE_MS, during
  // which its block is treated as animating (expanded + collapsed layers both mounted,
  // bars morph into ticks, column rotates) — making a manual collapse animate exactly
  // like a zoom one.
  const [animatingMothers, setAnimatingMothers] = useState<Record<string, number>>({})
  const animTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // The collapsed rail tick currently hovered → drives a small floating tooltip that
  // shows the entity's KIND GLYPH + title (the native `title` can't render the glyph).
  // One shared tooltip (keyed by bar) instead of a NodeGlyph per tick, so a rail with
  // many events stays cheap. Cleared on leave only if it's still this bar (so sliding
  // from one tick to the next doesn't blank between them).
  const [hoveredTick, setHoveredTick] = useState<
    { key: string; leftPct: number; top: number; title: string; kind: NodeKind; color: string } | null
  >(null)
  useEffect(() => {
    // Switching context re-derives folds for the NEW context's ribbons. Seed each ribbon's
    // collapsed state from its OWN scroll threshold at the current span (so already-folded
    // ribbons don't pop open for a frame, and not-yet-folded ones stay expanded), and resync
    // the crossing tracker so the next wheel move compares against this baseline.
    setOverride(() => {
      const next: Record<string, boolean> = {}
      for (const f of foldOrder) next[f.key] = spanMs >= f.thresholdMs
      return next
    })
    prevSpanFold.current = spanMs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId])

  const { startMs, spanMs } = vp

  // Cross the "collapse everything" threshold with hysteresis: once collapsed, stay
  // collapsed until the span shrinks back below the (slightly lower) close threshold,
  // and vice-versa — so a gesture parked on the boundary can't flicker the whole stack.
  // setState happens at the TOP LEVEL with an early bail when the value already matches
  // (so re-running after we set it is a no-op — no render loop).
  useEffect(() => {
    const next = zoomCollapsed ? spanMs > atlasCloseMs : spanMs >= atlasOpenMs
    if (next === zoomCollapsed) return
    setZoomCollapsed(next)
  }, [spanMs, zoomCollapsed, atlasOpenMs, atlasCloseMs])

  // CONTINUOUS PRE-FOLD CONDENSE (see CONDENSE_* constants). As the span approaches the fold
  // threshold the whole stack shrinks so the collapse is the tail end of a smooth compression
  // rather than a snap. `condense` 0→1; the visual compression is applied as a single GPU
  // `scaleY` (see `condenseScale` below + the render), NOT by mutating the lane geometry.
  const condenseOnsetMs = atlasOpenMs * CONDENSE_ONSET_FRAC
  const condenseRaw = Math.min(1, Math.max(0, (spanMs - condenseOnsetMs) / Math.max(1, atlasOpenMs - condenseOnsetMs)))
  const condenseSmooth = condenseRaw * condenseRaw * (3 - 2 * condenseRaw) // smoothstep — gentle onset
  // SMOOTH SCALE PHASE. Previously laneH/laneGap = LANE_* × laneScale, so the condense ramp
  // shrank the LIVE lane geometry → the `layout` memo (and every chip's top/height) recomputed
  // each step and the whole stack re-laid-out frame-by-frame (the "steppy" feel). Now the
  // layout is computed at RESTING geometry (laneH/laneGap are the un-condensed constants) so
  // positions are STABLE — zero relayout during the zoom — and the visual compression toward
  // the fold is a single GPU `scaleY(condenseScale)` on the lane layer + a matching shrink of
  // the band height (see render). Continuous (un-quantised): a transform is cheap every frame,
  // unlike a relayout, so we no longer need the CONDENSE_STEPS quantisation.
  const condense = condenseSmooth
  const condensing = condense > 0.001
  // Vertical compression factor: 1 at rest → CONDENSE_MIN_SCALE near the fold. Forced to 1
  // once FOLDED (rails are already tiny; scaling them again would double-shrink) — the rail
  // crossfade masks the boundary jump.
  const condenseScale = zoomCollapsed ? 1 : 1 - (1 - CONDENSE_MIN_SCALE) * condense
  // EXPERIMENT — UNIFORM x+y SCALE. When true the condense phase scales the plane uniformly in
  // BOTH axes (the timeline shrinks toward its center like zooming a photo out — no vertical
  // aspect distortion of chips/text) instead of vertical-only. Trade-off: the horizontal axis
  // is TIME and the viewport is the time-window, so a horizontal shrink pulls the gridlines +
  // chips IN from the left/right edges (empty track at the sides) and the fixed graduation
  // labels above no longer sit over their gridlines. Flip to false to revert to vertical-only
  // (chips stay time-accurate edge-to-edge but are vertically squished). Same single GPU
  // transform either way, so perf is unchanged.
  //
  // VERDICT (measured): tried `true`, screenshotted mid-ramp (scaleX≈0.70) — the ribbons/chips
  // pinch into the center leaving empty track at the right edge, and the fixed graduation labels
  // up top no longer sit over their (now pinched) gridlines. The horizontal shrink fights the
  // time-window semantics, so it reads as broken, not as a clean zoom-out. Kept OFF (vertical-
  // only). Leaving the wiring here as a documented one-line toggle in case we revisit with a
  // different model (e.g. also scaling the graduation + accepting/styling the side margins).
  const UNIFORM_SCALE = false
  const condenseScaleX = UNIFORM_SCALE ? condenseScale : 1
  const laneH = LANE_H
  const laneGap = LANE_GAP
  // `restTopDur` drives the live scaleX compression tween (see `entityScaleTween`): that genuinely
  // changes every wheel frame while condensing, so it must go INSTANT (0) to track the zoom and
  // only glide (0.3s) at rest.
  const restTopDur = condensing ? 0 : 0.3
  // LANE-REPACK top glide. The lane LAYOUT is computed at RESTING geometry (laneH/laneGap are the
  // un-condensed constants; the condense ramp toward the fold is a single GPU `scaleY` on the lane
  // layer, NOT a per-frame mutation of each chip's `top`). So a chip's `top` only ever changes on a
  // DISCRETE lane repack — which should ALWAYS glide, including while zoomed out near the fold.
  // Previously the chip `top` reused `restTopDur`, which is 0 while condensing; that made any repack
  // happening in the condense zone SNAP. Sparse entities (e.g. Product Review / Design sync) crowd
  // at NORMAL zoom (restTopDur=0.3 → glide), but a dense daily recurrence like Workout only splits
  // to a 2nd lane once zoomed far enough to be condensing — so its split lost the animation. A fixed
  // 0.3s here gives every lane repack the same glide regardless of zoom level or whether the entity
  // repeats. (The condense compression still rides its own separate scaleY, so there's no lag.)
  const topRepackDur = 0.3

  // NOTE: the per-ENTITY uniform-scale derivations (`entityScaleX` etc.) live further down, just
  // after `condenseScaleVisual` is defined — they read the JS-SMOOTHED fold-out scale so chips
  // don't snap horizontally when a zoom auto-fold triggers (see that block for the full rationale).

  const center = startMs + spanMs / 2
  const grain = useMemo(() => lodGrain(spanMs, width), [spanMs, width])

  // Epoch ms → percentage across the viewport (linear; equivalent to the d3
  // scale but width-independent, so markers reflow without a width read).
  const pct = (epoch: number) => ((epoch - startMs) / spanMs) * 100
  // d3 time scale (px) — used for tick generation and pixel clustering.
  const scale = useMemo(() => makeScale(startMs, spanMs, width), [startMs, spanMs, width])

  // --- Gestures: cursor-anchored wheel zoom + drag/scroll pan --------------
  const { onPointerDown, draggedRef } = useTimelineGestures({
    viewportRef,
    view: vp,
    onChange: (next) => {
      animRef.current?.stop()
      setVp(next)
    },
    minSpan: MIN_SPAN_MS,
    // Full zoom-OUT range (up to MAX_SPAN_MS, ~a lifetime). Zooming out past the collapse
    // threshold keeps widening the time window — it just collapses every ribbon to a rail
    // (see `zoomCollapsed`) instead of switching views.
    maxSpan: MAX_SPAN_MS,
    // Re-bind the wheel listener once the real viewport replaces the placeholder.
    enabled: mounted,
    active: true,
    onGestureStart: (kind) => {
      animRef.current?.stop()
      // Only a DRAG suppresses the cursor-lean: its pointer motion already drives the vertical
      // offset, so an active lean would double-count and fight the drag. A WHEEL ZOOM leaves the
      // lean alive — the pointer barely moves during a zoom, and suppressing it caused the lean to
      // freeze through the whole ease tail and then snap back abruptly when the spring finally
      // settled (the seam the user noticed).
      if (kind === "drag") {
        draggingRef.current = true
        leanXTargetRef.current = 0
        ensureFloatRef.current()
        // Clear any tick/lane/instant highlight the cursor happened to be on when the pan
        // began. As the strip translates under a stationary-ish cursor, the browser fires
        // mouseenter on whatever slides beneath it, making ticks/lanes flicker-highlight
        // along the drag path. We clear here and the enter-handlers below no-op while
        // `draggingRef` is set, so the strip stays visually calm through the whole pan.
        setHoveredMother(null)
        setHoveredTick(null)
        setHoveredInstant(null)
      }
    },
    onGestureEnd: (kind) => {
      if (kind === "drag") draggingRef.current = false
    },
    // Vertical drag-to-reposition (soft-axis attenuated in the hook). Accumulate the effective
    // delta into the persistent offset, clamp to bounds, and pump the float loop.
    verticalDrag: true,
    onVerticalDrag: (dy) => {
      yTargetRef.current = Math.max(DRAG_Y_MIN, Math.min(DRAG_Y_MAX, yTargetRef.current + dy))
      ensureFloatRef.current()
    },
  })

  // --- Float loop: drives the strip's transform from yOffset + lean ---------
  // One self-stopping rAF eases the rendered transform toward its targets and writes a single
  // compositor `translate3d` to the section. It idles (cancels) once settled and no gesture is
  // active, and re-arms on the next drag/pointer-move — so it costs nothing at rest.
  useEffect(() => {
    if (!mounted) return
    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

    const frame = () => {
      const yT = yTargetRef.current
      // Lean is HORIZONTAL ONLY (no vertical lean) and disabled under reduced-motion. Ease IN when
      // moving away from rest (target magnitude growing) and ease OUT — slower — when returning home,
      // so the settle is especially soft.
      const lxT = reduceMotion ? 0 : leanXTargetRef.current
      const leanEase = Math.abs(lxT) >= Math.abs(leanXRenderRef.current) ? LEAN_EASE_IN : LEAN_EASE_OUT
      const y = yRenderRef.current + (yT - yRenderRef.current) * Y_EASE
      const lx = leanXRenderRef.current + (lxT - leanXRenderRef.current) * leanEase
      yRenderRef.current = y
      leanXRenderRef.current = lx
      const el = floatRef.current
      const settled = Math.abs(yT - y) < 0.08 && Math.abs(lxT - lx) < 0.08
      if (settled && !draggingRef.current) {
        // Snap exactly to target and stop the loop (no perpetual rAF).
        yRenderRef.current = yT
        leanXRenderRef.current = lxT
        if (el) el.style.transform = `translate3d(${lxT.toFixed(2)}px, ${yT.toFixed(2)}px, 0)`
        floatRafRef.current = null
        return
      }
      if (el) el.style.transform = `translate3d(${lx.toFixed(2)}px, ${y.toFixed(2)}px, 0)`
      floatRafRef.current = requestAnimationFrame(frame)
    }
    const ensure = () => {
      if (floatRafRef.current == null) floatRafRef.current = requestAnimationFrame(frame)
    }
    ensureFloatRef.current = ensure

    // LEAN: the strip leans HORIZONTALLY toward the cursor's X position, reacting to the pointer
    // ANYWHERE on screen (no proximity gating). Normalized over half the viewport width and measured
    // from the strip's own horizontal center, so it pulls left/right by how far the cursor sits to
    // that side, hitting full MAX_LEAN near the screen edges. Suppressed while dragging/zooming.
    // Updates refs only (no React state) and pumps the loop.
    const onPointerMove = (e: PointerEvent) => {
      if (reduceMotion) return
      if (draggingRef.current) return // gesture owns motion; lean targets are held at 0
      if (foldingRef.current) return // a fold is settling; freeze lean so it can't shake the end
      const vp = viewportRef.current
      if (!vp) return
      const r = vp.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return
      const cx = r.left + r.width / 2
      const half = (window.innerWidth || r.width) / 2 || 1
      const nx = (e.clientX - cx) / half
      leanXTargetRef.current = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, nx * MAX_LEAN))
      ensure()
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true })
    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      if (floatRafRef.current != null) {
        cancelAnimationFrame(floatRafRef.current)
        floatRafRef.current = null
      }
    }
  }, [mounted])

  // --- Data query (bounded, LOD-aware) -------------------------------------
  // Range = viewport ± 25% padding, rounded so we only re-run the heavy
  // query → rollup → bar-build → lane-pack pipeline when the rounded window (or grain /
  // data / focus) changes — NOT on every gesture frame. queryTimeline never walks huge
  // ranges (recurrences become streams at coarse zoom), so this stays cheap from a day
  // to a whole life.
  //
  // PERF — quantize against ZOOM, not just pan. The bucket used to be `spanMs/6`, which
  // ramps continuously WITH the span, so during a wheel-zoom `qStart`/`qEnd` shifted
  // almost every frame and this whole pipeline recomputed ~60×/s — the scroll lag (it
  // was only ever quantized for PAN, where the span is fixed). Fix: snap the query SPAN
  // itself to a geometric ladder, so a continuous zoom only re-queries when it crosses a
  // ladder step (~a handful of times across a full zoom, vs per-frame). The live pixel
  // projection (`scale`/`pct`) still updates every frame, so motion stays perfectly smooth
  // — only the DATA set is recomputed in discrete steps.
  const pad = spanMs * 0.25
  // Ladder ratio ~1.19 (2^¼): the quantized window is at most ~19% larger than the raw
  // viewport+pad, so the resting set barely differs from the old window, yet a zoom spanning
  // orders of magnitude crosses only ~4 steps/decade instead of recomputing every frame.
  const QUERY_LADDER = 1.1892
  const qNeed = spanMs + 2 * pad // window must always cover the viewport + pad
  // Round the span UP to the next ladder step → guarantees qSpan ≥ qNeed (no on-screen clip).
  const qSpan = Math.pow(QUERY_LADDER, Math.ceil(Math.log(qNeed) / Math.log(QUERY_LADDER)))
  // Snap the window edges to a coarse grid (qSpan/6) centered on the view, so panning within
  // a step doesn't re-query either. Centering on `center` keeps the quantized window symmetric
  // around what's on screen.
  const bucket = Math.max(60_000, qSpan / 6)
  const qCenter = startMs + spanMs / 2
  const qStart = Math.floor((qCenter - qSpan / 2) / bucket) * bucket
  const qEnd = Math.ceil((qCenter + qSpan / 2) / bucket) * bucket
  // We always query the WHOLE tree (the root context), not just the focused
  // entity's subtree, so opening an entity never makes the rest of the lifeline
  // disappear — unrelated markers stay on the timeline, just dimmed (see
  // `relatedFactor`). `contextId` remains the FOCUS used for semantic rollup and
  // for deciding what counts as "related".
  const rootId = stack[0]
  const query = useMemo(
    () => queryTimeline(rootId, qStart, qEnd, grain),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rootId, grain, qStart, qEnd, dataVersion],
  )

  // Relatedness → opacity. When the focus IS the root (home view) everything is
  // related, so nothing dims. Once inside an entity, anything whose container
  // space falls outside the focus subtree fades back to a faint ambient layer.
  const atRootFocus = contextId === rootId
  const UNRELATED_OPACITY = 0.3
  const relatedFactor = (parentId?: string | null, id?: string | null): number => {
    if (atRootFocus) return 1
    const container = parentId ?? "s_root"
    const related = isInSubtree(contextId, container) || (id != null && isInSubtree(contextId, id))
    return related ? 1 : UNRELATED_OPACITY
  }

  // Adaptive semantic rollup: crowded child subtrees collapse into context bands.
  const rolled = useMemo(
    () => applySemanticRollup(query.items, contextId, width),
    [query, contextId, width],
  )

  const instants = useMemo(() => rolled.items.filter((e) => e.kind === "instant"), [rolled])
  const spans = useMemo(
    () => rolled.items.filter((e) => e.kind === "event" || e.kind === "space"),
    [rolled],
  )

  // Instants merged into density bubbles by pixel proximity. Singleton clusters
  // render as normal pins; multi-clusters as count bubbles that expand on zoom-in.
  const clusters = useMemo(
    () => clusterInstants(instants, scale, CLUSTER_GAP_PX),
    [instants, scale],
  )

  // All horizontal bars (spans + rollup bands + recurring streams) in one set.
  const bars = useMemo<Bar[]>(() => {
    const out: Bar[] = []
    for (const e of spans) {
      const color = getInheritedAccent(e.parentId ?? "s_root") ?? NEUTRAL_MARKER
      const kind = e.kind === "space" ? "space" : "event"
      const blocks = e.schedule?.blocks
      if (blocks && blocks.length > 1) {
        // MULTI-BLOCK DAY (D4): one occurrence with N within-day spans (e.g. Day Job
        // 8–11:30 AND 13:30–18:00) emits N bars keyed `${occKey}#${i}`. They all share
        // the SAME `entity`/occKey, so hover, relatedness, open and complete still act
        // on the single occurrence — only the drawn geometry differs per span.
        blocks.forEach((blk, i) => {
          out.push({
            key: `${e.occKey}#${i}`,
            from: blk.startAt,
            to: blk.endAt,
            color,
            title: e.title,
            kind,
            entity: e,
            cancelled: e.cancelled,
          })
        })
        continue
      }
      const [from, to] = entityInterval(e)
      out.push({
        key: e.occKey,
        from,
        to,
        color,
        title: e.title,
        kind,
        entity: e,
        cancelled: e.cancelled,
      })
    }
    for (const b of rolled.bands as RollupBand[]) {
      out.push({
        key: `band:${b.childId}`,
        from: b.from,
        to: b.to,
        color: b.color,
        title: b.title,
        kind: "band",
        count: b.count,
        childId: b.childId,
      })
    }
    for (const s of query.streams as StreamSeries[]) {
      out.push({
        key: `recur:${s.entity.id}`,
        from: s.from,
        to: s.to,
        color: s.color,
        title: s.entity.title,
        kind: "recur",
        entity: s.entity,
        count: Math.round(s.approxCount),
        times: s.times,
        truncated: s.truncated,
      })
    }
    return out
  }, [spans, rolled, query])

  // Footprint right-edge (ms) for lane-packing. Whenever a bar's TITLE is wider than
  // its span on screen, the label bleeds past the span's right edge (item 3 / the
  // collapsed marker) — so we reserve that label width in the packer. Adjacent items
  // whose labels would collide therefore stack into separate sub-lanes rather than
  // overlapping. `msPerPx` converts px label estimates into the ms axis.
  const msPerPx = spanMs / Math.max(1, width)
  const barRightEdge = useMemo(() => {
    return (b: Bar) => {
      const labelPx = b.title.length * 5.6 + 14
      return b.from + Math.max(b.to - b.from, labelPx * msPerPx)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msPerPx])

  // Space-grouped ribbon packing: each bar's containing space becomes a horizontal
  // ribbon; items stack into sub-lanes within their ribbon when they overlap.
  const groupOf = (b: Bar) => b.entity?.parentId ?? (b.kind === "band" ? contextId : rootId)
  const spaceMeta = (spaceId: string) => ({
    title: getEntity(spaceId)?.title ?? "Timeline",
    color: getInheritedAccent(spaceId) ?? NEUTRAL_MARKER,
  })
  // Declaration-order index of every entity, used as the per-level tiebreak so the
  // tree ordering follows how spaces are authored (siblings in declared order).
  const declIndex = useMemo(() => {
    const m = new Map<string, number>()
    entities.forEach((e, i) => m.set(e.id, i))
    return m
  }, [])
  // Tree-path key for a space: the chain of declaration indices from root down to
  // the space. Sorting ribbons by this (lexicographically) yields a depth-first
  // pre-order, keeping a parent space and its descendants contiguous.
  const orderKey = (spaceId: string): number[] => {
    const path: number[] = []
    let id: string | null | undefined = spaceId
    let guard = 0
    while (id && guard++ < 32) {
      path.push(declIndex.get(id) ?? 0)
      id = getEntity(id)?.parentId
    }
    return path.reverse()
  }
  const lanes = useMemo(
    () => packRibbons(bars, barRightEdge, groupOf, spaceMeta, orderKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bars, barRightEdge, contextId, rootId, declIndex],
  )
  // Show ribbon labels/backgrounds only when there's more than one space in view —
  // a single group keeps the clean centered lifeline with no extra chrome.
  const showRibbons = lanes.ribbons.length > 1

  // --- Mother ribbons: group the per-space ribbons by top-level ancestor -----
  // `lanes.ribbons` is already depth-first ordered, so all ribbons sharing a
  // top-level ancestor are CONTIGUOUS — we can fold consecutive runs into one
  // MotherBlock. `directChildOfFocus(spaceId, "s_root")` returns that ancestor
  // (itself if the space is already a child of root; null if it lives at root).
  const mothers = useMemo<MotherBlock[]>(() => {
    const out: MotherBlock[] = []
    for (const r of lanes.ribbons) {
      const motherId = directChildOfFocus(r.spaceId, "s_root") ?? null
      const last = out[out.length - 1]
      if (last && motherId !== null && last.motherId === motherId) {
        last.laneCount += r.laneCount
        last.spaceIds.push(r.spaceId)
      } else {
        const mEntity = motherId ? getEntity(motherId) : undefined
        out.push({
          motherId,
          title: mEntity?.title ?? r.title,
          color: (motherId ? getInheritedAccent(motherId) : null) ?? r.color,
          baseLane: r.baseLane,
          laneCount: r.laneCount,
          spaceIds: [r.spaceId],
        })
      }
    }
    return out
  }, [lanes.ribbons])

  // SCROLL-DRIVEN FOLD SCHEDULE. Give each ribbon (and the ungrouped root lane) its own span
  // threshold so they auto-fold one at a time as the view zooms out — CENTER of the stack first,
  // then outward. `mothers` is the stable top→bottom stack order (the root lane is the entry with
  // `motherId == null`), and it does NOT depend on fold state, so these thresholds stay fixed while
  // ribbons collapse (using the live `layout` would make the centers shift mid-cascade). k=0 is the
  // most-central ribbon (folds first/soonest); the outermost folds exactly at `atlasOpenMs` (the
  // `zoomCollapsed` point), each inner ribbon `FOLD_STEP_RATIO`× sooner.
  const foldOrder = useMemo(() => {
    const keys = mothers.map((m) => m.motherId ?? ROOT_KEY)
    const n = keys.length
    if (n === 0) return [] as { key: string; thresholdMs: number }[]
    const mid = (n - 1) / 2
    // Order indices by distance from the stack center (ties keep top-first via index tiebreak).
    const byCenter = keys
      .map((key, i) => ({ key, dist: Math.abs(i - mid), i }))
      .sort((a, b) => a.dist - b.dist || a.i - b.i)
    return byCenter.map((o, k) => ({
      key: o.key,
      thresholdMs: atlasOpenMs / Math.pow(FOLD_STEP_RATIO, n - 1 - k),
    }))
  }, [mothers, atlasOpenMs])

  // Collapse-aware vertical layout. Walk the mother blocks top→bottom, giving each
  // a y-offset: a collapsed mother occupies just RAIL_H; an expanded one lays out
  // its lanes at LANE_H each. `laneToY` maps every VISIBLE global lane to its y;
  // collapsed lanes are absent (their bars render as ticks on the rail instead).
  const layout = useMemo(() => {
    const blocks: {
      m: MotherBlock
      top: number
      height: number
      collapsed: boolean
      byUser: boolean
      hidden: boolean
    }[] = []
    const laneToY = new Map<number, number>()
    let y = 0
    for (const m of mothers) {
      // A mother collapses to its rail when EITHER the view is zoomed out past the
      // width-driven threshold (`zoomCollapsed` — folds EVERY ribbon, grouped or not),
      // OR the user has explicitly folded just this one (an entry in `override`).
      // `byUser` records the manual case: it collapses INSTANTLY (no zoom crossfade)
      // and its rail stays put even while a zoom (un)collapse animates around it.
      // `byUser` is the (un)fold state from `override`, keyed by motherId OR the ROOT
      // sentinel. A ZOOM auto-fold batch-sets `override` for every key (see the auto-fold
      // effect), so it now collapses through the SAME path as a manual click — and an
      // auto-collapsed mother therefore renders the same interactive title chip as a
      // hand-collapsed one (the label pass keys on `byUser`, not on live `zoomCollapsed`).
      const oKey = m.motherId ?? ROOT_KEY
      const byUser = oKey in override ? override[oKey] : false
      // HIDDEN (eye): the whole lane shrinks to a 1px sliver — no rail, no highlights —
      // sitting between its neighbours, but the title chip stays (rendered separately).
      const hidden = m.motherId != null && !!hiddenMothers[m.motherId]
      const collapsed = byUser || hidden
      if (hidden) {
        // 1px sliver between neighbours; lanes map to it so any crossfading element glides in.
        blocks.push({ m, top: y, height: HIDDEN_H, collapsed: true, byUser: true, hidden: true })
        for (let i = 0; i < m.laneCount; i++) laneToY.set(m.baseLane + i, y)
        y += HIDDEN_H + MOTHER_GAP
      } else if (collapsed) {
        blocks.push({ m, top: y, height: RAIL_H, collapsed: true, byUser, hidden: false })
        // Map every lane of a collapsed block to its RAIL y, so any expanded element
        // kept mounted for the crossfade (ribbon bands/labels) GLIDES down into the
        // rail while it fades, instead of snapping to the top of the track.
        for (let i = 0; i < m.laneCount; i++) laneToY.set(m.baseLane + i, y)
        y += RAIL_H + MOTHER_GAP
      } else {
        const h = m.laneCount * laneH + (m.laneCount - 1) * laneGap
        blocks.push({ m, top: y, height: h, collapsed: false, byUser: false, hidden: false })
        for (let i = 0; i < m.laneCount; i++) laneToY.set(m.baseLane + i, y + i * (laneH + laneGap))
        y += h + MOTHER_GAP
      }
    }
    return { blocks, laneToY, contentH: Math.max(0, y - MOTHER_GAP) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mothers, override, hiddenMothers, laneH, laneGap])

  const contentH = layout.contentH
  // The track GROWS VERTICALLY to fit the visible lanes (capped so a pathological
  // pile-up can't swallow the screen). Collapsing mothers SHRINKS contentH, so the
  // track — and via the live `--region1-reserve` measurement, the focus region
  // below — reflow up automatically. Lanes stay vertically centered.
  const stackedH = Math.min(contentH, MAX_STACK_LANES * LANE_H + (MAX_STACK_LANES - 1) * LANE_GAP)
  // The Lifelane strip is ALWAYS linear (the Atlas is a separate fullscreen overlay,
  // so it never reshapes this region); the track grows to fit its visible lanes.
  const trackH = Math.max(TRACK_H, stackedH + 2 * TRACK_PAD_Y)
  const offsetY = Math.max(TRACK_PAD_Y, (trackH - contentH) / 2)
  // LIFELANE BAND HEIGHT — hugs the CONTENT (`trackH`), nothing more. `trackH` is the
  // height of the visible lanes/rails (`stackedH + pad`, floored at TRACK_H), and the
  // content is vertically centered within it via `offsetY` — so the band wraps tightly
  // around the ribbons and the do-list (which reserves the MEASURED band height in
  // work-surface, not a fixed fraction) sits right beneath. When zoomed out collapses
  // every ribbon to a thin rail, `trackH` shrinks and the band shrinks with it; zooming
  // back in re-expands it. No max-height reservation, no empty space below the ribbons.
  const lifelaneBandH = trackH
  // BAND HEIGHT — drives the do-list below it (pure DOM flow: the section's height is the
  // label band + this band, so whatever this height does, the do-list does too).
  //   • ZOOM fold: `trackH` already ramps frame-by-frame as the zoom span animates, so the
  //     height is applied INSTANTLY — it tracks the zoom perfectly (a tween would LAG it).
  //   �� MANUAL fold (click): `trackH` JUMPS to the target in one step (override flips), so
  //     to make the do-list move TOGETHER with the ribbon — pushed fluidly as the ribbon
  //     expands, instead of snapping after it finished — the band TWEENS its height with
  //     the SAME direction-aware curve/duration as the ribbon morph (`morphTween`). Equal
  //     timing means the band tracks the ribbons' growing extent so the bottom ribbon
  //     (e.g. Health) is never left poking under the do-list (the old clip), AND the
  //     do-list rides the expansion in lockstep.
  // Direction comes from target vs the last SETTLED height (`prevBandH`, updated only when
  // not animating); expanding uses the slower soft EXPAND curve, collapsing the snappier one.
  const bandAnimating = collapseAnimating || Object.keys(animatingMothers).length > 0
  const prevBandH = useRef(lifelaneBandH)
  useEffect(() => {
    if (!bandAnimating) prevBandH.current = lifelaneBandH
  }, [lifelaneBandH, bandAnimating])
  const manualFolding = !collapseAnimating && Object.keys(animatingMothers).length > 0
  // FOLDING = a collapse/uncollapse is in progress, REGARDLESS of trigger: a ZOOM/auto fold
  // (`collapseAnimating`, all ribbons) OR a manual click (`animatingMothers`, one ribbon).
  // The user wants the EXACT SAME effect for both, so the whole reflow keys off this — not
  // off `manualFolding`. (`bandAnimating` is the same predicate; aliased for readability.)
  const folding = bandAnimating
  // Mirror `folding` into the float loop's ref and, on each fold's leading edge, home the
  // cursor-lean to 0 and pump the loop so it eases back to center DURING the collapse —
  // leaving no horizontal offset to reconcile (which read as the end-of-settle shake).
  useEffect(() => {
    foldingRef.current = folding
    if (folding) {
      leanXTargetRef.current = 0
      ensureFloatRef.current()
    }
  }, [folding])
  const bandExpanding = lifelaneBandH > prevBandH.current
  // ZOOM vs MANUAL fold split. A MANUAL click gets the long, lingering do-list settle
  // (DOLIST_MS ≈ 2.2s) — the user clicked once and watches it ease. A ZOOM fold must
  // instead TRACK THE GESTURE: the expanded layout mounts at full size the instant the
  // threshold flips, so the height/positions have to follow immediately or the container
  // spends the whole 2.2s shorter than its own content — clipping the lower ribbons and
  // letting the mother titles (sized to the FINAL height) bleed past the still-short
  // column. So:
  //   • zoomExpanding (uncollapse): apply layout INSTANTLY — the condense ramp already
  //     makes the surrounding zoom continuous, and instant means the band always exactly
  //     contains its content (no clip, no title bleed, no "slow to respond" lag).
  //   • zoomCollapsing (fold out): a short glide (COLLAPSE_MS) so the do-list rises in
  //     step with the rail crossfade instead of creeping for 2.2s after it finished.
  const zoomExpanding = collapseAnimating && bandExpanding
  const zoomCollapsing = collapseAnimating && !bandExpanding
  // LANE-COUNT REFLOW (NOT a fold). When a ribbon gains/loses a sub-lane — e.g. two items that
  // overlapped split into two lanes as you zoom — `contentH` jumps by ~one lane height in a
  // single frame. The chips, ribbon backgrounds and mother columns ALREADY glide their top/
  // height to the new layout (300ms), but the BAND FRAME height was applied instantly: because
  // the strip is flex-centered in its zone, an instant height change shunts the whole frame
  // (and the do-list beneath it) by HALF the delta in one frame — so the chip glided while
  // "the rest" jumped (the artefact the user flagged). We detect a discrete `contentH` change
  // that is NOT a fold and, for a brief window, transition the band height (and the centering
  // layer height, so it stays glued to the frame) on the SAME 300ms ease-out the chips use, so
  // the frame grows in lockstep with its gliding contents. SKIPPED while condensing (the live
  // zoom scale must own the frame height every frame — a tween would lag it) and while folding
  // (the fold already owns a longer height tween).
  // Detected DURING RENDER (not in an effect): the new `contentH` is applied to the band height
  // in THIS commit, so the `transition` must already be present in the SAME commit or the height
  // jumps before an effect can turn the transition on (the bug a first attempt hit). We compare
  // against a ref and, on a non-fold/non-condense change, arm a `reflowUntil` deadline; `reflowing`
  // is derived from the clock so the transition is live the instant the height changes. A trailing
  // timer re-render (below) clears it afterwards so rest/zoom height changes stay instant.
  const RELAYOUT_MS = 300
  const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now()
  const prevContentH = useRef(contentH)
  const reflowUntil = useRef(0)
  const [, bumpReflow] = useState(0)
  if (prevContentH.current !== contentH) {
    prevContentH.current = contentH
    // Arm on ANY non-fold lane change, INCLUDING while condensing. `contentH` is computed at
    // RESTING geometry (laneH/laneGap constants), so it only changes on a DISCRETE lane split/
    // merge — never per zoom frame — so this never spuriously fires mid-zoom. Non-condense
    // reflows glide via the CSS band/center transitions below; condense reflows glide via the
    // JS-smoothed base height (`bandHRender`), since the band frame bakes `condenseScale` into
    // its layout height and a CSS height tween there would lag the per-frame zoom scale.
    if (!folding) reflowUntil.current = nowMs + RELAYOUT_MS
  }
  const reflowing = nowMs < reflowUntil.current
  useEffect(() => {
    if (!reflowing) return
    const t = setTimeout(
      () => bumpReflow((n) => n + 1),
      Math.max(0, reflowUntil.current - (typeof performance !== "undefined" ? performance.now() : Date.now())) + 20,
    )
    return () => clearTimeout(t)
  }, [reflowing])
  // FLUID REFLOW. A fold (auto or manual) shifts the whole stack to a new layout. The folding
  // ribbon(s) + band + do-list morph over the fold window, but every OTHER repositioning
  // element (band backgrounds, ribbon labels, sibling chips/markers/columns) would default to
  // its snappy 300ms rest transition — so the lower stack SETTLED in 300ms while the band kept
  // growing, making the do-list look like it "moved after the timeline finished". So while
  // FOLDING we override EVERY repositioning transition with the SAME duration+curve as the
  // band: the entire timeline reflows as one unit, locked to the do-list push. This used to be
  // gated on `manualFolding`, which left a ZOOM/auto fold snapping the band/do-list while the
  // ribbons animated — the inconsistency the user flagged. `bandExpanding` (stable for the
  // whole window — `prevBandH` is the pre-fold height) sets direction; `reflowMs`/`reflowEase`
  // are the shared values; `reflowTransition(props)` builds the CSS string (undefined at rest →
  // the element keeps its Tailwind `duration-300`).
  const reflowMs = bandExpanding ? REFLOW_MS : COLLAPSE_MS
  // Prompt ease-OUT in both directions so the band (and the do-list tracking it) starts
  // moving immediately rather than crawling for the first ~150ms of a soft ease-in.
  const reflowEase = bandExpanding ? REFLOW_EASE_CSS : "ease-out"
  // zoomExpanding → "none" (instant): the whole stack reaches full layout in one frame so
  // nothing is ever larger than its container. Manual/zoom-collapse → the shared reflow tween.
  const reflowTransition = (props: string) =>
    zoomExpanding
      ? "none"
      : folding
        ? `${props.split(",").map((p) => `${p.trim()} ${reflowMs}ms ${reflowEase}`).join(", ")}`
        : undefined
  // The BAND height (and thus the do-list) gets its OWN longer + more generous ease-out,
  // decoupled from the sibling REFLOW above so the ribbons keep their loved timing while the
  // do-list lingers into a soft settle.
  // NB: an earlier pass set this to `undefined` (instant) on the theory that tweening the
  // layout `height` was the Electron lag. `chrome://gpu` later confirmed GPU compositing is
  // ON and the lag PERSISTED with the tween gone — so the tween was never the cause, and
  // removing it only made manual folds + lane splits JUMP. Restored. The real scroll lag is
  // the per-frame re-render during a wheel-zoom, addressed separately (see the wheel handler).
  const bandTransition =
    condensing && !zoomCollapsed
      ? // LIVE CONDENSE RAMP (zooming out, not yet folded): `condenseScale` is baked into the
        // frame height (`bandHVisual = base × condenseScale`) and changes EVERY frame as the span
        // animates, so the height MUST be instant — a CSS tween here smears each frame's value over
        // its duration, so the frame perpetually lags the zoom and then catches up in a jump when the
        // gesture stops or folds (the "frame/graduation doesn't adjust quick enough, then snaps"
        // artifact). This matches the long-documented intent ("SKIPPED while condensing"); the bug was
        // that the `zoomCollapsing` branch below fired for the WHOLE ramp (collapseAnimating is true
        // throughout) and wrongly won. Lane reflows DURING the ramp still glide via `bandHRender`'s JS
        // smoothing, and the FOLD itself (`zoomCollapsed`) still falls through to the glide branches.
        undefined
      : manualFolding
        ? `height ${DOLIST_MS}ms ${DOLIST_EASE_CSS}` // manual click → long soft settle
        : zoomCollapsing
          ? `height ${COLLAPSE_MS}ms ease-out` // fold settle → quick glide up, no 2.2s linger
          : reflowing && !condensing
            ? `height ${RELAYOUT_MS}ms ease-out` // lane split/merge → glide the frame with its chips
            : undefined // zoomExpanding / rest → instant, so the band always fits its content
  // HEADER ROWS (graduation + [date label/NOW]) transition. They float at NEGATIVE `top` above
  // the lanes and their `top` is recomputed from the INSTANT target geometry (`lifelaneBandH`) on
  // a fold, while the band frame's HEIGHT (and the container-centered band's top edge) glides on
  // `bandTransition`. `bandTransition` only lists the `height` property, so the rows' `top` change
  // was applied INSTANTLY ����� they jumped in frame 1 and the band's recenter then dragged them back
  // (the date/NOW + graduation "jump" the user saw). Mirror the band's exact schedule onto the
  // `top` property so the rows glide in lockstep with the recenter instead of snapping. `undefined`
  // at rest / during live zoom (top tracks the zoom every frame, no transition wanted).
  const headerRowTransition = bandTransition ? bandTransition.replace("height", "top") : undefined
  const bandH = lifelaneBandH
  // VISUAL band height during the condense scale phase. `bandH` is the resting (full) content
  // height; multiplying by `condenseScale` shrinks the FRAME (border, gridlines, NOW marker,
  // day cells — all full-frame `inset-y-0` layers) in lockstep with the lane layer's `scaleY`,
  // so the whole timeline scales toward its center as one unit. =bandH at rest (scale 1) and
  // when folded (scale forced to 1). The fold-out glide is carried by `bandTransition`; during
  // a live zoom the span spring drives `condenseScale` so the height tracks instantly.
  // JS-SMOOTHED BASE HEIGHT — only used while a lane reflow happens DURING condense. At normal
  // zoom a lane split glides via the CSS band/center transitions. But once condensing, the band
  // FRAME bakes `condenseScale` into its layout height (`bandHVisual = base × scale`, a real
  // height that pulls the do-list up), so a CSS height tween there would lag the per-frame zoom
  // scale — that's why the original code skipped the reflow glide while condensing and the split
  // SNAPPED (the artefact the user flagged on dense daily recurrences like Health → Workout).
  // Instead we ease the BASE toward `bandH` over RELAYOUT_MS and keep `condenseScale` an instant
  // multiplier on top — the exact model the chips use (resting top glides, condense scale
  // instant). The centering layer reads the SAME `bandHRender`, so frame + mother ribbons grow in
  // lockstep. `bandH === trackH === lifelaneBandH`, so this is a smoothed track height.
  const [bandHRender, setBandHRender] = useState(bandH)
  const bandHRenderRef = useRef(bandH)
  const bandHFrom = useRef(bandH)
  const bandHAnimRef = useRef<ReturnType<typeof animate> | null>(null)
  useEffect(() => {
    if (bandHFrom.current === bandH) return
    bandHFrom.current = bandH
    bandHAnimRef.current?.stop()
    // Only a reflow that lands while CONDENSING needs JS smoothing; every other case (normal-zoom
    // reflow → CSS, fold → its own CSS tween, rest/zoom → instant) keeps `bandHRender` pinned to
    // `bandH` so it's a ready start point for the next condense glide.
    if (!(reflowing && condensing)) {
      bandHRenderRef.current = bandH
      setBandHRender(bandH)
      return
    }
    bandHAnimRef.current = animate(bandHRenderRef.current, bandH, {
      duration: RELAYOUT_MS / 1000,
      ease: "easeOut",
      onUpdate: (v) => {
        bandHRenderRef.current = v
        setBandHRender(v)
      },
    })
    return () => bandHAnimRef.current?.stop()
  }, [bandH, reflowing, condensing])

  // JS-SMOOTHED FOLD-OUT SCALE. `condenseScale` tracks the wheel live while condensing, then is
  // forced to 1 the instant `zoomCollapsed` flips (the folded rail layout assumes scale 1). That
  // made the lane plane SNAP from its condensed value (~0.48) back to full size in one frame — the
  // "flash to a completely unscaled timeline, then fold from a big ghost" the user reported. The
  // intended glide (`scaleY` eases ~0.48→1 over COLLAPSE_MS in step with the band height) was meant
  // to ride a CSS `transform` transition, but it never fired: during the condense ramp the transform
  // is rewritten every frame with `transition: undefined`, so adding a transition in the SAME commit
  // as the value jump doesn't start a CSS transition. So we drive the glide in JS — like `bandHRender`.
  //
  // The trigger MUST key off `zoomCollapsed` (true in the very render that snaps `condenseScale` to 1),
  // NOT `zoomCollapsing` — the latter is derived from `autoFoldDir`, which a separate effect sets one
  // render LATER, so by then the smoothed value has already been synced to 1 and there's nothing left
  // to glide. So: while EXPANDED/condensing we keep the render value pinned to the live `condenseScale`
  // (its last value ~0.48 is the ready glide start); the frame `zoomCollapsed` flips true we animate
  // that start up to 1; fold-IN snaps back to live (condense is ~0 there anyway).
  const [condenseScaleRender, setCondenseScaleRender] = useState(condenseScale)
  const condenseScaleRenderRef = useRef(condenseScale)
  const condenseFoldedPrev = useRef(zoomCollapsed)
  const condenseScaleAnimRef = useRef<ReturnType<typeof animate> | null>(null)
  useEffect(() => {
    const wasFolded = condenseFoldedPrev.current
    condenseFoldedPrev.current = zoomCollapsed
    if (!zoomCollapsed) {
      // Expanded / live condense zoom: track the wheel instantly and keep the ref synced so its last
      // value is the start point when we next cross into the fold.
      condenseScaleAnimRef.current?.stop()
      condenseScaleRenderRef.current = condenseScale
      setCondenseScaleRender(condenseScale)
      return
    }
    if (!wasFolded) {
      // Just crossed into the fold: GLIDE from the last condensed value up to full scale.
      condenseScaleAnimRef.current?.stop()
      condenseScaleAnimRef.current = animate(condenseScaleRenderRef.current, 1, {
        duration: COLLAPSE_MS / 1000,
        ease: "easeOut",
        onUpdate: (v) => {
          condenseScaleRenderRef.current = v
          setCondenseScaleRender(v)
        },
      })
    }
    return () => condenseScaleAnimRef.current?.stop()
  }, [zoomCollapsed, condenseScale])
  // The value the render actually uses: the JS-smoothed glide whenever FOLDED (so the snap render
  // already reads the ~0.48 start, not 1), the live (instant) `condenseScale` while expanded.
  const condenseScaleVisual = zoomCollapsed ? condenseScaleRender : condenseScale

  // Per-ENTITY uniform scale (relocated here so it can read `condenseScaleVisual`). Keep the lane
  // plane VERTICAL-ONLY (the centering layer's `scaleY` compresses lane positions + ribbon
  // backgrounds) and give each ENTITY (event/space chips, span bars, rollup bands, collapsed markers
  // + their titles/glyphs) its OWN `scaleX` about its center. The parent `scaleY` already shrinks the
  // box HEIGHT; adding `scaleX` of the same factor makes it shrink UNIFORMLY (chip text/glyphs keep
  // their aspect, no vertical squish) while staying pinned to their time-center. Using the SMOOTHED
  // `condenseScaleVisual` means chips glide their width back in step with the plane on a fold-out
  // instead of snapping horizontally. Lanes / ribbon backgrounds / mother titles get NO entity scaleX.
  const ENTITY_UNIFORM_SCALE = true
  const entityScaleX = ENTITY_UNIFORM_SCALE ? condenseScaleVisual : 1
  // CSS form for non-motion entities (rollup band button). Default transform-origin (center) is what
  // we want, so a bare scaleX suffices. `undefined` at rest → no needless compositor layer.
  const entityTransformCss = entityScaleX === 1 ? undefined : `scaleX(${entityScaleX})`
  // Framer transition for the `scaleX` motion value on motion entities: instant while condensing /
  // folding (the JS glide above supplies the smoothness) and a 0.3s glide on a normal lane-repack.
  const entityScaleTween = { duration: restTopDur, ease: "easeOut" as const }

  // Base used for the frame/centering-layer heights: the smoothed value only during a condense
  // reflow, the live `bandH`/`trackH` everywhere else (so CSS owns the non-condense + fold glides).
  const reflowCondensing = reflowing && condensing
  // Multiply by the SMOOTHED scale so the frame height compresses in lockstep with the lane plane
  // during a fold-out (no frame-vs-content desync that would read as a jump).
  const bandHVisual = (reflowCondensing ? bandHRender : bandH) * condenseScaleVisual
  // COLLAPSED-RIBBON SHAPE IMMUNITY. The whole lane plane is squished by `scaleY(condenseScaleVisual)`
  // while zooming out (one cheap GPU transform). That squish distorts everything inside it — including
  // the collapsed-thin rails, their ticks and titles — until the scale settles back to 1. We don't
  // want a collapsed ribbon to look pressed/squished at any stage: it should already be in its final
  // thin shape. So every collapsed-ribbon element gets this center-origin INVERSE scaleY appended to
  // its transform; combined with the plane's scaleY they cancel, leaving the element at TRUE
  // proportions (shape-only immunity — its vertical CENTER still rides the plane, which keeps the
  // animation pure-GPU/no-reflow and therefore smooth). No-op at rest (scale ~1). Expanded ribbons get
  // NO counter, so they keep visibly compressing under the press until they pop into a rail.
  const collapsedDescaleY =
    condenseScaleVisual >= 0.999 ? "" : ` scaleY(${1 / Math.max(condenseScaleVisual, 0.05)})`
  // COLLAPSED-RIBBON POSITION IMMUNITY. Shape immunity alone keeps each rail its true thin height, but
  // their vertical CENTERS still ride the squished plane — so mid-zoom the rails bunch together and
  // their name-tags overlap (they only regain spacing once `condenseScale` snaps back to 1 at the fold).
  // Counter that too: under the plane's `scaleY(s)` about its center, an element at local center `cY`
  // drifts by `(cY − planeCenter)(s − 1)`. A `translateY(d)` on the element is itself scaled by the
  // parent (screen shift = d·s), so `d = (cY − planeCenter)(1 − s)/s` cancels the drift exactly. The
  // RELATIVE spacing this restores between two rails is independent of `planeCenter`, so any reasonable
  // estimate (the plane's own box center) removes the overlap robustly. Still pure GPU transform — no
  // reflow — so it stays smooth. Returns the full transform string (incl. the shape inverse) for a
  // collapsed element, given its local center and an optional prefix (e.g. a label's own translateY).
  const planeH = reflowCondensing ? bandHRender : trackH
  const collapsedXform = (centerY: number, prefix = "") => {
    if (condenseScaleVisual >= 0.999) return prefix.trim() || undefined
    const s = Math.max(condenseScaleVisual, 0.05)
    const d = ((centerY - planeH / 2) * (1 - s)) / s
    return `${prefix} translateY(${d.toFixed(2)}px) scaleY(${(1 / s).toFixed(4)})`.trim()
  }
  // The lane scaleY is now driven in JS (see `condenseScaleVisual`); a CSS `transform` transition
  // would re-tween every JS step and lag, so the centering layer no longer transitions transform.
  const laneScaleTransition = undefined
  // The centering layer's HEIGHT is `trackH`; it must glide on a lane reflow in lockstep with
  // the band frame (above), or — since the layer is `translateY(-50%)`-centered — the frame
  // and layer halves desync mid-tween and the content drifts. Mutually exclusive with
  // `laneScaleTransition` (that only fires during a zoom fold, when `reflowing` is false).
  //
  // MANUAL FOLD — SYMMETRIC EXPAND. When a mother is (un)folded by hand, `trackH` JUMPS to its
  // new value in one step. The layer is `translateY(-50%)`-centered, so its top edge is
  // `frameH/2 − trackH/2`: an INSTANT `trackH` change instantly shifts the whole stack's origin.
  // Blocks BELOW the expanding ribbon also animate their own `top` (big delta) via the sibling
  // `reflowTransition`, so they glided fine — but blocks ABOVE barely change their `top`, so their
  // ONLY motion was this origin shift, which snapped (they jumped to final in frame 1 while the
  // ones below eased down). Giving the layer height the SAME reflow curve/duration the below-
  // blocks use makes the recenter GLIDE, so the stack expands symmetrically about its center —
  // ribbons above rise and ribbons below descend together, exactly as if the vertical title grew
  // from its middle. Skipped while condensing (live zoom owns height every frame) and on
  // zoomExpanding (reflowTransition is "none" there — the expanded layout mounts at full size).
  const centerLayerTransition =
    reflowing && !condensing
      ? `height ${RELAYOUT_MS}ms ease-out`
      : manualFolding
        ? `height ${reflowMs}ms ${reflowEase}`
        : laneScaleTransition
  // Shared horizontal compression for the full-frame time-pinned layers (gridlines, day cells,
  // NOW marker) so they pinch toward center in lockstep with the lanes when UNIFORM_SCALE is on.
  // Each target is a full-width box (origin center 50% → a tick at pct% maps to 50+(pct−50)·s,
  // identical for every layer, so they stay mutually aligned). `undefined` at rest so no needless
  // compositor layer. Glides with the lanes on a zoom fold-out via `laneScaleTransition`.
  const condenseXTransform = condenseScaleX === 1 ? undefined : `scaleX(${condenseScaleX})`
  // Y of a VISIBLE global lane (collapsed lanes return the block's rail y so any
  // stray positioning lands sanely; their bars are handled separately as chips).
  const laneTop = (lane: number) => offsetY + (layout.laneToY.get(lane) ?? 0)
  // Which mother block a global lane belongs to (for routing bars to chips/lanes).
  const blockOfLane = (lane: number) =>
    layout.blocks.find((b) => lane >= b.m.baseLane && lane < b.m.baseLane + b.m.laneCount)
  // Open a mother's manual-fold animation window (see `animatingMothers`): its block is
  // treated as animating for the LONGEST glide (DOLIST_MS) so transitions aren't cut off.
  const animateMother = (id: string) => {
    setAnimatingMothers((m) => ({ ...m, [id]: (m[id] ?? 0) + 1 }))
    if (animTimers.current[id]) clearTimeout(animTimers.current[id])
    animTimers.current[id] = setTimeout(() => {
      setAnimatingMothers((m) => {
        const next = { ...m }
        delete next[id]
        return next
      })
      delete animTimers.current[id]
    }, DOLIST_MS)
  }
  // The three explicit mother states are reached via these actions. EXPANDED: full lanes.
  // COLLAPSED: thin rail with highlight ticks (`override`). HIDDEN: 1px sliver, no rail
  // (`hiddenMothers`, which also implies collapsed). Each opens the fold-animation window so
  // the band/lanes/do-list glide identically to a zoom fold.
  const collapseMother = (id: string) => {
    // Ignore the click that ends a drag-pan (panning often starts over a ribbon).
    if (draggedRef.current) return
    setOverride((o) => ({ ...o, [id]: true }))
    setHiddenMothers((h) => (h[id] ? { ...h, [id]: false } : h))
    animateMother(id)
  }
  const expandMother = (id: string) => {
    if (draggedRef.current) return
    setOverride((o) => ({ ...o, [id]: false }))
    setHiddenMothers((h) => (h[id] ? { ...h, [id]: false } : h))
    animateMother(id)
  }
  // Eye → fully hide the lane (collapsed + no rail). Keeps only the (hover-revealed) title chip.
  // From hidden there's no "show thin" path: clicking the 1px lane uncollapses fully (expandMother).
  const hideMother = (id: string) => {
    setOverride((o) => ({ ...o, [id]: true }))
    setHiddenMothers((h) => ({ ...h, [id]: true }))
    animateMother(id)
  }

  // SCROLL-DRIVEN STAGGERED AUTO-FOLD. As the span changes, fold/unfold each ribbon whose OWN
  // threshold (`foldOrder`) was crossed since the last reconcile — center-of-stack first on the way
  // out, outermost first on the way back in. Acting only on CROSSINGS (not the raw span) means
  // manual per-ribbon (un)folds the user makes between thresholds are left untouched. A monotonic
  // span change can only cross thresholds in ONE direction, so every crossing this tick is the same
  // way; we branch on that:
  //   • COLLAPSE: pulse the global `autoFoldDir` window (the snappy zoom-out glide that already
  //     reads well) — it also crossfades the root lane, which has no per-mother window.
  //   • EXPAND: open each crossed ribbon's OWN per-mother window via `animateMother` (root included,
  //     via ROOT_KEY) and do NOT pulse `autoFoldDir`. Pulsing it would set `collapseAnimating` →
  //     `zoomExpanding`, which forces the whole stack to mount instantly (the "ribbon jumps open"
  //     bug). The per-mother window instead routes through the normal manual-uncollapse morph.
  useEffect(() => {
    const prev = prevSpanFold.current
    if (prev === spanMs) return
    prevSpanFold.current = spanMs
    const crossed: { key: string; folded: boolean }[] = []
    for (const f of foldOrder) {
      const was = prev >= f.thresholdMs
      const now = spanMs >= f.thresholdMs
      if (was !== now) crossed.push({ key: f.key, folded: now })
    }
    if (crossed.length === 0) return
    setOverride((o) => {
      const next: Record<string, boolean> = { ...o }
      for (const c of crossed) next[c.key] = c.folded
      return next
    })
    const collapsing = crossed.some((c) => c.folded)
    if (collapsing) {
      // Mothers also get their own window (drives the per-ribbon morph); the root rides the pulse.
      for (const c of crossed) if (c.key !== ROOT_KEY) animateMother(c.key)
      setAutoFoldDir("collapse")
      if (autoFoldTimer.current) clearTimeout(autoFoldTimer.current)
      autoFoldTimer.current = setTimeout(() => {
        setAutoFoldDir(null)
        autoFoldTimer.current = null
      }, DOLIST_MS)
    } else {
      // EXPAND: per-ribbon window only (ROOT_KEY included — `blkAnimating` now reads it), so the
      // usual uncollapse animation plays instead of an instant `zoomExpanding` snap.
      for (const c of crossed) animateMother(c.key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spanMs, foldOrder])

  // (Un)collapse MORPH gates + opacity targets, per mother block.
  //  • Expanded layer (lanes, bars, ribbon labels, mother column) shows while the block
  //    is open, OR while it is ANIMATING — either a global ZOOM collapse or this mother's
  //    own manual-fold window (`blkAnimating`), so both kinds of toggle morph identically.
  //  • Collapsed layer (rails, ticks, rail labels) shows while the block is a rail, OR
  //    while it is animating (so the outgoing rails can fade out on un-fold).
  // Opacity targets crossfade the two layers; the side that PERSISTS across the toggle
  // eases via its `transition-opacity`, the side that MOUNTS fades via `animate-in`.
  type Blk = (typeof layout.blocks)[number]
  // A block is animating if a global zoom-COLLAPSE pulse is open (`collapseAnimating`) OR its own
  // per-ribbon fold window is open. Keyed by motherId, or ROOT_KEY for the ungrouped root lane — so
  // a scroll-driven EXPAND (which opens a per-ribbon window instead of the global pulse, to avoid
  // the instant `zoomExpanding` snap) still crossfades the root lane like the manual uncollapse.
  const blkAnimating = (blk: Blk) =>
    collapseAnimating || (blk.m.motherId ?? ROOT_KEY) in animatingMothers
  const showExpanded = (blk: Blk) => !blk.collapsed || blkAnimating(blk)
  const showCollapsed = (blk: Blk) => blk.collapsed || blkAnimating(blk)
  const expandedOpacity = (blk: Blk) => (blk.collapsed ? 0 : 1)
  const collapsedOpacity = (blk: Blk) => (blk.collapsed ? 1 : 0)
  // Where a bar sits while its block is collapsed: exactly on the thin rail tick
  // (`railY + 1`, matching the highlight tick below), so on fold an event chip GLIDES
  // down and MORPHS into its rail span instead of just fading at its old lane.
  const barTop = (lane: number) => {
    const blk = blockOfLane(lane)
    return blk?.collapsed ? offsetY + blk.top + 1 : laneTop(lane)
  }

  // Vertical stacking so cluster/pin LEFT-side labels don't collide. Footprint is
  // [x - estLabelWidth, x] in px; greedy interval packing by left edge.
  const clusterLevel = useMemo(() => {
    const items = clusters
      .map((c) => {
        const x = (pct(c.ms) / 100) * width
        const label = c.items.length > 1 ? `${c.items.length}` : c.items[0].title
        const estW = label.length * INSTANT_CHAR_W + INSTANT_LABEL_PAD
        return { key: c.key, left: x - estW, right: x }
      })
      .sort((a, b) => a.left - b.left)
    const levelEnds: number[] = []
    const level = new Map<string, number>()
    for (const it of items) {
      let lvl = levelEnds.findIndex((end) => end + 6 <= it.left)
      if (lvl === -1) {
        lvl = levelEnds.length
        levelEnds.push(it.right)
      } else {
        levelEnds[lvl] = it.right
      }
      level.set(it.key, lvl)
    }
    return level
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters, startMs, spanMs, width])

  // --- Animated view transitions (selector presets, "Now" jump) ------------
  // Animate a 0→1 driver, interpolating spanMs GEOMETRICALLY (so zoom reads evenly
  // across orders of magnitude). For the start we support two modes:
  //   • default: lerp startMs linearly.
  //   • anchored (anchorMs given): hold that instant's SCREEN FRACTION on a linear
  //     path from where it sits now → where it sits at the target. This keeps an
  //     already-visible anchor (e.g. "now") gliding smoothly into place instead of
  //     swinging in from an edge — the same pinning trick the cursor zoom uses, since
  //     a linear start + geometric span otherwise desyncs a fixed timestamp's path.
  const animateTo = (targetStart: number, targetSpan: number, anchorMs?: number) => {
    animRef.current?.stop()
    const s0 = startMs
    const sp0 = spanMs
    const spT = clampSpan(targetSpan)
    const anchored = anchorMs != null
    const f0 = anchored ? (anchorMs - s0) / sp0 : 0
    const fT = anchored ? (anchorMs - targetStart) / spT : 0
    animRef.current = animate(0, 1, {
      duration: 0.55,
      // Soft landing, NO overshoot: preset/now transitions decelerate smoothly into
      // place — a clean easeOut quint so the view eases to rest without any bounce-back.
      // (The wheel zoom is likewise bounce-free now — critically damped, see ZETA.)
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (t) => {
        const span = sp0 * Math.pow(spT / sp0, t)
        const start = anchored ? anchorMs - (f0 + (fT - f0) * t) * span : s0 + (targetStart - s0) * t
        setVp({ startMs: start, spanMs: span })
      },
    })
  }

  // Step one viewport-width earlier / later (chevit arrows).
  const panBy = (dir: -1 | 1) => animateTo(startMs + dir * spanMs * 0.9, spanMs)

  // "Now": frame today at Day zoom, centered on the current moment. Anchored on `now`
  // so when it's already on screen it glides smoothly to center instead of flying in.
  const goNow = () => animateTo(now - VIEW_SPAN_MS.D / 2, VIEW_SPAN_MS.D, now)

  const nowVisible = pct(now) >= 0 && pct(now) <= 100
  // The jump-to-now control is shown UNLESS we're already on the canonical home view:
  // the default Day-scale window with "now" still on screen. We deliberately do NOT
  // hide it merely because "now" falls inside a wide span — at week/month/…/life zoom
  // now is almost always within view, yet the user still wants a one-click way back to
  // today. So the hide condition is narrow: span ≈ the Day preset AND now visible.
  // (Any coarser zoom, or panning today off-screen at Day zoom, reveals the control.)
  const atDayScale = Math.abs(spanMs - VIEW_SPAN_MS.D) / VIEW_SPAN_MS.D < 0.02
  const atHome = atDayScale && nowVisible
  const centerLabel = useMemo(() => scrubLabel(center, grain), [center, grain])
  // Hide the displayed date when it equals the current date (same bucket at the active grain) —
  // there's no value in announcing "today" while you're parked on it. Compared via the same
  // `scrubLabel` the pill renders, so it stays correct across grains (day/week/month/…).
  const centeredOnNow = centerLabel === scrubLabel(now, grain)
  // Which way does NOW live relative to the current view center? When `now` is before the view
  // center the view is ahead of now, so jumping back points LEFT; otherwise it points RIGHT.
  const nowIsEarlier = now < center

  // --- Ruler ticks (two-tier, adaptive grain) ------------------------------
  const ticks = useMemo(() => timelineTicks(startMs, spanMs, width), [startMs, spanMs, width])

  // --- Day cells (shared-element morph carriers) ---------------------------
  // The visible day boundaries, computed with the SAME arithmetic the Atlas week uses
  // (`startOfDay(now) + k·DAY_MS`) so the ids line up exactly. Each renders a faint
  // horizontal day-slab here whose `layoutId` (`day-<ds>`) matches a vertical day-COLUMN
  // in the Atlas — so on the snap the day spans visibly FLY from horizontal bands into
  // the week's columns. Only drawn near the snap (where the morph reads); at wide zoom
  // the days are too thin to be anything but clutter.
  const dayCells = useMemo(() => {
    const base = startOfDay(now)
    const kStart = Math.floor((startMs - base) / DAY_MS)
    const kEnd = Math.ceil((startMs + spanMs - base) / DAY_MS)
    const out: number[] = []
    for (let k = kStart; k < kEnd; k++) out.push(base + k * DAY_MS)
    return out
  }, [startMs, spanMs, now])
  const showDayCells = spanMs <= atlasOpenMs * 2

  // Card-y of the Lifelane's first lane row = the strip's top edge + the label band
  // that sits above the track. When the strip is vertically CENTERED inside the
  // first-third zone (centerZoneH > 0, the home case), its top edge is no longer a
  // fixed pad: WorkSurface flex-centers a (LIFELANE_LABEL_BAND_H + bandH) tall strip
  // inside a `centerZoneH` overlay, so the top edge sits at `(zone − sectionH) / 2`
  // below the overlay top. We mirror that exact arithmetic here so the Atlas morph —
  // the only consumer of `laneBandTopY` — flies chips from where the band ACTUALLY is.
  // 0 → legacy top-anchored pad (focus-window mode). Day-bands span the full band height.
  const sectionH = LIFELANE_LABEL_BAND_H + lifelaneBandH
  const stripTopY = centerZoneH > 0 ? overlayTopPx + (centerZoneH - sectionH) / 2 : TIMELINE_TOP_PAD
  const laneBandTopY = stripTopY + LIFELANE_LABEL_BAND_H
  // HEADER-GROUP vertical positions, in BAND-DIV coords (band-div top = lane-stack top = 0;
  // both rows sit at NEGATIVE tops, i.e. ABOVE the lanes). Both float above the lane stack but
  // are independently CLAMPED so neither's card-Y rises above HEADER_CLEAR_Y (only at home, where
  // the strip is centered and can be pushed up under the header; `laneBandTopY` is the band-div
  // top in card coords). As the stack rises, the label rests just under the header bar and the
  // graduation rises to the same ceiling (overlapping the label, which stays readable via its bg
  // chip + later paint order); the lanes are unclamped and bleed up past both rows.
  const gradNaturalTop = -(GRAD_LANE_GAP + GRAD_ROW_H)
  const labelNaturalTop = gradNaturalTop - LABEL_GRAD_GAP - LABEL_ROW_H
  const labelGroupTop =
    centerZoneH > 0 ? Math.max(labelNaturalTop, HEADER_CLEAR_Y - laneBandTopY) : labelNaturalTop
  // Graduation clamp. Previously it was kept MIN_LABEL_GRAD_GAP BELOW the (clamped) date label, so
  // it could never rise higher than just under the date+NOW row. New rule (per request): let the
  // graduation rise as high as the bottom of the header top bar — the SAME `HEADER_CLEAR_Y` ceiling
  // the label uses — independent of the label. At full compression the two rows now overlap, which
  // is fine: the date+NOW pill has a `bg-background` chip and paints later in the DOM (equal z-40),
  // so it stays readable on top of the graduation ticks behind it. The date label itself is
  // unchanged — it still only rises to `HEADER_CLEAR_Y`.
  const gradGroupTop =
    centerZoneH > 0 ? Math.max(gradNaturalTop, HEADER_CLEAR_Y - laneBandTopY) : gradNaturalTop
  // Soft horizontal fade applied to the ruler graduations + labels, so ticks melt
  // in/out at the left and right edges while panning instead of popping abruptly.
  const edgeFade =
    "linear-gradient(to right, transparent 0px, #000 32px, #000 calc(100% - 32px), transparent 100%)"

  // Pre-hydration placeholder: reserve the exact layout footprint (label band + track)
  // so revealing the real timeline doesn't shift anything. See `mounted` above.
  if (!mounted) {
    return (
      <section aria-label="Lifelane" className="px-1">
        <div className="relative mb-1 -mx-6 h-12" />
        <div className="relative -mx-6" style={{ height: TRACK_H }} ref={viewportRef} />
      </section>
    )
  }

  return (
      <section
        ref={floatRef}
        aria-label="Lifelane"
        // `transform` is driven imperatively by the float loop (vertical drag + lean). `will-change`
        // keeps it on its own GPU layer so the transform never repaints the subtree. Only `opacity`
        // is CSS-transitioned (see className), so the imperative transform updates are instant.
        style={{ willChange: "transform" }}
        className="px-1"
      >
        {/* Flow SPACER only. The graduation + [date label + NOW] used to live here, pinned
            above the band frame. They now float just above the LANE STACK as overlays inside
            the band div (so they track the lanes, not the frame, and the label can clamp to
            the header). This empty box preserves the flow height the band div sits below —
            keeping `laneBandTopY`, the Atlas morph and the do-list reserve unchanged. */}
      <div className="relative mb-1 -mx-6 h-12" aria-hidden />

      {/* Full-bleed timeline. Arrows flank the track; the zoom selector pins left.
          The track height GROWS WITH ZOOM (`lifelaneBandH`): it rests at the content
          height `trackH` and expands toward the zoom-driven target only as the span
          widens toward the Atlas snap. For a ZOOM the height is applied INSTANTLY (the
          zoom span spring already eases it; a tween would lag behind). For a MANUAL fold
          `bandTransition` tweens the height so the do-list below is pushed FLUIDLY in
          lockstep with the ribbon morph (see `bandH`/`manualFolding`). */}
      <div className="relative -mx-6" style={{ height: bandHVisual, transition: bandTransition }}>
        {/* HEADER GROUP — graduation row + [date label + NOW]. Direct children of the band div
            (NOT inside the centering/scale layer), so they DON'T scale with the lanes and their
            `top` is measured from the band-div top (= lane-stack top in card coords). Both use
            NEGATIVE tops → they float ABOVE the lanes. As the band grows and is pushed up under
            the header, `labelGroupTop`/`gradGroupTop` clamp (see their derivation) so the label
            never rises above the header bar and the label↔graduation gap compresses; the lanes
            themselves are NOT clamped and bleed up past both rows. z-40 so they sit above lanes
            and the NOW marker. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-40"
          style={{
            top: gradGroupTop,
            height: GRAD_ROW_H,
            marginLeft: VIEWPORT_INSET_LEFT,
            marginRight: VIEWPORT_INSET_RIGHT,
            maskImage: edgeFade,
            WebkitMaskImage: edgeFade,
            transition: headerRowTransition,
          }}
        >
          {/* Keyed by `ms` ONLY (not ms+role): as you zoom, the tick GRAIN changes and the set
              of labeled timestamps swaps in batches. Keying by ms keeps surviving ticks MOUNTED
              (they slide via `left`); only genuinely added/removed labels fade — smoothing the
              graduation instead of letting the whole ruler pop. */}
          <AnimatePresence initial={false}>
            {ticks
              .filter((t) => t.labeled && pct(t.ms) >= 0 && pct(t.ms) <= 100)
              .map((t) => (
                <motion.span
                  key={t.ms}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className={cn(
                    "absolute bottom-0 -translate-x-1/2 whitespace-nowrap text-[9.5px] tabular-nums tracking-tight",
                    t.major
                      ? "font-semibold text-muted-foreground/70"
                      : t.sub
                        ? "font-normal text-muted-foreground/50"
                        : "font-medium text-muted-foreground/40",
                  )}
                  style={{ left: `${pct(t.ms)}%` }}
                >
                  {t.label}
                </motion.span>
              ))}
          </AnimatePresence>
        </div>

        {/* Date label + jump-to-now. The date label is ALWAYS shown (so it never jarringly
            vanishes when you land on today at Day zoom); only the jump control toggles —
            visible whenever "now" is off-screen, at any zoom. Hung off the label's edge so
            appending it never shifts the label. Clamped to rest just below the header bar. */}
        <div
          className="pointer-events-none absolute inset-x-0 z-40 flex items-center justify-center"
          style={{ top: labelGroupTop, height: LABEL_ROW_H, transition: headerRowTransition }}
        >
          {/* The date pill is `relative` and is the ONLY thing the parent centers, so the date
              text sits exactly on the viewport center. The jump-to-NOW control is hung BELOW the
              pill as an ABSOLUTE element (so it never shifts the date and we don't have to care
              whether "now" is to the left or right of the viewed date). */}
          {/* Render the pill only when it has content: the date (unless centered on today) and/or
              the jump-to-NOW control. Otherwise an empty `bg-background` chip would show. */}
          {(!centeredOnNow || !atHome) && (
          <div
            className={cn(
              "pointer-events-auto relative inline-flex items-center rounded",
              // Only paint the white pill when the DATE label is present. When centered on today
              // the label is hidden and only the absolutely-positioned NOW chip (below) shows —
              // keeping the bg/padding here would leave an empty white "hat" above NOW.
              !centeredOnNow && "bg-white px-2 py-0.5",
            )}
          >
            {!centeredOnNow && (
              <span className="whitespace-nowrap text-[11px] font-medium tracking-tight text-black">
                {centerLabel}
              </span>
            )}
            {!atHome && (
              <button
                type="button"
                onClick={goNow}
                aria-label="Jump to now"
                title="Jump to now"
                className={cn(
                  // Black-on-white chip matching the date pill, so NOW reads as a paired control
                  // rather than floating bare text over the lanes. Centered beneath the date. A
                  // direction chevron points the way NOW lives relative to the current view: LEFT
                  // (before the chevron+word) when now is earlier, RIGHT (after) when now is later.
                  "absolute left-1/2 top-full mt-0.5 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-[10px] font-medium leading-none text-black",
                )}
              >
                {nowIsEarlier && <ChevronLeft className="h-3 w-3 shrink-0" strokeWidth={2.5} />}
                <motion.span
                  className="overflow-hidden"
                  initial={false}
                  animate={{ width: stage <= 1 ? "auto" : 0, opacity: stage <= 1 ? 1 : 0 }}
                  transition={layerTransition}
                >
                  NOW
                </motion.span>
                {!nowIsEarlier && <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2.5} />}
              </button>
            )}
          </div>
          )}
        </div>

        {/* Instant layer — pins (singletons) and density bubbles (clusters). */}
        <div
          className="pointer-events-none absolute inset-y-0 z-30"
          style={{ left: VIEWPORT_INSET_LEFT, right: VIEWPORT_INSET_RIGHT }}
        >
          {clusters.map((c) => {
            const left = pct(c.ms)
            if (left < 0 || left > 100) return null
            const level = clusterLevel.get(c.key) ?? 0
            const triBottom = -(INSTANT_HEAD_CLEARANCE + level * INSTANT_ROW_STEP)
            const triTop = triBottom - INSTANT_TRI
            const triMid = triBottom - INSTANT_TRI / 2
            const multi = c.items.length > 1
            const color = c.color

            if (multi) {
              // Density bubble — clicking zooms in to that span (×0.25) to expand it,
              // anchored on the cluster so it expands in place rather than sliding in.
              const zoomIn = () =>
                animateTo(c.ms - (spanMs * 0.25) / 2, spanMs * 0.25, c.ms)
              // Related if ANY clustered item is in the focus subtree.
              const dim = Math.max(...c.items.map((it) => relatedFactor(it.parentId, it.id)))
              return (
                <div
                  key={c.key}
                  className="pointer-events-none absolute bottom-0 top-0 w-0 transition-opacity duration-300 ease-out"
                  style={{ left: `${left}%`, opacity: dim }}
                >
                  <button
                    type="button"
                    onClick={zoomIn}
                    title={`${c.items.length} items · zoom in`}
                    className="pointer-events-auto absolute left-0 z-10 flex -translate-x-1/2 items-center justify-center rounded-full text-[9px] font-semibold tabular-nums text-background shadow-sm transition-transform [&:hover]:scale-110"
                    style={{
                      top: triTop - 4,
                      height: 18,
                      width: 18,
                      backgroundColor: color,
                    }}
                  >
                    {c.items.length}
                  </button>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute bottom-0 left-0 z-0 w-px -translate-x-1/2"
                    style={{ top: triBottom + INSTANT_STEM_GAP, backgroundColor: color, opacity: 0.5 }}
                  />
                </div>
              )
            }

            // Singleton — the familiar instant pin (triangle + left label + stem).
            const e = c.items[0]
            const at = e.schedule?.at ?? c.ms
            const isOpen = stack.includes(e.id)
            const hovered = hoveredInstant === e.id
            const onEnter = () => {
              if (draggingRef.current) return // don't highlight along a pan path
              setHoveredInstant(e.id)
            }
            const onLeave = () => setHoveredInstant((cur) => (cur === e.id ? null : cur))
            return (
              <div
                key={c.key}
                className="pointer-events-none absolute bottom-0 top-0 w-0 transition-[filter,opacity] duration-300 ease-out"
                style={{
                  left: `${left}%`,
                  opacity: (e.cancelled ? 0.45 : 1) * relatedFactor(e.parentId, e.id),
                  filter: hovered ? "saturate(2) brightness(1.15)" : "none",
                }}
              >
                <span
                  aria-hidden
                  onMouseEnter={onEnter}
                  onMouseLeave={onLeave}
                  className={cn(
                    "pointer-events-auto absolute bottom-0 left-0 z-0 -translate-x-1/2",
                    "transition-[width,background-color] duration-300 ease-out",
                    "before:absolute before:inset-y-0 before:-inset-x-1 before:content-['']",
                  )}
                  style={{ top: triBottom + INSTANT_STEM_GAP, width: hovered ? 2 : 1, backgroundColor: color }}
                />
                <span
                  onMouseEnter={onEnter}
                  onMouseLeave={onLeave}
                  className={cn(
                    "pointer-events-auto absolute z-10 whitespace-nowrap rounded-[3px] bg-background px-1 py-0.5 text-right text-[10px] leading-none tracking-tight",
                    "transition-[color,font-weight] duration-300 ease-out",
                    e.cancelled && "line-through",
                  )}
                  style={{
                    right: INSTANT_TRI / 2 + 4,
                    top: triMid,
                    transform: "translateY(-50%)",
                    color,
                    fontWeight: hovered ? 600 : 500,
                  }}
                  title={e.title}
                >
                  {e.title}
                </span>
                <motion.button
                  type="button"
                  initial={false}
                  data-placement={placementKey("timeline", contextId, e.id)}
                  data-morph-kind="generic"
                  animate={{ scale: hovered ? 1.25 : 1, color }}
                  transition={{
                    scale: { type: "spring", stiffness: 400, damping: 25 },
                    color: { duration: 0.3, ease: "easeOut" },
                  }}
                  onMouseEnter={onEnter}
                  onMouseLeave={onLeave}
                  onClick={() => openOccurrence({ key: e.occKey, entity: e })}
                  onContextMenu={(ev) => openMenu(ev, e)}
                  aria-current={isOpen ? "true" : undefined}
                  title={e.title}
                  className="pointer-events-auto absolute left-0 z-10 flex -translate-x-1/2 items-center justify-center"
                  style={{ top: triTop, height: INSTANT_TRI, width: INSTANT_TRI }}
                >
                  <NodeGlyph kind="instant" filled strokeWidth={1.5} />
                </motion.button>
              </div>
            )
          })}
        </div>

        <div className="flex h-full items-stretch">
          {/* The left VIEW INDICATOR column (Line/Atlas glyphs) was removed — the
              Lifelane↔Atlas view is driven entirely by zoom, so it carried no function.
              `SELECTOR_W` is now 0 so the viewport insets collapse and stay aligned. */}
          <button
            type="button"
            onClick={() => panBy(-1)}
            aria-label="Pan earlier"
            className="flex w-10 shrink-0 items-center justify-center border-y border-border text-muted-foreground/70 transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Viewport — the continuous lifeline. Wheel zooms (cursor-anchored),
              drag/h-scroll pans. Markers sit above the drag layer.
              CLIP X, BLEED Y: lane `top`s jump to their FINAL (expanded) positions the
              instant a fold toggles, while the frame `height` (bandH) only TWEENS toward
              that size — so with `overflow-hidden` the lowest lanes (e.g. the Health
              mother ribbon) were cropped until the frame caught up. `overflow-x-clip`
              keeps the hard left/right clip that windows the track (chips at the edges
              still cut off), and `overflow-y-visible` lets lanes/ribbons BLEED past the
              still-growing frame instead of being clipped. `clip` (not `hidden`) is what
              allows the y-axis to stay `visible` — `hidden` would force it back to auto. */}
          <div ref={viewportRef} className="relative h-full flex-1 overflow-x-clip overflow-y-visible border-x border-border">
            {/* centered lifeline rule — only shown for a SINGLE lane (the clean lone
                lifeline). With 2+ lanes the stacked ribbons carry the structure, so the
                centered rule is hidden to avoid a stray line cutting across the stack. */}
            {lanes.count < 2 && (
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
            )}

            {/* gridlines — major (context) lines stronger than minor. Wrapped in an
                edge-faded layer so graduations melt in/out at the sides while panning
                rather than popping in/out at the hard viewport border. */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                maskImage: edgeFade,
                WebkitMaskImage: edgeFade,
                transform: condenseXTransform,
                transformOrigin: "center",
                transition: laneScaleTransition,
              }}
            >
              {/* Keyed by `ms` only (see ruler labels above): surviving graduations stay
                  mounted and just slide, so only added/removed lines fade — the grid melts
                  between grains instead of snapping. */}
              <AnimatePresence initial={false}>
                {ticks
                  .filter((t) => pct(t.ms) >= 0 && pct(t.ms) <= 100)
                  .map((t) => (
                    <motion.div
                      key={t.ms}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                      className={cn(
                        "absolute bottom-0 top-0 w-px",
                        // four tiers: context > labeled minor > bare minor > faint sub
                        t.major
                          ? "bg-border/40"
                          : t.sub
                            ? "bg-border/[0.09]"
                            : t.labeled
                              ? "bg-border/20"
                              : "bg-border/[0.08]",
                      )}
                      style={{ left: `${pct(t.ms)}%` }}
                    />
                  ))}
              </AnimatePresence>
            </div>

            {/* DAY CELLS — faint horizontal day-slabs marking each day boundary near the
                snap, drawn when the span is zoomed in enough for day boundaries to matter. */}
            {showDayCells && (
              <div
                className="pointer-events-none absolute inset-0 z-0"
                style={{ transform: condenseXTransform, transformOrigin: "center", transition: laneScaleTransition }}
                aria-hidden
              >
                {dayCells.map((ds) => {
                  const left = pct(ds)
                  const widthPct = (DAY_MS / spanMs) * 100
                  if (left > 100 || left + widthPct < 0) return null
                  return (
                    <div
                      key={`day-${ds}`}
                      className="pointer-events-none absolute bottom-0 top-0 border-l border-border/30 bg-foreground/[0.015]"
                      style={{ left: `${left}%`, width: `${widthPct}%` }}
                      aria-hidden
                    />
                  )
                })}
              </div>
            )}

            {/* drag surface — behind markers so it only catches empty-track drags.
                Keeps the CLASSIC arrow cursor (no grab/grabbing hand) — the timeline reads
                as a normal surface; only entity chips and ticks show the pointer hand. */}
            <div
              onPointerDown={onPointerDown}
              className="absolute inset-0 cursor-default touch-none"
              aria-hidden
            />

            {/* now marker — wrapped in a full-width layer so UNIFORM_SCALE's `scaleX` pinches it
                toward center IN STEP with the gridlines/lanes (scaling the thin marker itself
                about its own center wouldn't move it). At rest the wrapper has no transform. */}
            {nowVisible && (
              <div
                className="pointer-events-none absolute inset-0 z-20"
                style={{ transform: condenseXTransform, transformOrigin: "center", transition: laneScaleTransition }}
              >
              <div
                className="pointer-events-none absolute -bottom-px -top-px w-px"
                style={{ left: `${pct(now)}%`, backgroundColor: accent ?? "var(--accent)" }}
              >
                {/* Endpoint caps: equilateral triangles (8px base, ~7px tall) centered on
                    the 1px line (left −3.5px = −(8−1)/2). Top cap points DOWN into the line,
                    bottom cap points UP. `drop-shadow` gives the same card-colored separation
                    the old `ring-2 ring-card` discs had. */}
                <span
                  aria-hidden
                  className="absolute"
                  style={{
                    top: -7,
                    left: -3.5,
                    width: 0,
                    height: 0,
                    borderLeft: "4px solid transparent",
                    borderRight: "4px solid transparent",
                    borderTop: `7px solid ${accent ?? "var(--accent)"}`,
                    filter: "drop-shadow(0 0 1px var(--card))",
                  }}
                />
                <span
                  aria-hidden
                  className="absolute"
                  style={{
                    bottom: -7,
                    left: -3.5,
                    width: 0,
                    height: 0,
                    borderLeft: "4px solid transparent",
                    borderRight: "4px solid transparent",
                    borderBottom: `7px solid ${accent ?? "var(--accent)"}`,
                    filter: "drop-shadow(0 0 1px var(--card))",
                  }}
                />
              </div>
              </div>
            )}

            {/* CENTERING LAYER. The frame `height` (bandH) CSS-tweens on a fold while the
                lane layout below is computed against the FINAL `trackH` (it jumps in one
                step). Without this, content is pinned to the frame TOP and the growth all
                bleeds out the BOTTOM — so during a height change only the lower extremity
                of the NOW marker appears to move while the top stays put above the first
                lane. This layer keeps the lanes/ribbons/mother-column CENTERED in the live
                frame: `top-1/2` resolves against the animating frame height each frame and
                `-translate-y-1/2` backs off by half the (static) content height, so the
                net offset is `(bandH − trackH) / 2` — exactly 0 at rest (motion/morph math
                untouched) and symmetric bleed (top AND bottom) while the frame grows/shrinks.
                Full-frame elements (rule, gridlines, day cells, NOW marker) stay OUTSIDE
                this layer so they keep spanning the whole frame.
                SCALE PHASE (Part 1): the `scaleY(condenseScale)` is folded into this same
                transform so the lane plane compresses vertically as ONE GPU unit (no
                per-element relayout). `translateY(-50%)` uses the element's own (unscaled)
                height so centering is unaffected by the scale; scaling about the default
                center origin keeps the plane's center pinned to the band center, and since
                the band frame is also `× condenseScale` (bandHVisual) the scaled plane fills
                it exactly. Horizontal is untouched → chips keep real time positions/widths. */}
            <div
              onPointerDown={onPointerDown}
              className="absolute inset-x-0 top-1/2 cursor-default touch-none"
              style={{
              // During a condense reflow, read the SAME JS-smoothed base as the band frame so the
              // centering layer (and the mother ribbons it holds) grows/shrinks in lockstep; the
              // `scaleY(condenseScale)` transform still tracks the zoom instantly on top. Non-
              // condense reflows + folds keep using `trackH` with their CSS `centerLayerTransition`.
              height: reflowCondensing ? bandHRender : trackH,
              transform: `translateY(-50%) scaleX(${condenseScaleX}) scaleY(${condenseScaleVisual})`,
              transition: centerLayerTransition,
              }}
            >
            {/* ribbon background BANDS — one tinted horizontal band per space (the
                time.graphics "folder" model). Rendered BEHIND the bars (z-0). The
                left labels are a separate pass AFTER the bars so they paint on top of
                any event chip that reaches the gutter. Only shown when >1 space. */}
            {showRibbons &&
              lanes.ribbons.map((r) => {
                const blk = blockOfLane(r.baseLane)
                // Kept mounted (faded) through a zoom (un)collapse so it crossfades with
                // the rail; fully gone once the animation settles into the rail state.
                if (blk && !showExpanded(blk)) return null
                const top = laneTop(r.baseLane) - 3
                const h = r.laneCount * laneH + (r.laneCount - 1) * laneGap + 6
                const related = atRootFocus || r.spaceId === contextId || isInSubtree(contextId, r.spaceId)
                const op = (related ? 1 : UNRELATED_OPACITY) * (blk ? expandedOpacity(blk) : 1)
                return (
                  <div
                    key={`ribbon:${r.spaceId}`}
                    className="pointer-events-none absolute inset-x-0 z-0 rounded-r-md transition-[opacity,top,height] duration-300 ease-out animate-in fade-in"
                    style={{
                      top,
                      height: h,
                      opacity: op,
                      backgroundColor: `${r.color}0d`,
                      borderLeft: `2px solid ${r.color}66`,
                      // During a manual fold, reposition in lockstep with the band/do-list.
                      // While condensing (not folding) the top/height change every zoom frame,
                      // so kill the class' 300ms transition to track the compression live.
                      transition: condensing && !folding ? "none" : reflowTransition("opacity, top, height"),
                    }}
                  />
                )
              })}

            {/* EXPANDED RIBBON BODY click targets — one transparent layer per expanded mother
                spanning its lanes, at z-0 BENEATH the bars/chips (which are separate, higher-z
                absolute siblings, so a chip click never reaches this). Clicking the empty lane
                area collapses the mother to its thin rail. Only renders for EXPANDED grouped
                mothers (a collapsed block has no body; the root has no motherId), so it works
                the same whether the ribbon is open by default or was manually re-opened while
                zoomed out. */}
            {showRibbons &&
              layout.blocks.map((blk) => {
                const mId = blk.m.motherId
                if (!mId || !showExpanded(blk) || blk.collapsed) return null
                return (
                  <button
                    key={`mbody:${mId}`}
                    type="button"
                    aria-label={`Collapse ${blk.m.title}`}
                    onClick={() => collapseMother(mId)}
                    className="absolute z-0 cursor-default"
                    style={{
                      top: offsetY + blk.top - 3,
                      height: blk.height + 6,
                      left: MOTHER_COL_W,
                      right: 0,
                      transition: condensing && !folding ? "none" : reflowTransition("top, height"),
                    }}
                  />
                )
              })}

            {/* COLLAPSED RAILS — a thin bar where a folded ribbon's lanes used to be.
                Works for EVERY collapsed block (grouped mothers AND the ungrouped root).
                When the user folded it by hand it's a button that reopens on click; when
                the ZOOM forced the collapse, expansion is zoom-controlled so the rail is
                a plain (non-interactive) div — clicking it must not fight the zoom. */}
            {showRibbons &&
              layout.blocks.map((blk) => {
                if (!showCollapsed(blk)) return null
                const rk = blk.m.motherId ?? `root:${blk.m.baseLane}`
                // A fully HIDDEN mother has no thin rail — instead its lane is a SOLID 1px
                // sliver in the mother's own color (white when it has none). The SAME element
                // morphs between the two looks: the rail (translucent fill + 2px left border,
                // 7px tall) animates height/color into the 1px solid sliver, so hiding/showing
                // glides instead of snapping.
                const railStyle = {
                  top: offsetY + blk.top,
                  height: blk.hidden ? HIDDEN_H : RAIL_H,
                  // A hidden sliver rests at the same faded level the timeline uses for a
                  // backgrounded ribbon (`UNRELATED_OPACITY`) and lifts to 100% while its lane is
                  // hovered — a responsive cue that the (otherwise near-invisible) 1px line is
                  // clickable to reopen. Thin rails keep the crossfade opacity.
                  opacity: blk.hidden ? (hoveredMother === rk ? 1 : UNRELATED_OPACITY) : collapsedOpacity(blk),
                  backgroundColor: blk.hidden ? blk.m.color || "#ffffff" : `${blk.m.color}1f`,
                  borderLeft: blk.hidden ? "none" : `2px solid ${blk.m.color}`,
                  // SHAPE + POSITION IMMUNITY: keep the thin bar its true RAIL_H/HIDDEN_H AND restore its
                  // un-compressed spacing so rails don't bunch/overlap mid-zoom (see `collapsedXform`).
                  transform: collapsedXform(offsetY + blk.top + (blk.hidden ? HIDDEN_H : RAIL_H) / 2),
                  // A collapsed sibling rail (e.g. Health) must slide with the reflow too.
                  transition: reflowTransition("top, filter, opacity, height, background-color"),
                } as const
                const hoverProps = {
                  onMouseEnter: () => {
                    if (draggingRef.current) return // don't highlight along a pan path
                    setHoveredMother(rk)
                  },
                  onMouseLeave: () => setHoveredMother((h) => (h === rk ? null : h)),
                }
                // Clicking the rail/1px-sliver BODY expands the mother fully (between ticks on a
                // thin rail; anywhere on a hidden sliver) — true whether the fold was manual or a
                // zoom auto-fold (both now share the per-mother `override` path, so a click cleanly
                // re-opens just this ribbon). Only the ungrouped ROOT (no motherId) stays a plain
                // non-interactive div. The hidden sliver is just 1px tall, so it ALSO gets the
                // taller hover-catcher in the label pass as an easier target.
                return blk.m.motherId ? (
                  <button
                    key={`rail:${rk}`}
                    type="button"
                    onClick={() => expandMother(blk.m.motherId!)}
                    {...hoverProps}
                    aria-label={`Expand ${blk.m.title}`}
                    className="absolute inset-x-0 z-0 cursor-default rounded-r-md transition-[top,filter,opacity] duration-300 ease-out animate-in fade-in hover:brightness-150"
                    style={railStyle}
                  />
                ) : (
                  <div
                    key={`rail:${rk}`}
                    {...hoverProps}
                    className="absolute inset-x-0 z-0 rounded-r-md transition-[top,filter,opacity] duration-300 ease-out animate-in fade-in"
                    style={railStyle}
                  />
                )
              })}

            {/* bars — events, scheduled spaces, rollup bands, recurring streams. */}
            {bars.map((b) => {
              const lane = lanes.lane.get(b.key) ?? 0
              const blk = blockOfLane(lane)
              // PERSIST event chips as their OWN rail tick instead of unmounting them when the ribbon
              // is collapsed at rest. An event chip already morphs to the EXACT collapsed tick geometry
              // (same width/height/top/colour), so keeping it mounted lets it simply BE the tick.
              // Collapse → rest → uncollapse is then ONE continuous single-element morph whether or not
              // you wait, and the old chip→tick hand-off (with its ~2s swap jump) is gone entirely.
              //
              // This covers BOTH one-off events AND the individual occurrences of a recurring series at
              // fine zoom (each occurrence is its own `kind:"event"` bar whose entity carries
              // `schedule.repeat`). The ONLY thing excluded here is the `kind:"recur"` AGGREGATE bar
              // (emitted at coarse zoom) — that one is drawn as a downsampled dot-row in the rail pass,
              // which owns it. Excluding occurrences by `schedule.repeat` (the old check) is what made
              // recurring ticks vanish ~2s after collapse: they returned null at rest yet had no rail
              // tick anymore. Rollup bands and hidden ribbons keep unmounting as before.
              const persistAsTick =
                !!blk && blk.collapsed && !blk.hidden && b.kind !== "band" && b.kind !== "recur"
              if (blk && !showExpanded(blk) && !persistAsTick) return null
              const expOpacity = blk ? expandedOpacity(blk) : 1
              // Is THIS bar's block mid-morph (zoom window or its mother's manual-fold
              // window)? Drives the width tween + enter opacity so a manually-folded
              // ribbon's bars morph into ticks exactly like a zoom-folded one.
              const barAnimating = blk ? blkAnimating(blk) : collapseAnimating
              // True once the view has crossed the threshold toward collapsed (the morph
              // TARGET). Event chips stay opaque and morph into their rail span on this
              // flag; their inner text fades out FAST (before the bar finishes sliding).
              const collapsedTarget = !!blk?.collapsed
              // HIDING target: the ribbon is being fully hidden (→ 1px sliver, no rail). Unlike a
              // plain collapse — where the chip stays OPAQUE and morphs into its rail tick — a hide
              // must make the chip FADE OUT (fast) so it doesn't linger at full opacity on the rail
              // for the whole fold window and then suddenly pop off when it unmounts.
              const hidingTarget = !!blk?.hidden
              // The chip's RAIL geometry (y of its highlight tick). A chip that MOUNTS
              // mid-morph (un-collapse — it was unmounted while the ribbon was a rail)
              // uses this as its framer `initial`, so it FALLS out of the highlight into
              // its lane instead of just fading in place at full size.
              const railTopPx = blk ? offsetY + blk.top + 1 : barTop(lane)
              const left = pct(b.from)
              const widthPct = ((b.to - b.from) / spanMs) * 100
              if (left > 100 || left + widthPct < 0) return null
              // Real on-screen width of this bar in px (viewport `width` is the px
              // measure; `widthPct` is its share of the span). Drives the adaptive
              // chip → marker collapse below.
              const widthPx = (Math.max(widthPct, 0) / 100) * width
              const boxStyle = {
                left: `calc(${left}% + 2px)`,
                // ACCURATE width = the event's true share of the span, NO minimum. We used to
                // clamp to `max(widthPct, 0.8)%`, which forced short events WIDER than their
                // real duration so the translucent rounded span could "contain" its glyph/
                // label. That min was the gymnastics the user called out: a 30-min event on a
                // multi-day view rendered as a fat pill instead of a hairline, and on collapse
                // that inflated box had to shrink down to the true-width rail tick — reading as
                // the highlight "jumping" to a different (narrower→then accurate) width. The
                // glyph + label already BLEED past the box (overflow-visible) and clip on
                // collapse, so the box itself never needs a min to hold them. `max(widthPct,0)`
                // only guards against a negative %, and the `- 4px` inter-chip gap is floored
                // at 0 so a hairline event never produces a negative width.
                width: `max(0px, calc(${Math.max(widthPct, 0)}% - 4px))`,
                top: barTop(lane),
              } as const

              // Rollup context band — click to enter the child space (expands it).
              if (b.kind === "band") {
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => b.childId && open(b.childId)}
                    title={`${b.title} · ${b.count} items`}
                    className="absolute flex h-6 cursor-pointer items-center gap-1.5 overflow-hidden rounded-md border border-dashed px-2 text-[10.5px] tracking-tight text-foreground/80 transition-[filter,opacity,top] duration-300 ease-out animate-in fade-in hover:brightness-110"
                    style={{
                      ...boxStyle,
                      // EXPERIMENT 2: uniform entity scale (CSS scaleX, origin center → pairs with
                      // the parent scaleY so the rollup band shrinks uniformly with its label/count).
                      transform: entityTransformCss,
                      opacity: expOpacity,
                      borderColor: `${b.color}73`,
                      backgroundColor: `${b.color}1f`,
                    }}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} aria-hidden />
                    <span className="truncate font-medium">{b.title}</span>
                    <span className="ml-auto shrink-0 rounded-full bg-background/60 px-1 text-[9px] font-semibold tabular-nums">
                      {b.count}
                    </span>
                  </button>
                )
              }

              // Recurring series — drawn as a row of INDIVIDUAL occurrence dots on
              // its ribbon lane (never a collapsed band). The bar itself only
              // reserved the lane; here we paint a transparent full-track container
              // and drop a dot at each occurrence's time (`pct(t)`), culling those
              // off-screen. When the series was truncated at the cap, the final
              // RECUR_FADE_TAIL dots fade out to imply "…and it keeps going".
              if (b.kind === "recur") {
                const times = b.times ?? []
                const baseOpacity = relatedFactor(b.entity?.parentId, b.entity?.id) * expOpacity
                const tailStart = b.truncated ? times.length - RECUR_FADE_TAIL : times.length
                // Every occurrence shares the series' own span, so we measure it
                // ONCE with the same entityInterval the regular chips use, and draw
                // each occurrence with the SAME proportional width formula
                // (duration / spanMs) — never a fixed dot. Floored at 1px so a brief
                // event stays a visible sliver instead of vanishing.
                const occDurMs = b.entity ? (() => { const [s, e2] = entityInterval(b.entity); return Math.max(0, e2 - s) })() : 0
                const occWidthPct = (occDurMs / spanMs) * 100
                // Cull to on-screen indices FIRST, then downsample so a fully-packed series
                // paints at most RECUR_RENDER_MAX divs instead of all 366 every frame.
                const visIdx: number[] = []
                for (let i = 0; i < times.length; i++) { const d = pct(times[i]); if (d >= 0 && d <= 100) visIdx.push(i) }
                const renderIdx = downsampleKeepingTail(visIdx, RECUR_RENDER_MAX)
                return (
                  <div
                    key={b.key}
                    className="pointer-events-none absolute inset-x-0 transition-[top,opacity] duration-300 ease-out animate-in fade-in"
                    style={{ top: barTop(lane), height: laneH, opacity: baseOpacity }}
                  >
                    {renderIdx.map((i) => {
                      const t = times[i]
                      const dl = pct(t)
                      // Linear ramp over the trailing points: …0.75, 0.5, 0.25.
                      const fade = i >= tailStart ? (times.length - i) / (RECUR_FADE_TAIL + 1) : 1
                      return (
                        <button
                          key={`${b.key}@${t}`}
                          type="button"
                          onClick={() => openOccurrence(b)}
                          onContextMenu={(ev) => b.entity && openMenu(ev, b.entity)}
                          title={`${b.title} · recurring (~${b.count})`}
                          aria-label={b.title}
                          className="pointer-events-auto absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-[filter] hover:brightness-125"
                          style={{
                            left: `${dl}%`,
                            width: `max(1px, ${occWidthPct}%)`,
                            backgroundColor: b.color,
                            opacity: fade,
                          }}
                        />
                      )
                    })}
                  </div>
                )
              }

              // Event / scheduled-space span chip.
              const isOpen = b.entity ? stack.includes(b.entity.id) : false
              const dim = (b.cancelled ? 0.45 : 1) * relatedFactor(b.entity?.parentId, b.entity?.id)
              const markerColor = b.color || "var(--muted-foreground)"
              // When this chip is COLLAPSED (it now persists as its own rail tick), it absorbs the
              // duties the separate rail tick used to own: it GLOWS while its rail (or itself) is
              // hovered, and it feeds the shared floating glyph tooltip on hover. `rkForBar` matches
              // the rail pass's `rk` so whole-rail hover lights every tick in lockstep.
              const rkForBar = blk ? (blk.m.motherId ?? `root:${blk.m.baseLane}`) : null
              const railHovered = rkForBar != null && hoveredMother === rkForBar
              const tickGlow = collapsedTarget && (railHovered || hoveredTick?.key === b.key)
              const tickGlowColor = b.color || NEUTRAL_MARKER
              const onCollapsedTickEnter = () => {
                if (draggingRef.current) return // don't highlight along a pan path
                if (!collapsedTarget || !rkForBar) return
                setHoveredMother(rkForBar)
                setHoveredTick({
                  key: b.key,
                  leftPct: left,
                  top: blk ? offsetY + blk.top : barTop(lane),
                  title: b.title,
                  kind: (b.entity?.kind as NodeKind) ?? "event",
                  color: tickGlowColor,
                })
              }
              const onCollapsedTickLeave = () => {
                if (!rkForBar) return
                setHoveredMother((h) => (h === rkForBar ? null : h))
                setHoveredTick((t) => (t?.key === b.key ? null : t))
              }

              // COLLAPSED MARKER — when the span is too narrow for a labeled chip, it
              // becomes a smooth horizontal line the width of the span, a vertical
              // color edge rising at its left, and the title set to the RIGHT of that
              // vertical connector (free to overflow past the tiny span).
              if (CHIP_COLLAPSE_ENABLED && widthPx < CHIP_COLLAPSE_PX) {
                return (
                  <motion.button
                    key={b.key}
                    type="button"
                    // Same FALL as the titled chip: a marker mounting mid-un-collapse seeds
                    // at its rail highlight (railTopPx) and drops into its lane; on collapse
                    // it's already mounted so framer tweens its live top up to the rail.
                    initial={barAnimating ? { opacity: 0, top: railTopPx } : false}
                    data-placement={b.entity ? placementKey("timeline", contextId, b.entity.id) : undefined}
                    data-morph-kind="generic"
                    animate={{ opacity: hidingTarget ? 0 : dim, top: barTop(lane) }}
                    transition={
                      zoomExpanding
                        ? { top: { duration: 0 }, opacity: { duration: 0.2, ease: "easeOut" }, scaleX: { duration: 0 } }
                        : barAnimating
                          ? { top: morphTween(true, !collapsedTarget), opacity: { duration: 0.2, ease: "easeOut" }, scaleX: morphTween(true, !collapsedTarget) }
                          : manualFolding
                            ? { top: morphTween(true, bandExpanding, false), opacity: panelTransition, scaleX: morphTween(true, bandExpanding, false) }
                            : { top: { duration: topRepackDur, ease: "easeOut" }, opacity: panelTransition, scaleX: entityScaleTween }
                    }
                    onClick={() => openOccurrence(b)}
                    onContextMenu={(ev) => b.entity && openMenu(ev, b.entity)}
                    onMouseEnter={onCollapsedTickEnter}
                    onMouseLeave={onCollapsedTickLeave}
                    aria-current={isOpen ? "true" : undefined}
                    title={b.title}
                    className="absolute flex cursor-pointer items-end overflow-visible transition-[filter] duration-300 ease-out hover:brightness-110"
                    // EXPERIMENT 2: uniform entity scale (scaleX pairs with the parent scaleY so the
                    // marker line + vertical connector + bleeding title shrink uniformly, not squished).
                    // Collapsed: drop the +2px inter-chip gap so the resting tick sits at its TRUE time
                    // position (pixel-aligned with recurring ticks), exactly where the old rail tick was.
                    style={{ scaleX: entityScaleX, left: collapsedTarget ? `${left}%` : boxStyle.left, width: boxStyle.width, height: laneH }}
                  >
                    {/* vertical color connector rising from the duration line ��� shrinks
                        away on collapse so the marker flattens into its rail tick. */}
                    <span
                      className="absolute bottom-0 left-0 w-[2px] rounded-full transition-[height] duration-300 ease-out"
                      style={{ height: collapsedTarget ? RAIL_H - 2 : 16, backgroundColor: markerColor }}
                      aria-hidden
                    />
                    {/* title to the RIGHT of the vertical connector — fades out FAST/EARLY
                        on collapse (before the slide), back in LATE on expand. */}
                    <span
                      className={cn(
                        "pointer-events-none absolute bottom-1.5 left-1.5 whitespace-nowrap text-[10px] leading-none tracking-tight text-foreground/80",
                        b.cancelled && "line-through",
                      )}
                      style={{
                        opacity: collapsedTarget ? 0 : 1,
                        fontSize: 10,
                        // Match the titled chip: fade the bleeding marker title over a big
                        // slice of the collapse so the apparent width retracts smoothly into
                        // the rail tick instead of snapping away in 110ms.
                        transition: collapsedTarget
                          ? `opacity ${Math.round(COLLAPSE_MS * 0.7)}ms ease-out`
                          : "opacity 150ms ease-out 150ms",
                      }}
                    >
                      {b.title}
                    </span>
                    {/* smooth horizontal line spanning the (short) duration */}
                    <span
                      className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                      style={{ backgroundColor: markerColor, opacity: 0.6 }}
                      aria-hidden
                    />
                  </motion.button>
                )
              }

              // Fill crossfade timing for the chip's faint→solid (collapse) / solid→faint (expand)
              // background+border. It used to ride a FIXED 300ms CSS class while the geometry morph
              // takes COLLAPSE_MS (620) / EXPAND_MS — so the chip went fully opaque <50% into the
              // fold and then sat there ("turns opaque very early"). Drive the color off the SAME
              // duration + curve as the geometry so it darkens gradually and lands solid exactly as
              // the chip lands on its rail tick. At rest (not folding) keep the snappy 300ms default.
              const fillDur = barAnimating ? (collapsedTarget ? COLLAPSE_MS : EXPAND_MS) : 300
              // Collapsing: back-loaded ease-in so the fill inks in mostly at the END of the fold.
              // Expanding: keep the geometry's soft curve. At rest: snappy ease-out.
              const fillEase = !barAnimating ? "ease-out" : collapsedTarget ? FILL_IN_EASE_CSS : EXPAND_EASE_CSS
              const fillTransition = `background-color ${fillDur}ms ${fillEase}, border-color ${fillDur}ms ${fillEase}`

              return (
                // `transition-[top]` (NOT left/width) so a bar GLIDES vertically when
                // a zoom repacks it into a different lane, instead of snapping — and
                // lands on the same 300ms/ease-out beat as its ribbon band. Horizontal
                // (left/width) stays instant so it tracks the zoom/pan under the cursor.
                //
                // No cross-tree FLIP here anymore: the Lifelane<->Atlas flight is played
                // by the Atlas (TimelineWeek) itself, which animates each entity between
                // its Lifelane and Atlas rect. The whole Lifelane <section> is hidden
                // INSTANTLY while `morphing` (opacity-0 on the parent), so chips need NO
                // self-fade — keeping them at `dim` means that when the section pops back
                // in at morph-end they're already in place (no end-of-morph fade-in flash).
                // MORPH wrapper, driven by FRAMER (`initial`/`animate`) for top + height so
                // the morph plays in BOTH directions:
                //  • COLLAPSE — the chip is already mounted, so framer ignores `initial` and
                //    tweens its live box DOWN to the rail (height→tick, top→rail): it
                //    COMPRESSES into its highlight.
                //  • UN-COLLAPSE — the chip mounts fresh (it was unmounted while the ribbon
                //    was a rail). `initial` seeds it AT the rail highlight (railTopPx, tick
                //    height) and framer animates it UP to its lane box: it FALLS out of the
                //    highlight during the expand, instead of fading in place at full size
                //    after it (the old behaviour — `initial` only carried opacity).
                // `initial={false}` at rest so chips entering on a normal pan/zoom just
                // appear. WIDTH stays on a CSS transition (calc% — framer can't reliably
                // keyframe calc) and only transitions DURING the morph, so at rest spans
                // track the zoom instantly (avoids the earlier width-lag regression).
                <motion.div
                  key={b.key}
                  className="absolute"
                  initial={barAnimating ? { top: railTopPx, height: RAIL_H - 2 } : false}
                  animate={{ top: barTop(lane), height: collapsedTarget ? RAIL_H - 2 : laneH }}
                  // `barAnimating` = THIS ribbon is folding (falls from/into the rail) → soft
                  // fall curve. `manualFolding` (sibling) = just reposition `top`, on the
                  // prompt reflow curve so the pushed ribbons glide in lockstep with the band.
                  // At rest the top keeps its 0.3s repack glide, but while CONDENSING both top
                  // and height change every zoom frame, so they go instant to track the zoom
                  // (height is always instant at rest — the chip never tweened its own height
                  // outside a fold). `laneH` shrinks the chip continuously toward the rail.
                  transition={
                    zoomExpanding
                      ? { duration: 0 } // instant: chip mounts at full size and crossfades in, never clipped
                      : barAnimating || manualFolding
                        ? morphTween(barAnimating || manualFolding, barAnimating ? !collapsedTarget : bandExpanding, barAnimating)
                        : { top: { duration: topRepackDur, ease: "easeOut" }, height: { duration: 0 }, scaleX: entityScaleTween }
                  }
                  style={{
                    // EXPERIMENT 2: uniform entity scale. Parent layer already does scaleY; this
                    // scaleX (origin center) makes the whole chip — colored span box + glyph +
                    // bleeding title — shrink uniformly toward its time-center instead of being
                    // vertically squished. =1 (no-op) when the flag is off.
                    scaleX: entityScaleX,
                    // Collapsed: sit at the TRUE time position (`left%`, no +2px inter-chip gap) so the
                    // resting chip is pixel-aligned with recurring ticks — exactly where the old rail
                    // tick lived. The 2px is glided away (not snapped) DURING the fold via the `left`
                    // transition below, and only while animating, so at rest left/width still track the
                    // zoom instantly (no pan/zoom lag).
                    left: collapsedTarget ? `${left}%` : boxStyle.left,
                    // Collapse target width is the rail-tick width with a PIXEL floor — a `0.6%`-of-track
                    // floor made the chip morph to ~16px on an ultrawide, flashing fat for ~1s. Pixel
                    // floor is identical on every screen → seamless.
                    width: collapsedTarget ? `max(3px, ${widthPct}%)` : boxStyle.width,
                    transition: barAnimating
                      ? `width ${collapsedTarget ? COLLAPSE_MS : EXPAND_MS}ms ${collapsedTarget ? "ease-out" : EXPAND_EASE_CSS}, left ${collapsedTarget ? COLLAPSE_MS : EXPAND_MS}ms ${collapsedTarget ? "ease-out" : EXPAND_EASE_CSS}`
                      : undefined,
                  }}
                >
                  <motion.button
                    type="button"
                    initial={barAnimating ? { opacity: 0 } : false}
                    data-placement={b.entity ? placementKey("timeline", contextId, b.entity.id) : undefined}
                    data-morph-kind="generic"
                    // Stays OPAQUE through the morph (no expOpacity fade): it doesn't fade
                    // out, it BECOMES the span. The fill/border darken from faint → solid
                    // so the shrinking chip matches the solid rail tick it lands on. During
                    // the morph the opacity fade is QUICK (a chip falling out of its
                    // highlight should be visible as it drops, not crawl in over the 2s
                    // panelTransition) and rides early so the geometry fall carries the eye.
                    // When the ribbon is being HIDDEN (not just collapsed), fade to 0 instead so
                    // the chip doesn't linger opaque on the rail then pop off at unmount.
                    animate={{ opacity: hidingTarget ? 0 : dim }}
                    transition={barAnimating ? { opacity: { duration: 0.2, ease: "easeOut" } } : panelTransition}
                    onClick={() => openOccurrence(b)}
                    onContextMenu={(ev) => b.entity && openMenu(ev, b.entity)}
                    onMouseEnter={onCollapsedTickEnter}
                    onMouseLeave={onCollapsedTickLeave}
                    aria-current={isOpen ? "true" : undefined}
                    title={b.title}
                    className={cn(
                      // overflow-visible (not hidden) so a title wider than the span
                      // BLEEDS out past the colored frame to the right rather than
                      // truncating — the packer reserves that label width so it never
                      // collides with a neighbour (item 3).
                      // NO horizontal padding here, and min-w-0: with box-sizing:border-box
                      // an element CANNOT shrink below its own padding+border, so `px-2`
                      // (16px) + border was flooring the colored box at ~18px no matter how
                      // short the event — exactly the phantom "min-width" that made brief
                      // events render as fat squares when zoomed out. With padding removed the
                      // box width tracks the true duration down to the border. The glyph's
                      // breathing room moves to the INNER content span (which is overflow-
                      // visible, so it bleeds past the box instead of widening it).
                      "flex h-full w-full min-w-0 items-center overflow-visible rounded-md border text-[10.5px] tracking-tight",
                      "cursor-pointer text-foreground/85 shadow-sm transition-[filter] duration-300 ease-out hover:brightness-110",
                    )}
                    style={{
                      // Chip type is a constant size; the lane-layer scaleY squishes it
                      // vertically as we condense toward the fold (see render).
                      fontSize: 10.5,
                      borderColor: collapsedTarget
                        ? b.color || "var(--border)"
                        : b.color
                          ? `${b.color}59`
                          : "var(--border)",
                      backgroundColor: collapsedTarget
                        ? b.color || "var(--secondary)"
                        : b.color
                          ? `${b.color}26`
                          : "var(--secondary)",
                      // Gradual fill crossfade matched to the fold's own duration/curve (not a fixed
                      // 300ms) so the chip darkens smoothly across the whole morph — see fillTransition.
                      transition: fillTransition,
                      // Collapsed-tick glow when its rail (or itself) is hovered — parity with the old
                      // rail tick's `0 0 6px` halo. Undefined otherwise so the `shadow-sm` class wins.
                      boxShadow: tickGlow ? `0 0 6px ${tickGlowColor}` : undefined,
                    }}
                  >
                    {/* kind GLYPH + title. Wrapped so they fade as ONE unit and, crucially,
                        FAST + EARLY on collapse (110ms, no delay) — the text is gone before
                        the bar finishes sliding into the rail. On expand they fade back in
                        LATE (delayed) so the bar grows first, then the label appears. */}
                    <span
                      className="flex items-center gap-1.5 overflow-visible pl-1.5 pr-2"
                      style={{
                        opacity: collapsedTarget ? 0 : 1,
                        // A chip's colored BOX width is just its time-span % (≈ the rail tick),
                        // but its glyph + title BLEED right past the box — so a NARROW event
                        // (e.g. box 37px, label bleeds to 78px) LOOKS ~2× as wide as its tick.
                        // On collapse the perceived width must retract from the full label down to
                        // the box/tick. We do that by CLIPPING the label from the RIGHT (clip-path
                        // inset %, geometry-independent, no distortion): as the inset grows the
                        // bleeding title slides left under the clip edge until only the box (tick)
                        // remains. CRITICAL: timing is LINEAR, not ease-out. An ease-out clip
                        // decelerates, so the final sliver of the title CRAWLS for the last ~200ms
                        // then vanishes — exactly the "lingers then snaps" the user kept seeing.
                        // Linear retracts at a constant rate so the width slides smoothly into the
                        // tick with no tail. The clip finishes a touch before the fall lands
                        // (0.9×) so there's no leftover label on the last frame. inset(0) at rest
                        // clips nothing (titles bleed normally). Expand reverses it, delayed so the
                        // box grows first then the label unfurls.
                        clipPath: collapsedTarget ? "inset(0 100% 0 0)" : "inset(0 0 0 0)",
                        transition: collapsedTarget
                          ? `opacity ${Math.round(COLLAPSE_MS * 0.55)}ms linear, clip-path ${Math.round(COLLAPSE_MS * 0.9)}ms linear`
                          : "opacity 200ms ease-out 160ms, clip-path 340ms ease-out 140ms",
                      }}
                    >
                      <span className="h-2.5 w-2.5 shrink-0" style={{ color: b.color || "var(--muted-foreground)" }}>
                        <NodeGlyph kind={(b.entity?.kind as NodeKind) ?? "event"} filled strokeWidth={2} />
                      </span>
                      <span className={cn("whitespace-nowrap", b.cancelled && "line-through")}>{b.title}</span>
                    </span>
                  </motion.button>
                </motion.div>
              )
            })}

            {/* RAIL HIGHLIGHTS — a collapsed mother's events don't vanish; instead of
                falling onto the visible lanes, each event is painted AS a bright tick
                directly ON that mother's thin rail, at its own time position. The rail
                becomes a compressed one-line preview of the folded mother. Shown on a thin
                rail; a fully HIDDEN mother (eye) has no rail and no ticks (its lane is a 1px
                sliver), so its highlights are suppressed. ALL ticks brighten while the rail is
                hovered (`hoveredMother`); hovering ONE specific tick lights only that tick
                (`hoveredTick`). Clicking a tick OPENS that entity (like clicking its chip on an
                open lane); reopening the whole lane is done by clicking the rail BETWEEN ticks. */}
            {showRibbons &&
              layout.blocks.flatMap((blk) => {
                const rk = blk.m.motherId ?? `root:${blk.m.baseLane}`
                if (!showCollapsed(blk)) return []
                // A fully HIDDEN mother has no ticks at rest, but while it's still ANIMATING
                // into hidden we keep them mounted and drive their opacity to 0 so they fade
                // out together with the rail (the 150ms tick transition), instead of snapping
                // off the instant the eye is clicked.
                const hidingNow = blk.hidden && blkAnimating(blk)
                if (blk.hidden && !hidingNow) return []
                const hi = hoveredMother === rk
                const railY = offsetY + blk.top
                // Tick opacity is DIRECTION-AWARE:
                //  • COLLAPSE (blk.collapsed true) — stay SOLID so the chip morphing DOWN
                //    lands on a stable span (seamless handoff as the chip unmounts).
                //  • UN-COLLAPSE (blkAnimating && !collapsed) — fade OUT in the first frames
                //    (fast `duration-150` vs the 480ms morph) so the highlight clears early
                //    as the chips fall out of it, instead of lingering until the last frame.
                const uncollapsing = blkAnimating(blk) && !blk.collapsed
                // Bars whose lane falls inside THIS block's lane range (works for the
                // ungrouped root too, where there's no motherId to match on).
                const loLane = blk.m.baseLane
                const hiLane = blk.m.baseLane + blk.m.laneCount
                const motherBars = bars.filter((b) => {
                  const ln = lanes.lane.get(b.key) ?? -1
                  return ln >= loLane && ln < hiLane
                })
                // PER-TICK hover: when the pointer is over ONE specific tick on this rail
                // (`hoveredTick` is set by the tick's own onMouseEnter), only THAT tick lights
                // up and the rest stay dim — instead of the whole-rail `hi` highlight. Hovering
                // the rail anywhere ELSE (no specific tick) keeps the all-ticks `hi` behaviour.
                const hoveredTickKey = hoveredTick?.key ?? null
                const someTickOnRail = hoveredTickKey != null && motherBars.some((b) => b.key === hoveredTickKey)
                // Lit/glow for a tick given whether it is the specifically-hovered one.
                const tickLit = (isThis: boolean) => (someTickOnRail ? isThis : hi)
                // TICK REFLOW: a tick sits at the rail's `top` (railY). When ANOTHER ribbon folds,
                // the lanes reflow and railY changes — the rail itself glides via `reflowTransition`,
                // but the ticks declared only an opacity transition, so their `top` SNAPPED to the
                // new position while the rail eased (the "ticks jump suddenly" the user saw). Mirror
                // the rail's exact `top` schedule here (reflow tween while folding, instant on a
                // zoom-expand, 300ms ease-out otherwise) so ticks glide in lockstep with their rail.
                const railTopReflow = reflowTransition("top")
                const tickTopCss = railTopReflow === "none" ? "top 0ms" : (railTopReflow ?? "top 300ms ease-out")
                const collapsingNow = blkAnimating(blk) && blk.collapsed && !blk.hidden
                // RECUR-DOT ENTRANCE. Recurring occurrence dots have no single morphing chip actor, so
                // they keep a fade-in entrance; while actively folding, stretch it across the fold with
                // the back-loaded ease-in so they ink in toward the end like the chip fills. (Single
                // event ticks instead stay hidden during the fold — the chip is their sole actor.)
                const tickEnter = collapsingNow
                  ? { animationDuration: `${COLLAPSE_MS}ms`, animationTimingFunction: FILL_IN_EASE_CSS }
                  : undefined
                return motherBars
                  .map((b) => {
                    const color = b.color || NEUTRAL_MARKER
                    // A recurring lane is NEVER collapsed into a continuous tick —
                    // even on a collapsed/auto-folded ribbon it stays a row of its
                    // individual occurrence dots (with the same faded continuation
                    // tail), so it reads identically whether the ribbon is open or
                    // folded. Without this it rendered as one solid bar spanning the
                    // whole recurrence window.
                    if (b.kind === "recur") {
                      const times = b.times ?? []
                      const tailStart = b.truncated ? times.length - RECUR_FADE_TAIL : times.length
                      // Same proportional segment as the open-ribbon branch (each
                      // occurrence's duration / spanMs, floored at 1px) — never dots
                      // — so a folded recurring lane reads identically to an open one.
                      const occDurMs = b.entity ? (() => { const [s, e2] = entityInterval(b.entity); return Math.max(0, e2 - s) })() : 0
                      const occWidthPct = (occDurMs / spanMs) * 100
                      // Cull to on-screen indices, then downsample (this collapsed rail with a
                      // fully-packed series was the ~21fps hot path — hundreds of divs/frame).
                      const visIdx: number[] = []
                      for (let i = 0; i < times.length; i++) { const d = pct(times[i]); if (d >= 0 && d <= 100) visIdx.push(i) }
                      const renderIdx = downsampleKeepingTail(visIdx, RECUR_RENDER_MAX)
                      return (
                        <div
                          key={`railtick:${b.key}`}
                          className="absolute z-10 animate-in fade-in"
                          style={{
                            left: 0,
                            right: 0,
                            top: railY + 1,
                            height: RAIL_H - 2,
                            // Same shape + position immunity as the rail: this dot-row shares the rail's
                            // vertical center, so it un-squishes AND un-bunches in lockstep with the bar.
                            transform: collapsedXform(railY + RAIL_H / 2),
                            transition: tickTopCss,
                            ...tickEnter,
                          }}
                        >
                          {renderIdx.map((i) => {
                            const t = times[i]
                            const dl = pct(t)
                            const fade = i >= tailStart ? (times.length - i) / (RECUR_FADE_TAIL + 1) : 1
                            return (
                              <div
                                key={`${b.key}@${t}`}
                                className="absolute top-1/2 cursor-pointer rounded-full transition-[opacity] duration-150"
                                // Each occurrence dot of a folded recurring series opens that series'
                                // entity on click (and its context menu on right-click), matching the
                                // single-tick behaviour.
                                onClick={() => openOccurrence(b)}
                                onContextMenu={(e) => b.entity && openMenu(e, b.entity)}
                                style={{
                                  left: `${dl}%`,
                                  width: `max(1px, ${occWidthPct}%)`,
                                  height: RAIL_H - 2,
                                  transform: "translateY(-50%)",
                                  backgroundColor: color,
                                  opacity: (uncollapsing || hidingNow ? 0 : tickLit(false) ? 1 : 0.85) * fade,
                                  boxShadow: tickLit(false) ? `0 0 6px ${color}` : undefined,
                                }}
                              />
                            )
                          })}
                        </div>
                      )
                    }
                    // SINGLE-EVENT TICK — REMOVED. A non-recurring event is now drawn SOLELY by its
                    // morphing chip in the bar pass, which PERSISTS at rest collapsed (see `persistAsTick`)
                    // and already sits at this exact geometry (same width/height/top/colour/position). So
                    // there is no separate rail tick to render, hand off to, or swap with — killing the old
                    // ~2s chip→tick jump and making collapse/uncollapse one continuous morph either way. Its
                    // duties (open-on-click, glow, the shared glyph tooltip) moved onto the collapsed chip.
                    // Recurring series are still drawn as their downsampled dot row above; everything else
                    // (one-offs, scheduled spaces) is owned by the persistent chip, so render nothing here.
                    return null
                  })
                  .filter(Boolean)
              })}

            {/* COLLAPSED-RAIL TICK TOOLTIP — one shared floating tag showing the hovered
                entity's kind GLYPH + title, prefixed (glyph) as requested. Floats just
                above the rail, but FLIPS below it when the rail sits too close to the
                band's top edge (e.g. the first ribbon) so the ruler above doesn't crop
                it. pointer-events-none so it never interrupts the hover. */}
            {hoveredTick &&
              (() => {
                const flipBelow = hoveredTick.top < TOOLTIP_H + 2
                const tipTop = flipBelow ? hoveredTick.top + RAIL_H + 2 : hoveredTick.top - TOOLTIP_H
                return (
                  <div
                    className="pointer-events-none absolute z-40 flex max-w-[30vw] -translate-x-1/2 items-center gap-1 rounded border border-border/70 bg-card px-1.5 py-0.5 text-[9.5px] font-medium leading-none tracking-tight text-foreground/80 shadow-sm animate-in fade-in duration-150"
                    style={{ left: `${hoveredTick.leftPct}%`, top: tipTop }}
                  >
                    <span className="h-2.5 w-2.5 shrink-0" style={{ color: hoveredTick.color }}>
                      <NodeGlyph kind={hoveredTick.kind} filled strokeWidth={2} />
                    </span>
                    <span className="truncate">{hoveredTick.title}</span>
                  </div>
                )
              })()}

            {/* ribbon left LABELS — pinned to the gutter, painted AFTER the bars so a
                chip that reaches the left edge passes BEHIND the label, not over it.
                Solid opaque chip (no backdrop-blur): blur is imperceptible over the
                near-black timeline and is the costly GPU effect, so a crisp opaque tag
                is both cheaper and far more legible. */}
            {showRibbons &&
              lanes.ribbons.map((r) => {
                const blk = blockOfLane(r.baseLane)
                if (blk && !showExpanded(blk)) return null // folded — its mother rail-label is drawn below
                const fadeOp = blk ? expandedOpacity(blk) : 1
                const mId = blk?.m.motherId ?? null
                // The mother's LEAD lane (the mother space itself appearing as a lane)
                // would repeat the name already shown in the vertical mother column to
                // its left — visually redundant (e.g. "Day Job" lane label right next
                // to the vertical "Day Job"). Hide it at rest and reveal it only when
                // the pointer approaches: the button keeps its box and pointer-events
                // while transparent, so `hover:opacity-100` brings it back on approach.
                const isLeadDup = mId != null && r.spaceId === mId
                const bandTop = laneTop(r.baseLane) - 3
                const bandH = r.laneCount * laneH + (r.laneCount - 1) * laneGap + 6
                const related = atRootFocus || r.spaceId === contextId || isInSubtree(contextId, r.spaceId)
                const top = bandTop + bandH / 2
                // Lanes always just OPEN their space now ��� the fold control lives in the
                // rotated mother column to the left (rendered in the pass below). Lanes
                // inside a mother group shift right by MOTHER_COL_W to clear that column.
                return (
                  <button
                    key={`ribbon-label:${r.spaceId}`}
                    type="button"
                    onClick={() => r.spaceId !== "s_root" && open(r.spaceId)}
                    title={r.title}
                    className={cn(
                      "absolute z-20 flex max-w-[42%] items-center gap-1 rounded border border-border/70 bg-card px-1.5 py-0.5 text-[9.5px] font-medium leading-none tracking-tight text-foreground/80 shadow-sm transition-[opacity,colors,top,left] duration-300 ease-out animate-in fade-in hover:text-foreground",
                      isLeadDup && "opacity-0 hover:opacity-100",
                    )}
                    style={{
                      left: mId ? 4 + MOTHER_COL_W : 4,
                      top,
                      // EXPERIMENT 2: regular ribbon titles get the uniform entity scale too.
                      // The parent centering layer already applies `scaleY(condenseScale)` (the
                      // vertical squish); adding `scaleX(entityScaleX)` about the LEFT edge makes
                      // the label shrink UNIFORMLY (no vertical text squish) while staying pinned
                      // to the gutter (`transformOrigin: left` keeps `left` fixed instead of the
                      // label creeping inward as it scales). The rotated MOTHER column below gets
                      // none of this — it keeps its existing rules, as requested.
                      transform: `translateY(-50%) scaleX(${entityScaleX})`,
                      transformOrigin: "left center",
                      fontSize: 9.5,
                      // While condensing, `top` shifts every zoom frame — drop the class'
                      // 300ms transition so the label tracks the compressing lane live.
                      ...(condensing ? { transition: "none" } : {}),
                      // Lead duplicates are driven purely by the hover class above; everyone
                      // else uses the related/unrelated dimming (× the collapse crossfade).
                      ...(isLeadDup ? {} : { opacity: (related ? 1 : UNRELATED_OPACITY) * fadeOp }),
                    }}
                  >
                    <span className="h-2.5 w-2.5 shrink-0" style={{ color: r.color }}>
                      <NodeGlyph kind="space" filled strokeWidth={2} />
                    </span>
                    <span className="truncate">{r.title}</span>
                  </button>
                )
              })}

            {/* EXPANDED MOTHER COLUMN — the mother's title rotated 90° anticlockwise in a
                slim column at the FAR LEFT, vertically centered across all its lanes
                (e.g. a vertical "Day Job" sitting left of the Admin/Day Job lanes).
                Clicking the TITLE opens the space; a hover-revealed cluster at the top of
                the column holds the dedicated COLLAPSE (chevron) + HIDE (eye) controls.
                `rotate(-90deg)` makes the text read bottom→top (a true 90° CCW). */}
            {showRibbons &&
              layout.blocks.map((blk) => {
                const mId = blk.m.motherId
                if (!mId || !showExpanded(blk)) return null
                const rkExp = mId
                const related = atRootFocus || mId === contextId || isInSubtree(contextId, mId)
                // MORPH (not fade): this column is the SAME element through the collapse —
                // it stays opaque and framer tweens TOP + HEIGHT (blk.top/blk.height ↔ the
                // rail's y/RAIL_H) while its TITLE ROTATES between vertical (−90°, reading
                // bottom→top) and horizontal (0°). TOP must be animated (not just height):
                // collapsing reflows the whole stack so every block's top/offsetY jumps —
                // leaving top in plain style teleported the column and masked the morph.
                // top/height are CONSTANT during a normal zoom, so animating them adds no
                // zoom lag. We use an animatable `rotate` transform (not `writing-mode`,
                // which can't transition) — that's what lets the title spin smoothly.
                // The rail label is suppressed mid-morph so the two don't double up.
                // Title width = the column's ACTUAL rendered height (`blk.height`, the value
                // the column animates to) — NOT a lane-count estimate, which under-counted
                // the real height and truncated titles that easily fit ("Day Job" → "D…").
                // Modest floor (34px) so a short single-lane column shows a few letters but
                // long names DON'T bleed far past the column; genuinely-too-long titles get
                // an ellipsis. Rotated about CENTER it reads as a centered vertical label.
                const titleMax = Math.max(blk.height - 8, 34)
                const colHovered = hoveredMother === rkExp
                return (
                  <motion.div
                    key={`mcol:${mId}`}
                    onMouseEnter={() => {
                      if (draggingRef.current) return // don't highlight along a pan path
                      setHoveredMother(rkExp)
                    }}
                    onMouseLeave={() => setHoveredMother((h) => (h === rkExp ? null : h))}
                    initial={false}
                    animate={{
                      top: offsetY + blk.top,
                      height: blk.collapsed ? RAIL_H : blk.height,
                      opacity: related ? 1 : UNRELATED_OPACITY,
                    }}
                    transition={
                      zoomExpanding
                        ? { duration: 0 } // instant so the column matches titleMax ��� no title bleed
                        : blkAnimating(blk) || manualFolding
                          ? morphTween(blkAnimating(blk) || manualFolding, bandExpanding, blkAnimating(blk))
                          : { duration: restTopDur, ease: "easeOut" }
                    }
                    className="absolute z-20 overflow-visible rounded border border-border/70 bg-card text-[9.5px] font-semibold leading-none tracking-tight shadow-sm"
                    style={{ left: 4, width: MOTHER_COL_W - 4, color: blk.m.color, borderColor: `${blk.m.color}40` }}
                  >
                    {/* Clicking the TITLE opens the space (e.g. Day Job). It fills the column and
                        carries the vertical (−90°) label, faded out as the column shrinks (the
                        horizontal rail label crossfades in at the rail instead). The fixed
                        `width: titleMax` + `shrink-0` reserves the vertical room the rotated text
                        needs, so the full title lays out instead of truncating to the ~14px col. */}
                    <button
                      type="button"
                      onClick={() => openFromChip(mId)}
                      aria-label={`Open ${blk.m.title}`}
                      className="absolute inset-0 cursor-default rounded hover:brightness-125"
                    >
                      {/* The column lives inside the centering layer, which applies
                          `scaleY(condenseScaleVisual)` to compress lanes while zooming out. That
                          vertical squish distorts the rotated title (letters look horizontally
                          stretched/fat). Counter it on this wrapper — `scaleY(1/condenseScaleVisual)`
                          — so the parent squish and this exactly cancel (both axis-aligned, adjacent,
                          no rotation between them), leaving the title with ONLY its -90° rotation and
                          no distortion. At rest (scale 1) this is a no-op; clamp guards a tiny scale. */}
                      <span
                        className="pointer-events-none absolute inset-0 flex items-center justify-center"
                        style={{ transform: `scaleY(${1 / Math.max(condenseScaleVisual, 0.05)})` }}
                      >
                        <motion.span
                          className="block shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-center"
                          style={{ width: titleMax, rotate: "-90deg" }}
                          initial={false}
                          animate={{ opacity: blk.collapsed ? 0 : 1 }}
                          transition={{ duration: blk.collapsed ? 0.18 : 0.28, ease: "easeOut" }}
                        >
                          {blk.m.title}
                        </motion.span>
                      </span>
                    </button>
                    {/* Hover-revealed HIDE control (eye → 1px sliver) at the TOP of the column.
                        There's no collapse chevron anymore — clicking the ribbon body collapses
                        it to the thin rail. Shown only while the column (its title) is hovered so
                        the resting ribbon stays clean. Suppressed mid-morph: a click that started
                        the fold leaves `hoveredMother` set, which otherwise kept the eye visible
                        for the whole collapse/expand even though the column has shrunk/grown away
                        from the cursor (it then vanished abruptly when the hover finally cleared). */}
                    <div
                      className={cn(
                        "absolute inset-x-0 top-0 z-10 flex flex-col items-center rounded-t bg-card/95 py-0.5 transition-opacity",
                        colHovered && !blkAnimating(blk) ? "opacity-100" : "pointer-events-none opacity-0",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => hideMother(mId)}
                        aria-label={`Hide ${blk.m.title} lane`}
                        title={`Hide ${blk.m.title} lane`}
                        className="flex items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Eye className="h-3 w-3" strokeWidth={2.5} />
                      </button>
                    </div>
                  </motion.div>
                )
              })}

            {/* COLLAPSED RAIL LABELS — sit on the rail. When the user folded a single
                mother by hand it's the full control: a click-to-reopen title + an eye
                toggle for its rail ticks. When the ZOOM collapsed everything, expansion is
                zoom-controlled, so we show a lighter, non-interactive name tag (dot +
                title) — for grouped mothers AND the ungrouped root. Hover still brightens
                that rail's ticks. */}
            {showRibbons &&
              layout.blocks.map((blk) => {
                const mId = blk.m.motherId
                // Render the rail label THROUGH every fold — auto (zoom) and manual alike —
                // so it CROSSFADES with the column's vertical title identically in both cases:
                // it fades IN via `animate-in fade-in` on collapse (fresh mount) and OUT via the
                // reflow opacity on expand, mirroring the vertical title fading the opposite way.
                // (Previously suppressed during a zoom morph, which made auto-collapse look
                // different from manual — the title vanished with no label crossfade.)
                if (!showCollapsed(blk)) return null
                const rk = mId ?? `root:${blk.m.baseLane}`
                const labelOp = collapsedOpacity(blk)
                const hoverProps = {
                  onMouseEnter: () => {
                    if (draggingRef.current) return // don't highlight along a pan path
                    setHoveredMother(rk)
                  },
                  onMouseLeave: () => setHoveredMother((h) => (h === rk ? null : h)),
                }
                // These rail labels live INSIDE the centering plane (scaleY squish). Use the shared
                // collapsed-ribbon transform so the pill keeps true proportions AND un-bunched spacing
                // through the morph (see `collapsedXform`); the rail bar + ticks use it too. The label's
                // own `translateY(-50%)` (centering it on the rail) is passed as the prefix.
                const labelCenterY = offsetY + blk.top + blk.height / 2
                const wrapStyle = {
                  left: 4,
                  // Center on the block's own height: RAIL_H for a thin rail, the 1px sliver for
                  // a fully-hidden mother (so the title chip sits between its neighbours).
                  top: labelCenterY,
                  transform: collapsedXform(labelCenterY, "translateY(-50%)"),
                  opacity: labelOp,
                  // Slide the label with the reflow (a sibling rail label, e.g. Health,
                  // would otherwise JUMP to its new y while everything else glided).
                  transition: reflowTransition("top, opacity"),
                } as const
                // ZOOM-forced collapse (or the ungrouped root) → plain name tag. Keyed on
                // `!byUser` (not live `zoomCollapsed`) so the branch stays stable through
                // the un-collapse crossfade. Glyph prefixes the title on hover via the tag.
                if (!blk.byUser || !mId) {
                  return (
                    <div
                      key={`mlabel:${rk}`}
                      className="pointer-events-none absolute z-20 flex max-w-[36vw] items-center gap-1 rounded border border-border/70 bg-card px-1.5 py-0.5 text-[9.5px] font-medium leading-none tracking-tight text-foreground/70 shadow-sm animate-in fade-in duration-300"
                      style={wrapStyle}
                    >
                      <span className="h-2.5 w-2.5 shrink-0" style={{ color: blk.m.color }}>
                        <NodeGlyph kind="space" filled strokeWidth={2} />
                      </span>
                      <span className="truncate">{blk.m.title}</span>
                    </div>
                  )
                }
                // Manual-collapsed (thin rail) OR fully hidden.
                const hidden = blk.hidden
                // The TITLE chip (dot + name) opens the space. The HIDE eye shows ONLY while the
                // title is hovered (`hoveredTitleId`) — never on plain rail hover. There's no
                // collapse/expand chevron anymore: clicking the thin rail or the 1px lane reopens.
                const titleBtn = (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      openFromChip(mId)
                    }}
                    aria-label={`Open ${blk.m.title}`}
                    className="flex max-w-[36vw] items-center gap-1 rounded border border-border/70 bg-card px-1.5 py-0.5 text-[9.5px] font-medium leading-none tracking-tight text-foreground/70 shadow-sm transition-colors hover:text-foreground"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: blk.m.color }} aria-hidden />
                    <span className="truncate">{blk.m.title}</span>
                  </button>
                )
                // HIDDEN: at rest only the 1px colored sliver shows; hovering the lane reveals the
                // title (no eye, no chevron). The wrapper is a transparent hover-catcher sized to
                // the block+gap (~7px) so adjacent catchers TILE without overlap; CLICKING it
                // reopens the whole ribbon (the inner title button stops propagation so it opens
                // the space instead). The chip is a DOM descendant so moving onto the (taller)
                // revealed chip keeps the catcher hovered.
                if (hidden) {
                  const revealed = hoveredMother === rk || blkAnimating(blk)
                  return (
                    <div
                      key={`mlabel:${rk}`}
                      className="absolute z-20 flex cursor-default items-center"
                      style={{
                        left: 4,
                        top: labelCenterY,
                        height: blk.height + MOTHER_GAP,
                        transform: collapsedXform(labelCenterY, "translateY(-50%)"),
                        transition: reflowTransition("top"),
                      }}
                      onClick={() => expandMother(mId)}
                      aria-label={`Expand ${blk.m.title}`}
                      {...hoverProps}
                    >
                      <div className={cn("flex items-center transition-opacity duration-200", revealed ? "opacity-100" : "pointer-events-none opacity-0")}>
                        {titleBtn}
                      </div>
                    </div>
                  )
                }
                // COLLAPSED-THIN: title always visible; the eye fades in on title hover. Gated on
                // `!blkAnimating` so a stale hover from the click that triggered the fold can't keep
                // the eye flashing through the whole collapse/expand morph.
                const titleHovered = hoveredTitleId === mId && !blkAnimating(blk)
                return (
                  <div key={`mlabel:${rk}`} className="absolute z-20 flex items-center gap-1 animate-in fade-in duration-300" style={wrapStyle} {...hoverProps}>
                    <div
                      className="flex items-center gap-1"
                      onMouseEnter={() => setHoveredTitleId(mId)}
                      onMouseLeave={() => setHoveredTitleId((h) => (h === mId ? null : h))}
                    >
                      {titleBtn}
                      <span className={cn("transition-opacity duration-200", titleHovered ? "opacity-100" : "pointer-events-none opacity-0")}>
                        <button
                          type="button"
                          onClick={() => hideMother(mId)}
                          title="Hide lane"
                          aria-label={`Hide ${blk.m.title} lane`}
                          className="flex items-center justify-center rounded border border-border/70 bg-card p-0.5 text-foreground/60 shadow-sm transition-colors hover:text-foreground"
                        >
                          <Eye className="h-2.5 w-2.5" aria-hidden />
                        </button>
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
            {/* end centering layer */}
          </div>

          <button
            type="button"
            onClick={() => panBy(1)}
            aria-label="Pan later"
            className="flex w-10 shrink-0 items-center justify-center border-y border-border text-muted-foreground/70 transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </section>
  )
}
