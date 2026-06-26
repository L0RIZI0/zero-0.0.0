/**
 * REGION MODEL — the layout layer that sits between an Entity and its Components.
 *
 * Every entity renders its content (the window MINUS the header) as one or more
 * REGIONS. A region is an INVISIBLE frame: no border, no background, content
 * bleeds freely. Its only job is to organize and size the components stacked
 * inside an entity. Regions stack vertically, TOP to BOTTOM:
 *
 *   • REGION 0 is always present and hosts the entity's default component — the
 *     do-list. It GROWS to fill the leftover vertical space, so its component
 *     centers in the visual middle of whatever room remains.
 *   • ADDITIONAL regions stack ABOVE region 0 and HUG their component's height.
 *     When such a component grows taller, its region grows with it and pushes
 *     region 0 (and anything below) down the screen.
 *
 * The DOCK is deliberately NOT a region: it is a single element pinned to the
 * BOTTOM of the entity window, overlaying the regions beneath it (z-order), and
 * shown only when the entity has pinned items.
 *
 * For now only ENTITY 0 (home) carries a second region — the master timeline,
 * region 1, sitting above region 0. The add/remove-component interaction that
 * will let any entity gain or drop regions (e.g. via right-click on blank window
 * space) is NOT built yet; this is the structural foundation it will plug into.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * CURRENT STATUS (interim — this is the INTENDED model, not yet the live one):
 * The hug/fill push-down model above is the TARGET we mean to return to. Right
 * now WorkSurface renders the timeline as an ABSOLUTE OVERLAY (z-30) whose `top`
 * animates, and EntityBody reserves its slot via a measured `--region1-reserve`
 * CSS var — a visual shortcut that AVOIDS the real region stack. The overlay is
 * considered too unstructured to keep long-term. This file's RegionSpec shape is
 * still the source of truth for "does entity 0 have a timeline region" (consumed
 * by WorkSurface as a boolean) and is kept whole as the scaffold to migrate back
 * onto: replace the overlay with an actual hug Region that pushes region 0 down.
 */

/** How a region sizes vertically within the entity's content area. */
export type RegionGrow = "fill" | "hug"

/** Which component a region hosts. Extend as more component types are added. */
export type RegionComponent = "do-list" | "timeline"

export interface RegionSpec {
  /** Stable id (also used as the React key when rendering the stack). */
  id: string
  grow: RegionGrow
  component: RegionComponent
}

/** Region 0 — the always-present do-list region that fills the leftover space. */
export const REGION_0: RegionSpec = { id: "region-0", grow: "fill", component: "do-list" }

/**
 * The ordered region stack for an entity, TOP → BOTTOM. Region 0 is always the
 * LAST entry (bottom, fill); any hug regions precede it. Entity 0 gets the master
 * timeline as region 1 above region 0; every other entity has only region 0 for
 * now.
 */
export function entityRegions(isRoot: boolean): RegionSpec[] {
  if (isRoot) {
    return [{ id: "region-1-timeline", grow: "hug", component: "timeline" }, REGION_0]
  }
  return [REGION_0]
}
