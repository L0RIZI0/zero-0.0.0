"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { ChevronDown, FileText, ImageIcon, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { panelSlideTransition } from "@/lib/zero/motion"

/**
 * RESOURCES panel — a presentational MOCKUP of the "stuff that goes IN" side of a space.
 *
 * Structure (top → bottom, under the vertical RESOURCES label):
 *   1. Money — a single imposing balance figure.
 *   2. Assets — tangible holdings (camera roll, files…).
 *   3. Apps — tool subscriptions (Figma, Linear, Notion…).
 * Assets & Apps are collapsible. A "+ Add resource" link sits at the foot.
 *
 * Each item's icon tile is a DIAMOND — the item's square rotated 45° to echo the
 * Resource losange glyph — with the inner icon counter-rotated so it stays upright.
 * A continuity HAIRLINE runs from the window edge to the diamond's LEFT VERTEX, but
 * only for the camera roll and the app subscriptions (per the mockup spec).
 *
 * All content here is static mock data — no store reads, no persistence.
 */

type MockItem = {
  id: string
  title: string
  detail: string
  tint: string
  /** Draw the edge→vertex continuity hairline for this item. */
  rail: boolean
} & ({ icon: typeof FileText; domain?: never } | { domain: string; icon?: never })

const ASSET_ITEMS: MockItem[] = [
  {
    id: "camera-roll",
    title: "Camera Roll",
    detail: "1,284 photos · 42 videos",
    tint: "#E5A663",
    rail: true,
    icon: ImageIcon,
  },
  { id: "files", title: "Files", detail: "312 documents · 4.2 GB", tint: "#6C8FE5", rail: false, icon: FileText },
]

const APP_ITEMS: MockItem[] = [
  { id: "figma", title: "Figma", detail: "Professional · $16/mo", tint: "#A259FF", rail: true, domain: "figma.com" },
  { id: "linear", title: "Linear", detail: "Standard · $8/mo", tint: "#5E6AD2", rail: true, domain: "linear.app" },
  { id: "notion", title: "Notion", detail: "Plus · $10/mo", tint: "#C9C9C9", rail: true, domain: "notion.so" },
  { id: "vercel", title: "Vercel", detail: "Pro · $20/mo", tint: "#EDEDED", rail: true, domain: "vercel.com" },
]

const MOCK_BALANCE = "4,426.80"

const faviconUrl = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`

/** The upright mark inside a diamond tile: a lucide icon or a real favicon (with a
 *  monogram fallback while it loads / if it errors). Counter-rotated by the caller. */
function ItemMark({ item }: { item: MockItem }) {
  const [ok, setOk] = useState(false)
  if (item.icon) {
    const Icon = item.icon
    return <Icon className="h-[15px] w-[15px]" style={{ color: item.tint }} strokeWidth={1.75} />
  }
  return (
    <span className="relative flex h-[15px] w-[15px] items-center justify-center">
      <span className="absolute text-[9px] font-semibold leading-none" style={{ color: item.tint }}>
        {item.title[0]}
      </span>
      <img
        src={faviconUrl(item.domain!) || "/placeholder.svg"}
        alt=""
        draggable={false}
        onLoad={() => setOk(true)}
        className={cn("h-full w-full object-contain transition-opacity duration-150", ok ? "opacity-100" : "opacity-0")}
      />
    </span>
  )
}

function ResourceRow({ item, index }: { item: MockItem; index: number }) {
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ ...panelSlideTransition, delay: index * 0.015 }}
      className="group relative flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-card"
    >
      {/* Continuity hairline: from the window edge to the diamond's LEFT VERTEX. Reaches
          the edge by clearing the panel's content inset (`--panel-edge-inset` = railWidth)
          plus this row's own left padding (px-2 = 8px). Stops at ~10px = row padding (8) +
          the diamond's left vertex inside its 40px slot (~1.6px). Camera roll + apps only. */}
      {item.rail && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-px bg-border"
          style={{ left: "calc(-1 * (var(--panel-edge-inset, 48px) + 8px))", right: "calc(100% - 10px)" }}
        />
      )}
      {/* Diamond tile (square rotated 45°) echoing the Resource losange glyph. */}
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
        <span
          className="flex h-[26px] w-[26px] rotate-45 items-center justify-center rounded-[5px] border"
          style={{ borderColor: `${item.tint}55`, backgroundColor: `${item.tint}1a` }}
        >
          {/* Counter-rotate so the icon/favicon reads upright inside the diamond. */}
          <span className="-rotate-45">
            <ItemMark item={item} />
          </span>
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[12.5px] tracking-tight text-foreground">{item.title}</span>
        <span className="truncate text-[11px] text-muted-foreground/70">{item.detail}</span>
      </span>
    </motion.button>
  )
}

function Section({ title, items, defaultOpen = true }: { title: string; items: MockItem[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  // The height-collapse animation needs `overflow-hidden`, but that also clips the rows'
  // connector hairlines horizontally so they can't reach the window edge. So we only clip
  // WHILE animating; once the section is open and idle we switch overflow to visible,
  // letting each hairline paint out past the panel's content inset to the screen edge.
  const [settled, setSettled] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-2 text-left"
      >
        <ChevronDown
          className={cn("h-3.5 w-3.5 text-muted-foreground/70 transition-transform", !open && "-rotate-90")}
          strokeWidth={2}
        />
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">{title}</span>
        <span className="text-[11px] text-muted-foreground/40">{items.length}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={panelSlideTransition}
            onAnimationStart={() => setSettled(false)}
            onAnimationComplete={() => setSettled(true)}
            // Clip while animating (height collapse); go visible when open + idle so the
            // connector hairlines can extend past the content inset to the window edge.
            style={{ overflow: settled ? "visible" : "hidden" }}
          >
            <div className="flex flex-col pb-1">
              {items.map((item, i) => (
                <ResourceRow key={item.id} item={item} index={i} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function AssetPanel({ spaceId }: { spaceId: string }) {
  // Keyed by context so switching nodes hard-swaps (instant, no cross-fade).
  return (
    <div key={spaceId} className="flex flex-col">
      {/* Money — the imposing balance figure. */}
      <div className="px-2 pb-4 pt-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[34px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
            {MOCK_BALANCE}
          </span>
          <span className="text-sm font-medium text-muted-foreground">USD</span>
        </div>
      </div>

      <Section title="Assets" items={ASSET_ITEMS} />
      <Section title="Apps" items={APP_ITEMS} />

      {/* Add-resource affordance. */}
      <button
        type="button"
        className="mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-2 py-2 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        Add resource
      </button>
    </div>
  )
}
