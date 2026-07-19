"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Zero0ColorPicker — a compact, DEP-FREE HSV color picker (saturation/value square + hue
 * slider + hex field), styled to the zero0 mono aesthetic. Shared by the `--color` create-field
 * picker and the right-click "Set color" menu so custom colors (anything off the preset swatch
 * ramp) are pickable visually, not just typeable. Kept intentionally small (~176px) so it fits
 * inside the right-click menu popup as well as the roomy create field.
 *
 * Contract:
 *   - `value`   — the current "#rrggbb" (or short "#rgb"); seeds the picker. External updates are
 *                 adopted ONLY while not dragging, so a parent that echoes `onChange` back into
 *                 `value` can't fight the drag.
 *   - `onChange`— fires LIVE on every drag/type step with the normalized "#rrggbb". Use for a live
 *                 draft/preview.
 *   - `onCommit`— fires on pointer-release / Enter with the final "#rrggbb". Use to apply+close.
 *
 * All color math is inline (no deps): HSV⇄RGB⇄hex.
 */
export function Zero0ColorPicker({
  value,
  onChange,
  onCommit,
  className,
  showHexField = false,
}: {
  value?: string | null
  onChange?: (hex: string) => void
  onCommit?: (hex: string) => void
  className?: string
  /** v0.2.148: both callers now own an EXTERNAL hex/name field that the picker feeds, so the
   *  picker's own hex row is hidden by default (square + slider only). Set true for standalone use. */
  showHexField?: boolean
}) {
  const [hsv, setHsvState] = useState<Hsv>(() => {
    const rgb = value ? hexToRgb(value) : null
    return rgb ? rgbToHsv(rgb) : { h: 250, s: 0.5, v: 0.55 }
  })
  // A ref mirror so pointer handlers read the freshest hsv without stale-closure bugs.
  const hsvRef = useRef(hsv)
  const setHsv = useCallback((next: Hsv) => {
    hsvRef.current = next
    setHsvState(next)
  }, [])
  const dragging = useRef(false)
  // Local hex-field text so the user can type freely (partial values) without the field
  // being yanked mid-edit; committed on valid parse / Enter / blur.
  const [hexText, setHexText] = useState(() => hsvToHex(hsv.h, hsv.s, hsv.v))

  // Adopt external `value` changes (e.g. reopened on a different entity) — but never while the
  // user is dragging, and only when it actually maps to a different color than we already hold.
  useEffect(() => {
    if (dragging.current || !value) return
    const rgb = hexToRgb(value)
    if (!rgb) return
    const next = rgbToHsv(rgb)
    const cur = hsvRef.current
    if (hsvToHex(next.h, next.s, next.v) !== hsvToHex(cur.h, cur.s, cur.v)) {
      setHsv(next)
      setHexText(hsvToHex(next.h, next.s, next.v))
    }
  }, [value, setHsv])

  const emit = useCallback(
    (next: Hsv, commit: boolean) => {
      const hex = hsvToHex(next.h, next.s, next.v)
      setHexText(hex)
      onChange?.(hex)
      if (commit) onCommit?.(hex)
    },
    [onChange, onCommit],
  )

  // ── Saturation/Value square ────────────────────────────────────────────────────────────
  const svRef = useRef<HTMLDivElement>(null)
  const svFromEvent = useCallback(
    (clientX: number, clientY: number, commit: boolean) => {
      const el = svRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const s = clamp01((clientX - r.left) / r.width)
      const v = clamp01(1 - (clientY - r.top) / r.height)
      const next = { ...hsvRef.current, s, v }
      setHsv(next)
      emit(next, commit)
    },
    [emit, setHsv],
  )

  // ── Hue slider ─────────────────────────────────────────────────────────────────────────
  const hueRef = useRef<HTMLDivElement>(null)
  const hueFromEvent = useCallback(
    (clientX: number, commit: boolean) => {
      const el = hueRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const h = clamp01((clientX - r.left) / r.width) * 360
      const next = { ...hsvRef.current, h }
      setHsv(next)
      emit(next, commit)
    },
    [emit, setHsv],
  )

  const hex = hsvToHex(hsv.h, hsv.s, hsv.v)
  const hueColor = hsvToHex(hsv.h, 1, 1)

  return (
    <div className={"w-44 select-none " + (className ?? "")}>
      {/* SV square — drag to set saturation (x) + value/brightness (y). */}
      <div
        ref={svRef}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuetext={hex}
        tabIndex={0}
        onPointerDown={(e) => {
          dragging.current = true
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          svFromEvent(e.clientX, e.clientY, false)
        }}
        onPointerMove={(e) => {
          if (dragging.current) svFromEvent(e.clientX, e.clientY, false)
        }}
        onPointerUp={(e) => {
          dragging.current = false
          svFromEvent(e.clientX, e.clientY, true)
        }}
        className="relative h-28 w-full cursor-crosshair rounded-sm border border-border"
        style={{
          background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), hsl(${hsv.h} 100% 50%)`,
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: hex }}
        />
      </div>

      {/* Hue slider. */}
      <div
        ref={hueRef}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        tabIndex={0}
        onPointerDown={(e) => {
          dragging.current = true
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          hueFromEvent(e.clientX, false)
        }}
        onPointerMove={(e) => {
          if (dragging.current) hueFromEvent(e.clientX, false)
        }}
        onPointerUp={(e) => {
          dragging.current = false
          hueFromEvent(e.clientX, true)
        }}
        className="relative mt-1.5 h-1.5 w-full cursor-ew-resize rounded-full"
        style={{
          background:
            "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: hueColor }}
        />
      </div>

      {/* Hex field + live preview dot — hidden by default; the caller's external field is the
          single source of truth (it receives our onChange). Shown only for standalone use. */}
      {showHexField && (
      <div className="mt-2 flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-4 w-4 shrink-0 rounded-sm border border-border"
          style={{ backgroundColor: hex }}
        />
        <span className="text-[10px] text-muted-foreground">#</span>
        <input
          type="text"
          value={hexText.replace(/^#/, "")}
          spellCheck={false}
          onChange={(e) => {
            const t = e.target.value
            setHexText(t)
            const rgb = hexToRgb(t)
            if (rgb) {
              const next = rgbToHsv(rgb)
              setHsv(next)
              onChange?.(hsvToHex(next.h, next.s, next.v))
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              const rgb = hexToRgb(hexText)
              if (rgb) {
                const next = rgbToHsv(rgb)
                onCommit?.(hsvToHex(next.h, next.s, next.v))
              }
            }
          }}
          onBlur={() => {
            const rgb = hexToRgb(hexText)
            if (rgb) {
              const n = rgbToHsv(rgb)
              setHexText(hsvToHex(n.h, n.s, n.v))
            } else setHexText(hex) // snap back to the last valid color
          }}
          placeholder="rrggbb"
          aria-label="Hex color"
          className="w-20 rounded-sm border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums uppercase text-foreground focus:outline-none"
        />
      </div>
      )}
    </div>
  )
}

// ── color math (dep-free) ──────────────────────────────────────────────────────────────────
type Hsv = { h: number; s: number; v: number }

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function hexToRgb(input: string): [number, number, number] | null {
  let h = input.trim().replace(/^#/, "")
  if (h.length === 3) h = h.split("").map((c) => c + c).join("")
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  const n = Number.parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsv([r, g, b]: [number, number, number]): Hsv {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return { h, s, v: max }
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const to2 = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0")
  return `#${to2(r)}${to2(g)}${to2(b)}`
}
