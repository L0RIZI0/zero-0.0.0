"use client"

// BRANDED CONTEXT-MENU OVERLAY (M3) — the page loaded into the native menu WebView2 layer that the
// shell composites ABOVE web content, so a menu opened over a browsed Resource is no longer clipped by
// the native content layer (a DOM popup in the main renderer cannot paint over it).
//
// Transport is the host-injected `window.zeroMenu` bridge (see types/zero-desktop.d.ts):
//   host → overlay : zeroMenu.onShow({ items, x, y })   (items are the same serialisable MenuItem[])
//   overlay → host : zeroMenu.resize({ width, height }) once measured, so the host sizes the layer
//   overlay → host : zeroMenu.action(id) on a leaf pick · zeroMenu.dismiss() on outside-click/Escape
//
// The card renders the SAME Zero0MenuList as the in-DOM menu, so the two look and behave identically.
// `keepOpen` rows (checkbox toggles) report their action but DON'T dismiss; the list flips the tick
// locally, so multi-toggle stays instant without a re-show round-trip.

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Zero0MenuList } from "./zero0-menu-list"
import type { MenuItem } from "@/lib/zero/menu-model"

export function Zero0MenuOverlay() {
  const [items, setItems] = useState<MenuItem[] | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  // The native layer composites over web content, so the document must be transparent — the root
  // <body> carries `bg-background`, which a wrapper element can't override. Clear it for this route only
  // while the overlay is mounted, and restore on unmount.
  useEffect(() => {
    const prevHtml = document.documentElement.style.background
    const prevBody = document.body.style.background
    document.documentElement.style.background = "transparent"
    document.body.style.background = "transparent"
    return () => {
      document.documentElement.style.background = prevHtml
      document.body.style.background = prevBody
    }
  }, [])

  // Subscribe to the host's show event. In a browser (no bridge) we render nothing — this page only has
  // meaning inside the native overlay layer. `?menutest` renders a sample menu so the card can be
  // eyeballed on the web (the bridge only exists in the native overlay).
  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.zeroMenu : undefined
    if (bridge) {
      const off = bridge.onShow((payload) => setItems(payload.items))
      return () => off?.()
    }
    if (typeof window !== "undefined" && window.location.search.includes("menutest")) {
      setItems([
        { type: "header", label: "Show" },
        { type: "item", id: "rail:session", label: "Session rail", checkmark: true },
        { type: "item", id: "rail:access", label: "Access rail", checkmark: false },
        { type: "divider" },
        { type: "header", label: "Sky" },
        { type: "item", id: "sky:sun", label: "Sun", checkmark: true, keepOpen: true },
        { type: "item", id: "sky:moon", label: "Moon", checkmark: false, keepOpen: true },
      ])
    }
  }, [])

  // Report our measured size so the host can size the composition layer to exactly fit the card
  // (the layer is otherwise transparent and click-through outside the card).
  useLayoutEffect(() => {
    const el = cardRef.current
    const bridge = typeof window !== "undefined" ? window.zeroMenu : undefined
    if (!el || !bridge || !items) return
    const r = el.getBoundingClientRect()
    bridge.resize({ width: Math.ceil(r.width), height: Math.ceil(r.height) })
  }, [items])

  // Escape dismisses; so does a pointer down on the transparent backdrop (outside the card).
  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.zeroMenu : undefined
    if (!bridge) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") bridge.dismiss()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  if (!items) return null

  const bridge = typeof window !== "undefined" ? window.zeroMenu : undefined

  return (
    // Full-bleed transparent backdrop: a click anywhere off the card dismisses. The host sizes the layer
    // to the card, so in practice the backdrop is a thin margin, but keeping it makes the overlay robust
    // if the host over-sizes the layer.
    <div
      className="fixed inset-0"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) bridge?.dismiss()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        bridge?.dismiss()
      }}
    >
      <div
        ref={cardRef}
        role="presentation"
        className="inline-block rounded-md border border-border bg-popover text-popover-foreground shadow-md"
        style={{ fontFamily: "var(--font-zero0-mono), ui-monospace, monospace" }}
      >
        <Zero0MenuList
          items={items}
          onSelect={(id, keepOpen) => {
            bridge?.action(id)
            // keepOpen rows (checkbox toggles) leave the overlay up; the list already flipped the tick.
            if (!keepOpen) bridge?.dismiss()
          }}
        />
      </div>
    </div>
  )
}
