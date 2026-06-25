"use client"

import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { ChevronRight } from "lucide-react"

export interface ContextMenuItem {
  label: string
  onSelect?: () => void
  icon?: ReactNode
  /** When present, this item is a PARENT: hovering it reveals a flyout of these
   *  child items (e.g. "Change into…" → the kinds). A parent item has no
   *  `onSelect` of its own. */
  submenu?: ContextMenuItem[]
}

/** Anchor point + items for an open context menu. */
export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

const MENU_W = 184
const SUB_W = 184

const itemClass =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-popover-foreground transition-colors hover:bg-secondary"

function MenuItemButton({
  item,
  onClose,
}: {
  item: ContextMenuItem
  onClose: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        item.onSelect?.()
        onClose()
      }}
      className={itemClass}
    >
      {item.icon && (
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground">
          {item.icon}
        </span>
      )}
      {item.label}
    </button>
  )
}

/**
 * A small, elegant right-click menu rendered to a portal at the cursor.
 * Closes on outside click, another right-click, scroll, or Escape. Flips
 * leftward/upward near the viewport edges so it never overflows. Items may carry
 * a `submenu`, which reveals a flyout on hover (flipping to the left when there
 * isn't room on the right).
 */
export function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState | null
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [openSub, setOpenSub] = useState<string | null>(null)
  useEffect(() => setMounted(true), [])

  // Reset which submenu is open whenever the menu itself changes/closes.
  useEffect(() => setOpenSub(null), [state])

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
  const itemH = 34
  const menuH = state ? state.items.length * itemH + 8 : 0
  const left = state ? Math.min(state.x, window.innerWidth - MENU_W - 8) : 0
  const top = state ? Math.min(state.y, window.innerHeight - menuH - 8) : 0
  // Open submenus to the LEFT when the right edge wouldn't fit a flyout.
  const subOnLeft = left + MENU_W + SUB_W > window.innerWidth - 8

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
          className="z-[100] rounded-lg border border-border bg-popover p-1 shadow-[0_18px_44px_-12px_rgba(0,0,0,0.45)] backdrop-blur-sm"
          // Keep clicks inside from bubbling to the window-level close handler.
          onPointerDown={(e) => e.stopPropagation()}
        >
          {state.items.map((item) =>
            item.submenu ? (
              <div
                key={item.label}
                className="relative"
                onMouseEnter={() => setOpenSub(item.label)}
                onMouseLeave={() => setOpenSub((s) => (s === item.label ? null : s))}
              >
                <button type="button" role="menuitem" aria-haspopup="menu" className={itemClass}>
                  {item.icon && (
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground">
                      {item.icon}
                    </span>
                  )}
                  {item.label}
                  <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>

                <AnimatePresence>
                  {openSub === item.label && (
                    <motion.div
                      role="menu"
                      initial={{ opacity: 0, scale: 0.97, x: subOnLeft ? 4 : -4 }}
                      animate={{ opacity: 1, scale: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ duration: 0.1, ease: [0.2, 0, 0, 1] }}
                      style={{
                        position: "absolute",
                        top: -5,
                        width: SUB_W,
                        transformOrigin: subOnLeft ? "top right" : "top left",
                        ...(subOnLeft ? { right: "100%", marginRight: 4 } : { left: "100%", marginLeft: 4 }),
                      }}
                      className="rounded-lg border border-border bg-popover p-1 shadow-[0_18px_44px_-12px_rgba(0,0,0,0.45)] backdrop-blur-sm"
                    >
                      {item.submenu.map((sub) => (
                        <MenuItemButton key={sub.label} item={sub} onClose={onClose} />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <MenuItemButton key={item.label} item={item} onClose={onClose} />
            ),
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
