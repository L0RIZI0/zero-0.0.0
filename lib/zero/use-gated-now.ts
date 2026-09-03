"use client"

import { useEffect, useState } from "react"
import { isDaylineInteracting, onDaylineInteractionEnd } from "./tick-gate"

/**
 * A once-per-`ms` clock that PAUSES while the user is panning/dragging the canvas dayline, then catches
 * up the instant the interaction ends. Drop-in replacement for the common
 * `const [now,setNow]=useState(()=>Date.now()); useEffect(()=>{setInterval(()=>setNow(Date.now()),ms)},[])`
 * pattern — but it won't steal an animation frame from the engine mid-pan.
 *
 * @param ms       tick period (e.g. 1000 for a seconds clock)
 * @param enabled  when false the clock is frozen entirely (matches conditional tickers)
 */
export function useGatedNow(ms: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    // Refresh once on (re)enable so we don't show a stale value.
    setNow(Date.now())
    const id = setInterval(() => {
      // Skip the tick while a pan/drag is in flight — this is the whole point.
      if (isDaylineInteracting()) return
      setNow(Date.now())
    }, ms)
    // When the interaction releases, update immediately so counters don't look frozen.
    const off = onDaylineInteractionEnd(() => setNow(Date.now()))
    return () => {
      clearInterval(id)
      off()
    }
  }, [ms, enabled])
  return now
}
