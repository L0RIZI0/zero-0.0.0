"use client"

import { useLayoutEffect, useRef } from "react"

/** One keyed element's geometry + paint, captured in VIEWPORT coords (getBoundingClientRect), so the
 *  overlay can fly a clone between two layouts with position:fixed (v0.2.313). */
export interface MorphCell {
  left: number
  top: number
  width: number
  height: number
  bg: string
  border: string
  radius: number
}

/** Snapshot every keyed element under `root` into a key→cell map. `attr` is the identity attribute
 *  (`data-barkey` on the dayline, `data-calkey` on the calendar) — the SAME key values across views, so
 *  a tick and its calendar block resolve to one another. First occurrence wins, so a calendar block is
 *  captured rather than its external label chip (blocks render before chips + share the key). */
export function captureCells(root: HTMLElement | null, attr: string): Map<string, MorphCell> {
  const map = new Map<string, MorphCell>()
  if (!root) return map
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${attr}]`))) {
    const key = el.getAttribute(attr)
    if (!key || map.has(key)) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 0 && r.height <= 0) continue
    const cs = getComputedStyle(el)
    map.set(key, {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      bg: cs.backgroundColor,
      border: cs.borderTopColor,
      radius: Number.parseFloat(cs.borderTopLeftRadius) || 3,
    })
  }
  return map
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** ease-in-out cubic — a calm, symmetric morph. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

function place(el: HTMLDivElement, c: MorphCell) {
  el.style.left = `${c.left}px`
  el.style.top = `${c.top}px`
  el.style.width = `${c.width}px`
  el.style.height = `${c.height}px`
  el.style.borderRadius = `${c.radius}px`
}

/** Flies a set of keyed clones from `from` geometry to `to` geometry in a single rAF loop, and (if a
 *  `heightHost` is given) animates that container's height from `fromH`→`toH` on the SAME clock so the
 *  frame grows/shrinks in lockstep with the ticks (v0.2.313). Keys present in both views tween shape +
 *  position (a horizontal dayline tick morphs into a vertical calendar block, and vice-versa); keys on
 *  only one side fade out (from-only) or fade in at their destination (to-only). Calls `onDone` once. */
export function MorphOverlay({
  from,
  to,
  duration = 400,
  heightHost,
  fromH,
  toH,
  onDone,
}: {
  from: Map<string, MorphCell>
  to: Map<string, MorphCell>
  duration?: number
  heightHost?: React.RefObject<HTMLElement | null>
  fromH?: number
  toH?: number
  onDone: () => void
}) {
  const layerRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    const keys = new Set<string>([...from.keys(), ...to.keys()])
    const nodes: { a?: MorphCell; b?: MorphCell; el: HTMLDivElement }[] = []
    for (const k of keys) {
      const a = from.get(k)
      const b = to.get(k)
      const seed = (b ?? a) as MorphCell
      const el = document.createElement("div")
      el.style.position = "fixed"
      el.style.margin = "0"
      el.style.boxSizing = "border-box"
      el.style.pointerEvents = "none"
      el.style.background = seed.bg
      el.style.border = `1px solid ${seed.border}`
      el.style.willChange = "left, top, width, height"
      layer.appendChild(el)
      nodes.push({ a, b, el })
    }

    const host = heightHost?.current ?? null
    const animH = host != null && fromH != null && toH != null

    let raf = 0
    const start = performance.now()
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const e = ease(p)
      for (const { a, b, el } of nodes) {
        if (a && b) {
          el.style.left = `${lerp(a.left, b.left, e)}px`
          el.style.top = `${lerp(a.top, b.top, e)}px`
          el.style.width = `${lerp(a.width, b.width, e)}px`
          el.style.height = `${lerp(a.height, b.height, e)}px`
          el.style.borderRadius = `${lerp(a.radius, b.radius, e)}px`
          el.style.opacity = "1"
        } else if (a) {
          place(el, a)
          el.style.opacity = String(1 - e)
        } else if (b) {
          place(el, b)
          el.style.opacity = String(e)
        }
      }
      if (animH && host) host.style.height = `${lerp(fromH!, toH!, e)}px`
      if (p < 1) raf = requestAnimationFrame(frame)
      else doneRef.current()
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      for (const { el } of nodes) el.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={layerRef} className="pointer-events-none fixed inset-0 z-50" aria-hidden />
}
