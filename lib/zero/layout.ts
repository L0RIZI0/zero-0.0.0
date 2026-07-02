import type { ActiveEntity } from "./nav-store"

/**
 * Shared geometry for the work surface. Each entity renders its own body
 * (title band + dock + inputs/do-list/outputs) inside its window frame, so
 * there is no longer a separate frontmost layer to keep aligned. What remains
 * here is the depth-driven chrome: how the header bar and the persistent
 * timeline compact and lift as the user dives deeper.
 */

/**
 * The "shell stage" — how compact the chrome (header bar + timeline lift)
 * becomes as the user dives deeper. The whole interface reacts to depth:
 *
 *   stage 0  root (Space 0)      — everything full size, timeline rests low
 *   stage 1  first child open    — timeline slides up toward the header bar
 *   stage 2  second child (+)     — timeline lifts further AND the header bar
 *                                   compacts (avatar shrinks, handle drops,
 *                                   search collapses to its icon, logo shrinks)
 *
 * Depth 3 and beyond reuse stage 2 — no further push-up, for now.
 */
export type ShellStage = 0 | 1 | 2

export function shellStageFor(entity: ActiveEntity): ShellStage {
  // Re-enabled. Depth drives the chrome compaction:
  //   depth 0 (home)        → stage 0  (everything full size)
  //   depth 1 (first child) → stage 1  (timeline lifts toward the header)
  //   depth 2+ (deeper)     → stage 2  (timeline lifts more + header compacts)
  // This is now safe because BOTH treatments are non-reflowing: the timeline lift
  // is a `transform` (no layout impact) and the header keeps a constant box height
  // while only its CONTENTS shrink — so the focus-window region's box never moves
  // and the fixed-window geometry stays pinned to a stable rect through the morph.
  return Math.min(entity.depth, 2) as ShellStage
}

/** Vertical TRANSFORM (translateY) applied to the timeline as the shell compacts,
 *  so it slides up toward (and slightly into) the header bar with each level of
 *  depth: a little at stage 1, more at stage 2.
 *
 *  Crucially this is a `transform`, NOT a margin: it has ZERO layout impact, so
 *  the focus-window region directly below keeps its exact box. That stability is
 *  what makes the lift safe — the earlier margin-based version moved the region
 *  (whose rect anchors every fixed window) mid-morph, so the home backdrop and
 *  freshly-opened windows visibly jumped. The vacated space below the lifted
 *  strip is just more `bg-background` (same color), so no seam shows; and the
 *  WorkSurface card no longer clips its top, so the strip can ride up into the
 *  header's empty area without being cropped. */
export const TIMELINE_LIFT_Y: Record<ShellStage, number> = {
  0: 0,
  1: -32,
  2: -66,
}

/* --- Header bar height (depth-responsive) -----------------------------------
 * The top bar's box height. At rest (stage 0/1) it is HEADER_H; at stage 2
 * (depth ≥ 2) it shrinks to HEADER_H_COMPACT so the whole chrome tightens: the
 * avatar/handle/search/logo were already compacting their CONTENTS, and now the
 * BOX shrinks too, pulling the Dayline (the next row in the out-of-flow overlay)
 * up with it. This is safe because the header lives in the ABSOLUTE overlay and
 * the window region's inset is the CONSTANT `HEADER_OVERLAY_H` — so shrinking the
 * header never moves the region rect. The reclaimed HEADER_SHRINK px is handed to
 * the windows via WINDOW_TOP_LIFT below. */
export const HEADER_H = 64
export const HEADER_H_COMPACT = 44
/** Px reclaimed at the top when the bar compacts at stage 2. */
export const HEADER_SHRINK = HEADER_H - HEADER_H_COMPACT

/** How much the open windows grow UPWARD as the shell compacts.
 *
 *  At stage 2 (depth ≥ 2) the header bar shrinks vertically (HEADER_H → HEADER_H_COMPACT)
 *  and the Dayline rises with it, freeing HEADER_SHRINK px at the top. We lift the window
 *  region up by that SAME amount so open windows stay flush just below the risen Dayline —
 *  i.e. the home View expands upward into the reclaimed space.
 *
 *  WHY THIS IS MORPH-SAFE (unlike the old margin-based timeline lift): the region's own
 *  box never moves — its `marginTop` is the CONSTANT `HEADER_OVERLAY_H`. This lift is
 *  applied purely in `styleFor` (nav-store), which offsets each fixed window's `top` from
 *  the (stable) region rect. The offset is baked into the committed geometry the Flip
 *  morph animates toward, so windows glide up as one with the morph — no rect jump. */
export const WINDOW_TOP_LIFT: Record<ShellStage, number> = {
  0: 0,
  1: 0,
  2: HEADER_SHRINK,
}

/** Height of an open window's header band (glyph + title + close). Held constant
 *  across depth (the header compacts its CONTENTS, not its box — see HEADER_PAD_Y),
 *  so the timeline overlay can be positioned at a stable `headerBottom` offset
 *  below the app bar when a window is open. Measured from the live layout. */
export const HEADER_BAND_H = 60

/** Resting top margin of the timeline (constant — the depth response is the
 *  transform above, which doesn't reflow). */
export const TIMELINE_TOP_PAD = 2

/** Vertical padding of the header bar. At stage 2 the bar shrinks its BOX
 *  (HEADER_H → HEADER_H_COMPACT) and tightens this padding so the compacted
 *  avatar/logo still sit centered in the shorter bar. Because the header lives in
 *  the absolute overlay (and the region inset is the constant HEADER_OVERLAY_H),
 *  the box shrink pulls the Dayline up but never moves the window region rect. */
export const HEADER_PAD_Y = 14
export const HEADER_PAD_Y_COMPACT = 10

/* --- Header overlay sizing --------------------------------------------------
 * entity0's frame is full-bleed (touches all 4 screen edges); the chrome lives
 * in an absolute z-overlay ON TOP of it. The overlay is a vertical stack of two
 * constant-height rows: the top bar (avatar+handle / date+time / version+search+
 * logo) and the Individual's Dayline insight row beneath it. The focus-window
 * STAGE region is inset from the screen top by the overlay's total height, so
 * child windows + the home View open BELOW the header exactly as before — the
 * morph geometry is unchanged. Both heights are CONSTANT (matching the existing
 * fixed-box / transform-only compaction philosophy) so the stage rect never moves.
 * NOTE: HEADER_H (and its stage-2 shrink) is defined earlier, above WINDOW_TOP_LIFT.
 */
/** The Individual's Dayline insight row height (second header row). */
export const DAYLINE_ROW_H = 34
/** Total header-overlay height = the stage region's top inset. */
export const HEADER_OVERLAY_H = HEADER_H + DAYLINE_ROW_H

/* --- Timeline (Lifelane) sizing ---------------------------------------------
 * The Lifelane rests over the top ~1/3 of the card as its centered zone; the
 * band itself simply hugs its content/MAX height. These fractions are multiplied
 * by the live card height in WorkSurface to size the centered zone. */
export const TIMELINE_LIFELANE_MIN_FRAC = 0.33
