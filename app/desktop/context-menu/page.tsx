"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { JetBrains_Mono } from "next/font/google"
import type { MenuItem } from "@/lib/zero/menu-model"
import { Zero0MenuList } from "@/components/zero0/zero0-menu-list"

// Match the root canvas's DATA typography so the native overlay menu is visually
// identical to the in-DOM one (same JetBrains Mono via the page-local var).
const zero0Mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-zero0-mono",
  weight: ["400", "500"],
})

// Transparent margin inside the overlay window so the menu's (CSS) shadow has room to
// render without being clipped at the window edge; mirrors main's anchor offset.
const PAD = 14

// The branded context-menu OVERLAY — a transparent child window floating ABOVE the
// native web views. It renders a generic MenuItem tree pushed from the main renderer
// (which owns the live entity data), reports its measured size so main can place the
// window, and echoes the chosen action id back for main to execute. Purely
// presentational: it never mutates data itself.
export default function ContextMenuPage() {
  const [items, setItems] = useState<MenuItem[] | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Receive the menu to render from main.
  useEffect(() => {
    const bridge = window.zeroMenu
    if (!bridge) return
    return bridge.onShow((payload) => setItems(payload.items))
  }, [])

  // Escape dismisses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.zeroMenu?.dismiss()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Report measured size (including the shadow PAD) so main can size + place the window.
  // A ResizeObserver keeps it correct when a "Change into…" submenu expands.
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!items || !el) return
    const report = () => {
      const rect = el.getBoundingClientRect()
      window.zeroMenu?.resize({
        width: Math.ceil(rect.width) + PAD * 2,
        height: Math.ceil(rect.height) + PAD * 2,
        anchorOffsetX: PAD,
        anchorOffsetY: PAD,
      })
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [items])

  if (!items) return <GlobalTransparent />

  return (
    <>
      <GlobalTransparent />
      <div
        className={`${zero0Mono.variable} flex min-h-screen items-start justify-start`}
        style={{ padding: PAD, fontFamily: "var(--font-zero0-mono), ui-monospace, monospace" }}
      >
        <div
          ref={cardRef}
          className="border border-border bg-background shadow-[0_18px_50px_-12px_rgba(0,0,0,0.6)]"
        >
          <Zero0MenuList items={items} onSelect={(id) => window.zeroMenu?.action(id)} />
        </div>
      </div>
    </>
  )
}

/** Force the document transparent so only the menu card paints (the root layout sets
 *  an opaque bg on <html>; override it just for this overlay route). */
function GlobalTransparent() {
  return (
    <style>{`html,body{background:transparent !important;margin:0;overflow:hidden;}
      ::-webkit-scrollbar{display:none;}
      *{user-select:none;cursor:default;}`}</style>
  )
}
