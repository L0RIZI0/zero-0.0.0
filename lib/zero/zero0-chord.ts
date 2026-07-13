"use client"

import { useSyncExternalStore } from "react"

// ============================================================================
// `/0` §-prefix CHORDS — visibility toggles for the canvas's chrome bands
// ----------------------------------------------------------------------------
// A lean, dependency-free port of /2's `debug-view` chord, generalised to a small
// set of boolean visibility FLAGS. `§` is a one-shot PREFIX: press it, then press a
// digit within a short window to toggle the matching frame — top-to-bottom the digit
// order mirrors the stack (§3 topmost AGENDA … §0 the ENTITY HEADER):
//
//   §0 → the ENTITY HEADER  (the open node's raw-data block: glyph/title/kind + meta + log)
//   §1 → the ZERO HEADER    (the "zero · root canvas" top helper: mark + breadcrumb + session)
//   §2 → the ACTIVITY frame  (presence dayline + details) — mirrors the footer "activity" link
//   §3 → the AGENDA frame    (planned dayline)           — mirrors the footer "agenda" link
//   §4 → the FREQUENT frame  (quick-create tiles for recurring activities) — topmost band
//
// `readout` (the ACTIVITY details rollup/feed) is still a flag but is NO LONGER chorded —
// it's toggled only by the in-frame "show/hide details" link.
//
// We key off `§` (ISO/EU layouts) and accept the physical backtick (`Backquote`) as a
// fallback, exactly like /2. Chords typed into inputs/editables are ignored.
//
// One module-level flag map + one global keydown listener serve every subscriber via
// useSyncExternalStore, so every toggle stays in lockstep across the tree.
// ============================================================================

/** The visibility flags. Chrome headers + AGENDA default to shown (AGENDA as a minimized
 *  band); only ACTIVITY defaults to HIDDEN until summoned. */
export type Zero0Flag = "entityHeader" | "zeroHeader" | "activity" | "agenda" | "frequent" | "readout"

// Which digit (pressed after §) toggles which frame. `readout` is intentionally absent.
const DIGIT_FLAG: Record<string, Zero0Flag> = {
  "0": "entityHeader",
  "1": "zeroHeader",
  "2": "activity",
  "3": "agenda",
  "4": "frequent",
}

/** Reverse map — the § digit that toggles a given flag. Drives the in-frame "§x" corner
 *  markers so their label can never drift from the keybinding. `readout` has no digit. */
export const FLAG_DIGIT: Partial<Record<Zero0Flag, string>> = Object.fromEntries(
  Object.entries(DIGIT_FLAG).map(([digit, flag]) => [flag, digit]),
) as Partial<Record<Zero0Flag, string>>

// Chrome headers shown by default; AGENDA also shown (as a minimized band — see the
// canvas `minimized` init); ACTIVITY stays hidden until toggled.
const visible: Record<Zero0Flag, boolean> = {
  entityHeader: true,
  zeroHeader: true,
  activity: false,
  agenda: true,
  // FREQUENT (§4) — the quick-create tile band. Shown by default for now (per request).
  frequent: true,
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
