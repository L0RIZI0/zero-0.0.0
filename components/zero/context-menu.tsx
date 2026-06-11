"use client"

import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"

export interface ContextMenuItem {
  label: string
  onSelect: () => void
  icon?: ReactNode
}

/** Anchor point + items for an open context menu. */
export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

/**
 * A small, elegant right-click menu rendered to a portal at the cursor.
 * Closes on outside click, another right-click, scroll, or Escape. Flips
 * leftward/upward near the viewport edges so it never overflows.
 */
export function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState | null
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!state) return
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("pointerdown", close)
    window.addEventListener("contextmenu", close)
    window.addEventListener("scroll", close, true)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("contextmenu", close)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("keydown", onKey)
    }
  }, [state, onClose])

  if (!mounted) return null

  // Estimated footprint for edge-flipping.
  const MENU_W = 184
  const itemH = 34
  const menuH = state ? state.items.length * itemH + 8 : 0
  const left = state ? Math.min(state.x, window.innerWidth - MENU_W - 8) : 0
  const top = state ? Math.min(state.y, window.innerHeight - menuH - 8) : 0

  return createPortal(
    <AnimatePresence>
      {state && (
        <motion.div
          role="menu"
          initial={{ opacity: 0, scale: 0.96, y: -2 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -2 }}
          transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
          style={{ position: "fixed", left, top, width: MENU_W, transformOrigin: "top left" }}
          className="z-[100] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-[0_18px_44px_-12px_rgba(0,0,0,0.45)] backdrop-blur-sm"
          // Keep clicks inside from bubbling to the window-level close handler.
          onPointerDown={(e) => e.stopPropagation()}
        >
          {state.items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                item.onSelect()
                onClose()
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-popover-foreground transition-colors hover:bg-secondary"
            >
              {item.icon && (
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground">
                  {item.icon}
                </span>
              )}
              {item.label}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
