"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Dev-only on-screen FPS meter — a no-DevTools way to answer the 120Hz question.
 *
 * Reads the rAF cadence and shows: the live FPS (smoothed), plus the MAX FPS seen
 * since reset. The MAX is the key number for the refresh-rate thread:
 *   - max climbs to ~118–120  → the app IS presenting at full 120Hz; no vsync cap.
 *   - max pinned at ~60        → Chromium is capping vsync to 60Hz (the thread to pull).
 * Watch the LIVE number WHILE dragging/zooming the timeline:
 *   - stays near the max       → smooth, cost is fine.
 *   - drops well below max     → genuine per-frame cost (gesture-decoupling refactor).
 *
 * Renders nothing in production. Toggle with the backtick (`) key. Click "reset" (or
 * press R while hovering) to clear the max — do that right before a drag to capture
 * the drag's own min/max cleanly.
 */
export function FpsMeter() {
  const [fps, setFps] = useState(0)
  const [maxFps, setMaxFps] = useState(0)
  const [minFps, setMinFps] = useState(0)
  const [visible, setVisible] = useState(true)
  const resetRef = useRef(false)

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return

    let raf = 0
    let last = performance.now()
    // Exponential moving average so the readout is steady, not jittery per-frame.
    let ema = 0
    // Ignore the first few frames after mount / reset (warm-up spikes).
    let warmup = 0

    const tick = (now: number) => {
      const dt = now - last
      last = now
      if (dt > 0) {
        const inst = 1000 / dt
        ema = ema === 0 ? inst : ema * 0.9 + inst * 0.1
        if (resetRef.current) {
          resetRef.current = false
          ema = inst
          warmup = 0
          setMaxFps(0)
          setMinFps(0)
        }
        if (warmup < 10) {
          warmup++
        } else {
          const rounded = Math.round(ema)
          setFps(rounded)
          setMaxFps((m) => (rounded > m ? rounded : m))
          setMinFps((m) => (m === 0 || rounded < m ? rounded : m))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return
    const onKey = (e: KeyboardEvent) => {
      // Toggle with backtick (`) OR section sign (§) — the latter for keyboards
      // (e.g. ISO layouts) that have no backtick key. `e.code === "Backquote"`
      // also covers the physical key regardless of the layout's produced char.
      if (e.key === "`" || e.key === "§" || e.code === "Backquote") setVisible((v) => !v)
      if (e.key === "r" || e.key === "R") resetRef.current = true
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  if (process.env.NODE_ENV === "production" || !visible) return null

  return (
    <div
      className="fixed bottom-3 left-3 z-[9999] select-none rounded-md border border-border bg-card/90 px-3 py-2 font-mono text-xs text-card-foreground shadow-lg backdrop-blur"
      role="status"
      aria-label="FPS meter"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums leading-none">{fps}</span>
        <span className="text-muted-foreground">fps</span>
      </div>
      <div className="mt-1 flex gap-3 text-[10px] text-muted-foreground tabular-nums">
        <span>min {minFps}</span>
        <span>max {maxFps}</span>
      </div>
      <button
        type="button"
        onClick={() => {
          resetRef.current = true
        }}
        className="mt-1 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-card-foreground"
      >
        reset (R)
      </button>
      <div className="mt-1 text-[10px] text-muted-foreground">{"` or § to hide"}</div>
    </div>
  )
}
