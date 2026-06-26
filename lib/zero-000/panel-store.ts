"use client"

import { useCallback, useSyncExternalStore } from "react"

/**
 * Reactive, module-level memory of each side panel's open/closed state, keyed by
 * `${entityId}:${"in"|"out"}`.
 *
 * It lives OUTSIDE React for two reasons:
 *   1. EntityBody is re-mounted whenever the window stack changes (a row morphs
 *      into a window, a window reflows to a spine). Local component state would
 *      reset to its default on every remount; an external store preserves the
 *      user's open/closed choice across them.
 *   2. Both EntityBody (to size + animate the side slots) AND the navigation
 *      layer (to auto-collapse a parent's panels when a child opens) read and
 *      write the same state.
 */
const state = new Map<string, boolean>()
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

export function setPanelOpen(key: string, open: boolean) {
  if (state.get(key) === open) return
  state.set(key, open)
  emit()
}

/**
 * Collapse BOTH side panels of an entity. Called when that entity opens a child
 * window, so the parent reflows clean behind/around the child (and is collapsed
 * again the next time it returns to the front). No-op if already collapsed.
 */
export function collapseEntityPanels(entityId: string) {
  let changed = false
  for (const side of ["in", "out"] as const) {
    const k = `${entityId}:${side}`
    if (state.get(k)) {
      state.set(k, false)
      changed = true
    }
  }
  if (changed) emit()
}

/**
 * Subscribe to a single panel's open state. `defaultOpen` is used until the
 * panel has been toggled at least once. Returns a tuple like useState.
 */
export function usePanelOpen(key: string, defaultOpen = false): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    subscribe,
    () => (state.has(key) ? (state.get(key) as boolean) : defaultOpen),
    () => defaultOpen,
  )
  const set = useCallback((next: boolean) => setPanelOpen(key, next), [key])
  return [open, set]
}
