"use client"

import { useSyncExternalStore } from "react"

// ============================================================================
// `/0` §-prefix CHORD — the activity READOUT toggle (`§ 3`)
// ----------------------------------------------------------------------------
// A lean, dependency-free port of /2's `debug-view` chord, scoped to ONE flag:
// whether the activity READOUT (the textual rollup + feed — the "tracker frame")
// is shown. The presence DAYLINE is deliberately NOT chorded: as long as the
// footer "activity" band is on, the dayline stays put; `§ 3` only hides/shows the
// readout that sits under it.
//
// `§` is a one-shot PREFIX: press it, then press `3` within a short window. We key
// off `§` (ISO/EU layouts) and accept the physical backtick (`Backquote`) as a
// fallback, exactly like /2. Chords typed into inputs/editables are ignored.
//
// One module-level flag + one global keydown listener serve every subscriber via
// useSyncExternalStore, so the toggle stays in lockstep across the tree.
// ============================================================================

// Shown by default: when the band first opens, both dayline + readout are visible;
// `§ 3` then hides/re-shows the readout.
let readoutVisible = true
const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}

/** Toggle the activity readout (also used by the on-screen "§3 hide" affordance). */
export function toggleZero0Readout() {
  readoutVisible = !readoutVisible
  emit()
}

let installed = false
function ensureListener() {
  if (installed || typeof window === "undefined") return
  installed = true

  let prefixActive = false
  let prefixTimer: ReturnType<typeof setTimeout> | null = null
  const clearPrefix = () => {
    prefixActive = false
    if (prefixTimer) clearTimeout(prefixTimer)
    prefixTimer = null
  }

  window.addEventListener("keydown", (e) => {
    // Ignore chords typed into inputs / editable fields (e.g. the create field).
    const t = e.target as HTMLElement | null
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return

    // Arm the prefix on § (or the physical backtick key).
    if (e.key === "§" || e.code === "Backquote") {
      prefixActive = true
      if (prefixTimer) clearTimeout(prefixTimer)
      prefixTimer = setTimeout(clearPrefix, 800) // generous window to press the digit
      return
    }

    if (prefixActive && e.key === "3") {
      e.preventDefault()
      toggleZero0Readout()
      clearPrefix()
    } else if (prefixActive) {
      // Any other key disarms the prefix (only §3 is bound on /0 for now).
      clearPrefix()
    }
  })
}

const subscribe = (cb: () => void) => {
  ensureListener()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Subscribe to the readout-visibility flag. SSR/first paint returns the default (true). */
export function useZero0Readout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readoutVisible,
    () => readoutVisible,
  )
}
