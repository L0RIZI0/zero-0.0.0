"use client"

import { useEffect } from "react"
import { useAnimationControls } from "motion/react"
import { useZeroNav } from "./nav-store"

/**
 * Returns animation controls that play a brief "attention" bounce whenever the
 * nav store requests a pulse for `id` (e.g. the user re-clicks the timeline chip
 * of an entity whose window is already open in front of them). The bounce is a
 * quick scale dip-and-settle — calm, not cartoonish — and re-fires for repeat
 * clicks because the store increments a counter on every request.
 *
 * Attach the returned controls to the frame root's `animate` prop. The frame
 * root also carries a shared `layoutId`; the bounce only runs while the frame is
 * stably open (never mid-morph), so it doesn't disturb the layout projection.
 */
export function usePulse(id: string) {
  const { pulse } = useZeroNav()
  const controls = useAnimationControls()

  useEffect(() => {
    if (!pulse || pulse.id !== id) return
    let cancelled = false
    ;(async () => {
      await controls.start({
        scale: [1, 1.035, 0.992, 1],
        transition: { duration: 0.42, ease: [0.22, 0.61, 0.36, 1], times: [0, 0.3, 0.65, 1] },
      })
      if (!cancelled) controls.set({ scale: 1 })
    })()
    return () => {
      cancelled = true
    }
    // Keyed on `n` so identical repeat requests still re-trigger the bounce.
  }, [pulse?.n, pulse?.id, id, controls])

  return controls
}
