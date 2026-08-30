"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { isDaylineInteracting, onDaylineInteractionEnd } from "./tick-gate"

// ============================================================================
// Shared minute clock.
// ----------------------------------------------------------------------------
// A single source of "now" for the whole app so independent widgets (the header
// time/date and the Dayline NOW marker) never drift apart. Previously each ran
// its own setInterval started at a different moment, so their minute boundaries
// didn't line up — the header could read 12:50 AM while the Dayline read 00:49.
//
// One module-level interval ticks ALL subscribers from the same value, and the
// first tick is ALIGNED to the wall-clock minute boundary (fires at :00 seconds),
// so the displayed minute flips simultaneously everywhere — including across the
// midnight / 5am date rollovers the header cares about.
//
// `useSyncExternalStore` gives a stable SSR snapshot (0) so server == first client
// paint; consumers still gate time-dependent UI on their own `mounted` flag.
// ============================================================================

let current = 0
const listeners = new Set<() => void>()
let tickTimer: ReturnType<typeof setTimeout> | null = null
let intervalTimer: ReturnType<typeof setInterval> | null = null

function emit() {
  current = Date.now()
  for (const l of listeners) l()
}

function start() {
  current = Date.now()
  // Align the first tick to the next minute boundary, then tick every 60s.
  const msToNextMinute = 60_000 - (Date.now() % 60_000)
  tickTimer = setTimeout(() => {
    emit()
    intervalTimer = setInterval(emit, 60_000)
  }, msToNextMinute)
}

function stop() {
  if (tickTimer) clearTimeout(tickTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  tickTimer = null
  intervalTimer = null
}

function subscribe(cb: () => void) {
  const wasEmpty = listeners.size === 0
  listeners.add(cb)
  if (wasEmpty) start()
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) stop()
  }
}

const getSnapshot = () => current
const getServerSnapshot = () => 0

/** Shared "now" in epoch ms, updated once per (wall-clock-aligned) minute. Returns
 *  0 on the server and the first client render — gate time-dependent UI on `mounted`. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// ---------------------------------------------------------------------------
// Per-SECOND clock (separate store).
// ---------------------------------------------------------------------------
// A second, independent store ticking every second — for the glued-top live clock
// that shows seconds. Kept separate from the minute clock so the rest of the app
// (dayline marker, etc.) isn't forced onto a 1s cadence; only subscribers of THIS
// hook pay for the per-second re-render, and the interval runs only while at least
// one is mounted. Same SSR-safe snapshot (0) contract as `useNow`.
let currentSec = 0
const secListeners = new Set<() => void>()
let secInterval: ReturnType<typeof setInterval> | null = null
let secOffEnd: (() => void) | null = null

function emitSec() {
  // PAN-STUTTER GATE: while the user is panning/dragging the canvas dayline, hold this per-second
  // store still. It fans out to the whole app (canvas, content, detail panel, calendar), so its 1s
  // re-render is the single biggest main-thread spike that competes with the engine's rAF pan.
  // On release, onDaylineInteractionEnd fires emitSec once so every subscriber catches up instantly.
  if (isDaylineInteracting()) return
  currentSec = Date.now()
  for (const l of secListeners) l()
}

function subscribeSec(cb: () => void) {
  const wasEmpty = secListeners.size === 0
  secListeners.add(cb)
  if (wasEmpty) {
    currentSec = Date.now()
    secInterval = setInterval(emitSec, 1000)
    // Catch up the instant a pan ends so counters never look frozen.
    secOffEnd = onDaylineInteractionEnd(() => emitSec())
  }
  return () => {
    secListeners.delete(cb)
    if (secListeners.size === 0 && secInterval) {
      clearInterval(secInterval)
      secInterval = null
      secOffEnd?.()
      secOffEnd = null
    }
  }
}

const getSecSnapshot = () => currentSec

/** Shared "now" in epoch ms, updated once per second. Returns 0 on the server and the
 *  first client render — gate time-dependent UI on `mounted`. */
export function useNowSeconds(): number {
  return useSyncExternalStore(subscribeSec, getSecSnapshot, getServerSnapshot)
}

// ---------------------------------------------------------------------------
// requestAnimationFrame clock (per-COMPONENT, not shared).
// ---------------------------------------------------------------------------
// A high-frequency "now" for VISUAL geometry that must glide continuously rather than
// jump on a 1s boundary — e.g. the dayline NOW marker and open-tick right edges, which
// at a zoomed-in span move a couple px/sec and looked stuttery on the per-second clock.
// Keep DATA derivation (which sessions are open, projections, day window) on the coarse
// per-second/minute clocks; use THIS only for the moving edges. Returns 0 until `active`
// so SSR/first paint stay stable; throttled to `minIntervalMs` (default ~30fps) so the
// per-frame re-render cost stays bounded (the value moves far less than a pixel between
// updates at any real zoom, so the motion still reads as continuous).
//
// `shouldUpdate` (optional): a ref-backed predicate checked each frame — while it returns
// false the rAF keeps spinning but SKIPS the `setNow` re-render. The dayline passes a check
// that's false during an active pan/ripple, so the smooth clock never stacks a 30fps React
// re-render on top of the imperative pan loop (which drives everything via transforms and
// needs the main thread). When the pan settles, updates resume with no gap.
export function useAnimationFrameNow(
  active: boolean,
  minIntervalMs = 33,
  shouldUpdate?: () => boolean,
): number {
  const [now, setNow] = useState(0)
  const lastRef = useRef(0)
  const shouldRef = useRef(shouldUpdate)
  shouldRef.current = shouldUpdate
  useEffect(() => {
    if (!active) return
    let raf = 0
    const tick = () => {
      const t = Date.now()
      if (t - lastRef.current >= minIntervalMs && shouldRef.current?.() !== false) {
        lastRef.current = t
        setNow(t)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, minIntervalMs])
  return now
}
