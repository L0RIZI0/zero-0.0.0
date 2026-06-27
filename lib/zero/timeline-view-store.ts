"use client"

import { useSyncExternalStore } from "react"

/**
 * Reactive, module-level memory of the ONE Timeline's current morph state.
 *
 * Lifelane and Atlas are two named morphs of the SAME Timeline component, driven by
 * zoom. The component that owns the zoom viewport (TimelineStrip) is the sole WRITER;
 * several sibling pieces of chrome need to READ it without prop-drilling through the
 * region/window machinery:
 *   • WorkSurface — sizes the timeline band + the `--region1-reserve` the do-list pads for.
 *   • Dock        — shrinks its cards when the Atlas is open.
 *   • DoList      — moves its create row to the top and becomes a short scroller in Atlas.
 *
 * It lives OUTSIDE React (like panel-store) because these readers sit in different
 * branches of the tree and some remount across navigation; an external store keeps a
 * single source of truth they all observe.
 *
 *   atlas      — true once zoomed out past the snap (span ≥ ~2.5 days): the day-column grid.
 *   heightFrac — the Timeline's height as a fraction of the card, in [0,1]. Grows
 *                continuously with zoom-out while in Lifelane, then jumps to the Atlas
 *                fraction at the snap. WorkSurface multiplies it by the live card height.
 */
export type TimelineView = { atlas: boolean; heightFrac: number }

let state: TimelineView = { atlas: false, heightFrac: 0.33 }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function setTimelineView(next: TimelineView) {
  if (state.atlas === next.atlas && state.heightFrac === next.heightFrac) return
  state = next
  emit()
}

const SERVER_VIEW: TimelineView = { atlas: false, heightFrac: 0.33 }

export function useTimelineView(): TimelineView {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_VIEW,
  )
}
