"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { JetBrains_Mono } from "next/font/google"
import type { MenuItem } from "@/lib/zero/menu-model"
import { Zero0MenuList } from "@/components/zero0/zero0-menu-list"

// Match the root canvas's DATA typography so the overlay menu is visually identical to
// the in-DOM one (same JetBrains Mono via the page-local var).
const zero0Mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-zero0-mono",
  weight: ["400", "500"],
})

// Gap kept between the menu card and the viewport edge when clamping.
const EDGE = 6

// The branded context-menu OVERLAY route. It now renders INSIDE a full-content-area,
// transparent WebContentsView that main layers ON TOP of the resource views (see
// main.cjs) — so the whole viewport is ours: we paint the menu card at the click coords
// and treat the rest as a transparent backdrop that dismisses on the next click. It
// renders a generic MenuItem tree pushed from the main renderer (which owns the live
// entity data) and echoes the chosen action id back for main to execute. Purely
// presentational: it never mutates data itself.
export default function ContextMenuPage() {
  const [menu, setMenu] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Receive the menu (items + click coords) to render from main. Reset position so the
  // layout effect re-clamps for the new anchor.
  useEffect(() => {
    const bridge = window.zeroMenu
    if (!bridge) return
    return bridge.onShow((payload) => {
      setPos(null)
      setMenu({ items: payload.items, x: payload.x ?? 0, y: payload.y ?? 0 })
    })
  }, [])

  // Escape dismisses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Position the card at the click point, then clamp so it stays fully on-screen —
  // shifting left / flipping up when it would overflow the viewport.
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!menu || !el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = menu.x
    let top = menu.y
    if (left + rect.width > vw - EDGE) left = Math.max(EDGE, vw - EDGE - rect.width)
    if (top + rect.height > vh - EDGE) top = Math.max(EDGE, menu.y - rect.height)
    left = Math.max(EDGE, left)
    top = Math.max(EDGE, top)
    setPos({ left, top })
  }, [menu])

  const dismiss = () => window.zeroMenu?.dismiss()

  if (!menu) return <GlobalTransparent />

  return (
    <>
      <GlobalTransparent />
      {/* Full-viewport backdrop: transparent, but any press outside the card dismisses.
          A right-click anywhere also dismisses (so a fresh right-click on the site isn't
          swallowed by a stale menu). */}
      <div
        className="fixed inset-0"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) dismiss()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          dismiss()
        }}
      >
        <div
          ref={cardRef}
          className={`${zero0Mono.variable} absolute border border-border bg-background shadow-[0_18px_50px_-12px_rgba(0,0,0,0.6)]`}
          style={{
            left: pos ? pos.left : menu.x,
            top: pos ? pos.top : menu.y,
            // Hide the first paint until clamped, so it never flashes at the wrong spot.
            visibility: pos ? "visible" : "hidden",
            fontFamily: "var(--font-zero0-mono), ui-monospace, monospace",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Zero0MenuList items={menu.items} onSelect={(id) => window.zeroMenu?.action(id)} />
        </div>
      </div>
    </>
  )
}

/** Force the document transparent so only the menu card paints (the root layout sets an
 *  opaque bg on <html>; override it just for this overlay route). */
function GlobalTransparent() {
  return (
    <style>{`html,body{background:transparent !important;margin:0;overflow:hidden;}
      ::-webkit-scrollbar{display:none;}
      *{user-select:none;cursor:default;}`}</style>
  )
}
