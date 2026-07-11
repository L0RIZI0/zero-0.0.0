"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { Entity } from "@/lib/zero/types"
import { buildEntityMenuItems, applyEntityMenuAction } from "@/lib/zero/menu-model"
import { Zero0MenuList } from "./zero0-menu-list"

export interface Zero0MenuAnchor {
  entity: Entity
  x: number
  y: number
}

/**
 * The in-DOM right-click menu for the root canvas — used whenever nothing occludes it
 * (i.e. NOT over a native web Resource; that case routes to the transparent overlay
 * window instead). It only handles positioning/clamping/dismissal: the item list and
 * the action resolution both come from the shared {@link buildEntityMenuItems} /
 * {@link applyEntityMenuAction} model, and the rows are drawn by the shared
 * {@link Zero0MenuList} so the DOM and native menus are identical.
 */
export function Zero0EntityMenu({
  anchor,
  onMutate,
  onClose,
}: {
  anchor: Zero0MenuAnchor
  onMutate: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Clamp the menu inside the viewport once its size is known. Re-measured on any size
  // change (e.g. the "Change into…" submenu expanding) via a ResizeObserver.
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y })
  const { entity } = anchor

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const clamp = () => {
      const { innerWidth, innerHeight } = window
      const rect = el.getBoundingClientRect()
      setPos({
        x: Math.min(anchor.x, innerWidth - rect.width - 8),
        y: Math.min(anchor.y, innerHeight - rect.height - 8),
      })
    }
    clamp()
    const ro = new ResizeObserver(clamp)
    ro.observe(el)
    return () => ro.disconnect()
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

  const handleSelect = (actionId: string) => {
    applyEntityMenuAction(entity, actionId)
    onMutate()
    onClose()
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 border border-border bg-background shadow-none"
      style={{ left: pos.x, top: pos.y, fontFamily: "var(--font-zero0-mono), ui-monospace, monospace" }}
    >
      <Zero0MenuList items={buildEntityMenuItems(entity)} onSelect={handleSelect} />
    </div>
  )
}
