"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { motion } from "motion/react"
import { useTheme } from "next-themes"
import { useZeroNav } from "@/lib/zero/nav-store"
import { getSpace, getEntity, isDetachedChild } from "@/lib/zero/data"
import { shellStageFor, HEADER_BAND_H, TIMELINE_TOP_PAD } from "@/lib/zero/layout"
import { entityRegions } from "@/lib/zero/regions"
import { layerTransition, telescopicSurface } from "@/lib/zero/motion"
import { DURATION_S, MORPH_CSS_EASE } from "@/lib/zero/flip-stage"
import { registerStage } from "@/lib/zero/flip-stage"
import { EntityBody } from "./entity-body"
import { EntityNode } from "./entity-node"
import { TimelineStrip } from "./timeline-strip"

/**
 * The composed work surface — and the renderer for ENTITY 0's REGION STACK
 * (see lib/zero/regions). Entity 0 (home) is the OPENED WINDOW of the root
 * ORGANISM — the Individual "Loris", animated by a Soul — and is special: its
 * region 0 is the recursive focus-window region that hosts the ENTIRE entity tree.
 *
 * REGION MODEL (overlay Lifelane):
 *
 *   ┌─────────────────────────────────────┐  ← card (below the app header bar)
 *   │ ░ REGION 1 — Lifelane  (overlay) ░░░ │  ← entity 0's region 1. Absolutely
 *   │ ┌─────────────────────────────────┐  │     positioned at `timelineTop`; NOT in
 *   │ │ REGION 0 — window region (fill) │  │     flow. z-30, so it floats over region
 *   │ │  • home do-list (below Lifelane) │  │     0. Its bottom defines a RESERVE that
 *   │ │  • child focus windows open here │  │     content below it pads for.
 *   │ └─────────────────────────────────┘  │  ← region 0 fills the WHOLE card now.
 *   └─────────────────────────────────────┘     Every fixed window fills this rect.
 *
 * Region 1 is the root Organism's ONE master Lifeline (a timeless life artefact that
 * follows the user everywhere) shown in its linear LIFELANE view. Its alternate view,
 * the ATLAS (a fullscreen period-grid morph), is toggled from the Lifelane's own
 * switch and rendered as a fixed fullscreen overlay, so it does not affect this region
 * layout. A space child does not get its own region 1 — it REFERENCES entity 0's:
 * structurally there is a single TimelineStrip here, and we just move it vertically.
 *   • HOME (no window open): timeline rests at `TIMELINE_TOP_PAD` from the card top,
 *     with the home do-list reserved below it → identical to before.
 *   • WINDOW OPEN: the active window fills region 0 from the card top, so its header
 *     (glyph + title + close) sits just under the app bar; the timeline drops to
 *     `HEADER_BAND_H` (the header's bottom) and the window's content reserves the
 *     slot below it. Visual order: app bar → entity header → timeline → content.
 *
 * Because region 0 == the full card, the home body and the active window's body both
 * start at the card top, so the timeline's BOTTOM (`timelineTop + timelineH`) is a
 * single RESERVE both consume via the `--region1-reserve` CSS var. And the IN/OUT
 * rails (anchored to region 0's center) now center on the full entity for free.
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

  const stage = shellStageFor(activeEntity)

  // Region 1 = entity 0's Lifeline, in its linear LIFELANE view (the root Organism's
  // master timeline, asserted by the region model). It's rendered as an absolute
  // overlay below; region 0 is the window region rendered explicitly. (The Atlas view
  // is a separate fullscreen morph the Lifelane strip toggles into.)
  const hasTimeline = entityRegions(true).some((r) => r.component === "lifelane")

  // Is a focus window open? `stack` ALWAYS holds the root entity (home backdrop) at
  // index 0, so "a window is open" means depth ≥ 1 — i.e. stack.length > 1. When so,
  // the timeline drops to sit just under the active window's header (HEADER_BAND_H)
  // instead of at its home resting pad.
  const windowOpen = stack.length > 1
  const timelineTop = windowOpen ? HEADER_BAND_H : TIMELINE_TOP_PAD

  // Measure the live timeline height so content below it (home do-list, the active
  // window's content) can reserve `timelineTop + timelineH`. Exposed as the
  // `--region1-reserve` CSS var on the card so EntityBody — at home AND inside every
  // fixed window — consumes one value without prop drilling. registerStage is
  // preserved via a combined ref so the Flip stage still resolves region 0's box.
  const regionElRef = useRef<HTMLDivElement | null>(null)
  const timelineElRef = useRef<HTMLDivElement | null>(null)
  const [timelineH, setTimelineH] = useState(0)
  const setRegionRef = useCallback((el: HTMLDivElement | null) => {
    regionElRef.current = el
    registerStage(el)
  }, [])
  useEffect(() => {
    const el = timelineElRef.current
    if (!el) return
    const measure = () => setTimelineH(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Reserve = the timeline's BOTTOM measured FROM THE CONSUMING BODY'S TOP (the
  // do-list region pads by this). `timelineTop` is in CARD coords, but the consuming
  // body's top is also offset within the card: 0 for home (body == region 0 == card),
  // HEADER_BAND_H for an open window (body sits below its header). Those offsets are
  // exactly `windowOpen ? HEADER_BAND_H : 0`, and since `timelineTop` equals that same
  // offset (+ TIMELINE_TOP_PAD only at home), the body-relative reserve collapses to
  // `(home ? TIMELINE_TOP_PAD : 0) + timelineH`. This keeps content flush under the
  // timeline in BOTH home and windows from a single shared var.
  const region1Reserve = (windowOpen ? 0 : TIMELINE_TOP_PAD) + timelineH

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
      style={
        {
          backgroundColor: homeSurface,
          transition: homeBgTransition,
          // The timeline's reserved bottom, consumed by EntityBody (home + every
          // fixed window) so content sits below the overlay timeline.
          "--region1-reserve": `${region1Reserve}px`,
        } as React.CSSProperties
      }
    >
      {/* REGION 1 — the LIFELANE (the Lifeline's linear view; the root Organism's
          master timeline), an ABSOLUTE OVERLAY (not in flow), so region 0 below can
          fill the whole card and the Lifelane can float at the active entity's header
          bottom. `top` ANIMATES between the home resting pad and HEADER_BAND_H (header
          bottom) when a window opens, so the Lifelane glides into the window just
          below its header. z-30
          floats it over region 0 / opened windows; not clipped by the card, so it
          never crops. The active window's content reserves space below it via
          `--region1-reserve`. */}
      {hasTimeline ? (
        <motion.div
          ref={timelineElRef}
          className="absolute inset-x-0 z-30 px-6"
          initial={false}
          animate={{ top: timelineTop }}
          transition={layerTransition}
        >
          <TimelineStrip contextId={contextId} accent={accent} />
        </motion.div>
      ) : null}

      {/* REGION 0 (fill) — the focus-window region, where the SINGLE recursive
          entity tree lives. It now fills the ENTIRE card (the timeline is an overlay,
          not a band above it), so an opened window fills from the card top: its
          header sits just under the app bar and the timeline drops below it. The
          root entity's body (home view) is always mounted; its dock cards and DO-list
          rows are themselves `EntityNode`s that morph IN PLACE into fixed focus
          windows when opened, and shrink back into their own row on close (same DOM
          node — no duplicate, no captured-rect drift). This wrapper owns the clipping
          + establishes the positioning context the opened windows are measured
          against (they use region-relative `fixed`).

          `data-window-region` lets the Flip stage resolve this box's rect so a
          window can fill it exactly at depth 1. */}
      <div
        ref={setRegionRef}
        data-window-region
        // `flex flex-col` so the always-mounted home EntityBody (flex-1) is
        // actually constrained to this region's height.
        //
        // Clipping uses `clip-path` (an inset with a NEGATIVE bottom) instead of
        // `overflow-hidden`. At rest the open windows are `position: fixed`, so
        // overflow didn't clip them; but during the GSAP Flip morph the frames
        // become `position: absolute` inside this region and overflow-hidden then
        // clipped the stacked drop-shadows at the very bottom of the screen — they
        // vanished mid-animation and snapped back when it ended. The negative
        // bottom inset (−120px) leaves room for those shadows while still clipping
        // the top/sides (so peeking parent frames stay contained). The small
        // negative top inset keeps morph shadows above the frame top from clipping.
        className="relative flex min-h-0 flex-1 flex-col rounded-md [clip-path:inset(-48px_0px_-120px_0px_round_6px)]"
      >
        <EntityBody entityId={rootId} active={activeEntity.id === rootId} isRoot centerList />

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
