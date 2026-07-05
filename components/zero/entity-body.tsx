"use client"

import type { ReactNode } from "react"
import { motion } from "motion/react"
import { panelSlideTransition } from "@/lib/zero/motion"
import { getPinnedItems } from "@/lib/zero/data"
import { usePanelOpen } from "@/lib/zero/panel-store"
import { useZeroNav } from "@/lib/zero/nav-store"
import { VIEW_PAD_TOP, VIEW_PAD_BOTTOM } from "@/lib/zero/layout"
import { Region } from "./region"
import { Dock } from "./dock"
import { DoList } from "./do-list"
import { AssetPanel } from "./asset-panel"
import { getEntityResourceCount } from "@/lib/zero/resources"
import { OutputPanel } from "./output-panel"
import { CollapsibleColumn } from "./collapsible-column"
import { SpineExcerpt } from "./spine-excerpt"
import { ResourceCanvas } from "./resource-canvas"
import { DebugFrameLabel, DebugComponentFrame } from "./debug-frame-label"
import { useDebugView } from "@/lib/zero/debug-view"
import { cn } from "@/lib/utils"

/** Width of a side panel when OPEN, and of the thin RAIL when collapsed. */
const PANEL_OPEN_W = 230
const PANEL_SPINE_W = 48
/** How far the View is squeezed IN from a side when that side's panel is OPEN: the
 *  full panel footprint (spine + panel), so the content sits flush beside the panel's
 *  inner edge instead of being overlaid by it. Collapsed → back to the spine (PANEL_SPINE_W). */
const PANEL_SQUEEZE_W = PANEL_SPINE_W + PANEL_OPEN_W


/**
 * An entity's working surface: its Tasks do-list + Dock (center), with the
 * Inputs / Outputs side panels OVERLAID on the left/right edges.
 *
 * Panels are an absolute overlay anchored to the FRAME's vertical center, not to
 * the body. `entity-node` measures the only thing that varies — the in-flow
 * header — and hands us `spineShift` (0 for floating/space headers,
 * `-headerH/2` for in-flow task/event headers). The overlay sits at
 * `calc(50% + var(spineShift))`, so the spines land on the true middle of
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
  spineShift = 0,
  spineBleedLeft = PANEL_SPINE_W,
  spineBleedRight = PANEL_SPINE_W,
  panelTopOffset = 0,
  spineTitle,
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
   *  The Inputs/Outputs spines still render — a resource is work whose outputs wire
   *  into the Task's Outputs. `url` is the page to open; `resourceId` selects the
   *  catalog entry (branding + embed behavior). */
  resource?: { url: string; resourceId?: string }
  /** Forwarded to the DoList so it can keep its scroller clipped during this
   *  window's close morph (prevents the ADD row jumping up over the title). */
  closing?: boolean
  /** Vertical px offset that re-centers the spines on the FRAME center (0 when the
   *  body fills the frame; −headerH/2 for an in-flow header). ANIMATED, so the
   *  spines slide as a window's header changes (e.g. ancestor → spine). */
  spineShift?: number
  /** Collapsed-spine width per side = the visible bleed strip of this window once a
   *  child covers it, so the spine centers within that sliver instead of clipping at
   *  the frame edge. Defaults to the full spine (leaf / home root, uncovered). */
  spineBleedLeft?: number
  spineBleedRight?: number
  /** Px to push the panel/spine box top DOWN from the body's top so it starts at the
   *  VISUAL header bottom (spanning header-bottom → window-bottom). 0 wherever the body
   *  already starts at the header bottom (home view, in-flow-header child); = headerH
   *  only for a FLOATING-header window whose body fills from the window top. */
  panelTopOffset?: number
  /** When set (a covered SPACE ancestor), the LEFT spine renders this title ROTATED
   *  below the glyph and above the excerpt. The excerpt flows naturally beneath it —
   *  no offset needed (see CollapsibleColumn). Undefined for leaves/non-spaces. */
  spineTitle?: string
  /** The window's background colour — the opaque panel uses it so it reads as the
   *  window surface sliding over the View. Falls back to the theme background. */
  surface?: string
  /** Vertically center the do-list within its column (forwarded to DoList). */
  centerList?: boolean
  /** The always-mounted home view. Its body has no in-flow header, so its spines
   *  center on the region directly (`spineShift` defaults to 0). Kept as
   *  a flag only to widen the central reading measure on the home view. */
  isRoot?: boolean
}) {
  // The spine's "RESOURCES (n)" counter reflects the resources this entity actually HOLDS
  // (entity0's world inputs; a child's imported/added resources) — model-driven, so a
  // child with no holdings reads (0).
  const assetCount = getEntityResourceCount(entityId)
  // Resources (IN) default OPEN for every entity regardless of kind; Published (OUT) default
  // CLOSED. State is session-persistent (the in-memory panel store keeps a user's per-entity
  // expand/collapse choice across navigation, resetting to these defaults on a full reload).
  // Because Resources defaults open, diving into a child turns every ancestor into a covered
  // ancestor with an open panel → the existing dive peek (`inOpen && !active`) morphs it into
  // the peek-losange strip, so every ancestor shows its resources collapsed.
  const [inOpen, setInOpen] = usePanelOpen(`${entityId}:in`, true)
  const [outOpen, setOutOpen] = usePanelOpen(`${entityId}:out`, false)
  // IN/OUT GUTTERS: the View is everything visually INSIDE the entity window — inset on
  // the left/right by the in/out panels, so it never underlaps them. Each side's gutter
  // is the panel's current footprint: the thin RAIL (`PANEL_SPINE_W`, 48) when collapsed,
  // or the full panel (`PANEL_SQUEEZE_W` = spine + open panel) when that side is open. The
  // inset is animated on the shared panel-slide curve so the do-list/resource glides aside
  // exactly as the panel glides in — a one-shot, localized layout animation on toggle (not
  // part of the dive morph). Top (header) and bottom (22 peek) insets are separate.
  const padLeft = inOpen ? PANEL_SQUEEZE_W : PANEL_SPINE_W
  const padRight = outOpen ? PANEL_SQUEEZE_W : PANEL_SPINE_W
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
    // never skews where the spines sit.
    // `pointer-events-none`: the body root is transparent to events and each
    // interactive LEAF re-enables `pointer-events-auto` (region 0 timeline, do-list
    // content, resource canvas, Dock, side panels). This keeps the empty gaps between
    // regions click/scroll-through while the chrome stays fully interactive, and lets
    // the overlaid side-panel spines sit over the content without stealing its events.
    <div data-body className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
      {/* RESOURCE TASK: the center surface is the bound web resource, filling the
          rectangular Task window almost edge-to-edge (a slim inset keeps it clear of
          the Inputs/Outputs spines). The do-list/Dock are skipped entirely — this is
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
        // THE VIEW — everything visually INSIDE the entity window: the region stack,
        // inset so it never covers the surrounding chrome. Sides = the in/out gutters
        // (padLeft/padRight: the spine when collapsed → full panel when open, animated);
        // bottom = a 22px peek (VIEW_PAD_BOTTOM); top = 0 (VIEW_PAD_TOP — the header
        // already occupies the top for in-flow-header windows, and floating-header
        // windows intentionally keep their View starting at the window top). Lives on
        // this inner wrapper, NOT on `[data-body]`: the body root must stay full-bleed
        // because it's both the side-panel spines' offset parent and the Flip morph's
        // target box.
        // [v0] DEBUG: purple border = the View area (the region stack's footprint).
        <motion.div
          data-view
          className={cn("relative flex min-h-0 flex-1 flex-col", showFrames && "border border-purple-500")}
          style={{ paddingTop: VIEW_PAD_TOP, paddingBottom: VIEW_PAD_BOTTOM }}
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
              info="stack · h:fill v:fill · pad:0/gutter/22/gutter"
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
      <PanelSlot side="left" open={inOpen} shift={spineShift} bleed={spineBleedLeft} topOffset={panelTopOffset}>
        {(spineWidth, panelWidth, spineScale, shift) => (
          <CollapsibleColumn
            title="Resources"
            collapsedTitle="Resources"
            side="left"
            count={assetCount}
            excerpt={<SpineExcerpt entityId={entityId} />}
            spineTitle={spineTitle}
            open={inOpen}
            onOpenChange={setInOpen}
            focused={active}
            spineWidth={spineWidth}
            panelWidth={panelWidth}
            spineScale={spineScale}
            spineShift={shift}
            surface={surface}
            // The collapsed state of a FOCUSED leaf's Resources spine is the peek-losange
            // strip (not a vertical label): clicking the band expands to the full list,
            // clicking the band again collapses back to losanges. Only on a leaf (active).
            stripCollapse={active}
          >
            {/* The AssetPanel is in PEEK (losange strip) whenever it isn't the full
                expanded list on the focused leaf, i.e.:
                  • COVERED ANCESTOR — open but a child is focused (`inOpen && !active`).
                  • LEAF COLLAPSED — focused leaf with the panel closed (`active && !inOpen`):
                    the losanges are the collapsed affordance. `stripMode` marks this so the
                    non-losange content FADES (nothing covers it) and the morph is immediate.
                `spineWidth` is the strip width the losanges center on. */}
            <AssetPanel
              spaceId={entityId}
              peek={(inOpen && !active) || (active && !inOpen)}
              stripMode={active && !inOpen}
              // Focused-leaf scenario → snappy panel-slide curve both directions (so expand
              // can't fall back to the slow 2s dive beat). The covered-ancestor dive keeps
              // the 2s beat (snappy false there).
              snappy={active}
              spineWidth={spineWidth}
            />
          </CollapsibleColumn>
        )}
      </PanelSlot>

      {/* PUBLISHED — stuff that goes OUT (publications, output, results). Mirror of
          Assets on the RIGHT edge. */}
      <PanelSlot side="right" open={outOpen} shift={spineShift} bleed={spineBleedRight} topOffset={panelTopOffset}>
        {(spineWidth, panelWidth, spineScale, shift) => (
          <CollapsibleColumn
            title="Published"
            collapsedTitle="Published"
            side="right"
            count={0}
            open={outOpen}
            onOpenChange={setOutOpen}
            focused={active}
            spineWidth={spineWidth}
            panelWidth={panelWidth}
            spineScale={spineScale}
            spineShift={shift}
            surface={surface}
          >
            {/* Mirror of AssetPanel on the right peek. `panelWidth` is needed so a
                publication losange can be offset onto the RIGHT edge strip. */}
            <OutputPanel
              spaceId={entityId}
              peek={outOpen && !active}
              spineWidth={spineWidth}
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
 * motion comes from GSAP tweening the FRAME geometry, which carries this spine (a
 * frame descendant) along with it. So the spine must sit at the frame's true center
 * in the final layout immediately; the GSAP frame morph then slides it smoothly.
 * Animating `shift` here instead re-introduced the pre-commit offset, making the
 * spine jump (up when spining, down when un-spining) before easing back — the bug
 * this avoids.
 *
 * The slot spans from the VISUAL header bottom to the window bottom: it fills the
 * body (`bottom-0`) and its top is pushed DOWN by `topOffset` (0 when the body already
 * starts at the header bottom; = headerH for a floating-header window). The persistent
 * shortcut spine stays at the edge sliver (`bleed` wide) and is vertically centered on
 * the FRAME by `shift` (a covered ancestor's spine also recesses via `spineScale`) — the
 * panel itself ignores `shift` and just fills the slot. Both handled in CollapsibleColumn.
 *
 * The wrapper is `pointer-events-none` so the do-list underneath stays interactive
 * wherever the panel is transparent; the spine + panel re-enable pointer events.
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
  children: (spineWidth: number, panelWidth: number, spineScale: number, spineShift: number) => React.ReactNode
}) {
  // Spine label/shortcut is ALWAYS full scale (per user): a covered ancestor's spine
  // used to shrink to 0.85 when its peek (`bleed`) was narrower than the full width,
  // but that made a middle ancestor's vertical label look inconsistently smaller than
  // the leaf/home spines. The peek WIDTH (`bleed`) is unchanged — only the artificial
  // label shrink is dropped — so every spine label now reads identically.
  const spineScale = 1
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-0 z-10 hidden md:block",
        side === "left" ? "left-0" : "right-0",
      )}
      // `topOffset` is applied INSTANTLY (see the doc note above): the GSAP frame morph
      // carries the spine. Because leaf and spine now share an IDENTICAL internal layout
      // (same body header band, same spine center), this value doesn't change on a
      // leaf↔spine flip, so there is nothing to snap.
      style={{ top: topOffset }}
    >
      {children(bleed, PANEL_OPEN_W, spineScale, shift)}
    </div>
  )
}
