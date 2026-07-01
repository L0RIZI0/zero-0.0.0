"use client"

import { useSyncExternalStore } from "react"

// ============================================================================
// Shared DEBUG-view store ([v0] DEBUG)
// ----------------------------------------------------------------------------
// Two independently-toggleable dev overlays, flipped by a `§`-prefixed chord:
//   • `§ 1` → the FPS meter window (bottom-left)
//   • `§ 2` → the colored element frames + their ID/property labels
//
// `§` is used as a one-shot PREFIX: press it, then press 1 or 2 within a short
// window. We use § (not the backtick) because some keyboards (ISO/EU layouts)
// have no backtick key; `e.code === "Backquote"` is accepted as a fallback so the
// physical key works regardless of the produced character.
//
// One module-level store + one global keydown listener serve every subscriber
// (FPS meter + all four frame components), so the toggles stay in lockstep and
// there's a single source of truth. Remove this whole file with the debug borders.
// ============================================================================

type DebugState = { fps: boolean; frames: boolean }

// Both overlays default OFF; reveal them on demand via the `§ 1` / `§ 2` chords.
let state: DebugState = { fps: false, frames: false }

const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}

function setState(next: Partial<DebugState>) {
  state = { ...state, ...next }
  emit()
}

export function toggleDebugFps() {
  setState({ fps: !state.fps })
}
export function toggleDebugFrames() {
  setState({ frames: !state.frames })
}

// --- Global `§`-prefix chord listener (installed once, client-only) ----------
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
    // Ignore chords typed into inputs/editable fields.
    const t = e.target as HTMLElement | null
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return

    // Arm the prefix on § (or the physical backtick key).
    if (e.key === "§" || e.code === "Backquote") {
      prefixActive = true
      if (prefixTimer) clearTimeout(prefixTimer)
      // Give a generous window to press the digit, then disarm.
      prefixTimer = setTimeout(clearPrefix, 800)
      return
    }

    if (prefixActive && (e.key === "1" || e.key === "2")) {
      e.preventDefault()
      if (e.key === "1") toggleDebugFps()
      else toggleDebugFrames()
      clearPrefix()
    }
  })
}

const subscribe = (cb: () => void) => {
  ensureListener()
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Subscribe to the debug-view flags. SSR/first-paint returns the default state. */
export function useDebugView(): DebugState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}
