"use client"

import { useRef, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { ChevronDown, FileText, ImageIcon, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { panelSlideTransition, MORPH_SECONDS, MORPH_EASE } from "@/lib/zero/motion"

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
 * PEEK MODE (`peek`): when this panel is open but its entity becomes a covered ancestor
 * (a child opened), the resources morph — over the shared window-morph beat — into small
 * SOLID pointy losanges sitting on the window's left peek strip: metadata + section
 * headers + the add button fade, titles shrink to the hover-label size and fade, glyph
 * tiles shrink/harden into filled diamonds, and the whole list packs tight and slides
 * left. From the focused child, hovering a peek losange shows its title as a floating
 * label. Money is left untouched (it just falls under the child). Reverses symmetrically
 * when the child closes (`peek` flips back to false and Framer animates everything home).
 *
 * All content here is static mock data — no store reads, no persistence.
 */

const MORPH = { duration: MORPH_SECONDS, ease: MORPH_EASE }
/** Shrunk peek-title size == the floating hover-label size, so the two read continuous. */
const PEEK_LABEL_PX = 11
/** Horizontal distance from a row's left edge to its glyph-tile CENTER: row px-2 (8) +
 *  half the 40px glyph slot (20). Used to land the losange centered on the peek strip. */
const ROW_GLYPH_CENTER = 28

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
  // Notion & Vercel are grayscale brands; their near-white brand tints made the diamond
  // tile (low-alpha bg + border) invisible on the light panel. Use a mid neutral gray so
  // the losange reads clearly in BOTH themes while staying monochrome-on-brand.
  { id: "notion", title: "Notion", detail: "Plus · $10/mo", tint: "#8A8A8A", rail: true, domain: "notion.so" },
  { id: "vercel", title: "Vercel", detail: "Pro · $20/mo", tint: "#8A8A8A", rail: true, domain: "vercel.com" },
]

const MOCK_BALANCE = "4,426.80"

/** Total resources shown in this mockup (assets + apps) — surfaced so the panel header
 *  counter reflects what's actually rendered rather than a store value. */
export const RESOURCE_COUNT = ASSET_ITEMS.length + APP_ITEMS.length

const faviconUrl = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`

/** A hovered peek losange's floating label: its title + the viewport point to anchor to. */
type PeekHover = { title: string; top: number; left: number; side: "left" | "right" } | null

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

function ResourceRow({
  item,
  peek,
  railWidth,
  onHover,
}: {
  item: MockItem
  peek: boolean
  railWidth: number
  onHover: (h: PeekHover) => void
}) {
  const tileRef = useRef<HTMLSpanElement>(null)
  // Slide left so the glyph tile's center lands on the peek strip center (railWidth/2).
  // At rest the center sits at inset(=railWidth) + ROW_GLYPH_CENTER; the panel's content
  // inset eases to railWidth over the same beat (in CollapsibleColumn), so this transform
  // is measured against the FINAL inset and the two compose into one smooth glide.
  const peekX = -(railWidth / 2 + ROW_GLYPH_CENTER)

  const showLabel = () => {
    const el = tileRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    onHover({ title: item.title, top: r.top + r.height / 2, left: r.right + 10, side: "left" })
  }

  return (
    <motion.button
      type="button"
      initial={false}
      animate={{ x: peek ? peekX : 0, paddingTop: peek ? 3 : 6, paddingBottom: peek ? 3 : 6 }}
      transition={MORPH}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-lg border border-transparent px-2 text-left",
        peek ? "pointer-events-none" : "pointer-events-auto transition-colors hover:border-border hover:bg-card",
      )}
    >
      {/* Continuity hairline: from the window edge to the diamond's LEFT VERTEX. Fades out
          in peek (it belongs to the full layout; the losange sits on the edge itself). */}
      {item.rail && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-px"
          initial={false}
          animate={{ opacity: peek ? 0 : 1 }}
          transition={MORPH}
          style={{
            left: "calc(-1 * (var(--panel-edge-inset, 48px) + 8px))",
            right: "calc(100% - 10px)",
            backgroundColor: `${item.tint}55`,
          }}
        />
      )}
      {/* Diamond tile (square rotated 45°). In peek it shrinks + hardens into the "pure
          glyph": pointy (radius 0), SOLID tint fill + border, inner mark faded out. It's
          raised above the rail (z-30) and re-enables pointer events so it's hoverable from
          the focused child; a click is a no-op for now. */}
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
        <motion.span
          ref={tileRef}
          initial={false}
          animate={{
            width: peek ? 15 : 26,
            height: peek ? 15 : 26,
            borderRadius: peek ? 0 : 5,
            backgroundColor: peek ? item.tint : `${item.tint}1a`,
            borderColor: peek ? item.tint : `${item.tint}55`,
          }}
          transition={MORPH}
          onPointerEnter={peek ? showLabel : undefined}
          onPointerLeave={peek ? () => onHover(null) : undefined}
          onClick={peek ? (e) => e.stopPropagation() : undefined}
          className={cn("flex rotate-45 items-center justify-center border", peek && "pointer-events-auto")}
          style={peek ? { position: "relative", zIndex: 30 } : undefined}
        >
          {/* Counter-rotate so the icon/favicon reads upright inside the diamond. */}
          <motion.span
            className="-rotate-45"
            initial={false}
            animate={{ opacity: peek ? 0 : 1 }}
            transition={MORPH}
          >
            <ItemMark item={item} />
          </motion.span>
        </motion.span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        {/* Title shrinks to the hover-label size, nudges DOWN to the glyph centerline (as
            the detail line collapses beneath it), and fades — so in peek only the losange
            remains, its title available on hover. */}
        <motion.span
          initial={false}
          animate={{ opacity: peek ? 0 : 1, fontSize: peek ? PEEK_LABEL_PX : 12.5, y: peek ? 7 : 0 }}
          transition={MORPH}
          className="truncate tracking-tight text-foreground"
        >
          {item.title}
        </motion.span>
        <motion.span
          initial={false}
          animate={{ opacity: peek ? 0 : 1, height: peek ? 0 : "auto" }}
          transition={MORPH}
          className="truncate text-[11px] text-muted-foreground/70"
        >
          {item.detail}
        </motion.span>
      </span>
    </motion.button>
  )
}

function Section({
  title,
  items,
  peek,
  railWidth,
  onHover,
  defaultOpen = true,
}: {
  title: string
  items: MockItem[]
  peek: boolean
  railWidth: number
  onHover: (h: PeekHover) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  // The height-collapse animation needs `overflow-hidden`, but that also clips the rows'
  // connector hairlines horizontally so they can't reach the window edge. So we only clip
  // WHILE animating; once the section is open and idle we switch overflow to visible,
  // letting each hairline paint out past the panel's content inset to the screen edge.
  const [settled, setSettled] = useState(defaultOpen)
  // In peek, force all rows visible (regardless of the user's collapse state) so every
  // resource shows as a losange on the strip.
  const expanded = open || peek
  return (
    <div>
      {/* Header toggles the section. In peek it fades out but KEEPS its box, so the
          collapsed losange list keeps the between-section gaps. */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        initial={false}
        animate={{ opacity: peek ? 0 : 1 }}
        transition={peek ? { duration: 0.3, ease: "easeOut" } : MORPH}
        className={cn(
          "flex w-full items-center gap-1.5 px-2 py-2 text-left",
          peek && "pointer-events-none",
        )}
      >
        {!open && <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground/70" strokeWidth={2} />}
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">{title}</span>
        <span className="text-[11px] text-muted-foreground/40">{items.length}</span>
      </motion.button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={panelSlideTransition}
            onAnimationStart={() => setSettled(false)}
            onAnimationComplete={() => setSettled(true)}
            // Visible in peek so losanges paint onto the strip; otherwise clip only while
            // the height collapse animates (see note above).
            style={{ overflow: peek || settled ? "visible" : "hidden" }}
          >
            <div className="flex flex-col pb-1">
              {items.map((item) => (
                <ResourceRow key={item.id} item={item} peek={peek} railWidth={railWidth} onHover={onHover} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function AssetPanel({
  spaceId,
  peek = false,
  railWidth = 48,
}: {
  spaceId: string
  /** Collapse the resources into peek losanges on the window's left peek strip. */
  peek?: boolean
  /** Width of the peek strip the losanges center on (the window's visible bleed). */
  railWidth?: number
}) {
  const [hover, setHover] = useState<PeekHover>(null)
  // The minimal add affordance on the peek strip only shows on hover.
  const [addHover, setAddHover] = useState(false)
  const peekX = -(railWidth / 2 + ROW_GLYPH_CENTER)

  return (
    // Keyed by context so switching nodes hard-swaps (instant, no cross-fade).
    <div key={spaceId} className="flex flex-col">
      {/* Money — the imposing balance figure. Left untouched in peek (per spec). */}
      <div className="px-2 pb-4 pt-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[27px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
            {MOCK_BALANCE}
          </span>
          <span className="text-sm font-medium text-muted-foreground">USD</span>
        </div>
      </div>

      <Section title="Assets" items={ASSET_ITEMS} peek={peek} railWidth={railWidth} onHover={setHover} />
      <Section title="Apps" items={APP_ITEMS} peek={peek} railWidth={railWidth} onHover={setHover} />

      {/* Full add-resource affordance — fades out FAST/early at the start of the peek
          collapse (an exception to the slow morph beat) and stops taking pointer events. */}
      <motion.button
        type="button"
        initial={false}
        animate={{ opacity: peek ? 0 : 1 }}
        transition={peek ? { duration: 0.25, ease: "easeOut" } : MORPH}
        className={cn(
          "mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-2 py-2 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
          peek && "pointer-events-none",
        )}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        Add resource
      </motion.button>

      {/* PEEK add button — a tiny minimalist "+" at the foot of the losange list, on the
          peek strip. Invisible until hovered (opacity 0 but still hit-testable). Rendered
          only while peek to keep the normal layout untouched. */}
      {peek && (
        <motion.button
          type="button"
          initial={false}
          animate={{ x: peekX, opacity: addHover ? 1 : 0 }}
          transition={{ opacity: { duration: 0.2, ease: "easeOut" }, x: MORPH }}
          onPointerEnter={() => setAddHover(true)}
          onPointerLeave={() => setAddHover(false)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Add resource"
          className="pointer-events-auto relative mt-1 flex h-10 w-10 items-center justify-center self-start rounded-md text-muted-foreground transition-colors hover:text-foreground"
          style={{ zIndex: 30 }}
        >
          <span className="flex h-[15px] w-[15px] items-center justify-center rounded-[3px] border border-dashed border-current">
            <Plus className="h-2.5 w-2.5" strokeWidth={2.5} />
          </span>
        </motion.button>
      )}

      {/* Floating hover label for a peek losange. Fixed + high z so it paints ABOVE the
          focused child window (z-140) yet below the theme toggle (z-300). */}
      {hover && (
        <div
          className="pointer-events-none fixed z-[200] -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 leading-none text-popover-foreground shadow-md"
          style={{ top: hover.top, left: hover.left, fontSize: PEEK_LABEL_PX }}
        >
          {hover.title}
        </div>
      )}
    </div>
  )
}
