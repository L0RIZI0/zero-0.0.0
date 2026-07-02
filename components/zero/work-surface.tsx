"use client"

import { useCallback, useRef } from "react"
import { useTheme } from "next-themes"
import { useZeroNav } from "@/lib/zero/nav-store"
import { getSpace, getEntity, isDetachedChild } from "@/lib/zero/data"
import { telescopicSurface } from "@/lib/zero/motion"
import { DURATION_S, MORPH_CSS_EASE } from "@/lib/zero/flip-stage"
import { registerStage } from "@/lib/zero/flip-stage"
import { HEADER_OVERLAY_H } from "@/lib/zero/layout"
import { useDebugView } from "@/lib/zero/debug-view"
import { cn } from "@/lib/utils"
import { DebugFrameLabel } from "./debug-frame-label"
import { EntityBody } from "./entity-body"
import { EntityNode } from "./entity-node"
// [v0] EXPERIMENT: region-0 timeline hidden — see note below. Restore with the const.
// import { TimelineStrip } from "./timeline-strip"

/**
 * The composed work surface — the host for the FOCUS-WINDOW REGION (the full card)
 * and the always-mounted home view. Entity 0 (home) is the OPENED WINDOW of the root
 * ORGANISM — the Individual "Loris", animated by a Soul.
 *
 *   ┌─────────────────────────────────────┐  ← card (below the app header bar)
 *   │  data-window-region  (fills card)   │  ← the Flip stage + morph origin. Every
 *   │  ┌───────────────────────────────┐  │     fixed child window fills this rect.
 *   │  │ home EntityBody (region stack)│  │     The home body renders its content as
 *   │  │   region 0 — timeline  (hug)  │  │     an IN-FLOW region stack now (see
 *   │  │   region 1 — do-list  (fill)  │  │     lib/zero/regions + entity-body):
 *   │  │   region 2 — dock      (hug)  │  │     timeline at top, do-list filling
 *   │  └───────────────────────────────┘  │     below, dock at the bottom when pinned.
 *   └─────────────────────────────────────┘
 *
 * The timeline is the root Organism's ONE master Lifeline shown in its linear LIFELANE
 * view. It is built HERE (WorkSurface owns the root context) and handed to the home
 * EntityBody as region-0 content. It is a HOME-ONLY component: a child focus window
 * fills the whole window region and simply COVERS home, timeline included (no more
 * gliding up under the window header). The window region stays the full card, so the
 * GSAP Flip morph + IN/OUT rail centering (both keyed off this box / `[data-body]`)
 * are unchanged by the in-flow region restructure.
 */
export function WorkSurface() {
  const { activeEntity, stack, fading } = useZeroNav()
  // [v0] DEBUG: colored frames + labels are gated on the shared `§ 2` toggle.
  const { frames: showFrames } = useDebugView()
  // The root entity's body is the permanent home backdrop at z-0. It is ALWAYS
  // mounted: the depth-1 window grows over it on open and shrinks back into its
  // dock card / row on close, so that morph source must always be present.
  const rootId = stack[0]
  // The timeline is the ROOT Organism's Lifeline (home only), so it reads the root
  // entity's accent — not the active context's.
  const rootAccent = getSpace(rootId)?.accent ?? getEntity(rootId)?.accent

  // registerStage is preserved via a combined ref so the Flip stage still resolves
  // the window region's box (the morph origin for every fixed child window).
  const regionElRef = useRef<HTMLDivElement | null>(null)
  const setRegionRef = useCallback((el: HTMLDivElement | null) => {
    regionElRef.current = el
    registerStage(el)
  }, [])

  // REGION 0 content for the home view: the root Organism's Lifeline timeline. Built
  // here (WorkSurface owns the root context) and handed to the home EntityBody, which
  // renders it as the top HUG region. It is purely a home component — a child window
  // covering home covers it too.
  //
  // [v0] EXPERIMENT: region 0 (the lifelane timeline) is HIDDEN so the home view is just
  // the Dayline (rendered up in zero-shell) on top of the do-list. To restore, uncomment
  // this and pass `timeline={timeline}` to <EntityBody> below.
  // const timeline = <TimelineStrip contextId={rootId} accent={rootAccent} />

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
    // entity0's FRAME — the Individual's homeview window. It is FULL-BLEED: it fills
    // the whole work area (which itself spans the full viewport), so it touches all
    // four screen edges. No `rounded-md` (edge-to-edge) and not `overflow-hidden`:
    // clipping lives on the inner stage region below, so the timeline can ride UP
    // toward the header at deeper stages without being cropped.
    // [v0] DEBUG: bright green border = entity0 (home) frame — the always-open root window.
    <div
      className={cn("relative flex h-full w-full flex-col", showFrames && "border border-green-500")}
      style={
        {
          backgroundColor: homeSurface,
          transition: homeBgTransition,
        } as React.CSSProperties
      }
    >
      {/* [v0] DEBUG: green frame label. Pinned to the screen's top-left corner — the
          outermost (full-bleed) frame's own corner. `z-50` floats it above the header
          overlay. Remove with the debug borders. */}
      {showFrames && (
        <DebugFrameLabel name="ent0·frame" info="h:fill v:fill · full-bleed" className="text-green-500" />
      )}
      {/* REGION 0 (fill) — the focus-window region, where the SINGLE recursive
          entity tree lives. It fills the ENTIRE card, so an opened window fills from
          the card top: its header sits just under the app bar. The root entity's body
          (home view) is always mounted and now renders the timeline IN-FLOW as its own
          top region (no overlay). Its dock cards and DO-list rows are themselves
          `EntityNode`s that morph IN PLACE into fixed focus windows when opened, and
          shrink back into their own row on close (same DOM node — no duplicate, no
          captured-rect drift). This wrapper owns the clipping + establishes the
          positioning context the opened windows are measured against (region-relative
          `fixed`).

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
        // `pointer-events-none`: the region box is transparent to events so the gaps
        // between the in-flow regions stay click/scroll-through; each interactive leaf
        // (region-0 timeline, do-list, Dock, side panels, window chrome) re-enables
        // `pointer-events-auto` for itself.
        //
        // TOP INSET (`marginTop: HEADER_OVERLAY_H`): the header is now an ABSOLUTE
        // overlay (no longer in flow), so this stage region is pushed down by the full
        // overlay height. Its bounding rect — which `registerStage` reads and every
        // fixed child window fills (getRegionRect) — therefore starts BELOW the header,
        // exactly as it did when the header was in flow. So child-window morph geometry
        // and the home View both open under the header, unchanged. The negative top in
        // the clip-path lets morph shadows bleed up behind the header.
        className="pointer-events-none relative z-10 flex min-h-0 flex-1 flex-col [clip-path:inset(-48px_0px_-120px_0px_round_6px)]"
        style={{ marginTop: HEADER_OVERLAY_H }}
      >
        {/* The home view: region 0 = the timeline (passed in), region 1 = the do-list,
            region 2 = the dock (when pinned). centerList (true): the do-list + create-
            input are vertically CENTERED within region 1 (center-center) — sitting in
            the middle of the leftover space between the timeline and the dock rather
            than hugging the timeline at the top. `justify-center-safe` keeps a long list
            from clipping, and region 2 (dock) still pushes region 1 up when pinned, so
            the centered group recenters within the reduced space. Horizontal centering
            is independent (items-center / self-center / w-2/3 in EntityBody). */}
        <EntityBody
          entityId={rootId}
          active={activeEntity.id === rootId}
          isRoot
          centerList
          surface={homeSurface}
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
            morphDetached) from the launching placement's rect, or the region center.

            OUT-OF-FLOW WRAPPER: the EntityNode renders as `variant="row"`, whose outer
            slot is an in-flow `h-11` (44px) box (the telescoping hole a real do-list row
            leaves behind). A detached node has no list to telescope into, so that 44px
            slot would just be a flex sibling in this `flex-col` region — stealing 44px
            from the home EntityBody (`flex-1`) and lifting the home View + dock up by
            exactly one row. Wrapping in `absolute` removes the slot from the flex main-
            axis entirely (contributes zero flow height); the inner `fixed` window is
            unaffected and still fills the region via getRegionRect.

            `pointer-events-auto`: the region is `pointer-events-none` (see note above) and
            each interactive leaf re-enables events for itself. A window opened from the
            do-list inherits auto from that list; a DETACHED window is mounted straight into
            the region with no such ancestor, so without this the whole window subtree —
            close button included — inherits `none` and only ESC could close it. The fixed
            window covers the region, so the wrapper's own 44px slot never intercepts. */}
        {stack.map((id, depth) =>
          depth >= 1 && isDetachedChild(id, stack[depth - 1]) ? (
            <div key={`detached:${depth}:${id}`} className="pointer-events-auto absolute left-0 top-0 w-full">
              <EntityNode entityId={id} contextId={stack[depth - 1]} variant="row" detached />
            </div>
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
            // Same out-of-flow wrapper as the open case above (see note there).
            <div key={`fading:${f.depth}:${f.id}`} className="absolute left-0 top-0 w-full">
              <EntityNode entityId={f.id} contextId={f.parent} variant="row" detached />
            </div>
          ) : null,
        )}
      </div>
    </div>
  )
}
