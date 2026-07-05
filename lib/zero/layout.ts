/**
 * Shared geometry for the work surface. Each entity renders its own body
 * (title band + dock + inputs/do-list/outputs) inside its window frame, so
 * there is no longer a separate frontmost layer to keep aligned.
 *
 * entity0 (the home / Individual) is now a plain full-bleed depth-0 backdrop in
 * the recursive ancestor model: its chrome (the header bar + Dayline overlay) is
 * CONSTANT height and no longer compacts on dive. Children always stick to
 * entity0's fixed real View top, so there is no depth-driven header shrink or
 * window lift — the old "shell stage" compaction machinery has been removed.
 */

/** Vertical TRANSFORM (translateY) that WOULD slide the timeline up toward the
 *  header as the user dives (a little at depth 1, more at depth 2+). Currently
 *  DORMANT — the depth-driven timeline lift is disabled — but kept as the restore
 *  path for that behavior. Indexed by clamped depth (0 | 1 | 2+). Realized as a
 *  `transform` (zero layout impact) if re-enabled, so the region rect never moves. */
export const TIMELINE_LIFT_Y: Record<0 | 1 | 2, number> = {
  0: 0,
  1: -32,
  2: -66,
}

/* --- Header bar height (CONSTANT) --------------------------------------------
 * The top bar's box height. entity0's header no longer compacts on dive, so this
 * is a single constant. The header lives in the ABSOLUTE overlay and the window
 * region's inset is `HEADER_OVERLAY_H`, so the bar sits above the stage region. */
export const HEADER_H = 64

/* --- View padding (the gutter around every open window) ----------------------
 * The View (`[data-view]` in entity-body) insets its region stack by this much so
 * no region (chiefly the Dock) kisses the window/screen edge. The SAME inset also
 * defines how an opened child window is framed: a window spans its parent View
 * MINUS this padding (applied in nav-store `styleFor`), so every open window sits
 * inside the parent's View content box rather than covering the full region
 * edge-to-edge. Single source of truth for both places.
 *   top: 0 (windows stay flush under the Dayline), left/right: VIEW_PAD_X, bottom.
 *
 * Set to 48 to MATCH the rail width (PANEL_RAIL_W / TASK_SIDE / RIGHT_PEEK = 48):
 * because a depth-1 window insets by this (WINDOW_BASE_SIDE), it is ALSO the width
 * of home's (entity0's) exposed left/right peek. Making it 48 means home's peek is
 * the SAME width as every deeper ancestor's peek (which reserve TASK_SIDE/RIGHT_PEEK
 * = 48), so the rule "same peek width at every depth for every ancestor" holds at
 * depth 0 too — home's rail is no longer narrower than the ancestors'.
 */
export const VIEW_PAD_X = 48
export const VIEW_PAD_TOP = 0
export const VIEW_PAD_BOTTOM = 22

/** Height of an open window's header band (glyph + title + close). Held constant
 *  across depth, so the timeline overlay can be positioned at a stable
 *  `headerBottom` offset below the app bar when a window is open. */
export const HEADER_BAND_H = 60

/** Resting top margin of the timeline. */
export const TIMELINE_TOP_PAD = 2

/** Vertical padding of the header bar (constant). */
export const HEADER_PAD_Y = 14

/* --- Header overlay sizing --------------------------------------------------
 * entity0's frame is full-bleed (touches all 4 screen edges); the chrome lives
 * in an absolute z-overlay ON TOP of it. The overlay is a vertical stack of two
 * constant-height rows: the top bar (avatar+handle / date+time / version+search+
 * logo) and the Individual's Dayline insight row beneath it. The focus-window
 * STAGE region is inset from the screen top by the overlay's total height, so
 * child windows + the home View open BELOW the header. Both heights are CONSTANT
 * so the stage rect never moves as the user dives. */
/** The Individual's Dayline insight row height (second header row). */
export const DAYLINE_ROW_H = 34
/** Total header-overlay height = the stage region's top inset. */
export const HEADER_OVERLAY_H = HEADER_H + DAYLINE_ROW_H

/* --- Timeline (Lifelane) sizing ---------------------------------------------
 * The Lifelane rests over the top ~1/3 of the card as its centered zone; the
 * band itself simply hugs its content/MAX height. These fractions are multiplied
 * by the live card height in WorkSurface to size the centered zone. */
export const TIMELINE_LIFELANE_MIN_FRAC = 0.33
