"use client"

import { useSyncExternalStore } from "react"
import { clearUserItems, clearResourceLastUrls } from "./persistence"
import { clearActivityLog } from "./activity-log"
import { cycleBrat } from "./motion"

// ============================================================================
// Shared DEBUG-view store ([v0] DEBUG)
// ----------------------------------------------------------------------------
// Dev overlays, flipped by a `§`-prefixed chord:
//   • `§ 1` → the FPS + morph-time helper (bottom-left). Each press ALSO cycles the
//            global BRAT (morph time) through BRAT_STEPS — every big animation scales
//            off it (see motion.ts). The overlay auto-reveals on the first press and
//            auto-hides 10s after the LAST press (transient, not a sticky toggle).
//   • `§ 2` → the colored element frames + their ID/property labels
//   • `§ 3` → the ACTIVITY inspector (today's presence segments + per-space totals)
//   • `§ 4` → the HIERARCHY inspector (the whole containment tree, root → leaves)
//   • `§ 0` → RESET PREVIEW DATA: wipe THIS browser's persisted user items
//            (created entities + pins + tombstones + overrides) AND the activity
//            log, then reload, so the app returns to pure seed data. localStorage
//            is per-browser, so this only affects the browser it's pressed in
//            (never Electron).
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

type DebugState = { fps: boolean; frames: boolean; activity: boolean; hierarchy: boolean }

// All overlays default OFF; reveal them on demand via the `§ 1`..`§ 4` chords.
let state: DebugState = { fps: false, frames: false, activity: false, hierarchy: false }

const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}

function setState(next: Partial<DebugState>) {
  state = { ...state, ...next }
  emit()
}

// The FPS/morph-time helper is TRANSIENT: it reveals on a `§ 1` press and auto-hides
// this long after the LAST press (each press restarts the countdown). Not a sticky toggle.
const FPS_AUTOHIDE_MS = 10_000
let fpsHideTimer: ReturnType<typeof setTimeout> | null = null

/**
 * `§ 1` action: (1) reveal the FPS/morph-time overlay if hidden, (2) advance the global
 * BRAT to the next step (so §1 doubles as the morph-time cycler), and (3) (re)start the
 * 10s auto-hide countdown. Repeated presses keep it visible AND keep cycling BRAT.
 */
export function pulseDebugFps() {
  cycleBrat()
  if (!state.fps) setState({ fps: true })
  if (fpsHideTimer) clearTimeout(fpsHideTimer)
  fpsHideTimer = setTimeout(() => {
    fpsHideTimer = null
    setState({ fps: false })
  }, FPS_AUTOHIDE_MS)
}
export function toggleDebugFrames() {
  setState({ frames: !state.frames })
}
export function toggleDebugActivity() {
  setState({ activity: !state.activity })
}
export function toggleDebugHierarchy() {
  setState({ hierarchy: !state.hierarchy })
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

    if (
      prefixActive &&
      (e.key === "0" || e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4")
    ) {
      e.preventDefault()
      if (e.key === "1") pulseDebugFps()
      else if (e.key === "2") toggleDebugFrames()
      else if (e.key === "3") toggleDebugActivity()
      else if (e.key === "4") toggleDebugHierarchy()
      else {
        // `§ 0` — reset THIS browser's preview data back to pure seeds. Confirmed
        // because it clears created entities too (web-preview store is disposable,
        // but a stray chord shouldn't silently wipe it).
        const ok = window.confirm(
          "Reset preview data?\n\nThis clears this browser's created entities, pins, deletions (including the tombstones hiding the seeded spaces/tasks), and the activity log, then reloads with fresh seed data.\n\nThis only affects THIS browser — your Electron app is untouched.",
        )
        if (ok) {
          clearUserItems()
          clearActivityLog()
          clearResourceLastUrls()
          window.location.reload()
        }
      }
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
