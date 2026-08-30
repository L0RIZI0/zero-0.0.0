// ─────────────────────────────────────────────────────────────────────────────
// TICK GATE — a tiny global switch that pauses the app's once-per-second re-renders
// while the user is actively interacting with the canvas dayline (pan / drag / wheel).
//
// WHY: Grok's dayline engine animates pans on requestAnimationFrame, which shares the
// single main JS thread with React. Zero has several 1s `setInterval(setNow)` tickers
// (live duration counters, header clock) that each trigger a synchronous re-render —
// including re-scans over the activity log. When one lands mid-pan it steals a frame,
// producing a periodic ~1s stutter. Pausing those tickers for the brief moment of an
// active pan removes the contention; counters simply catch up on release.
//
// This is a plain module singleton (not React state) on purpose: signalling must be
// synchronous and allocation-free during a pan, and it must be readable from inside an
// interval callback without a re-render.
// ─────────────────────────────────────────────────────────────────────────────

let depth = 0
const endListeners = new Set<() => void>()

/** Call when a dayline pan/drag/wheel interaction begins. Ref-counted (nested/overlapping safe). */
export function beginDaylineInteraction(): void {
  depth++
}

/** Call when an interaction ends. When the last one clears, notifies listeners so counters catch up. */
export function endDaylineInteraction(): void {
  depth = Math.max(0, depth - 1)
  if (depth === 0) {
    for (const l of endListeners) l()
  }
}

/** True while at least one dayline interaction is in flight. Read this inside interval callbacks. */
export function isDaylineInteracting(): boolean {
  return depth > 0
}

/** Subscribe to "interaction fully ended" so a paused ticker can immediately refresh. */
export function onDaylineInteractionEnd(cb: () => void): () => void {
  endListeners.add(cb)
  return () => {
    endListeners.delete(cb)
  }
}
