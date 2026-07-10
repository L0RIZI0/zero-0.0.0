"use client"

import { useSyncExternalStore } from "react"

// ============================================================================
// `/0` §-prefix CHORDS — visibility toggles for the canvas's chrome bands
// ----------------------------------------------------------------------------
// A lean, dependency-free port of /2's `debug-view` chord, generalised to a small
// set of boolean visibility FLAGS. `§` is a one-shot PREFIX: press it, then press a
// digit within a short window to toggle the matching band:
//
//   §0 → the ENTITY HEADER  (the open node's raw-data block: glyph/title/kind + meta + log)
//   §1 → the ZERO HEADER    (the "zero · root canvas" top helper: mark + breadcrumb + session)
//   §3 → the activity READOUT (the textual rollup + feed under the presence dayline)
//
// We key off `§` (ISO/EU layouts) and accept the physical backtick (`Backquote`) as a
// fallback, exactly like /2. Chords typed into inputs/editables are ignored.
//
// One module-level flag map + one global keydown listener serve every subscriber via
// useSyncExternalStore, so every toggle stays in lockstep across the tree.
// ============================================================================

/** The chorded visibility bands. All default to shown. */
export type Zero0Flag = "entityHeader" | "zeroHeader" | "readout"

// Which digit (pressed after §) toggles which band.
const DIGIT_FLAG: Record<string, Zero0Flag> = {
  "0": "entityHeader",
  "1": "zeroHeader",
  "3": "readout",
}

// Everything shown by default; a chord (or an on-screen affordance) hides/re-shows it.
const visible: Record<Zero0Flag, boolean> = {
  entityHeader: true,
  zeroHeader: true,
  readout: true,
}

const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}

/** Toggle any chorded band (also used by on-screen affordances like "§3 hide"). */
export function toggleZero0Flag(flag: Zero0Flag) {
  visible[flag] = !visible[flag]
  emit()
}

/** Back-compat alias — the activity readout's own "§3 hide" affordance calls this. */
export function toggleZero0Readout() {
  toggleZero0Flag("readout")
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

    if (!prefixActive) return

    const flag = DIGIT_FLAG[e.key]
    if (flag) {
      e.preventDefault()
      toggleZero0Flag(flag)
    }
    // Any key while armed (bound or not) disarms the one-shot prefix.
    clearPrefix()
  })
}

const subscribe = (cb: () => void) => {
  ensureListener()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Subscribe to a single band's visibility. SSR/first paint returns the default (true). */
export function useZero0Flag(flag: Zero0Flag): boolean {
  return useSyncExternalStore(
    subscribe,
    () => visible[flag],
    () => visible[flag],
  )
}

/** Back-compat hook — the activity component reads the readout flag through this. */
export function useZero0Readout(): boolean {
  return useZero0Flag("readout")
}
