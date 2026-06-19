"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion, type Transition } from "motion/react"
import { Check, Plus, Pin, Trash2, Ban, RotateCcw, ChevronDown } from "lucide-react"
import {
  getContextItems,
  isPinned,
  pinItem,
  deleteEntity,
  setEventCancelled,
  setEntityTitle,
  changeEntityKind,
  addTask,
  type ContextItem,
} from "@/lib/zero/data"
import type { Entity } from "@/lib/zero/types"
import { useZeroNav, useRowSelection, ADD_KEY } from "@/lib/zero/nav-store"
import { MORPH_EASE } from "@/lib/zero/motion"
import { NodeGlyph, NODE_KIND_META, type NodeKind } from "./node-glyph"
import { EntityNode } from "./entity-node"
import { ContextMenu, type ContextMenuState } from "./context-menu"
import { cn } from "@/lib/utils"

const KIND_ORDER: NodeKind[] = ["task", "space", "event", "instant"]

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
 * In-place editing presentation for a freshly-created (or being-renamed) DO-list
 * entity. The entity ALREADY EXISTS in the store, so this is the real row's slot
 * rendered with a focused title input + glyph (kind) picker.
 */
function EditRow({
  entity,
  onCommit,
  onCancelEmpty,
}: {
  entity: Entity
  onCommit: (id: string) => void
  onCancelEmpty: (id: string) => void
}) {
  const { notifyDataChanged } = useZeroNav()
  const [kind, setKind] = useState<NodeKind>(entity.kind as NodeKind)
  const [title, setTitle] = useState(entity.title ?? "")
  const [anchor, setAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const rowRef = useRef<HTMLLIElement>(null)
  const doneRef = useRef(false) // guard so commit/cancel only fires once
  const menuOpen = anchor !== null

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const commit = () => {
    if (doneRef.current) return
    doneRef.current = true
    setEntityTitle(entity.id, title.trim())
    onCommit(entity.id)
  }
  const cancel = () => {
    if (doneRef.current) return
    doneRef.current = true
    onCancelEmpty(entity.id)
  }

  // Outside pointer finishes the edit: save if titled, else discard.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuOpen) return
      if (rowRef.current?.contains(e.target as Node)) return
      if (title.trim()) commit()
      else cancel()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => document.removeEventListener("pointerdown", onPointerDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, title])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
    }
    if (e.key === "Enter") {
      if (title.trim()) commit() // empty Enter is a no-op; keep editing
    } else if (e.key === "Escape") {
      if (menuOpen) setAnchor(null)
      else if (title.trim()) commit()
      else cancel()
    }
  }

  // Persist the kind change in place so the row keeps its identity/slot.
  const pickKind = (k: NodeKind) => {
    setKind(k)
    changeEntityKind(entity.id, k)
    notifyDataChanged()
    setAnchor(null)
    inputRef.current?.focus()
  }

  const toggleMenu = () => {
    if (menuOpen) {
      setAnchor(null)
      return
    }
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setAnchor({ left: r.left, top: r.top, bottom: r.bottom })
  }

  return (
    <motion.li
      ref={rowRef}
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.16 } }}
      transition={ROW_REFLOW}
    >
      <div
        style={{ borderRadius: 4 }}
        className="flex w-full items-center gap-3 border border-foreground/40 bg-card-solid px-2.5 py-2 text-left"
      >
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          aria-label={`Type: ${NODE_KIND_META[kind].label}. Change type`}
          onClick={toggleMenu}
          className={cn(
            "flex items-center gap-0.5 rounded-[3px] py-0.5 pl-0.5 pr-1 text-foreground transition-colors hover:bg-foreground/10",
            menuOpen && "bg-foreground/10",
          )}
        >
          <span className={GLYPH_BOX}>
            <NodeGlyph kind={kind} filled={false} strokeWidth={2} />
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>

        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Name this ${NODE_KIND_META[kind].label.toLowerCase()}…`}
          className="min-w-0 flex-1 bg-transparent text-[13px] tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
        />
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
      </AnimatePresence>
    </motion.li>
  )
}

/**
 * The permanent terminal "+ADD" birther row. Activating it asks the list to
 * birth a new entity. Always rendered last, so creating one never reflows the
 * rows above it.
 */
function AddRow({ onActivate }: { onActivate: () => void }) {
  const { lift, hoverProps, ref } = useRowSelection("list", ADD_KEY)
  return (
    // `layout` so ADD glides down to make room as a new draft row appears above it
    // (and back up when a row is deleted), in lockstep with the other cells.
    // `initial={false}`: ADD is always present, so it must never animate itself in.
    <motion.li layout initial={false} transition={ROW_REFLOW}>
      <motion.button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        onClick={onActivate}
        {...hoverProps}
        style={{ borderRadius: 4 }}
        animate={{ scale: lift ? 1.02 : 1 }}
        className="flex w-full items-center justify-center gap-1.5 border border-border bg-card-solid px-2.5 py-2 text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        Add
      </motion.button>
    </motion.li>
  )
}

/**
 * The DO list — the central column of an entity's working surface. It lists the
 * context's direct children (any kind) as generic `EntityRow`s, plus the inline
 * EditRow for a row being created/renamed, and the terminal ADD birther row.
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
  const { dataVersion, notifyDataChanged, open, selection, select, moveSelection, publishNavOrder, animating } =
    useZeroNav()
  // Re-read whenever data mutates or context changes. Pinned items are promoted
  // to the dock, so they're excluded here.
  const items = useMemo(
    () => getContextItems(contextId).filter((it) => !isPinned(contextId, it.id)),
    [contextId, dataVersion],
  )
  const [filter, setFilter] = useState<"open" | "all">("open")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  // Reset filter view when the context changes.
  useEffect(() => setFilter("open"), [contextId])

  const shown = useMemo(
    () => (filter === "open" ? items.filter((it) => it.kind !== "task" || !it.entity.completed) : items),
    [items, filter],
  )

  // The navigable keys of the DO list, ALWAYS ending with the ADD birther row.
  const listKeys = useMemo(() => [...shown.map((it) => it.id), ADD_KEY], [shown])

  useEffect(() => {
    if (!active) return
    publishNavOrder("list", listKeys)
  }, [active, listKeys, publishNavOrder])

  // Default selection when the viewed context changes. Only the frontmost
  // window (active) owns selection — ancestor do-lists stay mounted but inert.
  useEffect(() => {
    if (!active) return
    const first = shown[0]?.id
    select("list", first ?? ADD_KEY)
    // Only on context change / activation — intentionally omit `shown`/`select`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId, active])

  // Birth a new entity: created in the store immediately (default kind task),
  // appears as a real row directly above ADD, and enters edit mode while selected.
  const beginCreate = useCallback(() => {
    if (editingId) return
    const entity = addTask({ title: "", spaceId: contextId })
    notifyDataChanged()
    setEditingId(entity.id)
    select("list", entity.id, "keyboard")
  }, [editingId, contextId, notifyDataChanged, select])

  // Commit edit: keep the row selected (keyboard mode) so the next Enter opens it.
  const finishEdit = useCallback(
    (id: string) => {
      setEditingId(null)
      notifyDataChanged()
      select("list", id, "keyboard")
    },
    [notifyDataChanged, select],
  )

  // Cancel an untitled new row: delete it and fall selection back to ADD.
  const cancelEdit = useCallback(
    (id: string) => {
      setEditingId(null)
      deleteEntity(id)
      notifyDataChanged()
      select("list", ADD_KEY, "keyboard")
    },
    [notifyDataChanged, select],
  )

  // Window-level keyboard handler, active only when the DO list owns the
  // selection and no text input is focused.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (!selection || selection.region !== "list") return
      if (editingId) return
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
          e.preventDefault()
          if (key === ADD_KEY) beginCreate()
          else open(key, "row")
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
  }, [active, selection, editingId, moveSelection, open, beginCreate, listKeys, notifyDataChanged, select])

  const openMenu = (e: React.MouseEvent, item: ContextItem) => {
    e.preventDefault()
    e.stopPropagation()
    const canCancel = item.kind === "event" || item.kind === "instant"
    const isCancelled = !!item.entity.cancelled
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "Pin to Dock",
          icon: <Pin className="h-3.5 w-3.5" />,
          onSelect: () => {
            pinItem(contextId, item.id)
            notifyDataChanged()
          },
        },
        ...(canCancel
          ? [
              {
                label: isCancelled ? "Restore" : "Cancel",
                icon: isCancelled ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />,
                onSelect: () => {
                  setEventCancelled(item.id, !isCancelled)
                  notifyDataChanged()
                },
              },
            ]
          : []),
        {
          label: "Delete",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          onSelect: () => {
            deleteEntity(item.id)
            notifyDataChanged()
          },
        },
      ],
    })
  }

  return (
    // `flex-1` so the section fills the column height — the scrolling <ul> below is
    // then a proper height-constrained scroller (and can center its content when
    // asked) rather than a content-height block pinned to the top.
    <section aria-label="Do list" className="flex min-h-0 flex-1 flex-col">
      {/* The DO label and the Open/All filters are hidden. The list still defaults
          to the "open" filter internally (see `filter` state); only its toggle UI
          is removed. */}
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
      <ul
        key={contextId}
        // `overflow: visible` during ANY morph (`animating`), including this window's
        // close. The list is a height-constrained `overflow-y-auto` scroller at rest;
        // if it stayed clipped during the close the rows would be cut off and the
        // whole list appeared to vanish instantly while the intrinsic-height Dock
        // stayed. Visible overflow lets the rows show and shrink with the body's scale
        // tween. (The ADD row that used to jump here is now gated out by `active`
        // below, so it no longer matters that the list is unclipped during close.)
        style={animating ? { overflow: "visible" } : undefined}
        className={cn(
          "-mx-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 no-scrollbar",
          // Center the rows + ADD vertically when short; `-safe` falls back to
          // top-aligned the moment the list overflows, so the top is never clipped.
          centered && "justify-center-safe",
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((it) =>
            it.id === editingId ? (
              <EditRow key={it.id} entity={it.entity} onCommit={finishEdit} onCancelEmpty={cancelEdit} />
            ) : (
              <motion.li
                key={it.id}
                // `layout` lets the row glide to its new slot when a sibling is added
                // above/below or removed — this is what stops the list from "jumping"
                // on every edit. `initial={false}` so neither pre-existing rows nor a
                // row that just committed from its draft (EditRow → row, same key) ever
                // flash an enter animation; the only entrance is the draft EditRow's.
                // `exit` fades + slightly shrinks a deleted row while popLayout pulls it
                // out of flow so the rows below slide up to close the gap.
                //
                // CRITICAL: disable framer layout while a WINDOW morph is in flight
                // (`animating`). Opening a row grows that SAME node into a window driven
                // by GSAP Flip (which transforms the row's frame/glyph/title and reflows
                // its siblings). If framer also layout-animated these <li>s at the same
                // time, the two systems fight over the same elements — the glyph/title
                // flash out and back and the morph snaps on its first/last frame. Add/
                // delete/reorder do NOT set `animating`, so those edits still animate.
                layout={!animating}
                initial={false}
                exit={animating ? undefined : { opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
                transition={ROW_REFLOW}
              >
                <EntityNode
                  entityId={it.id}
                  contextId={contextId}
                  variant="row"
                  onContextMenu={(e) => openMenu(e, it)}
                />
              </motion.li>
            ),
          )}
          {/* The ADD birther row is a permanent terminal list cell — but only while
              the list is ACTIVE (the interactive top window). It is the last cell, so
              during a close morph it was the element that visibly jumped up over the
              title as the body left flow. Gating on `active` (false while closing AND
              while this window is a non-top/closing layer) drops it the instant the
              window stops being interactive, so there is nothing left to jump; `closing`
              is kept in the condition as a belt-and-braces guard. ADD is irrelevant on a
              window you can no longer type into anyway. */}
          {active && !closing && <AddRow key={ADD_KEY} onActivate={beginCreate} />}
        </AnimatePresence>
      </ul>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </section>
  )
}
