"use client"

import { useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "motion/react"
import { ChevronDown, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { panelSlideTransition, MORPH_SECONDS, MORPH_EASE } from "@/lib/zero/motion"
import { getEntityResources, groupResources, type EntityResource } from "@/lib/zero/resources"

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
/**
 * Beat to HOLD the full panel before it collapses into peek, once a child opens.
 * Pegged to 60% of the open-window morph (MORPH_SECONDS) so the panel stays whole for
 * most of the dive-in, then morphs into losanges as the child window settles in.
 */
const PEEK_IN_DELAY = MORPH_SECONDS * 0.6
/**
 * Transition for every peek-driven property. Entering peek is HELD for PEEK_IN_DELAY only
 * when `delayed` — the DIVE case (a child opened): the full panel lingers before morphing
 * into the losange strip so it stays whole for most of the dive-in. For a MANUAL COLLAPSE
 * on a focused leaf (`delayed` false) there is nothing to wait for, so the morph plays
 * immediately. The reverse (leaving peek) always plays immediately. Pass the element's
 * base transition as `base` (defaults to the slow MORPH) to keep per-element durations.
 */
const peekMorph = (peek: boolean, delayed = true, base: object = MORPH) => ({
  ...base,
  delay: peek && delayed ? PEEK_IN_DELAY : 0,
})
/** Shrunk peek-title size == the floating hover-label size, so the two read continuous. */
const PEEK_LABEL_PX = 11
/** Horizontal distance from a row's left edge to its glyph-tile CENTER: row px-2 (8) +
 *  half the 40px glyph slot (20). Used to land the losange centered on the peek strip. */
const ROW_GLYPH_CENTER = 28
/** The add "+" affordance has NO px-2, so its 40px slot center sits 20px from its left. */
const ADD_GLYPH_CENTER = 20
/** The panel content inset (px) when the panel is open — the scroller's `pl`. FROZEN at
 *  this value during peek (see CollapsibleColumn) so the content never horizontally jumps
 *  when `spineWidth` shrinks to the bleed; the losange travel is measured against it. */
const FULL_INSET = 48
/** Pure-losange edge (px) in peek — half the previous 15px, per the tighter peek spec. */
const PEEK_LOSANGE = 8
/** Where a peek glyph/losange lands, measured from the WINDOW EDGE: centered on the
 *  bleed strip. Both resources and the add button converge here so they align. */
const peekCenter = (spineWidth: number) => spineWidth / 2
/** Row transform to bring a glyph tile's center from its resting spot (inset + slot
 *  center) onto the peek strip center. Negative = leftward. */
const rowPeekX = (spineWidth: number, slotCenter: number) => peekCenter(spineWidth) - FULL_INSET - slotCenter

const faviconUrl = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`

/** Format a money resource's amount as the imposing balance figure (e.g. "4,426.80"). */
const formatBalance = (amount: number) =>
  amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** A hovered peek losange's floating label: the item (for name + icon) + the viewport
 *  point to anchor to. */
type PeekHover = { item: EntityResource; top: number; left: number; side: "left" | "right" } | null

/** The upright mark inside a diamond tile: a lucide icon or a real favicon (with a
 *  monogram fallback while it loads / if it errors). Counter-rotated by the caller.
 *  `size` (px) lets the tooltip render a smaller mark than the 15px tile default. */
function ItemMark({ item, size = 15 }: { item: EntityResource; size?: number }) {
  const [ok, setOk] = useState(false)
  if (item.icon) {
    const Icon = item.icon
    return <Icon style={{ width: size, height: size, color: item.tint }} strokeWidth={1.75} />
  }
  return (
    <span className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <span className="absolute font-semibold leading-none" style={{ fontSize: size * 0.6, color: item.tint }}>
        {item.name[0]}
      </span>
      <img
        src={item.domain ? faviconUrl(item.domain) : "/placeholder.svg"}
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
  peekDelayed = true,
  stripMode = false,
  spineWidth,
  onHover,
}: {
  item: EntityResource
  peek: boolean
  /** Hold the peek morph by PEEK_IN_DELAY (dive) or play it immediately (manual collapse). */
  peekDelayed?: boolean
  /** Leaf-collapsed strip: nothing covers the panel, so fade the row's text (title/detail)
   *  to 0, leaving only the losange + hairline on the narrow strip. */
  stripMode?: boolean
  spineWidth: number
  onHover: (h: PeekHover) => void
}) {
  const tileRef = useRef<HTMLSpanElement>(null)
  // Peek travel for JUST the glyph tile (+ hairline): slide the losange left so its center
  // lands on the peek strip center. The ROW itself no longer moves — only the losange and
  // its hairline travel; titles/meta/money simply fade in place. The content inset is
  // FROZEN at FULL_INSET during peek (CollapsibleColumn), so this pure transform (no layout
  // change) carries the losange the whole way — no jump.
  const peekX = rowPeekX(spineWidth, ROW_GLYPH_CENTER)
  // Base transition. STRIP MODE (manual leaf collapse/expand) uses the SNAPPY panel-slide
  // curve so the losange travel/scale + fades land IN LOCKSTEP with the View squeeze
  // (which also uses panelSlideTransition) — everything moves together in one beat, no
  // delay. The covered-ancestor DIVE peek keeps the slow 2s MORPH so it matches the window
  // dive it rides along with.
  const morphBase = stripMode ? panelSlideTransition : MORPH

  const showLabel = () => {
    const el = tileRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    onHover({ item, top: r.top + r.height / 2, left: r.right + 10, side: "left" })
  }

  return (
    <button
      type="button"
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left",
        peek ? "pointer-events-none" : "pointer-events-auto transition-colors hover:border-border hover:bg-card",
      )}
    >
      {/* Continuity hairline: runs from the window edge to the glyph. It PERSISTS in peek
          (stays visible, connecting the screen edge to the peek losange). Its left anchor is
          fixed at the window edge; the ROW no longer moves, so the hairline no longer needs
          to counter-translate — it just widens to end exactly at the losange's new center
          (`peekCenter + 8` local, since the local origin sits at FULL_INSET and left starts
          8px past the edge). */}
      {item.connector && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-px"
          initial={false}
          animate={{
            width: peek ? peekCenter(spineWidth) + 8 : FULL_INSET + 18,
          }}
          transition={peekMorph(peek, peekDelayed, morphBase)}
          style={{
            left: "calc(-1 * (var(--panel-edge-inset, 48px) + 8px))",
            backgroundColor: `${item.tint}55`,
          }}
        />
      )}
      {/* Diamond tile (square rotated 45°). In peek it shrinks + hardens into the "pure
          glyph": pointy (radius 0), SOLID tint fill + border, inner mark faded out. It's
          raised above the spine (z-30) and re-enables pointer events so it's hoverable from
          the focused child; a click is a no-op for now.
          The peek TRAVEL (x) lives on this rotation-free slot wrapper — NOT on the tile
          itself, whose `transform` is already owned by the rotate-45 (+ Framer width/height
          morph). Putting x here lets the losange slide onto the peek strip while the tile
          keeps rotating cleanly. */}
      <motion.span
        className="relative flex h-10 w-10 shrink-0 items-center justify-center"
        initial={false}
        animate={{ x: peek ? peekX : 0 }}
        transition={peekMorph(peek, peekDelayed, morphBase)}
        style={peek ? { position: "relative", zIndex: 30 } : undefined}
      >
        <motion.span
          ref={tileRef}
          initial={false}
          animate={{
            width: peek ? PEEK_LOSANGE : 26,
            height: peek ? PEEK_LOSANGE : 26,
            borderRadius: peek ? 0 : 5,
            backgroundColor: peek ? item.tint : `${item.tint}1a`,
            borderColor: peek ? item.tint : `${item.tint}55`,
          }}
          transition={peekMorph(peek, peekDelayed, morphBase)}
          onPointerEnter={peek ? showLabel : undefined}
          onPointerLeave={peek ? () => onHover(null) : undefined}
          onClick={peek ? (e) => e.stopPropagation() : undefined}
          data-peek-losange={peek ? item.id : undefined}
          className={cn("flex rotate-45 items-center justify-center border", peek && "pointer-events-auto")}
          style={peek ? { position: "relative", zIndex: 30 } : undefined}
        >
          {/* Counter-rotate so the icon/favicon reads upright inside the diamond. */}
          <motion.span
            className="-rotate-45"
            initial={false}
            animate={{ opacity: peek ? 0 : 1 }}
            transition={peekMorph(peek, peekDelayed, morphBase)}
          >
            <ItemMark item={item} />
          </motion.span>
        </motion.span>
      </motion.span>
      {/* Title + detail. In the DIVE peek they stay put (the child window covers them). In
          STRIP MODE (manual leaf-collapse) nothing covers the panel, so they FADE to 0 —
          leaving just the losange + hairline on the narrow strip. */}
      <motion.span
        className="flex min-w-0 flex-1 flex-col leading-tight"
        initial={false}
        animate={{ opacity: stripMode ? 0 : 1 }}
        transition={peekMorph(peek, peekDelayed, morphBase)}
      >
        <span className="truncate text-[12.5px] tracking-tight text-foreground">{item.name}</span>
        <span className="truncate text-[11px] text-muted-foreground/70">{item.detail}</span>
      </motion.span>
    </button>
  )
}

function Section({
  title,
  items,
  peek,
  peekDelayed = true,
  stripMode = false,
  spineWidth,
  onHover,
  defaultOpen = true,
}: {
  title: string
  items: EntityResource[]
  peek: boolean
  peekDelayed?: boolean
  stripMode?: boolean
  spineWidth: number
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
      {/* Header toggles the section. In the DIVE peek it stays put (covered by the child);
          in STRIP MODE (manual leaf-collapse) it FADES to 0 so only losanges show on the
          narrow strip. Inert (pointer-events-none) whenever the losanges are showing. */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        initial={false}
        animate={{ opacity: stripMode ? 0 : 1 }}
        transition={peekMorph(peek, peekDelayed, stripMode ? panelSlideTransition : MORPH)}
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
                <ResourceRow
                  key={item.id}
                  item={item}
                  peek={peek}
                  peekDelayed={peekDelayed}
                  stripMode={stripMode}
                  spineWidth={spineWidth}
                  onHover={onHover}
                />
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
  stripMode = false,
  spineWidth = 48,
}: {
  spaceId: string
  /** Collapse the resources into peek losanges on the window's left peek strip. */
  peek?: boolean
  /** Leaf-collapsed STRIP: the peek losanges are shown on the spine of a FOCUSED leaf (a
   *  manual collapse), not a covered ancestor. Nothing covers the panel, so the non-losange
   *  content (money, section headers, titles, add) FADES OUT rather than riding out under a
   *  child window; and the losange morph plays immediately (no dive hold). Implies `peek`. */
  stripMode?: boolean
  /** Width of the peek strip the losanges center on (the window's visible bleed). */
  spineWidth?: number
}) {
  const [hover, setHover] = useState<PeekHover>(null)
  // The minimal add affordance on the peek strip only shows on hover.
  const [addHover, setAddHover] = useState(false)
  // Manual leaf-collapse morphs immediately (nothing to wait for); the dive-into-child
  // peek holds the full panel for PEEK_IN_DELAY before morphing. `stripMode` marks the
  // manual-collapse case.
  const peekDelayed = !stripMode
  // Fade transition for the non-losange content in strip mode (money, add button). Uses
  // the snappy panel-slide curve in strip mode so it fades IN LOCKSTEP with the View
  // squeeze + losange travel — one coherent beat, no delay.
  const stripFade = {
    initial: false as const,
    animate: { opacity: stripMode ? 0 : 1 },
    transition: peekMorph(peek, peekDelayed, stripMode ? panelSlideTransition : MORPH),
  }
  // The add button has no px-2, so it uses ADD_GLYPH_CENTER — this lands its "+" on the
  // SAME peek-strip center as the resource losanges above, so they align vertically.
  const peekAddX = rowPeekX(spineWidth, ADD_GLYPH_CENTER)

  // Model-driven: an entity renders exactly the resources it HOLDS (entity0's world
  // inputs; a child's imported/added resources). An entity with no holdings shows an
  // EMPTY panel — no money, no assets/apps (⇒ no peek losanges), just the affordance to
  // add/import its first resource.
  const resources = getEntityResources(spaceId)
  const { money, assets, apps } = groupResources(resources)

  if (resources.length === 0) {
    return (
      <div key={spaceId} className="flex flex-col">
        <motion.button
          type="button"
          {...stripFade}
          className={cn(
            "mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-2 py-2 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
            peek && "pointer-events-none",
          )}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Add resource
        </motion.button>
      </div>
    )
  }

  return (
    // Keyed by context so switching nodes hard-swaps (instant, no cross-fade).
    <div key={spaceId} className="flex flex-col">
      {/* Money — the imposing balance figure. In the DIVE peek it rides out with the
          narrowing column (covered by the child); in STRIP MODE it FADES to 0 so only the
          losanges remain on the spine. */}
      {money[0]?.amount != null && (
        <motion.div className="px-2 pb-4 pt-1" {...stripFade}>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[27px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
              {formatBalance(money[0].amount)}
            </span>
            <span className="text-sm font-medium text-muted-foreground">{money[0].currency ?? "USD"}</span>
          </div>
        </motion.div>
      )}

      {assets.length > 0 && (
        <Section
          title="Assets"
          items={assets}
          peek={peek}
          peekDelayed={peekDelayed}
          stripMode={stripMode}
          spineWidth={spineWidth}
          onHover={setHover}
        />
      )}
      {apps.length > 0 && (
        <Section
          title="Apps"
          items={apps}
          peek={peek}
          peekDelayed={peekDelayed}
          stripMode={stripMode}
          spineWidth={spineWidth}
          onHover={setHover}
        />
      )}

      {/* Full add-resource affordance — fades in strip mode, rides out under a child in the
          dive peek. */}
      <motion.button
        type="button"
        {...stripFade}
        className={cn(
          "mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-2 py-2 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
          peek && "pointer-events-none",
        )}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        Add resource
      </motion.button>

      {/* PEEK add button — a tiny minimalist "+" at the foot of the losange list, on the
          peek strip. Invisible until hovered (opacity 0 but still hit-testable). It lives
          in a ZERO-HEIGHT relative wrapper and is ABSOLUTELY positioned: mounting it must
          NOT add flow height, because the panel content is vertically CENTERED — an
          in-flow ~40px button would shift the whole centered list up ~20px on peek-in (the
          jump). Absolute = out of flow = no jump. It hangs just below the last row. */}
      {peek && (
        <div className="relative h-0">
          <motion.button
            type="button"
            initial={false}
            animate={{ x: peekAddX, opacity: addHover ? 1 : 0 }}
            transition={{ opacity: { duration: 0.2, ease: "easeOut" }, x: MORPH }}
            onPointerEnter={() => setAddHover(true)}
            onPointerLeave={() => setAddHover(false)}
            onClick={(e) => e.stopPropagation()}
            aria-label="Add resource"
            className="pointer-events-auto absolute left-0 top-0 flex h-8 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            style={{ zIndex: 30 }}
          >
            <span className="flex h-3 w-3 items-center justify-center rounded-[2px] border border-dashed border-current">
              <Plus className="h-2 w-2" strokeWidth={2.5} />
            </span>
          </motion.button>
        </div>
      )}

      {/* Floating hover label for a peek losange — PORTALED to <body>. The panel lives
          inside a transformed (framer x) + `overflow-hidden` clip container, which would
          clip/mis-anchor a `position: fixed` child; portaling escapes both so the label
          paints above the focused child window. z-[200] < theme toggle (z-300).
          It shows the resource's ICON (the same mark that was inside the losange) beside
          the title, and REVEALS left→right via a clip-path inset wipe so it grows out of
          the losange rather than popping in.
          NOTE: AnimatePresence must live INSIDE the portal so its direct child is the
          motion.div. Wrapping the `createPortal(...)` call instead hides the motion node
          from AnimatePresence, so the enter animation never runs and the label stays stuck
          at its initial `clip-path: inset(0 100% 0 0)` = fully clipped = invisible. */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {hover && (
              <motion.div
                key={hover.item.id}
                data-peek-label
                initial={{ clipPath: "inset(0 100% 0 0)", opacity: 0 }}
                animate={{ clipPath: "inset(0 0% 0 0)", opacity: 1 }}
                exit={{ clipPath: "inset(0 100% 0 0)", opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-none fixed z-[200] flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-popover py-1 pl-1.5 pr-2 leading-none text-popover-foreground shadow-md"
                style={{ top: hover.top, left: hover.left, fontSize: PEEK_LABEL_PX }}
              >
                <ItemMark item={hover.item} size={13} />
                {hover.item.name}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  )
}
