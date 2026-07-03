"use client"

import type { ReactNode } from "react"
import { motion } from "motion/react"
import { panelSlideTransition } from "@/lib/zero/motion"
import { getPinnedItems } from "@/lib/zero/data"
import { usePanelOpen } from "@/lib/zero/panel-store"
import { useZeroNav } from "@/lib/zero/nav-store"
import { Region } from "./region"
import { Dock } from "./dock"
import { DoList } from "./do-list"
import { AssetPanel } from "./asset-panel"
import { getEntityResourceCount } from "@/lib/zero/resources"
import { OutputPanel } from "./output-panel"
import { CollapsibleColumn } from "./collapsible-column"
import { ResourceCanvas } from "./resource-canvas"
import { DebugFrameLabel, DebugComponentFrame } from "./debug-frame-label"
import { useDebugView } from "@/lib/zero/debug-view"
import { cn } from "@/lib/utils"

/** Width of a side panel when OPEN, and of the thin RAIL when collapsed. */
const PANEL_OPEN_W = 230
const PANEL_RAIL_W = 48
/** Base horizontal inset of the View (left/right breathing room, 42px). */
const VIEW_PAD_X = 42
/** How far the View is squeezed IN from a side when that side's panel is open: the
 *  full panel footprint (rail + panel), so the content sits flush beside the panel's
 *  inner edge instead of being overlaid by it. Closed → back to VIEW_PAD_X. */
const PANEL_SQUEEZE_W = PANEL_RAIL_W + PANEL_OPEN_W


/**
 * An entity's working surface: its Tasks do-list + Dock (center), with the
 * Inputs / Outputs side panels OVERLAID on the left/right edges.
 *
 * Panels are an absolute overlay anchored to the FRAME's vertical center, not to
 * the body. `entity-node` measures the only thing that varies — the in-flow
 * header — and hands us `--rail-center-shift` (0 for floating/space headers,
 * `-headerH/2` for in-flow task/event headers). The overlay sits at
 * `calc(50% + var(--rail-center-shift))`, so the rails land on the true middle of
 * the window's left/right edges at ANY depth, and never jump when a child opens
 * and this window's ancestor rank (and header height) changes.
 *
 * Open panels OVERLAY the content — they do not reflow the center column — so the
 * do-list stays perfectly still whether the panels are open, closed, or mid-
 * animation. Panel state lives in the reactive panel-store so it survives the
 * remounts that happen as windows open/close, and so the nav layer can fold it.
 */
export function EntityBody({
  entityId,
  active = true,
  isRoot = false,
  closing = false,
  centerList = true,
  railShift = 0,
  railBleedLeft = PANEL_RAIL_W,
  railBleedRight = PANEL_RAIL_W,
  panelTopOffset = 0,
  surface,
  resource,
  timeline,
}: {
  entityId: string
  active?: boolean
  /** Region-0 content (the home Lifeline timeline). Provided ONLY for the home view;
   *  when present, EntityBody renders it as the top HUG region above the do-list.
   *  Omitted for every child entity, so their stack starts at the do-list region. */
  timeline?: ReactNode
  /** When set, this is a RESOURCE TASK: the center surface is the bound web
   *  resource (live embed or illustrative stand-in) instead of the do-list/Dock.
   *  The Inputs/Outputs rails still render — a resource is work whose outputs wire
   *  into the Task's Outputs. `url` is the page to open; `resourceId` selects the
   *  catalog entry (branding + embed behavior). */
  resource?: { url: string; resourceId?: string }
  /** Forwarded to the DoList so it can keep its scroller clipped during this
   *  window's close morph (prevents the ADD row jumping up over the title). */
  closing?: boolean
  /** Vertical px offset that re-centers the rails on the FRAME center (0 when the
   *  body fills the frame; −headerH/2 for an in-flow header). ANIMATED, so the
   *  rails slide as a window's header changes (e.g. ancestor → spine). */
  railShift?: number
  /** Collapsed-rail width per side = the visible bleed strip of this window once a
   *  child covers it, so the rail centers within that sliver instead of clipping at
   *  the frame edge. Defaults to the full rail (leaf / home root, uncovered). */
  railBleedLeft?: number
  railBleedRight?: number
  /** Px to push the panel/rail box top DOWN from the body's top so it starts at the
   *  VISUAL header bottom (spanning header-bottom → window-bottom). 0 wherever the body
   *  already starts at the header bottom (home view, in-flow-header child); = headerH
   *  only for a FLOATING-header window whose body fills from the window top. */
  panelTopOffset?: number
  /** The window's background colour — the opaque panel uses it so it reads as the
   *  window surface sliding over the View. Falls back to the theme background. */
  surface?: string
  /** Vertically center the do-list within its column (forwarded to DoList). */
  centerList?: boolean
  /** The always-mounted home view. Its body has no in-flow header, so its rails
   *  center on the region directly (`--rail-center-shift` defaults to 0). Kept as
   *  a flag only to widen the central reading measure on the home view. */
  isRoot?: boolean
}) {
  // The rail's "RESOURCES (n)" counter reflects the resources this entity actually HOLDS
  // (entity0's world inputs; a child's imported/added resources) — model-driven, so a
  // child with no holdings reads (0).
  const assetCount = getEntityResourceCount(entityId)
  const [inOpen, setInOpen] = usePanelOpen(`${entityId}:in`, false)
  const [outOpen, setOutOpen] = usePanelOpen(`${entityId}:out`, false)
  // SQUEEZE: an open side panel pushes the View content inward on that side (instead
  // of overlaying it), so the do-list/resource narrows and shifts toward center. The
  // padding is animated on the shared panel-slide curve so content glides aside exactly
  // as the panel glides in. This is a one-shot layout animation on toggle (not part of
  // the dive morph), so its reflow cost is minor and localized.
  const padLeft = inOpen ? PANEL_SQUEEZE_W : VIEW_PAD_X
  const padRight = outOpen ? PANEL_SQUEEZE_W : VIEW_PAD_X
  // Region 2 (dock) is mounted ONLY when this context has pinned items, so an empty
  // entity's do-list region fills the whole view. Same source the Dock reads, so they
  // agree. `dataVersion` makes this reactive to pin add/remove.
  const { dataVersion } = useZeroNav()
  void dataVersion
  const hasPins = getPinnedItems(entityId).length > 0

  // [v0] DEBUG: short identity prefix for the frame labels. entity0 (the always-mounted
  // home / Individual) reads "ent0"; any other opened entity uses its id. Remove with
  // the debug borders.
  const dbg = isRoot ? "ent0" : entityId
  // [v0] DEBUG: colored frames + labels gated on the shared `§ 2` toggle.
  const { frames: showFrames } = useDebugView()

  return (
    // Unpadded root: fills [data-body] EXACTLY and is the offset parent for the
    // panel overlays, so a panel's `top: 50%` resolves to the body's true vertical
    // center. The reading padding lives on the inner center column instead, so it
    // never skews where the rails sit.
    // `pointer-events-none`: the body root is transparent to events and each
    // interactive LEAF re-enables `pointer-events-auto` (region 0 timeline, do-list
    // content, resource canvas, Dock, side panels). This keeps the empty gaps between
    // regions click/scroll-through while the chrome stays fully interactive, and lets
    // the overlaid side-panel rails sit over the content without stealing its events.
    <div data-body className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
      {/* RESOURCE TASK: the center surface is the bound web resource, filling the
          rectangular Task window almost edge-to-edge (a slim inset keeps it clear of
          the Inputs/Outputs rails). The do-list/Dock are skipped entirely — this is
          Zero acting as a contextual browser. */}
      {resource ? (
        <motion.div
          className="pointer-events-auto flex min-h-0 min-w-0 flex-1 flex-col pb-3 pt-2"
          initial={false}
          animate={{ paddingLeft: padLeft, paddingRight: padRight }}
          transition={panelSlideTransition}
        >
          <ResourceCanvas id={entityId} url={resource.url} resourceId={resource.resourceId} active={active} />
        </motion.div>
      ) : (
        // VIEW PADDING — a uniform inset around the whole region stack so no region
        // can touch the window/screen edge (chiefly: the Dock never kisses the bottom
        // edge). Lives on this inner wrapper, NOT on `[data-body]`: the body root must
        // stay full-bleed because it's both the side-panel rails' offset parent and
        // the Flip morph's target box. Asymmetric inset: 0 top, 42px left/right
        // (VIEW_PAD_X, animated for panel squeeze), 21px bottom (pb-[21px]).
        // [v0] DEBUG: purple border = the View area (the region stack's footprint).
        <motion.div
          data-view
          className={cn("relative flex min-h-0 flex-1 flex-col pt-0 pb-[21px]", showFrames && "border border-purple-500")}
          initial={false}
          animate={{ paddingLeft: padLeft, paddingRight: padRight }}
          transition={panelSlideTransition}
        >
          {/* [v0] DEBUG: View label in the BOTTOM-left corner so it never collides with
              region 0's top-left label. The View is the full region stack: it fills its
              parent both ways and carries the uniform p-3 inset. */}
          {showFrames && (
            <DebugFrameLabel
              name={`${dbg}·view`}
              info="stack · h:fill v:fill · pad:0/42/21/42"
              className="bottom-0.5 left-0.5 top-auto text-purple-500"
            />
          )}
      {/* REGION 0 (hug) — the home Lifeline timeline, at the very TOP of the view.
          Rendered ONLY when `timeline` is provided (home view); child entities omit
          it, so their stack starts at region 1. `pointer-events-auto` so wheel-zoom
          works while hovering the timeline/its region (the body root is pointer-
          transparent). */}
      {timeline ? (
        <Region grow="hug" className="pointer-events-auto pt-2" debugName={`${dbg}·reg0`} debugRole="lifelane">
          {/* Full-bleed: the timeline fills the ENTIRE horizontal space of region 0
              (no `max-w` cap and no side padding, unlike regions 1/2 which stay capped
              + centered for a comfortable reading measure). Only the view's `p-3` inset
              keeps it off the screen edge. */}
          <DebugComponentFrame name={`${dbg}·lifelane`} info="component · timeline" className="w-full">
            {timeline}
          </DebugComponentFrame>
        </Region>
      ) : null}

      {/* REGION 1 (fill) — the do-list (rows + create-input). Takes the leftover height
          BETWEEN region 0 and region 2 and centers the do-list in it. The side panels
          overlay it rather than stealing its space, so it never moves. Pointer-
          transparent box (the body root is none); the inner do-list re-enables events. */}
      <Region
        grow="fill"
        className="min-h-[180px] min-w-0 items-center px-6 pb-5 pt-4"
        debugName={`${dbg}·reg1`}
        debugRole="do-list"
      >
        <div className={cn("flex min-h-0 w-full flex-1 flex-col", isRoot ? "max-w-[70vw]" : "max-w-[720px]")}>
          {/* Do-list narrowed to 2/3 of the measure and centered for a tighter list,
              but capped at `max-w-2xl` (672px) so it never stretches into an
              uncomfortably wide measure on large/ultrawide monitors — on narrower
              screens the 2/3 width wins, on wide ones the cap does.
              `pointer-events-auto` re-enables interaction on the list itself. */}
          <DebugComponentFrame
            name={`${dbg}·do-list`}
            info="component · rows + input"
            className="pointer-events-auto flex min-h-0 w-2/3 max-w-2xl flex-1 flex-col self-center"
          >
            <DoList contextId={entityId} active={active} closing={closing} centered={centerList} />
          </DebugComponentFrame>
        </div>
      </Region>

      {/* REGION 2 (hug) — the Dock at the BOTTOM. Mounted ONLY when the context has
          pinned items, so it reserves real flow space and pushes region 1 up when it
          appears (region 1 shrinks to the gap above it). The Dock slides into this
          reserved slot via its own transform entrance. */}
      {hasPins ? (
        <Region grow="hug" className="px-6" debugName={`${dbg}·reg2`} debugRole="dock">
          <DebugComponentFrame
            name={`${dbg}·dock`}
            info="component · pins"
            className={cn("mx-auto w-full", isRoot ? "max-w-[70vw]" : "max-w-[720px]")}
          >
            <Dock contextId={entityId} active={active} />
          </DebugComponentFrame>
        </Region>
      ) : null}
        </motion.div>
      )}

      {/* RESOURCES — stuff that goes IN (money, assets, apps, files…). Persistent
          shortcut on the LEFT edge; the opaque panel slides in over the View. */}
      <PanelSlot side="left" open={inOpen} shift={railShift} bleed={railBleedLeft} topOffset={panelTopOffset}>
        {(railWidth, panelWidth, railScale, shift) => (
          <CollapsibleColumn
            title="Resources"
            collapsedTitle="Resources"
            side="left"
            count={assetCount}
            open={inOpen}
            onOpenChange={setInOpen}
            focused={active}
            railWidth={railWidth}
            panelWidth={panelWidth}
            railScale={railScale}
            railShift={shift}
            surface={surface}
          >
            {/* PEEK: when this panel is OPEN but its entity is no longer the focused
                front view (a child opened → `!active`), the resources collapse into
                small filled losanges on the left peek. `railWidth` is the peek strip
                width they center on. If the panel was closed, AssetPanel isn't mounted,
                so nothing changes. */}
            <AssetPanel spaceId={entityId} peek={inOpen && !active} railWidth={railWidth} />
          </CollapsibleColumn>
        )}
      </PanelSlot>

      {/* PUBLISHED — stuff that goes OUT (publications, output, results). Mirror of
          Assets on the RIGHT edge. */}
      <PanelSlot side="right" open={outOpen} shift={railShift} bleed={railBleedRight} topOffset={panelTopOffset}>
        {(railWidth, panelWidth, railScale, shift) => (
          <CollapsibleColumn
            title="Published"
            collapsedTitle="Published"
            side="right"
            count={0}
            open={outOpen}
            onOpenChange={setOutOpen}
            focused={active}
            railWidth={railWidth}
            panelWidth={panelWidth}
            railScale={railScale}
            railShift={shift}
            surface={surface}
          >
            {/* Mirror of AssetPanel on the right peek. `panelWidth` is needed so a
                publication losange can be offset onto the RIGHT edge strip. */}
            <OutputPanel
              spaceId={entityId}
              peek={outOpen && !active}
              railWidth={railWidth}
              panelWidth={panelWidth}
            />
          </CollapsibleColumn>
        )}
      </PanelSlot>
    </div>
  )
}

/**
 * Absolute overlay for one side panel, pinned to the window's left/right edge.
 *
 * Vertical centering (`shift`) is applied INSTANTLY — NOT animated. The morph is a
 * GSAP FLIP: at the React commit the body has already reflowed to its FINAL layout
 * (e.g. header switches in-flow ⇄ absolute when a window spines), and the smooth
 * motion comes from GSAP tweening the FRAME geometry, which carries this rail (a
 * frame descendant) along with it. So the rail must sit at the frame's true center
 * in the final layout immediately; the GSAP frame morph then slides it smoothly.
 * Animating `shift` here instead re-introduced the pre-commit offset, making the
 * rail jump (up when spining, down when un-spining) before easing back — the bug
 * this avoids.
 *
 * The slot spans from the VISUAL header bottom to the window bottom: it fills the
 * body (`bottom-0`) and its top is pushed DOWN by `topOffset` (0 when the body already
 * starts at the header bottom; = headerH for a floating-header window). The persistent
 * shortcut rail stays at the edge sliver (`bleed` wide) and is vertically centered on
 * the FRAME by `shift` (a covered ancestor's rail also recesses via `railScale`) — the
 * panel itself ignores `shift` and just fills the slot. Both handled in CollapsibleColumn.
 *
 * The wrapper is `pointer-events-none` so the do-list underneath stays interactive
 * wherever the panel is transparent; the rail + panel re-enable pointer events.
 */
function PanelSlot({
  side,
  open,
  shift,
  bleed,
  topOffset,
  children,
}: {
  side: "left" | "right"
  open: boolean
  shift: number
  bleed: number
  /** Px to push the slot top DOWN from the body top to the VISUAL header bottom. 0
   *  where the body already starts at the header bottom; = headerH for a floating-
   *  header window whose body fills from the window top. */
  topOffset: number
  children: (railWidth: number, panelWidth: number, railScale: number, railShift: number) => React.ReactNode
}) {
  // Rail label/shortcut is ALWAYS full scale (per user): a covered ancestor's rail
  // used to shrink to 0.85 when its peek (`bleed`) was narrower than the full width,
  // but that made a middle ancestor's vertical label look inconsistently smaller than
  // the leaf/home rails. The peek WIDTH (`bleed`) is unchanged — only the artificial
  // label shrink is dropped — so every rail label now reads identically.
  const railScale = 1
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-0 z-10 hidden md:block",
        side === "left" ? "left-0" : "right-0",
      )}
      style={{ top: topOffset }}
    >
      {children(bleed, PANEL_OPEN_W, railScale, shift)}
    </div>
  )
}
