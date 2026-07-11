"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"

/** Which minimizable frame a right-click targeted, plus the click position. */
export interface Zero0FrameMenuAnchor {
  frame: "agenda" | "activity" | "zeroHeader"
  x: number
  y: number
}

/**
 * A lean right-click menu for a MINIMIZABLE frame (TODAY / ACTIVITY / ZERO HEADER).
 * Distinct from the per-entity menu ({@link Zero0DomMenu}): it acts on the FRAME chrome,
 * not a data node. It
 * offers a single toggle — "Minimize the frame" (collapse to just its dayline band) or
 * "Maximize the frame" (restore the full render) — and shares the entity menu's chrome
 * (fixed position, viewport-clamped, closes on outside pointer-down / Escape). Kept as
 * its own tiny component so the two menus stay independent and easy to reason about.
 */
export function Zero0FrameMenu({
  anchor,
  minimized,
  onToggle,
  onClose,
}: {
  anchor: Zero0FrameMenuAnchor
  /** Whether the targeted frame is currently minimized (flips the menu wording). */
  minimized: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y })

  // Clamp inside the viewport once the menu's size is known.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { innerWidth, innerHeight } = window
    const rect = el.getBoundingClientRect()
    setPos({
      x: Math.min(anchor.x, innerWidth - rect.width - 8),
      y: Math.min(anchor.y, innerHeight - rect.height - 8),
    })
  }, [anchor.x, anchor.y])

  // Dismiss on outside pointer-down or Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-40 border border-border bg-background py-1 text-[11px] tabular-nums shadow-none"
      style={{ left: pos.x, top: pos.y, fontFamily: "var(--font-zero0-mono), ui-monospace, monospace" }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onToggle()
          onClose()
        }}
        className="block w-full px-3 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {minimized ? "Maximize the frame" : "Minimize the frame"}
      </button>
    </div>
  )
}
