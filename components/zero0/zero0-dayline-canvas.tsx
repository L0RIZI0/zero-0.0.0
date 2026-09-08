"use client"

// ─────────────────────────────────────────────────────────────────────────────
// DAYLINE CANVAS HOST — the React seam between Zero and the (external) view engine.
//
// This is the "mount + update" wrapper Grok asked for. It owns NOTHING about how the
// dayline looks — it hands the engine a <canvas>, feeds it `DaylineData`, keeps the
// size in sync, and forwards intent callbacks. All view geometry lives in the engine
// (`@/lib/dayline`); all model meaning lives behind `data`/`callbacks`.
//
// Lifecycle mirrors the contract exactly:
//   mount   → mountDayline({ surface, data, theme, callbacks, options })
//   change  → handle.update(data) / handle.setTheme(theme)
//   resize  → handle.resize(w, h)  (driven by a ResizeObserver here)
//   unmount → handle.destroy()
//
// It does NOT replace the current in-tree dayline yet — it's wired in alongside so the
// .347 scroll dayline stays the working stopgap until the engine proves out.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react"
import { mountDayline } from "@zero/dayline"
import { beginDaylineInteraction, endDaylineInteraction } from "@/lib/zero/tick-gate"
import type {
  DaylineData,
  DaylineTheme,
  DaylineCallbacks,
  DaylineOptions,
  DaylineHandle,
} from "@/packages/dayline-contract"

export interface Zero0DaylineCanvasProps {
  data: DaylineData
  theme?: DaylineTheme
  callbacks?: DaylineCallbacks
  options?: DaylineOptions
  className?: string
}

export function Zero0DaylineCanvas({ data, theme, callbacks, options, className }: Zero0DaylineCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const handleRef = useRef<DaylineHandle | null>(null)

  // Callbacks are held in a ref so a parent re-render passing new closures does NOT force a remount of
  // the engine. The engine is mounted once; only data/theme/size stream in.
  const cbRef = useRef<DaylineCallbacks | undefined>(callbacks)
  cbRef.current = callbacks

  // ── MOUNT ONCE ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handle = mountDayline({
      surface: canvas,
      data,
      theme,
      // Zero drives its own clock: "wall" means the engine reads real time itself and must NOT be fed a
      // per-second `now` via update() (that would rebuild marks mid-drag). nowRestFraction keeps NOW at
      // 1/3 from the left at rest. Caller `options` can still override these.
      options: { clock: "wall", nowRestFraction: 1 / 3, ...options },
      // Indirect through the ref so the engine always calls the latest handlers.
      callbacks: {
        onActivate: (id, mark) => cbRef.current?.onActivate?.(id, mark),
        onOccurrenceMenu: (id, ref, x, y) => cbRef.current?.onOccurrenceMenu?.(id, ref, x, y),
        onSessionMenu: (id, sid, x, y) => cbRef.current?.onSessionMenu?.(id, sid, x, y),
        onOccurrenceRetime: (id, ref, s, e) => cbRef.current?.onOccurrenceRetime?.(id, ref, s, e),
        onSessionRetime: (id, sid, s, e) => cbRef.current?.onSessionRetime?.(id, sid, s, e),
        onEmptyClick: (t) => cbRef.current?.onEmptyClick?.(t),
        onBandMenu: (x, y) => cbRef.current?.onBandMenu?.(x, y),
      },
    })
    handleRef.current = handle

    // Keep the drawing buffer sized to the element's box.
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) handle.resize(box.width, box.height)
    })
    ro.observe(canvas)
    // Initial size.
    const rect = canvas.getBoundingClientRect()
    handle.resize(rect.width, rect.height)

    // ── PAN-STUTTER GATE ──
    // Signal Zero's 1s tickers to stand down during an active pointer drag or wheel gesture on the
    // canvas, so their synchronous re-render never steals a frame from the engine's rAF pan.
    // Pointer: begin on down, end on up/cancel (down↔up brackets the whole drag).
    // Wheel: momentum has no "end" event, so hold the gate open on a trailing debounce.
    let pointerHeld = false
    let wheelTimer: ReturnType<typeof setTimeout> | null = null
    const onPointerDown = () => {
      pointerHeld = true
      beginDaylineInteraction()
    }
    const releasePointer = () => {
      if (!pointerHeld) return
      pointerHeld = false
      endDaylineInteraction()
    }
    const onWheel = () => {
      if (wheelTimer === null) beginDaylineInteraction()
      else clearTimeout(wheelTimer)
      wheelTimer = setTimeout(() => {
        wheelTimer = null
        endDaylineInteraction()
      }, 180)
    }
    canvas.addEventListener("pointerdown", onPointerDown)
    // Listen on window for up/cancel so a release outside the canvas still clears the gate.
    window.addEventListener("pointerup", releasePointer)
    window.addEventListener("pointercancel", releasePointer)
    canvas.addEventListener("wheel", onWheel, { passive: true })

    // ── RECENTER-TO-NOW BRIDGE ──
    // Zero chrome (the clock-header time) dispatches this window event to scroll the dayline back to
    // "now". Route it to the engine handle's imperative goToNow (present from a recent @zero/dayline;
    // older engines lack it → harmless no-op). A window event avoids threading a ref up through
    // agenda → dayline-view → this host.
    const onRecenter = () => handleRef.current?.goToNow?.()
    window.addEventListener("zero:dayline-recenter", onRecenter)

    return () => {
      ro.disconnect()
      canvas.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("pointerup", releasePointer)
      window.removeEventListener("pointercancel", releasePointer)
      canvas.removeEventListener("wheel", onWheel)
      window.removeEventListener("zero:dayline-recenter", onRecenter)
      // Balance the counter if we tore down mid-gesture, so depth never sticks above 0.
      if (pointerHeld) endDaylineInteraction()
      if (wheelTimer !== null) {
        clearTimeout(wheelTimer)
        endDaylineInteraction()
      }
      handle.destroy()
      handleRef.current = null
    }
    // Mount once — data/theme are streamed via the effects below, not via remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── STREAM DATA ──
  useEffect(() => {
    handleRef.current?.update(data)
  }, [data])

  // ── STREAM THEME ──
  useEffect(() => {
    if (theme) handleRef.current?.setTheme(theme)
  }, [theme])

  return <canvas ref={canvasRef} className={className} style={{ display: "block", width: "100%", height: "100%" }} />
}

/**
 * Read Zero's resolved theme colors off the document so the engine never needs the DOM. Call inside a
 * component (client) and pass the result as the `theme` prop. Returns concrete color strings.
 */
export function readDaylineTheme(el: HTMLElement | null = typeof document !== "undefined" ? document.body : null): DaylineTheme {
  if (!el) return {}
  const cs = getComputedStyle(el)
  const v = (name: string) => cs.getPropertyValue(name).trim() || undefined
  const scheme =
    (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) ? "dark" : "light"
  return {
    background: v("--background"),
    foreground: v("--foreground"),
    muted: v("--muted-foreground") ?? v("--muted"),
    border: v("--border"),
    now: v("--primary") ?? v("--accent"),
    scheme,
  }
}
