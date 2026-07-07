"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence, Reorder } from "motion/react"
import { ChevronDown, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
// `layerTransition as MORPH` + `PEEK_IN_DELAY` are LIVE ESM bindings (BRAT-derived in
// motion.ts). The peek/snappy transition builders below reference them at CALL time
// (render / default-param eval), so a `§ 5` BRAT change is picked up on the next morph —
// they must NOT be copied into a module-scope const here (that would freeze the value).
import {
  panelSlideTransition,
  panelCollapseTransition,
  layerTransition as MORPH,
  PEEK_IN_DELAY,
} from "@/lib/zero/motion"
import {
  getEntityResources,
  groupResources,
  reorderEntityResources,
  type EntityResource,
} from "@/lib/zero/resources"

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
 * PEEK MODE (`peek`): the collapsed state, shown whenever this isn't the focused-open leaf —
 * i.e. a focused leaf whose panel was manually collapsed, OR a covered ancestor (a child
 * opened). The resources morph into small SOLID pointy losanges sitting on the window's left
 * peek strip: money + metadata + section headers + the add button slide left and fade out,
 * titles slide left and fade, glyph tiles shrink/harden into filled diamonds, and the list
 * packs tight — leaving only the losange column. From the focused child, hovering a peek
 * losange shows its title as a floating label. Reverses symmetrically when the panel expands
 * (`peek` flips back to false and Framer animates everything home).
 *
 * All content here is static mock data — no store reads, no persistence.
 */

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
/**
 * The base transition for a peek morph, chosen by whether it's a MANUAL toggle (`snappy`) and
 * by DIRECTION:
 *   • auto morph (`!snappy`, a child opening OR closing) → slow 2s MORPH, both directions, so
 *     collapse ⇄ uncollapse stay symmetric and ride the window dive.
 *   • manual expand (snappy, peek=false) → panelSlideTransition (ease-OUT bloom).
 *   • manual collapse (snappy, peek=true) → panelCollapseTransition (fast spring, slight end
 *     bounce). Same character as the auto-collapse but quicker and with a bounce.
 */
const snappyBase = (snappy: boolean, peek: boolean) =>
  !snappy ? MORPH : peek ? panelCollapseTransition : panelSlideTransition
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
/** Row HEIGHT (px) in peek. Rows normally stand ~52px tall (py-1.5 + the 40px glyph slot),
 *  which spaces the collapsed losanges far apart. In peek we compress each row to this tight
 *  height so the losanges stack into a close column; expanded rows keep `height:"auto"` (52),
 *  so the open panel is unchanged. The 40px slot overflows this box but only the tiny centered
 *  losange is opaque, so the overflow is invisible (and overflow stays VISIBLE so the row's
 *  connector hairline can still escape left to the window edge). */
const PEEK_ROW_H = 24
/** Collapsed SECTION-HEADER height (px) in peek. Kept as a small non-zero band (rather than
 *  fully 0) so a visible GAP separates the Assets losange group from the Apps group — each
 *  group of peek losanges reads as its own cluster. */
const PEEK_HEADER_H = 14
/** EXPANDED (open) heights, in px. Rows are a deterministic 54 (the 40px glyph slot + py-1.5
 *  + border dominates every row since titles/detail are single-line `truncate`); headers are
 *  ~32. We animate the peek⇄open morph between these NUMERIC endpoints instead of to the
 *  string `"auto"`: Framer measures + snaps to `auto` on complete, and any sub-pixel gap
 *  between the last interpolated frame and the natural layout height shows as a JUMP at the
 *  end of the uncollapse. Numeric endpoints never snap. Content is vertically centered
 *  (`items-center`), so exact-fit isn't required and the open panel looks identical. */
const ROW_H_OPEN = 54
const HEADER_H_OPEN = 32
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
  snappy = false,
  spineWidth,
  onHover,
  onDragStart,
  onDragEnd,
}: {
  item: EntityResource
  peek: boolean
  /** Hold the peek morph by PEEK_IN_DELAY (dive) or play it immediately (manual collapse). */
  peekDelayed?: boolean
  /** Focused-leaf scenario (both open + collapsed): use the SNAPPY panel-slide curve for
   *  the whole morph so it can't fall back to the slow 2s dive beat mid-transition. */
  snappy?: boolean
  spineWidth: number
  onHover: (h: PeekHover) => void
  /** Drag lifecycle (open panel only) — the row is a Reorder.Item, directly draggable
   *  with no handle. Absent (and drag disabled) in peek. */
  onDragStart?: () => void
  onDragEnd?: () => void
}) {
  const tileRef = useRef<HTMLSpanElement>(null)
  // Row hover is driven by LOCAL state + inline styles rather than a Tailwind
  // `hover:` utility: the `hover:bg-card`/`hover:border-border` variants stopped being
  // emitted by the JIT (only non-hover `.bg-card` survives, from other usages), so the
  // CSS pseudo-hover silently painted nothing. Local state is self-sufficient and
  // matches the app's other JS-driven hovers (entity-node/do-list). Fades in quick
  // (0.15s) and out a touch slower (0.3s) so the highlight lingers like elsewhere.
  const [hovered, setHovered] = useState(false)
  // Peek travel for JUST the glyph tile (+ hairline): slide the losange left so its center
  // lands on the peek strip center. The ROW box itself no longer moves — only the losange and
  // its hairline travel; the title/detail slide left + fade separately. The content inset is
  // FROZEN at FULL_INSET during peek (CollapsibleColumn), so this pure transform (no layout
  // change) carries the losange the whole way — no jump.
  const peekX = rowPeekX(spineWidth, ROW_GLYPH_CENTER)
  // Base transition (see snappyBase): a MANUAL toggle uses the quick curves — ease-OUT bloom
  // on expand, fast spring with a slight end bounce on collapse — so the losange travel/scale
  // + text slide/fade land together. An AUTO morph (child opening/closing) rides the slow 2s
  // MORPH both ways so it stays symmetric with the window dive.
  const morphBase = snappyBase(snappy, peek)

  const showLabel = () => {
    const el = tileRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    onHover({ item, top: r.top + r.height / 2, left: r.right + 10, side: "left" })
  }

  // Row chrome (className/style) for the single Reorder.Item element below.
  const sharedClassName = cn(
    "group relative flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left",
    peek ? "pointer-events-none" : "pointer-events-auto",
    // `cursor-pointer` (finger), not grab: resources are becoming openable from
    // here, so the affordance reads as "click to open." Drag still works — the
    // cursor is purely cosmetic. `touch-none` stays so a press-drag isn't stolen
    // by the browser as a scroll/pan gesture.
    !peek && "cursor-pointer touch-none",
  )
  const sharedStyle: React.CSSProperties = {
    // Inline hover fill + outline (see the `hovered` note above). Transparent at
    // rest; card fill + visible border on hover. Duration is asymmetric so the
    // highlight lingers slightly after the pointer leaves.
    backgroundColor: !peek && hovered ? "var(--card)" : "transparent",
    borderColor: !peek && hovered ? "var(--border)" : "transparent",
    transition: `background-color ${hovered ? "0.15s" : "0.3s"} ease-out, border-color ${hovered ? "0.15s" : "0.3s"} ease-out`,
  }

  const rowInner = (
    <>
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
          className={cn(
            "flex rotate-45 items-center justify-center border",
            // In peek the losange is the drag HANDLE: re-enable pointer events (the row is
            // pointer-events-none) and touch-none so a press-drag isn't stolen by the browser
            // as a scroll/pan gesture. Cursor is `pointer` (finger) not grab — resources are
            // becoming click-to-open from here; dragging still works regardless of cursor.
            peek && "pointer-events-auto cursor-pointer touch-none",
          )}
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
      {/* Title + detail. In peek they SLIDE LEFT with the losange (same `peekX`) AND fade to
          0, so they travel together as one unit and the reverse slides+fades them back in —
          leaving only the losange + hairline on the strip. */}
      <motion.span
        className="flex min-w-0 flex-1 flex-col leading-tight"
        initial={false}
        animate={{ opacity: peek ? 0 : 1, x: peek ? peekX : 0 }}
        transition={peekMorph(peek, peekDelayed, morphBase)}
      >
        <span className="truncate text-[12.5px] tracking-tight text-foreground">{item.name}</span>
        <span className="truncate text-[11px] text-muted-foreground/70">{item.detail}</span>
      </motion.span>
    </>
  )

  // Compress the row to a tight height in peek so the losanges stack close; expanded is the
  // deterministic ROW_H_OPEN (NUMERIC, not "auto" → no end-of-uncollapse snap). Same morph
  // curve as everything else → the vertical compaction glides in lockstep.
  const heightAnimate = { height: peek ? PEEK_ROW_H : ROW_H_OPEN }
  const heightTransition = peekMorph(peek, peekDelayed, morphBase)

  // ONE element for both peek and open: a Reorder.Item rendered as a DIV (framer's drag
  // listener doesn't attach reliably to a native <button>; the working do-list rows also
  // use div+role). Keeping the SAME element type across the peek↔open morph is what makes
  // the morph smooth — swapping element types here remounts and kills the animation.
  // Drag is enabled in BOTH peek and open. In peek the ROW is `pointer-events-none` and only
  // the losange re-enables events; a native pointerdown on the losange bubbles up to framer's
  // listener on this Reorder.Item (pointer-events:none blocks hit-testing of the row itself
  // but NOT event bubbling from children), so the drag starts from the losange. `whileDrag`
  // just floats the dragged element above its siblings (a tiny scale bump for feedback).
  return (
    <Reorder.Item
      as="div"
      role="button"
      tabIndex={0}
      value={item.id}
      initial={false}
      animate={heightAnimate}
      transition={heightTransition}
      onPointerEnter={peek ? undefined : () => setHovered(true)}
      onPointerLeave={peek ? undefined : () => setHovered(false)}
      onDragStart={onDragStart}
      // In peek the label tooltip is anchored to the losange's live bbox; re-run showLabel
      // each drag frame so the tooltip travels WITH the losange instead of staying pinned
      // at the pre-drag spot. (framer passes (event, info) — showLabel ignores them.)
      onDrag={peek ? () => showLabel() : undefined}
      onDragEnd={onDragEnd}
      // In peek, only lift z (no scale): the losange sits far left of the row center, so a
      // row-centered scale would visibly shove it sideways as you grab it.
      whileDrag={peek ? { zIndex: 40 } : { scale: 1.02, zIndex: 40 }}
      className={sharedClassName}
      style={sharedStyle}
    >
      {rowInner}
    </Reorder.Item>
  )
}

function Section({
  title,
  items,
  peek,
  peekDelayed = true,
  snappy = false,
  spineWidth,
  onHover,
  onReorder,
  defaultOpen = true,
}: {
  title: string
  items: EntityResource[]
  peek: boolean
  peekDelayed?: boolean
  snappy?: boolean
  spineWidth: number
  onHover: (h: PeekHover) => void
  /** Commit a new order for THIS section's resources (open panel drag-and-drop). */
  onReorder?: (orderedIds: string[]) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  // Live order for drag-and-drop reorder. Mirrors the incoming item order; a drag
  // rearranges it live and commits on drop via `onReorder`. Never resynced mid-drag (that
  // would yank the row from the cursor).
  const itemIds = items.map((i) => i.id)
  const itemsKey = itemIds.join("|")
  const [liveIds, setLiveIds] = useState<string[]>(itemIds)
  const liveRef = useRef(liveIds)
  liveRef.current = liveIds
  const draggingRef = useRef(false)
  useEffect(() => {
    if (draggingRef.current) return
    setLiveIds(itemIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey])
  // Robust ordering: ranked ids (the live drag order) first, then ANY items not yet in
  // `liveIds` appended in catalog order — this covers the frame after `items` changes but
  // before the resync effect runs, so the section never renders empty.
  const byId = new Map(items.map((i) => [i.id, i]))
  const seen = new Set<string>()
  const orderedItems: EntityResource[] = []
  for (const id of liveIds) {
    const it = byId.get(id)
    if (it) {
      orderedItems.push(it)
      seen.add(id)
    }
  }
  for (const it of items) if (!seen.has(it.id)) orderedItems.push(it)
  const orderedIds = orderedItems.map((i) => i.id)
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
      {/* Header toggles the section. In peek it SLIDES LEFT (same delta as the row losanges)
          AND fades to 0 so only losanges remain on the strip. Inert (pointer-events-none)
          whenever the losanges are showing. */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        initial={false}
        // In peek the header text fades + slides out, but we KEEP a small residual height
        // (PEEK_HEADER_H) so a gap remains between the Assets and Apps losange clusters — each
        // group reads as its own set. Expanded is the NUMERIC HEADER_H_OPEN (not "auto" → no
        // end-of-uncollapse snap); `items-center` centers the text so no vertical padding
        // animation is needed.
        animate={{
          opacity: peek ? 0 : 1,
          x: peek ? rowPeekX(spineWidth, ROW_GLYPH_CENTER) : 0,
          height: peek ? PEEK_HEADER_H : HEADER_H_OPEN,
        }}
        transition={peekMorph(peek, peekDelayed, snappyBase(snappy, peek))}
        className={cn(
          "flex w-full items-center gap-1.5 overflow-hidden px-2 text-left",
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
            {/* ONE Reorder.Group for BOTH peek and open — the row element type stays stable
                across the peek↔open morph (no remount), so Framer's height/losange/text morph
                stays smooth. Rows are draggable only when open (ResourceRow gates its own
                dragListener on !peek); peek is still hover/click only, but structurally ready
                for upcoming peek-reorder work. */}
            <Reorder.Group
              as="div"
              axis="y"
              values={orderedIds}
              onReorder={(next) => setLiveIds(next as string[])}
              className="flex flex-col pb-1"
            >
              {orderedItems.map((item) => (
                <ResourceRow
                  key={item.id}
                  item={item}
                  peek={peek}
                  peekDelayed={peekDelayed}
                  snappy={snappy}
                  spineWidth={spineWidth}
                  onHover={onHover}
                  onDragStart={() => {
                    draggingRef.current = true
                  }}
                  onDragEnd={() => {
                    draggingRef.current = false
                    onReorder?.(liveRef.current)
                  }}
                />
              ))}
            </Reorder.Group>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function AssetPanel({
  spaceId,
  peek = false,
  snappy = false,
  spineWidth = 48,
}: {
  spaceId: string
  /** Collapse the resources into peek losanges on the window's left peek strip. In peek, the
   *  non-losange content (money, section headers, titles, add) SLIDES LEFT + FADES OUT so only
   *  the losanges remain — whether this is a focused-leaf manual collapse or a covered
   *  ancestor whose child just opened. */
  peek?: boolean
  /** Focused-leaf scenario (open AND collapsed). Drives the SNAPPY panel-slide curve for the
   *  whole morph so expand can't fall back to the slow 2s dive beat. False for the
   *  covered-ancestor dive, which keeps the slow 2s MORPH to ride the window dive. */
  snappy?: boolean
  /** Width of the peek strip the losanges center on (the window's visible bleed). */
  spineWidth?: number
}) {
  const [hover, setHover] = useState<PeekHover>(null)
  // The minimal add affordance on the peek strip only shows on hover.
  const [addHover, setAddHover] = useState(false)
  // Bumped after a drag-and-drop reorder so the panel re-reads the new resource order.
  const [, setReorderTick] = useState(0)
  // No PEEK_IN_DELAY in any case: the user wants the collapse to START immediately. The DIVE
  // case still rides the slow 2s MORPH curve (via `snappy=false` → the coherent window-dive
  // ride) but with zero lead-in; the focused-leaf case uses the quick panel-slide. So the
  // curve differs by scenario, but neither waits before morphing.
  const peekDelayed = false
  // The panel-wide leftward slide for the non-losange content in peek — the SAME delta the
  // row losanges travel, so money/headers/titles/add all move together as one unit.
  const stripSlideX = rowPeekX(spineWidth, ROW_GLYPH_CENTER)
  // Slide + fade for the non-losange content (money, add button) in peek. Follows the same
  // curve as the losanges (snappy panel-slide on a focused leaf, slow MORPH on the dive) so
  // it moves IN LOCKSTEP with the losange travel and the View squeeze.
  const stripFade = {
    initial: false as const,
    animate: { opacity: peek ? 0 : 1, x: peek ? stripSlideX : 0 },
    transition: peekMorph(peek, peekDelayed, snappyBase(snappy, peek)),
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

  // Commit a within-section reorder: splice the class's new id sequence back into the
  // entity's full order (other classes keep their relative order), persist to the model,
  // and re-read. Ordering only ever changes within a section, so this is stable.
  const commitReorder = (newClassIds: string[]) => {
    const set = new Set(newClassIds)
    const queue = [...newClassIds]
    const fullOrder = resources.map((r) => r.id).map((id) => (set.has(id) ? (queue.shift() as string) : id))
    reorderEntityResources(spaceId, fullOrder)
    setReorderTick((t) => t + 1)
  }

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
      {/* Money — the imposing balance figure. In peek it slides left + FADES to 0 (via
          stripFade) so only the losanges remain on the spine. */}
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
          snappy={snappy}
          spineWidth={spineWidth}
          onHover={setHover}
          onReorder={commitReorder}
        />
      )}
      {apps.length > 0 && (
        <Section
          title="Apps"
          items={apps}
          peek={peek}
          peekDelayed={peekDelayed}
          snappy={snappy}
          spineWidth={spineWidth}
          onHover={setHover}
          onReorder={commitReorder}
        />
      )}

      {/* Full add-resource affordance — slides left + fades out in peek (via stripFade). */}
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
