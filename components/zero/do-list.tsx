"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion, Reorder, useDragControls, type Transition } from "motion/react"
import { Check, ChevronDown, Globe, CalendarClock, GripVertical } from "lucide-react"
import {
  getContextItems,
  isPinned,
  reorderContextItems,
  deleteEntity,
  changeEntityKind,
  addTask,
  addParsedEntity,
  addWebResource,
  parseInstantTime,
  setInstantAt,
  applyParsedSchedule,
  type ContextItem,
} from "@/lib/zero/data"
import { looksLikeSchedule, type ScheduleParse } from "@/lib/zero/schedule-parse"
import { parseCreateField } from "@/lib/zero/create-parse"
import {
  WEB_RESOURCES,
  getWebResource,
  resolveWebResourceByUrl,
  looksLikeUrl,
  normalizeUrl,
  webDisplayName,
  type WebResource,
} from "@/lib/zero/web-resources"
import { isClosed } from "@/lib/zero/kinds"
import { useZeroNav, ADD_KEY } from "@/lib/zero/nav-store"
import { MORPH_EASE } from "@/lib/zero/motion"
import { NodeGlyph, NODE_KIND_META, type NodeKind } from "./node-glyph"
import { ResourceGlyph } from "./resource-glyph"
import { EntityNode } from "./entity-node"
import { CaretTextInput } from "./caret-text-input"
import { cn } from "@/lib/utils"

// Order of kinds offered in the inline create/glyph picker. The identity triad's
// `individual` and `soul` are deliberately absent — they are system-only — but
// `organism` is user-creatable (you can spin up a new living entity / company).
const KIND_ORDER: NodeKind[] = ["task", "space", "resource", "event", "instant", "community", "organism"]

/**
 * Reflow timing for DO-list edits (add / delete): rows glide to make room or
 * close ranks, the new draft row fades in, a deleted row fades+shrinks out. It is
 * MUCH quicker than the 2s window morph — list edits should feel responsive — but
 * shares MORPH_EASE so it still reads as the same calm motion language (no bounce).
 * Used as the `layout` transition on every list cell so they all move in lockstep.
 */
const ROW_REFLOW: Transition = { duration: 0.4, ease: MORPH_EASE }

/** Shared leading glyph box, matching EntityRow so the edit row aligns. */
const GLYPH_BOX = "flex h-4 w-4 shrink-0 items-center justify-center"

/**
 * One draggable do-list cell. Wraps the row's {@link EntityNode} in a
 * `Reorder.Item` so the user can drag it above/below its siblings to set a
 * custom order (persisted per-context via `reorderContextItems`).
 *
 * Drag is HANDLE-ONLY (`dragListener={false}` + `useDragControls`): the row body
 * keeps its normal click-to-open + hover behaviour untouched, and a small grip
 * appears in the left gutter on hover to start a drag. This avoids any conflict
 * between "click a row to open it" and "drag a row to reorder it".
 *
 * `layout` is disabled while a WINDOW morph is in flight (`animating`) for the
 * same reason the old `motion.li` did it: opening a row grows that same node into
 * a window via GSAP Flip, and a simultaneous framer layout animation on the <li>
 * would fight it. Reorder never sets `animating`, so drags still animate.
 */
function ReorderRow({
  id,
  contextId,
  animating,
  morphing,
  hostsWindow,
  born,
  canReorder,
  faded,
  onDragStartRow,
  onCommit,
}: {
  id: string
  contextId: string
  animating: boolean
  /** This row is the child currently CLOSING back into the list — elevate its own
   *  `<li>` (see below) so the opaque morphing window always paints ABOVE its
   *  siblings-below and the dock during the early close frames. */
  morphing: boolean
  /** This row currently HOSTS an open/opening/closing `position: fixed` window.
   *  Neutralizes the containing-block trap on the `<li>` (see className) so the
   *  fixed window stays anchored to the viewport and never jumps to the row's
   *  coordinates when framer transiently transforms the animating Reorder.Item. */
  hostsWindow: boolean
  born: boolean
  canReorder: boolean
  /** Dim the row: the resolved "settled" zone below the open items in the Open view. */
  faded?: boolean
  onDragStartRow: () => void
  onCommit: () => void
}) {
  const controls = useDragControls()
  const [dragging, setDragging] = useState(false)
  return (
    <Reorder.Item
      value={id}
      as="li"
      // Handle-only: the item never starts a drag on its own pointer-down; only
      // the grip below (via `controls.start`) does. Keeps click-to-open intact.
      dragListener={false}
      dragControls={controls}
      layout={animating ? undefined : true}
      initial={born ? { opacity: 0, y: 6 } : false}
      // Resolved rows in the Open view settle at reduced opacity; framer animates the
      // fade so a row you just checked GLIDES down and dims in one motion. (EntityNode
      // adds its own dimming for cancelled items, so those end up a touch fainter still.)
        animate={{ opacity: faded ? 0.4 : 1, y: 0 }}
      exit={animating ? undefined : { opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
      transition={ROW_REFLOW}
      onDragStart={() => {
        setDragging(true)
        onDragStartRow()
      }}
      onDragEnd={() => {
        setDragging(false)
        onCommit()
      }}
      // `relative` alone leaves the row at z:auto, so the closing frame's inner
      // z-index is trapped whenever framer's reflow makes this `<li>` a stacking
      // context — letting siblings-below/dock paint over the closing window for a
      // frame. `morphing` lifts the WHOLE row to z-40 (matching the frame's own
      // closing elevation) so it wins among sibling row contexts and the dock.
      // IMPORTANT (`z-40!`): framer's Reorder.Item writes an INLINE `z-index: unset`
      // that would otherwise beat a plain `z-40` class — the `!important` wins over it.
      //
      // `hostsWindow`: this row contains an open/opening/closing `position: fixed`
      // window. Framer transiently sets `will-change: transform` (and/or a transform)
      // on the animating Reorder.Item — and ANY such value makes the `<li>` the
      // CONTAINING BLOCK for its fixed descendant, which snaps the window from the
      // viewport to the row's coordinates for 1-2 frames (the "window jumps on the
      // first open frame" bug). `transform-none!` + `[will-change:auto]!` override
      // framer's inline hints (the `!important` beats inline styles) so the `<li>`
      // never establishes a containing block while it hosts a window. Safe because
      // the row's own layout animation is disabled (`layout={undefined}`) throughout
      // the morph, and Flip transforms the FRAME (a child), not this `<li>`.
      className={cn(
        "group/row relative",
        dragging && "z-20",
        morphing && "z-40!",
        hostsWindow && "transform-none! [will-change:auto]!",
      )}
    >
      {canReorder && (
        <div
          role="button"
          tabIndex={-1}
          aria-label="Drag to reorder"
          // preventDefault stops text selection; stopPropagation keeps the row
          // frame's click-to-open from firing when the user grabs the handle.
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            controls.start(e)
          }}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            // Bigger target (h-7 w-5, was h-6 w-4) and nudged further into the gutter
            // (`-ml-1` on top of `-translate-x-full`) so it reads clearly instead of
            // sitting cropped against the row edge. The widened scroller gutter above
            // keeps this fully visible.
            "absolute top-1/2 left-0 z-10 flex h-7 w-5 -translate-x-full -translate-y-1/2 -ml-1 items-center justify-center",
            "cursor-grab text-muted-foreground/50 opacity-0 transition-opacity duration-150",
            "hover:text-foreground group-hover/row:opacity-100",
            dragging && "cursor-grabbing opacity-100",
          )}
        >
          <GripVertical className="h-4 w-4" strokeWidth={1.75} />
        </div>
      )}
      <EntityNode entityId={id} contextId={contextId} variant="row" />
    </Reorder.Item>
  )
}

/**
 * The glyph (kind) picker for the inline draft row. Rendered to a body portal
 * so it escapes the DO list's `overflow-y-auto` clip, and anchored under the
 * trigger (flipping above when there isn't room below).
 */
function GlyphMenu({
  anchor,
  kind,
  onSelect,
  onClose,
}: {
  anchor: { left: number; top: number; bottom: number } | null
  kind: NodeKind
  onSelect: (k: NodeKind) => void
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!anchor) return
    const close = () => onClose()
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [anchor, onClose])

  if (!mounted || !anchor) return null

  const MENU_W = 248
  const itemH = 50
  const menuH = KIND_ORDER.length * itemH + 8
  const left = Math.min(anchor.left, window.innerWidth - MENU_W - 8)
  // Open below the trigger; flip above if it would run off the bottom.
  const below = anchor.bottom + 6
  const top = below + menuH > window.innerHeight - 8 ? anchor.top - menuH - 6 : below

  return createPortal(
    <>
      {/* invisible catcher closes the menu on any outside pointer press */}
      <div className="fixed inset-0 z-[140]" onPointerDown={onClose} aria-hidden />
      <motion.ul
        role="listbox"
        initial={{ opacity: 0, y: -6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.97 }}
        transition={{ duration: 0.14, ease: [0.22, 0.61, 0.36, 1] }}
        style={{ position: "fixed", left, top, width: MENU_W, transformOrigin: "top left" }}
        className="z-[141] overflow-hidden rounded-md border border-border bg-popover p-1 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.55)]"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {KIND_ORDER.map((k) => {
          const selected = k === kind
          return (
            <li key={k}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(k)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[4px] px-2 py-1.5 text-left transition-colors",
                  selected ? "bg-secondary" : "hover:bg-secondary/60",
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-foreground">
                  <NodeGlyph kind={k} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-medium leading-tight text-foreground">
                    {NODE_KIND_META[k].label}
                  </span>
                  <span className="text-[11px] leading-snug text-muted-foreground">
                    {NODE_KIND_META[k].description}
                  </span>
                </span>
                {selected && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-foreground" />}
              </button>
            </li>
          )
        })}
      </motion.ul>
    </>,
    document.body,
  )
}

/**
 * The RESOURCE launcher menu — the second way to summon a web resource into a Task
 * (the first being typing a URL into the input). Lists the known catalog (Photopea
 * live, Figma/Notion/Linear illustrative); picking one creates a resource task in
 * this context. Portaled + anchored like `GlyphMenu` so it escapes the list clip.
 */
function ResourceMenu({
  anchor,
  onSelect,
  onClose,
}: {
  anchor: { left: number; top: number; bottom: number } | null
  onSelect: (r: WebResource) => void
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!anchor) return
    const close = () => onClose()
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [anchor, onClose])

  if (!mounted || !anchor) return null

  const MENU_W = 268
  const itemH = 52
  const menuH = WEB_RESOURCES.length * itemH + 34
  // Right-align the menu to the trigger (the launcher sits at the row's right end).
  const left = Math.max(8, Math.min(anchor.left - MENU_W + 28, window.innerWidth - MENU_W - 8))
  const below = anchor.bottom + 6
  const top = below + menuH > window.innerHeight - 8 ? anchor.top - menuH - 6 : below

  return createPortal(
    <>
      <div className="fixed inset-0 z-[140]" onPointerDown={onClose} aria-hidden />
      <motion.div
        role="listbox"
        aria-label="Open a resource"
        initial={{ opacity: 0, y: -6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.97 }}
        transition={{ duration: 0.14, ease: [0.22, 0.61, 0.36, 1] }}
        style={{ position: "fixed", left, top, width: MENU_W, transformOrigin: "top right" }}
        className="z-[141] overflow-hidden rounded-md border border-border bg-popover p-1 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.55)]"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Open a resource
        </p>
        {WEB_RESOURCES.map((r) => (
          <button
            key={r.id}
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => onSelect(r)}
            className="flex w-full items-center gap-2.5 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-secondary/60"
          >
            <span className="h-6 w-6 shrink-0">
              <ResourceGlyph resourceId={r.id} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="text-[13px] font-medium leading-tight text-foreground">{r.name}</span>
                <span
                  className={cn(
                    "rounded-[3px] px-1 py-px text-[9px] font-medium uppercase tracking-wide",
                    r.mode === "live"
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-foreground/10 text-muted-foreground",
                  )}
                >
                  {r.mode === "live" ? "Live" : "Native"}
                </span>
              </span>
              <span className="truncate text-[11px] leading-snug text-muted-foreground">{r.tagline}</span>
            </span>
          </button>
        ))}
        <p className="px-2 pb-1 pt-1 text-[10px] leading-snug text-muted-foreground/60">
          …or type any URL in the field.
        </p>
      </motion.div>
    </>,
    document.body,
  )
}

/**
 * The permanent terminal entity-creation row. Replaces the old "+ADD" button and
 * the on-demand EditRow: every DO list always ends with this draft input, so
 * opening a child never adds or removes a row — there is no reflow and no jump.
 *
 * It is a PURELY LOCAL draft: no store entity exists until you commit, so an
 * abandoned draft leaves nothing behind to clean up. Committing (Enter on a
 * non-empty title) asks the parent to create the entity and select it (keyboard
 * mode) so a SECOND Enter opens it — matching the old two-step gesture.
 */
function CreateRow({
  active,
  animating,
  closing,
  flipId,
  onCreate,
  onCreateWeb,
  onNavigateUp,
  onNavigateDown,
}: {
  /** Only the active (top, interactive) window's row auto-focuses its input, so
   *  ancestor windows that stay mounted don't fight over keyboard focus. */
  active: boolean
  /** True while a window OPEN/CLOSE morph is in flight. Disables framer `layout`
   *  so this row doesn't independently animate (and overlap the list) as GSAP Flip
   *  transforms the surrounding window frame — same guard the entity rows use. */
  animating: boolean
  /** True while THIS window is closing. The row stays mounted (so the centered list
   *  doesn't re-center and jump when it would otherwise be removed) but fades out, so
   *  its disappearance is smooth and any drift during the body's scale-down is hidden. */
  closing: boolean
  /** Stable Flip id for the draft row's <li>. Makes the row a participant in the
   *  pin/unpin morph: because it's always mounted it PERSISTS across the commit, so
   *  GSAP Flip matches it and SLIDES it to its new slot in lockstep with the frames
   *  (instead of jumping the instant the list grows/shrinks). On window open/close it
   *  enters/leaves rather than persists, so the stage's Flip.from ignores it. */
  flipId: string
  /** Commit a non-empty draft. The parent creates the entity and selects it. */
  onCreate: (title: string, kind: NodeKind) => void
  /** Summon a web resource: either a URL typed into the field, or a pick from the
   *  resource launcher. The parent creates a resource task and selects it (it then
   *  opens with the normal two-step gesture). */
  onCreateWeb: (url: string, resourceId?: string) => void
  /** ArrowUp out of the focused input hands selection back to the last real row. */
  onNavigateUp: () => void
  /** ArrowDown out of the focused input drops selection into the dock below. */
  onNavigateDown: () => void
}) {
  const { select, selection, inputMode, close } = useZeroNav()
  const [kind, setKind] = useState<NodeKind>("task")
  const [title, setTitle] = useState("")
  const [anchor, setAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null)
  const [resAnchor, setResAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const resTriggerRef = useRef<HTMLButtonElement>(null)
  const menuOpen = anchor !== null
  const resMenuOpen = resAnchor !== null
  // When the draft text reads as a URL/bare domain, committing it summons a web
  // resource instead of creating a plain task — so the leading glyph and the
  // placeholder both flip to reflect that.
  const isUrl = looksLikeUrl(title)
  const urlResource = isUrl ? resolveWebResourceByUrl(normalizeUrl(title)) : undefined

  const selected = selection?.region === "list" && selection.key === ADD_KEY

  // Auto-focus when this window becomes the active (top) one, so you can type the
  // moment it opens. `preventScroll` so focusing mid-open-morph doesn't yank the
  // scroller and fight the animation.
  useEffect(() => {
    if (active) inputRef.current?.focus({ preventScroll: true })
  }, [active])

  // Arrowing DOWN onto the creation slot (keyboard) refocuses the input so you can
  // immediately type another entity.
  useEffect(() => {
    if (active && selected && inputMode === "keyboard") inputRef.current?.focus({ preventScroll: true })
  }, [active, selected, inputMode])

  // Commit the local draft. Empty title is a no-op (keep the row ready). On success
  // we blur so the NEXT Enter is handled by the window-level list handler and OPENS
  // the freshly-created (now selected) row — the old two-step create→open gesture.
  //
  // `keepFocus` is reserved for a future Ctrl+Enter "rapid add" (create then stay
  // focused to type the next one); today every commit blurs.
  const commit = (keepFocus = false) => {
    const t = title.trim()
    if (!t) return
    // A URL-like draft becomes a RESOURCE TASK (web surface); anything else is a
    // normal entity of the chosen kind.
    if (looksLikeUrl(t)) {
      onCreateWeb(normalizeUrl(t))
    } else {
      onCreate(t, kind)
    }
    setTitle("")
    setKind("task")
    if (!keepFocus) inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (menuOpen || resMenuOpen) {
      if (e.key === "Escape") {
        e.preventDefault()
        setAnchor(null)
        setResAnchor(null)
      }
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      commit()
    } else if (e.key === "ArrowUp") {
      // Hand selection back to the list; blur so the window handler takes over.
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      inputRef.current?.blur()
      onNavigateUp()
    } else if (e.key === "ArrowDown") {
      // Drop into the dock below; blur so the dock's keyboard handler takes over.
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      inputRef.current?.blur()
      onNavigateDown()
    } else if (e.key === "Escape") {
      e.preventDefault()
      if (title.trim()) {
        // There's a draft: first Escape just discards focus (and keeps the text),
        // so a SECOND Escape then reaches the window handler to close the window.
        inputRef.current?.blur()
      } else {
        // Empty field: skip the blur-then-close two-step and close the window now.
        // (The window-level handler ignores Escape fired from an INPUT, so we close
        // directly here.) `close` is a no-op at the home root, which has no window.
        inputRef.current?.blur()
        close()
      }
    }
  }

  // No store entity exists yet, so the kind is just local draft state.
  const pickKind = (k: NodeKind) => {
    setKind(k)
    setAnchor(null)
    inputRef.current?.focus({ preventScroll: true })
  }

  const toggleMenu = () => {
    if (menuOpen) {
      setAnchor(null)
      return
    }
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setAnchor({ left: r.left, top: r.top, bottom: r.bottom })
  }

  const toggleResMenu = () => {
    if (resMenuOpen) {
      setResAnchor(null)
      return
    }
    const r = resTriggerRef.current?.getBoundingClientRect()
    if (r) setResAnchor({ left: r.left, top: r.top, bottom: r.bottom })
  }

  // Pick a resource from the launcher: create it (the parent selects it; the
  // normal second Enter / click then opens it) and reset the draft.
  const pickResource = (r: WebResource) => {
    onCreateWeb(r.url, r.id)
    setResAnchor(null)
    setTitle("")
    inputRef.current?.blur()
  }

  return (
    // `layout` so the row glides as siblings are added/removed; `initial={false}`
    // because it's permanent (it must never animate itself in on open / context
    // switch). No `exit` — it only leaves during a close, handled by the gate below.
    // `layout={!animating}`: during a window morph GSAP Flip transforms the enclosing
    // frame, which framer would otherwise read as a layout shift and animate this row
    // independently — making it jump and overlap the list. Disabling layout while
    // morphing hands the whole frame (this row included) to Flip, in lockstep.
    <motion.li
      // Persisting Flip target: slides to its new slot when an entity is pinned/
      // unpinned above it, in lockstep with the morphing frames (see `flipId` prop).
      data-flip-id={flipId}
      layout={!animating}
      initial={false}
      // Fade out as the window closes (kept in flow so the centered list never jumps
      // by losing this cell); a quick fade also hides any drift while the body shrinks.
      animate={{ opacity: closing ? 0 : 1 }}
      transition={closing ? { duration: 0.12, ease: "easeOut" } : ROW_REFLOW}
    >
      <div
        onPointerEnter={() => select("list", ADD_KEY, "mouse")}
        style={{ borderRadius: 4 }}
        // py-3 (12px) matches the taller h-11 entity rows so the draft input row is the
        // same height; px-4 matches the row's horizontal padding.
        className="flex w-full items-center gap-3 bg-card-solid px-4 py-3 text-left"
      >
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          // While the draft is a URL the kind chooser is irrelevant (it commits as a
          // resource), so the trigger just reflects "resource" and the chevron hides.
          aria-label={isUrl ? "Resource (from URL)" : `Type: ${NODE_KIND_META[kind].label}. Change type`}
          onClick={toggleMenu}
          disabled={isUrl}
          className={cn(
            "flex items-center gap-0.5 rounded-[3px] py-0.5 pl-0.5 pr-1 text-foreground transition-colors hover:bg-foreground/10",
            menuOpen && "bg-foreground/10",
            isUrl && "cursor-default hover:bg-transparent",
          )}
        >
          <span className={GLYPH_BOX}>
            {isUrl ? (
              <ResourceGlyph resourceId={urlResource?.id} url={normalizeUrl(title)} />
            ) : (
              <NodeGlyph kind={kind} filled={false} strokeWidth={2} />
            )}
          </span>
          {!isUrl && <ChevronDown className="h-3 w-3 text-muted-foreground" />}
        </button>

        <CaretTextInput
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => select("list", ADD_KEY)}
          placeholder={`New ${NODE_KIND_META[kind].label.toLowerCase()}… or paste a URL`}
          className="min-w-0 flex-1 bg-transparent text-[13px] tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
        />

        {/* Resource launcher — the second entry point. Hidden once the field already
            reads as a URL (committing handles that). */}
        {!isUrl && (
          <button
            ref={resTriggerRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={resMenuOpen}
            aria-label="Open a resource"
            onClick={toggleResMenu}
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-[background-color,color]",
              // Completely INVISIBLE but still fully clickable (kept for pulling website
              // resources in demos). `opacity-0` only — pointer-events stay on — so the
              // launcher never shows but the hit target remains.
              "opacity-0",
            )}
          >
            <Globe className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {menuOpen && (
          <GlyphMenu
            anchor={anchor}
            kind={kind}
            onSelect={pickKind}
            onClose={() => {
              setAnchor(null)
              inputRef.current?.focus()
            }}
          />
        )}
        {resMenuOpen && (
          <ResourceMenu
            anchor={resAnchor}
            onSelect={pickResource}
            onClose={() => {
              setResAnchor(null)
              inputRef.current?.focus()
            }}
          />
        )}
      </AnimatePresence>
    </motion.li>
  )
}

/**
 * The DO list — the central column of an entity's working surface. It lists the
 * context's direct children (any kind) as generic `EntityRow`s, plus a permanent
 * terminal `CreateRow` (the always-present "name this…" draft input).
 */
export function DoList({
  contextId,
  active = true,
  closing = false,
  centered = true,
}: {
  contextId: string
  active?: boolean
  /** True while THIS window is playing its close morph. Suppresses the
   *  `overflow: visible` escape hatch below — during a close no row is morphing
   *  out of the list, so un-clipping would only let the scroller expand to its
   *  full natural height and shove the terminal ADD row up over the title. */
  closing?: boolean
  /** Vertically center the list (incl. the ADD row) within its column instead of
   *  top-aligning it. ON by default for every entity at every depth. Uses
   *  `justify-center-safe`, so a short list sits in the middle but a list that
   *  outgrows the column falls back to top-aligned and scrolls normally (no clipped
   *  top). Pass `false` to force a specific list back to top-aligned. */
  centered?: boolean
}) {
  const { dataVersion, notifyDataChanged, open, selection, select, moveSelection, publishNavOrder, animating, closing: navClosing, stack } =
    useZeroNav()
  // The child entity that is CLOSING back into this list (globally, from the nav
  // store). During the 1-2 commit frames where this do-list re-expands out of its
  // spine, framer's `layout` reflow can apply a transient `transform` to each row
  // `<li>` (a Reorder.Item) — which makes every row its OWN stacking context and
  // TRAPS the closing frame's inner `zIndex:40` inside its row. Among those equal
  // (auto) sibling contexts paint order is pure DOM order, so rows positioned BELOW
  // the closing child (and the later-in-DOM dock region) briefly paint OVER the
  // still-full-size closing window — the "ghost parent do-list/dock" flash. Elevating
  // the closing row's OWN `<li>` (below) makes it win among those contexts. `.id` is
  // unique, so matching on it alone is safe (the row only lives in its parent list).
  const closingChildId = navClosing?.id ?? null
  // Whether a given row currently HOSTS an open/opening/closing window (its
  // EntityNode is rendered as a `position: fixed` window). True when the entity is
  // in the nav stack (open or opening) OR is the closing child. Used to neutralize
  // the containing-block trap on that row's `<li>` (see ReorderRow `hostsWindow`):
  // framer transiently sets `will-change: transform` / a transform on the animating
  // Reorder.Item, and ANY such ancestor becomes the containing block for its
  // `position: fixed` descendant — which re-anchors the window from the viewport to
  // the ROW's coordinates for 1-2 frames, so the opening window visibly JUMPS by the
  // row offset on the first frame. Forcing the `<li>` to establish no containing
  // block keeps the fixed window pinned to the viewport throughout the morph.
  const hostsWindow = (rowId: string) => rowId === closingChildId || stack.includes(rowId)
  // Re-read whenever data mutates or context changes. Pinned items are promoted
  // to the dock, so they're excluded here.
  const items = useMemo(
    () => getContextItems(contextId).filter((it) => !isPinned(contextId, it.id)),
    [contextId, dataVersion],
  )
  const [filter, setFilter] = useState<"open" | "all">("all")
  // The most recently created row. Only THIS row plays an enter animation (a gentle
  // fade/slide as it's "born" from the creation input); all other rows mount with
  // `initial={false}` so context switches and commits never flash the whole list.
  const [bornId, setBornId] = useState<string | null>(null)

  // Transient inline notice for the async NL→schedule parse (below). Because that
  // upgrade happens AFTER the row is created, a failure (or a gated AI Gateway) would
  // otherwise be invisible — the typed phrase would just silently stay a plain task.
  // This surfaces "couldn't auto-schedule" / "scheduled" so the outcome is never silent.
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashNotice = useCallback((tone: "ok" | "error", text: string) => {
    setNotice({ tone, text })
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])

  // Opening any entity defaults to "All" (everything shown in place). The user can
  // switch to "Open" to hide completed tasks; a just-checked task still stays put via
  // the retain set until the selector changes again.
  useEffect(() => setFilter("all"), [contextId])

  // Classify each item as OPEN (still actionable) vs RESOLVED. "Resolved" = completed
  // (any completable kind) OR closed — `isClosed` so a DERIVED close counts too (a done
  // task past midnight, a passed event, a cancelled item). Everything else is open.
  const openItemIds = useMemo(() => {
    const s = new Set<string>()
    for (const it of items) if (!it.entity.completed && !isClosed(it.entity)) s.add(it.id)
    return s
  }, [items])

  // Under "Open", resolved items are no longer HIDDEN — they SINK to a faded zone below
  // the still-open items (the user's "bubble open to the top, fade the rest below"
  // model, which also supersedes the old retain-set trick: a task you check simply
  // glides down into the resolved zone instead of being yanked out or frozen in place).
  // So `shown` is a STABLE partition — open items first (in canonical order), then
  // resolved items after them. "All" shows the raw canonical order untouched.
  const shown = useMemo(() => {
    if (filter !== "open") return items
    const open = items.filter((it) => openItemIds.has(it.id))
    const resolved = items.filter((it) => !openItemIds.has(it.id))
    return [...open, ...resolved]
  }, [items, filter, openItemIds])

  // DRAG-AND-DROP REORDER (via motion's Reorder). The list renders from `liveOrder`
  // — a local mirror of the shown ids — so a drag can rearrange it instantly (framer
  // calls `onReorder` with the new sequence mid-drag) without waiting on the data
  // layer. On drop we persist the arranged sequence (`commitReorder`) and let the
  // resulting data change flow back. Between drags `liveOrder` is kept in lockstep with
  // the real order; we NEVER resync mid-drag (that would yank the row from the cursor).
  // BOTH views reorder now: "all" permutes everything freely; "open" permutes only the
  // open rows and keeps them clamped above the faded resolved zone (see applyReorder).
  const shownIds = useMemo(() => shown.map((it) => it.id), [shown])
  const shownKey = shownIds.join("|")
  const itemById = useMemo(() => {
    const m = new Map<string, ContextItem>()
    for (const it of shown) m.set(it.id, it)
    return m
  }, [shown])
  const [liveOrder, setLiveOrder] = useState<string[]>(shownIds)
  const liveOrderRef = useRef(liveOrder)
  liveOrderRef.current = liveOrder
  const draggingRef = useRef(false)
  // Every proposed sequence from a drag passes through here. In "open" view we re-split
  // it open-before-resolved (stable) so a resolved row never rises above an open one and
  // an open row dragged DOWN can't cross the boundary — it just settles at the end of the
  // open group. motion animates that clamp, giving the "snap smoothly to the end of the
  // open items" feel the user asked for. "All" view keeps the raw sequence.
  const applyReorder = useCallback(
    (next: string[]) => {
      if (filter !== "open") {
        setLiveOrder(next)
        return
      }
      const open = next.filter((id) => openItemIds.has(id))
      const resolved = next.filter((id) => !openItemIds.has(id))
      setLiveOrder([...open, ...resolved])
    },
    [filter, openItemIds],
  )
  // Resync the live order from the data layer whenever the shown set/order changes
  // (create, delete, complete, context switch, or a just-committed reorder) — but
  // never while a drag is in flight.
  useEffect(() => {
    if (draggingRef.current) return
    setLiveOrder(shownIds)
    // shownKey is the content signature of shownIds; depend on it (not the array
    // identity) so we only resync on a real membership/order change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey])

  // The Open/All selectors reveal ONLY when the do-list isn't empty AND its entries
  // are not ALL open — i.e. at least one item is RESOLVED: done (completed) OR CLOSED.
  // "Closed" uses isClosed so a DERIVED close counts too — e.g. an Event whose end
  // time has passed (like a finished "Daily standup") flips the list non-virgin even
  // though nothing was manually acted on. A list that is empty, or whose every item is
  // still open, stays "virgin" ⇒ no chrome.
  const showSelectors = useMemo(
    () =>
      items.length > 0 &&
      items.some((it) => it.entity.completed || isClosed(it.entity)),
    [items],
  )

  // The navigable keys of the DO list, ALWAYS ending with the ADD birther row.
  const listKeys = useMemo(() => [...shown.map((it) => it.id), ADD_KEY], [shown])

  useEffect(() => {
    if (!active) return
    publishNavOrder("list", listKeys)
  }, [active, listKeys, publishNavOrder])

  // Default selection when the viewed context changes. Only the frontmost window
  // (active) owns selection — ancestor do-lists stay mounted but inert. We land on
  // the terminal CreateRow (ADD_KEY) because its input auto-focuses on open, so the
  // selection model should agree with where focus actually is.
  useEffect(() => {
    if (!active) return
    select("list", ADD_KEY)
    // Only on context change / activation — intentionally omit `select`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId, active])

  // Create a child from the committed draft: a real entity with the chosen title +
  // kind, then SELECTED in keyboard mode. Because the CreateRow blurs its input on
  // commit, the next Enter is caught by the window handler below and OPENS this new
  // (now selected) row — preserving the two-step create→open gesture. `bornId` marks
  // it so it (and only it) fades in.
  const createEntity = useCallback(
    (title: string, kind: NodeKind) => {
      // CREATE FIELD as a terminal hybrid: only the DEFAULT `task` kind is inspected
      // for the past-activity grammar ("Slept --2330-0630", "Worked … --1100-1730",
      // "Woke --0630"). An explicitly picked kind means the user already declared
      // their intent, so it skips this. A recognized past-tense verb + a `--time`
      // param becomes an already-Done Moment / Task / Instant spanning (or pointing
      // at) that time — Zero as an archive of what you did, not just a planner.
      if (kind === "task") {
        const past = parseCreateField(title)
        if (past) {
          const entity = addParsedEntity({
            title: past.title,
            spaceId: contextId,
            kind: past.kind,
            schedule: past.schedule,
            completed: past.completed,
          })
          setBornId(entity.id)
          notifyDataChanged()
          select("list", entity.id, "keyboard")
          flashNotice("ok", past.summary)
          return
        }
      }

      // Instants support a rough inline time token ("Ping --4pm"): strip it from
      // the title and apply it as the instant's moment. Other kinds keep the
      // title verbatim.
      const parsed = kind === "instant" ? parseInstantTime(title) : { title, at: undefined }
      const entity = addTask({ title: parsed.title, spaceId: contextId })
      if (kind !== "task") changeEntityKind(entity.id, kind)
      if (kind === "instant" && parsed.at != null) setInstantAt(entity.id, parsed.at)
      setBornId(entity.id)
      notifyDataChanged()
      select("list", entity.id, "keyboard")

      // NL → schedule (slice): only the plain `task` kind goes through the language
      // model — picking an explicit kind means the user already declared their intent,
      // and the instant time-token path above is handled synchronously. A cheap local
      // heuristic gates the network call so ordinary one-word tasks ("Laundry") never
      // hit the API; only phrases that smell time-related ("every weekday", "at 7am",
      // "for 1h daily") are parsed. The row is created INSTANTLY above; this upgrades it
      // in place when the parse resolves, so the create→open gesture is never blocked.
      if (kind === "task" && looksLikeSchedule(parsed.title)) {
        void (async () => {
          try {
            const res = await fetch("/api/parse-schedule", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text: parsed.title }),
            })
            if (!res.ok) {
              // 402 = AI Gateway not set up for this project (no card on file); any
              // other code = a genuine parse failure. Either way, tell the user the
              // auto-schedule didn't happen instead of leaving the plain task silently.
              flashNotice(
                "error",
                res.status === 402 ? "Couldn't auto-schedule — AI isn't set up yet." : "Couldn't auto-schedule that.",
              )
              return
            }
            const plan = (await res.json()) as ScheduleParse
            // The model decided it wasn't a schedule after all — staying a plain task
            // is the correct outcome, so no notice.
            if (!plan?.isSchedule) return
            if (applyParsedSchedule(entity.id, plan)) {
              notifyDataChanged()
              flashNotice("ok", plan.summary ? `Scheduled: ${plan.summary}` : "Scheduled.")
            }
          } catch {
            // Network error (offline, aborted): the plain task already exists and stands.
            flashNotice("error", "Couldn't auto-schedule that.")
          }
        })()
      }
    },
    [contextId, notifyDataChanged, select, flashNotice],
  )

  // Create a RESOURCE TASK from a typed URL or a launcher pick: a task bound to a
  // web surface, titled by the matched resource (or its hostname). Selected in
  // keyboard mode like a normal create, so the same second-Enter / click opens it
  // — at which point its body renders the resource instead of a do-list.
  const createWebEntity = useCallback(
    (url: string, resourceId?: string) => {
      const resource = getWebResource(resourceId) ?? resolveWebResourceByUrl(url)
      const entity = addWebResource({
        title: webDisplayName(url, resource?.id),
        url,
        spaceId: contextId,
        resourceId: resource?.id,
      })
      setBornId(entity.id)
      notifyDataChanged()
      select("list", entity.id, "keyboard")
    },
    [contextId, notifyDataChanged, select],
  )

  // ArrowUp out of the creation input lands selection on the last real row (if any),
  // handing keyboard control back to the normal list navigation.
  const navigateUpToList = useCallback(() => {
    const last = shown[shown.length - 1]?.id
    if (last) select("list", last, "keyboard")
  }, [shown, select])

  // ArrowDown out of the creation input (the last list entry) drops into the dock
  // below. The input owns its keys while focused, so the window-level handler can't
  // run `moveSelection` for it — we trigger the same list→dock move directly. The
  // CreateRow blurs its input first so the dock's keyboard handler then owns the keys.
  const navigateDownToDock = useCallback(() => moveSelection("down"), [moveSelection])

  // The create-input is a flow element pinned DIRECTLY BELOW the scroller (not a
  // scrolling list item, so the list never scrolls behind it). The dock no longer
  // overlays this column — it's the entity's region 2 (a sibling hug region below
  // region 1), so it reserves its own flow space and the input naturally rests at
  // the bottom of region 1, just above the dock. No manual clamp needed.
  const scrollerRef = useRef<HTMLUListElement | null>(null)
  // Whether the scroller has content hidden ABOVE / BELOW the visible band, so the
  // matching edge fade is only painted when there's actually something to scroll to
  // (otherwise the first/last rows would always look dimmed even at rest).
  const [fade, setFade] = useState({ top: false, bottom: false })

  const measureFade = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    // 1px tolerance absorbs sub-pixel rounding so the fade doesn't flicker at the ends.
    const top = el.scrollTop > 1
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setFade((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }))
  }, [])

  // Re-measure repeatedly across a row's birth/reflow animation, then stop once the layout
  // settles. WHY: the ResizeObserver below watches the scroller's OWN box (a fixed height
  // when the list is height-constrained), so a row animating its HEIGHT — a child resize —
  // never fires it. Measuring only at commit would latch onto the transient scrollHeight
  // overshoot during the birth animation and leave the bottom edge fade stuck ON even
  // though the settled list doesn't overflow. So we poll each frame until scrollHeight is
  // stable for 2 frames (or a hard deadline just past ROW_REFLOW's 0.4s), then quit.
  const settleRafRef = useRef(0)
  const measureFadeSettling = useCallback(() => {
    cancelAnimationFrame(settleRafRef.current)
    measureFade()
    if (!scrollerRef.current) return
    // Re-measure every frame through the whole row birth/reflow, THEN stop. We can't
    // early-exit on "size looks stable" because the scroller's clientHeight holds its
    // small pre-growth value (e.g. 44) for several frames before jumping to its settled
    // value (e.g. 144) — an early stability check latches onto that flat pre-jump window
    // (transient overflow ⇒ fade stuck ON). ROW_REFLOW is 0.4s; run a touch past it. This
    // is a cheap one-shot (a few layout reads/frame for ~0.5s), only after a mutation.
    const reflowMs = (typeof ROW_REFLOW.duration === "number" ? ROW_REFLOW.duration : 0.4) * 1000
    const deadline = performance.now() + reflowMs + 120
    const tick = () => {
      if (!scrollerRef.current) return
      measureFade()
      if (performance.now() < deadline) settleRafRef.current = requestAnimationFrame(tick)
    }
    settleRafRef.current = requestAnimationFrame(tick)
  }, [measureFade])

  // Recompute the edge fades on any layout-affecting change, then keep re-measuring until
  // the reflow settles (see above). Skipped during a window morph (`animating`): GSAP Flip
  // owns the frame then; the post-morph run settles it.
  useLayoutEffect(() => {
    if (animating) return
    measureFadeSettling()
    return () => cancelAnimationFrame(settleRafRef.current)
  }, [animating, measureFadeSettling, shown, showSelectors, dataVersion])

  // Keep the edge fades correct as the scroller resizes or the list scrolls.
  useEffect(() => {
    const sc = scrollerRef.current
    if (!sc) return
    let raf = 0
    const schedule = () => {
      if (animating) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measureFade)
    }
    const ro = new ResizeObserver(schedule)
    ro.observe(sc)
    window.addEventListener("resize", schedule)
    sc.addEventListener("scroll", measureFade, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener("resize", schedule)
      sc.removeEventListener("scroll", measureFade)
    }
  }, [animating, measureFade])

  // Window-level keyboard handler, active only when the DO list owns the
  // selection and no text input is focused.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (!selection || selection.region !== "list") return
      // When the CreateRow input has focus it owns the keys (Enter=commit,
      // ArrowUp=hand back, etc.); this window-level handler stands down.
      const ae = document.activeElement as HTMLElement | null
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return
      const key = selection.key
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          moveSelection("down")
          break
        case "ArrowUp":
          e.preventDefault()
          moveSelection("up")
          break
        case "ArrowLeft":
          moveSelection("left")
          break
        case "ArrowRight":
          moveSelection("right")
          break
        case "Enter":
          // ADD_KEY (the creation row) is owned by its focused input, so by the time
          // this runs `key` is a real row — Enter opens it.
          e.preventDefault()
          // No explicit origin: this row has an in-place owning node, so the
          // legacy single-node morph grows the window out of the row itself.
          if (key !== ADD_KEY) open(key)
          break
        case "Delete":
        case "Backspace": {
          if (key === ADD_KEY) break
          e.preventDefault()
          const idx = listKeys.indexOf(key)
          const neighbor = listKeys[idx + 1] ?? listKeys[idx - 1] ?? ADD_KEY
          deleteEntity(key)
          notifyDataChanged()
          select("list", neighbor, "keyboard")
          break
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active, selection, moveSelection, open, listKeys, notifyDataChanged, select])

  // Commit the freshly-arranged order on drop, then let the data change flow back
  // (which resyncs `liveOrder`). Read the latest sequence from the ref — onReorder has
  // been updating it live throughout the drag.
  // • "All" view: persist `liveOrder` verbatim — the user arranged the whole list.
  // • "Open" view: only the OPEN rows were permutable and the resolved rows were merely
  //   floated to the bottom for display, so persisting `liveOrder` as-is would shove
  //   every resolved item to the end of the CANONICAL order (corrupting the All view).
  //   Instead we permute open items IN PLACE: walk the canonical order and, wherever a
  //   slot holds an open item, drop in the next id from the new open sequence; resolved
  //   items keep their exact canonical slot. So a reorder in Open only reshuffles open
  //   items relative to each other and never disturbs where resolved items live.
  const commitReorder = useCallback(() => {
    draggingRef.current = false
    const live = liveOrderRef.current
    let nextOrder = live
    if (filter === "open") {
      const canonical = items.map((it) => it.id)
      const newOpenSeq = live.filter((id) => openItemIds.has(id))
      let p = 0
      nextOrder = canonical.map((id) => (openItemIds.has(id) ? newOpenSeq[p++] : id))
    }
    reorderContextItems(contextId, nextOrder)
    notifyDataChanged()
  }, [contextId, filter, items, openItemIds, notifyDataChanged])

  // The entity rows, rendered from `liveOrder` so a drag can rearrange them instantly.
  // Each cell is a `ReorderRow` (a handle-only draggable wrapper around the row's
  // EntityNode). In "open" view a RESOLVED row is not draggable (no grip) and renders
  // faded — it's the settled zone below the open items; only open rows carry a grip.
  // In "all" view every row is draggable. Rows glide via framer `layout`; only the
  // just-born row plays an enter animation. Stale ids (missing from itemById) are skipped.
  const rowItems = liveOrder
    .map((id) => {
      const it = itemById.get(id)
      if (!it) return null
      const isOpenRow = filter !== "open" || openItemIds.has(id)
      return (
        <ReorderRow
          key={id}
          id={id}
          contextId={contextId}
          animating={animating}
          morphing={id === closingChildId}
          hostsWindow={hostsWindow(id)}
          born={id === bornId}
          canReorder={isOpenRow}
          // Resolved-zone dim (Open view). A CLOSED row is skipped here because the
          // EntityNode frame already fades it (opacity-40) — dimming it twice would
          // stack the two and make it nearly invisible.
          faded={filter === "open" && !isOpenRow && !isClosed(it.entity)}
          onDragStartRow={() => {
            draggingRef.current = true
          }}
          onCommit={commitReorder}
        />
      )
    })
    .filter(Boolean)

  // The permanent terminal creation row. It stays mounted at ALL times — including
  // while opening a CHILD and during this window's own CLOSE — so the list never
  // adds/removes a cell. During close it fades out (see CreateRow `closing`) rather
  // than unmounting. Only the active window's row grabs focus (see `active`).
  const createRowEl = (
    <CreateRow
      key={ADD_KEY}
      active={active}
      animating={animating}
      closing={closing}
      flipId={`${contextId}:__create__`}
      onCreate={createEntity}
      onCreateWeb={createWebEntity}
      onNavigateUp={navigateUpToList}
      onNavigateDown={navigateDownToDock}
    />
  )

  // Vertical mask for the scroller's edge fades. Each end fades over `FADE` px only
  // when that side has hidden content; an inactive side collapses to a 0px stop
  // (no visible fade). Reused for both `mask-image` and `-webkit-mask-image`.
  const FADE = 9
  const edgeFadeMask = `linear-gradient(to bottom, transparent 0, #000 ${
    fade.top ? FADE : 0
  }px, #000 calc(100% - ${fade.bottom ? FADE : 0}px), transparent 100%)`

  return (
    // `flex-1` so the section fills the column height — the scrolling <ul> below is
    // then a proper height-constrained scroller (and can center its content when
    // asked) rather than a content-height block pinned to the top.
    <section aria-label="Do list" className="flex min-h-0 flex-1 flex-col">
      {/* Keyed by context: switching entities hard-swaps the list (instant, no
          cross-fade) while add/remove within a context still animates. */}
      {/* While a window morph is in flight the overflow MUST be visible: opening a
          task row grows the SAME node into a fixed window, and GSAP Flip parks it
          at `position: absolute` for the duration of the tween. An absolute child
          is clipped by this scroller's bounds, so a clipped overflow would crop
          the growing window to the narrow column and only "release" it when Flip
          restores `position: fixed` at the very end (the disappearing-then-
          reappearing task bug). Visible overflow during the morph lets it escape;
          it returns to a normal scroller the instant the morph settles. */}
      {/* The create-input is DECOUPLED from the scrolling list — it's a flow element
          pinned DIRECTLY BELOW the rows (the list never scrolls behind it).
            • `justify-center-safe` centers the (rows + input) group when it's short,
              so an EMPTY entity shows the lone input dead-center; `-safe` falls back
              to top-aligned the instant the content overflows.
            • the scroller is `flex-initial` (grow 0 / shrink 1): it HUGS its content
              (0px when empty) but shrinks + scrolls once the list is long, keeping
              the input visible right below it.
          The dock (the entity's region 2) sits BELOW this region and reserves its own
          flow space, so the input rests just above it with no manual clamp. */}
          <div className={cn("flex min-h-0 flex-1 flex-col", centered && "justify-center-safe")}>
        {/* Open/All selectors. Hidden while the list is "virgin" (empty, or every item
            still open) ⇒ no chrome. Shown once at least one item has been RESOLVED
            (completed/cancelled) — scheduling/planning alone no longer reveals them.
            "Open" hides resolved items (a just-resolved one stays put via the retain set
            until the selector changes); "All" shows everything in place.
            Placed INSIDE the centering group and directly above the scroller so it rides
            with the (rows + input) block and sits right on top of the FIRST row rather
            than pinned to the region top. `px-2` matches the list's inset and `pl-1.5`
            lines the pills' text up with the row glyph. */}
        {/* PERMANENTLY RESERVED SLOT (fixed h-6). The selector band ALWAYS occupies its
            height whether or not the pills are shown, so the scroller + rows below NEVER
            shift when the selectors appear/disappear — the user can undo a click (e.g.
            re-check a task) without the list sliding out from under the cursor. The empty
            reserved band also counterbalances the dock's upward push on the region below.
            Only the pill frame itself animates, IN PLACE: it fades (opacity) and drifts a
            few px (y) within the fixed slot — no height change, so no layout reflow. Other
            list motion (adding/removing/completing rows) still animates the scroller freely;
            this only pins the selector toggle. `initial={false}` means the correct state is
            set on mount/context-switch without an animation (only in-session toggles
            animate); hidden pills are inert (`pointer-events-none` + `aria-hidden`).
            DIRECTION: the hidden state sits a few px LOWER (`y: 6`) and rises to `y: 0`, so
            the pills appear to emerge from BEHIND the rows below them (their own bottom
            edge) rather than dropping in from the top. */}
        <div className="h-6 shrink-0">
          {/* The pills are shown CONSTANTLY whenever the list is non-virgin (`showSelectors`)
              — no hover required. They stay hidden + inert only while the list is "virgin"
              (empty, or every item still open — i.e. none resolved) so a list with nothing
              to filter shows no chrome. The reveal still animates (fade + slight rise) on the
              virgin→non-virgin transition; the reserved `h-6` slot keeps the rows below from
              shifting either way. */}
          <div
            aria-hidden={!showSelectors}
            className={cn(
              "mb-1 flex translate-y-1.5 items-center justify-start gap-1 pr-2 pl-1.5 opacity-0",
              "pointer-events-none transition-[opacity,transform] duration-200 ease-out",
              showSelectors && "pointer-events-auto translate-y-0 opacity-100",
            )}
          >
            {(["all", "open"] as const).map((f) => (
              <button
                key={f}
                type="button"
                tabIndex={showSelectors ? 0 : -1}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs capitalize transition-colors",
                  filter === f
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {/* Reorder.Group renders the scrolling <ul> AND powers drag-and-drop
            reordering: `values` is the live id sequence, `onReorder` fires with the
            rearranged sequence during a drag (we mirror it into `liveOrder`), and the
            per-row grip commits it on drop. Non-draggable rows (the "open" view) simply
            never start a drag — the group is inert without a handle grab. */}
        <Reorder.Group
          as="ul"
          axis="y"
          values={liveOrder}
          onReorder={(next) => applyReorder(next as string[])}
          key={contextId}
          ref={scrollerRef}
          // `overflow: visible` during a window morph so a row growing into a window
          // (parked at `position: absolute` by GSAP Flip) isn't clipped; it returns
          // to a normal scroller the instant the morph settles.
          //
          // EDGE FADES: a vertical mask makes rows dissolve into transparency as they
          // scroll past the top/bottom edges. Each edge's fade is only added when there's
          // actually hidden content that way (`fade.top` / `fade.bottom`), so resting
          // rows stay fully opaque. Disabled mid-morph — a mask would clip the row
          // growing out of the scroller into a window.
          style={
            animating
              ? { overflow: "visible" }
              : fade.top || fade.bottom
                ? { maskImage: edgeFadeMask, WebkitMaskImage: edgeFadeMask }
                : undefined
          }
          // `-mx-7 px-7`: the negative margin + equal padding keep row CONTENT aligned to
          // the parent's content box (unchanged visually) while reserving a WIDE clip-safe
          // left gutter. `overflow-y-auto` also clips overflow-x, so the drag grip (which
          // lives to the LEFT of each row via `-translate-x-full`) was previously cropped in
          // the old 8px (`-mx-2`) gutter — 28px comfortably fits the bigger grip now.
          className="-mx-7 flex min-h-0 flex-initial flex-col gap-1.5 overflow-y-auto px-7 no-scrollbar"
        >
          <AnimatePresence initial={false} mode="popLayout">{rowItems}</AnimatePresence>
        </Reorder.Group>
        {/* Create-input — its own one-row list directly below the scroller. The inner
            `motion.li` carries `layout={!animating}`, so it SLIDES down as rows are
            added above (and back up on delete). `mt-1.5` only when rows exist mimics
            the list's row gap so it reads as the next item below them. */}
        <ul className={cn("-mx-2 list-none px-2", shown.length > 0 && "mt-1.5")}>
          {createRowEl}
        </ul>
      </div>

      {/* Transient NL→schedule outcome notice. Rendered as a floating pill at the
          bottom-center of the viewport (via portal) so the centered do-list layout
          and the dock never clip it. aria-live announces the async result to screen
          readers; it auto-dismisses after 4s (see flashNotice). */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {notice && (
              <motion.div
                role="status"
                aria-live="polite"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8, transition: { duration: 0.18 } }}
                className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
              >
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-full border bg-card-solid px-4 py-2 text-xs shadow-lg",
                    notice.tone === "error" ? "border-destructive/40 text-destructive" : "border-border text-foreground",
                  )}
                >
                  <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="text-pretty">{notice.text}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </section>
  )
}
