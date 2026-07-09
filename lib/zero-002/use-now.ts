"use client"

import { useSyncExternalStore } from "react"

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
