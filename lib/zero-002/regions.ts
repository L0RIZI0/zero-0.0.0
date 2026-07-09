/**
 * REGION MODEL — the layout layer that sits between an Entity and its Components.
 *
 * Every entity renders its CONTENT (a VIEW — the window MINUS the chrome: title,
 * glyph, window/close buttons, IO rails, metadata) as a vertical stack of REGIONS.
 * A region is an INVISIBLE frame: no border, no background, content bleeds freely.
 * Its only job is to organize and size the COMPONENTS stacked inside it (components
 * align center-top, in order of addition). Regions stack vertically, TOP → BOTTOM.
 *
 * The DEFAULT view of every Space is three regions:
 *
 *   • REGION 0 — HUG — hosts the `lifelane` (timeline). Sizes to the band's height
 *     at the very TOP of the view. Rendered on HOME only for now (the root
 *     Organism's Lifeline); other entities omit it, so their stack starts at
 *     region 1.
 *   • REGION 1 — FILL — hosts the `do-list` (its rows + the create-input). Takes
 *     the leftover vertical space BETWEEN region 0 and region 2.
 *   • REGION 2 — HUG — hosts the `dock`. Sizes to the dock's height at the BOTTOM
 *     of the view, and is present ONLY when the entity has pinned items. When it
 *     appears it reserves real flow space and pushes region 1 UP (region 1 shrinks
 *     to the gap between regions 0 and 2) — it is NOT an overlay.
 *
 * Entity 0 (home) is the opened window of the root ORGANISM (the Individual
 * "Loris", animated by a Soul); its region 0 hosts that Organism's LIFELINE — the
 * canonical master timeline its Events, Instants and scheduled work project onto.
 * The add/remove-component interaction that will let any entity gain or drop
 * regions/components (e.g. via right-click on blank window space) is NOT built yet;
 * this is the structural foundation it will plug into. (Every Individual and
 * Organism will own a Lifeline; today only entity 0's is rendered.)
 */

/** How a region sizes vertically within the entity's content area. */
export type RegionGrow = "fill" | "hug"

/** Which component a region hosts. Extend as more component types are added.
 *  `lifelane` is the Lifeline's linear master-timeline strip (region 0, home only);
 *  `do-list` is the rows + create-input (region 1); `dock` is the pinned-items bar
 *  (region 2, only when the entity has pins). */
export type RegionComponent = "lifelane" | "do-list" | "dock"

export interface RegionSpec {
  /** Stable id (also used as the React key when rendering the stack). */
  id: string
  grow: RegionGrow
  component: RegionComponent
}

/** Region 1 — the always-present do-list region that fills the space between the
 *  (home-only) timeline above and the (conditional) dock below. */
export const DO_LIST_REGION: RegionSpec = { id: "region-1-do-list", grow: "fill", component: "do-list" }
/** Region 2 — the dock region at the bottom (hug). EntityBody renders it only when
 *  the entity has pinned items, but it always occupies this slot in the stack. */
export const DOCK_REGION: RegionSpec = { id: "region-2-dock", grow: "hug", component: "dock" }
/** Region 0 — the home-only timeline region at the top (hug). */
export const LIFELANE_REGION: RegionSpec = { id: "region-0-lifelane", grow: "hug", component: "lifelane" }

/**
 * The ordered region stack for an entity, TOP → BOTTOM:
 *   home → [lifelane (hug), do-list (fill), dock (hug)]
 *   other → [do-list (fill), dock (hug)]
 * The dock slot is always listed; EntityBody mounts its content only when the
 * entity has pinned items (an empty dock region collapses to 0 height).
 */
export function entityRegions(isRoot: boolean): RegionSpec[] {
  return isRoot ? [LIFELANE_REGION, DO_LIST_REGION, DOCK_REGION] : [DO_LIST_REGION, DOCK_REGION]
}
