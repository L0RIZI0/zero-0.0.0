"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { MenuItem } from "@/lib/zero/menu-model"
import { Zero0MenuList } from "./zero0-menu-list"

// A generic in-DOM popup menu: a viewport-clamped, self-dismissing fixed container that
// draws a MenuItem tree via the shared Zero0MenuList. Used for entity menus AND the
// siblings dropdown whenever nothing occludes the DOM (i.e. NOT over a native web
// Resource — that case routes to the transparent overlay window instead).
export interface Zero0DomMenuState {
  items: MenuItem[]
  x: number
  y: number
  onSelect: (id: string) => void
}

export function Zero0DomMenu({ menu, onClose }: { menu: Zero0DomMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })

  // Clamp inside the viewport once sized; re-measured (ResizeObserver) when a submenu
  // expands and changes the height.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const clamp = () => {
      const { innerWidth, innerHeight } = window
      const rect = el.getBoundingClientRect()
      setPos({
        x: Math.min(menu.x, innerWidth - rect.width - 8),
        y: Math.min(menu.y, innerHeight - rect.height - 8),
      })
    }
    clamp()
    const ro = new ResizeObserver(clamp)
    ro.observe(el)
    return () => ro.disconnect()
  }, [menu.x, menu.y])

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
      data-zero-menu
      className="fixed z-50 border border-border bg-background shadow-none"
      style={{ left: pos.x, top: pos.y, fontFamily: "var(--font-zero0-mono), ui-monospace, monospace" }}
    >
      <Zero0MenuList
        items={menu.items}
        onSelect={(id, keepOpen) => {
          menu.onSelect(id)
          // `keepOpen` rows (checkbox toggles like Sun/Moon) leave the menu up so several can be
          // flipped in one pass; the shared list already updated the row's ✓ locally.
          if (!keepOpen) onClose()
        }}
      />
    </div>
  )
}
