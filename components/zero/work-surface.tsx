"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { motion } from "motion/react"
import { useTheme } from "next-themes"
import { useZeroNav } from "@/lib/zero/nav-store"
import { getSpace, getEntity, isDetachedChild } from "@/lib/zero/data"
import { shellStageFor, TIMELINE_LIFT_Y, TIMELINE_TOP_PAD } from "@/lib/zero/layout"
import { entityRegions } from "@/lib/zero/regions"
import { telescopicSurface } from "@/lib/zero/motion"
import { DURATION_S, MORPH_CSS_EASE } from "@/lib/zero/flip-stage"
import { registerStage } from "@/lib/zero/flip-stage"
import { EntityBody } from "./entity-body"
import { EntityNode } from "./entity-node"
import { Region } from "./region"
import { TimelineStrip } from "./timeline-strip"

/**
 * The composed work surface — and the renderer for ENTITY 0's REGION STACK
 * (see lib/zero/regions). Entity 0 (home) is special: its region 0 is the
 * recursive focus-window region that hosts the ENTIRE entity tree, so its regions
 * are laid out here rather than inside an EntityBody.
 *
 * Home's content area is a vertical flex column of regions:
 *
 *   ┌─────────────────────────────────────┐
 *   │  REGION 1 — timeline      (hug)       │  ← context-filtered; hugs its height
 *   │ ┌─────────────────────────────────┐  │     and PUSHES region 0 down. Lifts
 *   │ │ REGION 0 — content     (fill)    │  │     toward the header with depth via
 *   │ │  • home do-list (centered)       │  │     a transform (no reflow).
 *   │ │  • child focus windows open here │  │  ← region 0 is the window region:
 *   │ │    (position: fixed to this box) │  │     it fills the leftover space and
 *   │ └─────────────────────────────────┘  │     every fixed window is anchored to
 *   └─────────────────────────────────────┘     its rect.
 *
 * Because the timeline is region 1 ABOVE region 0, and children open INSIDE region
 * 0, the timeline naturally stays above child content at every depth (the "master
 * timeline flies with the user" behavior) without any re-parenting. The non-root
 * entities have only region 0 for now; their region stack lives in EntityBody.
 */
export function WorkSurface() {
  const { activeEntity, stack, fading } = useZeroNav()
  const contextId = activeEntity.contextId
  // The root entity's body is the permanent home backdrop at z-0. It is ALWAYS
  // mounted: the depth-1 window grows over it on open and shrinks back into its
  // dock card / row on close, so that morph source must always be present.
  const rootId = stack[0]
  // The context may be a task/event (not a space), so fall back to the entity's
  // own accent when it isn't a space.
  const accent = getSpace(contextId)?.accent ?? getEntity(contextId)?.accent

  // As the user dives deeper, the whole interface compacts: the timeline slides
  // up toward the header bar (less top padding) at each stage.
  const stage = shellStageFor(activeEntity)

  // Entity 0's region stack (top → bottom). For home this is [timeline (hug),
  // region 0 (fill)]; the hug regions are rendered above region 0 below. Region 0
  // itself is the special window region (it hosts the whole recursive tree), so we
  // render it explicitly rather than from this list.
  const regions = entityRegions(true)
  const hugRegions = regions.filter((r) => r.grow === "hug")

  // Home's IN/OUT side panels must center on the FULL entity (region 1 + region 0),
  // not on region 0 alone — otherwise they drift down as the timeline grows. The
  // panels live inside region 0's EntityBody and anchor to its center (top-1/2), so
  // we shift them UP by half the timeline's occupied height. region 0's `offsetTop`
  // within the card == exactly that height (the hug regions stacked above it incl.
  // their top margin), so the correction is `-offsetTop / 2`. We remeasure whenever
  // region 0 resizes (it shrinks as the timeline grows). registerStage is preserved
  // via a combined ref so the Flip stage still resolves this box.
  const regionElRef = useRef<HTMLDivElement | null>(null)
  const [panelShift, setPanelShift] = useState(0)
  const setRegionRef = useCallback((el: HTMLDivElement | null) => {
    regionElRef.current = el
    registerStage(el)
  }, [])
  useEffect(() => {
    const el = regionElRef.current
    if (!el) return
    const measure = () => setPanelShift(-el.offsetTop / 2)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Home is window 0 in the telescopic surface model. In DARK mode it stays on
  // pure --background (level 0) at every depth — a no-op. In LIGHT mode it is the
  // deepest ancestor, so it darkens (capped) as the stack grows, completing the
  // "leaf brightest, ancestors progressively darker" recede.
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== "light"
  const leafDepth = Math.max(0, stack.length - 1)
  const homeSurface = telescopicSurface(0, leafDepth, isDark)
  const homeBgTransition = `background-color ${DURATION_S} ${MORPH_CSS_EASE}`

  return (
    // NOTE: the card is NOT `overflow-hidden`. Clipping lives on the focus-window
    // region below instead, so the timeline can ride UP past the card's top edge
    // (toward the header) at deeper stages without being cropped. `rounded-md`
    // still rounds the card's own background; only the window region needs to
    // clip its scaled-up parent frames.
    <div
      className="relative flex h-full w-full flex-col rounded-md"
      style={{ backgroundColor: homeSurface, transition: homeBgTransition }}
    >
      {/* HUG REGIONS above region 0 — for entity 0 this is region 1, the master
          timeline. A hug region sizes to its content and pushes region 0 down. The
          timeline rises toward (and slightly into) the header bar with depth via the
          Region's `lift` transform (NOT a margin): that keeps region 0's box — the
          rect that anchors every fixed window — perfectly still through the morph.
          The resting top margin stays constant. Not clipped by the card, so it never
          crops. z-30 keeps it above the window region / opened children. */}
      {hugRegions.map((r) => (
        <Region
          key={r.id}
          grow={r.grow}
          lift={TIMELINE_LIFT_Y[stage]}
          className="z-30 px-6"
          style={{ marginTop: TIMELINE_TOP_PAD }}
        >
          {r.component === "timeline" ? <TimelineStrip contextId={contextId} accent={accent} /> : null}
        </Region>
      ))}

      {/* REGION 0 (fill) — the focus-window region, where the SINGLE recursive
          entity tree lives. This is entity 0's region 0: it fills the space left
          below the hug regions (timeline) above, so home's centered do-list sits in
          the visual middle of the leftover area, and the timeline pushes it down.
          The root entity's body (home view) is always mounted; its dock cards and
          DO-list rows are themselves `EntityNode`s that morph IN PLACE into
          fixed focus windows when opened, and shrink back into their own row on
          close (same DOM node — no duplicate, no captured-rect drift). This
          wrapper owns the clipping + establishes the positioning context the
          opened windows are measured against (they use region-relative `fixed`).

          `data-window-region` lets the Flip stage resolve this box's rect so a
          window can fill it exactly at depth 1. */}
      <div
        ref={setRegionRef}
        data-window-region
        // `flex flex-col` so the always-mounted home EntityBody (flex-1) is
        // actually constrained to this region's height. Without it the region was
        // a plain block, EntityBody sized to its content and overflowed — an
        // expanded Inputs panel then grew the columns row and pushed the opposite
        // (centered) Outputs rail down.
        //
        // Clipping uses `clip-path` (an inset with a NEGATIVE bottom) instead of
        // `overflow-hidden`. At rest the open windows are `position: fixed`, so
        // overflow didn't clip them; but during the GSAP Flip morph the frames
        // become `position: absolute` inside this region and overflow-hidden then
        // clipped the stacked drop-shadows at the very bottom of the screen — they
        // vanished mid-animation and snapped back when it ended. The negative
        // bottom inset (−120px) leaves room for those shadows while still clipping
        // the top/sides (so peeking parent frames stay contained).
        // Top inset is NEGATIVE (−48px) so the windows — which grow upward past the
        // region top as the shell compacts (WINDOW_TOP_LIFT) — are not clipped at
        // their tops during the morph (when frames are `absolute` inside this box).
        // The space above is the header's empty area, so nothing else shows there.
        className="relative flex min-h-0 flex-1 flex-col rounded-md [clip-path:inset(-48px_0px_-120px_0px_round_6px)]"
      >
        <EntityBody
          entityId={rootId}
          active={activeEntity.id === rootId}
          isRoot
          centerList
          railShift={panelShift}
        />

        {/* DETACHED WINDOWS. The recursive in-place tree above only reaches a stack
            entry through its host's do-list/dock. When an entry's host is NOT its
            structural parent/tag (e.g. it was opened from a timeline chip or search),
            that chain breaks — there is no in-place row to morph from. We mount such
            entries as standalone EntityNodes here: passing contextId = the stack entry
            below makes `ownsOpen` true, so each renders as a FULL focus window through
            all the normal machinery (its own members then recurse in-place inside it).
            Each window is `position: fixed` against the region, so DOM nesting here is
            irrelevant to layout. The morph is driven imperatively (flip-stage's
            morphDetached) from the launching placement's rect, or the region center. */}
        {stack.map((id, depth) =>
          depth >= 1 && isDetachedChild(id, stack[depth - 1]) ? (
            <EntityNode
              key={`detached:${depth}:${id}`}
              entityId={id}
              contextId={stack[depth - 1]}
              variant="row"
              detached
            />
          ) : null,
        )}

        {/* CLOSING detached windows. On a detached close we pop the stack
            immediately (so state is never stale) but keep the window mounted for
            its shrink animation by placing it in `fading`. Once popped it is no
            longer in `stack`, so we mount fading detached entries here too. The
            EntityNode keeps rendering as a window because `fadingEntry` matches;
            it unmounts when the fade list clears at the end of the morph. */}
        {fading.map((f) =>
          !stack.includes(f.id) && isDetachedChild(f.id, f.parent) ? (
            <EntityNode
              key={`fading:${f.depth}:${f.id}`}
              entityId={f.id}
              contextId={f.parent}
              variant="row"
              detached
            />
          ) : null,
        )}
      </div>
    </div>
  )
}
