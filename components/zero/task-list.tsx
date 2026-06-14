"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { Check, Plus, Pin, Trash2, Ban, RotateCcw, ChevronDown } from "lucide-react"
import {
  getContextItems,
  getOpenTaskCount,
  isPinned,
  pinItem,
  deleteEntity,
  setEventCancelled,
  setEntityTitle,
  changeEntityKind,
  addTask,
  type ContextItem,
} from "@/lib/zero/data"
import type { Entity, TaskPriority } from "@/lib/zero/types"
import { useZeroNav, useRowSelection, ADD_KEY, HIGHLIGHT_SHADOW, HIGHLIGHT_SHADOW_NONE } from "@/lib/zero/nav-store"
import {
  layerTransition,
  taskLayoutId,
  taskTitleId,
  spaceLayoutId,
  spaceTitleId,
  eventRowLayoutId,
  eventRowTitleId,
  instantRowLayoutId,
  instantRowTitleId,
  glyphId,
} from "@/lib/zero/motion"
import { NodeGlyph, NODE_KIND_META, type NodeKind } from "./node-glyph"
import { ContextMenu, type ContextMenuState } from "./context-menu"
import { cn } from "@/lib/utils"

const KIND_ORDER: NodeKind[] = ["task", "space", "event", "instant"]

const priorityDot: Record<TaskPriority, string> = {
  high: "bg-accent",
  medium: "bg-foreground/40",
  low: "bg-foreground/20",
}

/**
 * Shared leading glyph box for every row, so the task square, event triangle,
 * and space hexagon all read at the same 16px size and weight. The square is
 * rendered very slightly paler than the others, per the unified treatment.
 */
const GLYPH_BOX = "flex h-4 w-4 shrink-0 items-center justify-center"

/**
 * Trailing detail showing how many open (incomplete) DIRECT child tasks live
 * inside a space — a number followed by the task square glyph (e.g. "4 ■").
 * Child spaces/events and deeper descendants are intentionally not counted.
 * Renders nothing when there are none.
 */
function OpenTaskCount({ spaceId }: { spaceId: string }) {
  const { dataVersion } = useZeroNav()
  const count = useMemo(() => getOpenTaskCount(spaceId), [spaceId, dataVersion])
  if (count === 0) return null
  return (
    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/70">
      <span className="font-medium tabular-nums">{count}</span>
      <span className="flex h-2.5 w-2.5 items-center justify-center">
        <NodeGlyph kind="task" strokeWidth={1.5} />
      </span>
    </span>
  )
}

function TaskRow({
  task,
  onContext,
}: {
  task: Entity
  onContext: (e: React.MouseEvent) => void
}) {
  const [done, setDone] = useState(!!task.completed)
  const { openTask, stack } = useZeroNav()
  const { showHighlight, lift, hoverProps, ref } = useRowSelection("list", task.id)

  // This row stays mounted while its window is open, and it carries the shared
  // taskLayoutId. If it kept that layoutId while the frame is also open, TWO
  // elements would own the same layoutId and Framer's frame-expand morph breaks
  // (the frame opens with no chrome). So while open, swap in an inert
  // placeholder so the layoutId lives only on the active frame. (The dock's
  // PinnedCard is different — it unmounts on open and uses no layoutId at all.)
  if (stack.includes(task.id)) {
    return (
      <li>
        <div
          aria-hidden
          className="h-[42px] w-full rounded-sm border border-dashed border-border/60 bg-secondary/30"
        />
      </li>
    )
  }

  return (
    <li>
      <motion.div
        ref={ref as React.Ref<HTMLDivElement>}
        layoutId={taskLayoutId(task.id)}
        transition={layerTransition}
        style={{ borderRadius: 4 }}
        onContextMenu={onContext}
        {...hoverProps}
        animate={{
          scale: lift ? 1.02 : 1,
          boxShadow: showHighlight ? HIGHLIGHT_SHADOW : HIGHLIGHT_SHADOW_NONE,
        }}
        className="group flex w-full items-center gap-3 border border-border bg-card-solid px-2.5 py-2 text-left"
      >
        <button
          type="button"
          aria-label={done ? "Mark task incomplete" : "Mark task complete"}
          onClick={(e) => {
            e.stopPropagation()
            setDone((d) => !d)
          }}
          className={cn(GLYPH_BOX, "relative text-foreground")}
        >
          <motion.span
            layoutId={glyphId(task.id)}
            transition={layerTransition}
            className="flex items-center justify-center"
          >
            <NodeGlyph kind="task" filled={done} strokeWidth={2} />
          </motion.span>
          {done && (
            <Check
              className="absolute h-2.5 w-2.5 text-background"
              strokeWidth={3.5}
            />
          )}
        </button>

        <button
          type="button"
          onClick={() => openTask(task.id)}
          className="flex min-w-0 flex-1 flex-col text-left"
        >
          <motion.span
            layoutId={taskTitleId(task.id)}
            transition={layerTransition}
            className={cn(
              "truncate text-[13px] tracking-tight transition-colors",
              done ? "text-muted-foreground/60 line-through" : "text-foreground",
            )}
          >
            {task.title}
          </motion.span>
          {task.tags && task.tags.length > 0 && (
            <span className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
              {task.tags.map((t) => `#${t}`).join("  ")}
            </span>
          )}
        </button>

        {task.dueDate && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
            {task.dueDate}
          </span>
        )}
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", priorityDot[task.priority ?? "medium"])} />
      </motion.div>
    </li>
  )
}

/** An event surfaced in the task list — opens as its own window. An event lives
 *  in two places at once (this row AND its timeline marker), so it can morph
 *  from EITHER: this row carries its own row-specific layoutId and opens with
 *  source "row", so the window grows from here when clicked here (and the
 *  timeline keeps its marker). While the window is open from the row, the row
 *  releases its layoutId to the frame (placeholder swap) so only one element
 *  owns it. Detail line shows the open-subtask count AND the time range. */
function EventRow({
  item,
  onContext,
}: {
  item: ContextItem
  onContext: (e: React.MouseEvent) => void
}) {
  const { open, stack, openSourceOf } = useZeroNav()
  const event = item.event!
  const hasRange = typeof event.start === "number" && typeof event.end === "number"
  const cancelled = !!event.cancelled
  const { showHighlight, lift, hoverProps, ref } = useRowSelection("list", event.id)

  // When opened FROM this row, hand the row layoutId to the frame so the morph
  // reads as the row growing into the window. (If it was opened from the
  // timeline instead, the row stays put and the timeline owns the morph.)
  if (stack.includes(event.id) && openSourceOf(event.id) === "row") {
    return (
      <li>
        <div
          aria-hidden
          className="h-[42px] w-full rounded-sm border border-dashed border-border/60 bg-secondary/30"
        />
      </li>
    )
  }

  return (
    <li>
      <motion.button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        layoutId={eventRowLayoutId(event.id)}
        transition={layerTransition}
        onClick={() => open(event.id, "row")}
        onContextMenu={onContext}
        {...hoverProps}
        style={{ borderRadius: 4 }}
        animate={{
          scale: lift ? 1.02 : 1,
          boxShadow: showHighlight ? HIGHLIGHT_SHADOW : HIGHLIGHT_SHADOW_NONE,
        }}
        className={cn(
          "group flex w-full items-center gap-3 border border-border bg-card-solid px-2.5 py-2 text-left",
          cancelled && "opacity-50",
        )}
      >
        <span className={cn(GLYPH_BOX, "text-foreground")}>
          <NodeGlyph kind="event" />
        </span>
        <motion.span
          layoutId={eventRowTitleId(event.id)}
          transition={layerTransition}
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] tracking-tight text-foreground",
            cancelled && "line-through",
          )}
        >
          {event.title}
        </motion.span>
        <OpenTaskCount spaceId={event.id} />
        {hasRange && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
            {fmtTime(event.start!)}
            {"\u2013"}
            {fmtTime(event.end!)}
          </span>
        )}
      </motion.button>
    </li>
  )
}

/** An instant surfaced in the task list — like an event row, but it marks a
 *  single point in time, so its detail shows one precise moment (down to the
 *  second). Like events, it can morph from EITHER this row or its timeline
 *  marker depending on where it's opened from. */
function InstantRow({
  item,
  onContext,
}: {
  item: ContextItem
  onContext: (e: React.MouseEvent) => void
}) {
  const { open, stack, openSourceOf } = useZeroNav()
  const instant = item.entity
  const hasMoment = typeof instant.at === "number"
  const cancelled = !!instant.cancelled
  const { showHighlight, lift, hoverProps, ref } = useRowSelection("list", instant.id)

  if (stack.includes(instant.id) && openSourceOf(instant.id) === "row") {
    return (
      <li>
        <div
          aria-hidden
          className="h-[42px] w-full rounded-sm border border-dashed border-border/60 bg-secondary/30"
        />
      </li>
    )
  }

  return (
    <li>
      <motion.button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        layoutId={instantRowLayoutId(instant.id)}
        transition={layerTransition}
        onClick={() => open(instant.id, "row")}
        onContextMenu={onContext}
        {...hoverProps}
        style={{ borderRadius: 4 }}
        animate={{
          scale: lift ? 1.02 : 1,
          boxShadow: showHighlight ? HIGHLIGHT_SHADOW : HIGHLIGHT_SHADOW_NONE,
        }}
        className={cn(
          "group flex w-full items-center gap-3 border border-border bg-card-solid px-2.5 py-2 text-left",
          cancelled && "opacity-50",
        )}
      >
        <span className={cn(GLYPH_BOX, "text-foreground")}>
          <NodeGlyph kind="instant" />
        </span>
        <motion.span
          layoutId={instantRowTitleId(instant.id)}
          transition={layerTransition}
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] tracking-tight text-foreground",
            cancelled && "line-through",
          )}
        >
          {instant.title}
        </motion.span>
        <OpenTaskCount spaceId={instant.id} />
        {hasMoment && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
            {fmtMoment(instant.at!, instant.seconds ?? 0)}
          </span>
        )}
      </motion.button>
    </li>
  )
}

/** A child space surfaced in the task list — hexagon glyph, dives in on click.
 *  Carries the shared space layoutId so the row's border frame expands into the
 *  opened window (same morph as the pinned SPACES-dock card). */
function SpaceRow({
  item,
  onContext,
}: {
  item: ContextItem
  onContext: (e: React.MouseEvent) => void
}) {
  const { openSpace, stack } = useZeroNav()
  const space = item.space!
  const accent = space.accent ?? "var(--muted-foreground)"
  const { showHighlight, lift, hoverProps, ref } = useRowSelection("list", space.id)

  // While this space is open as a frame, release the shared layoutId to the
  // frame (see TaskRow note) via an inert placeholder so the morph stays clean.
  if (stack.includes(space.id)) {
    return (
      <li>
        <div
          aria-hidden
          className="h-[42px] w-full rounded-sm border border-dashed border-border/60 bg-secondary/30"
        />
      </li>
    )
  }

  return (
    <li>
      <motion.button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        layoutId={spaceLayoutId(space.id)}
        transition={layerTransition}
        onClick={() => openSpace(space.id)}
        onContextMenu={onContext}
        {...hoverProps}
        style={{ borderRadius: 4 }}
        animate={{
          scale: lift ? 1.02 : 1,
          boxShadow: showHighlight ? HIGHLIGHT_SHADOW : HIGHLIGHT_SHADOW_NONE,
        }}
        className="group relative flex w-full items-center gap-3 overflow-hidden border border-border bg-card-solid px-2.5 py-2 text-left"
      >
        <motion.span
          layoutId={`${spaceLayoutId(space.id)}-accent`}
          transition={layerTransition}
          className="absolute left-0 top-0 h-full w-[3px]"
          style={{ backgroundColor: accent }}
        />
        <motion.span
          layoutId={glyphId(space.id)}
          transition={layerTransition}
          className={cn(GLYPH_BOX, "text-foreground")}
        >
          <NodeGlyph kind="space" />
        </motion.span>
        <motion.span
          layoutId={spaceTitleId(space.id)}
          transition={layerTransition}
          className="min-w-0 flex-1 truncate text-[13px] tracking-tight text-foreground"
        >
          {space.title}
        </motion.span>
        <OpenTaskCount spaceId={space.id} />
      </motion.button>
    </li>
  )
}

function fmtTime(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h >= 12 ? "pm" : "am"
  const hr = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`
}

/** A precise moment for an instant — always includes seconds. */
function fmtMoment(min: number, seconds: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h >= 12 ? "pm" : "am"
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${ampm}`
}

/**
 * The glyph (kind) picker for the inline draft row. Rendered to a body portal
 * so it escapes the DO list's `overflow-y-auto` clip, and anchored under the
 * trigger (flipping above when there isn't room below). Unlike the old popup,
 * the per-kind helper text is given room to show in full (no truncation).
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
                  {/* Full helper text — no truncation. */}
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
 * entity. The entity ALREADY EXISTS in the store, so this is not a separate
 * mount/unmount draft — it's the real row's slot rendered with a focused title
 * input + glyph (kind) picker. That's what dissolves the old create-animation
 * hiccup: the row is born in its final list position (directly above the ADD
 * birther row) and merely swaps its inner presentation on commit.
 *
 * Keys:
 *  - Enter commits the title and exits editing (the list keeps the row selected,
 *    so the next Enter opens it — the "second Enter opens" chain).
 *  - Esc cancels: removes the entity if still untitled (animated shrink-out via
 *    AnimatePresence), else just commits what's there.
 *  - Click outside saves when titled, discards when empty.
 * The glyph picker is only available here (while editing) and shows full,
 * non-truncated helper text.
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

  // Outside pointer finishes the edit: save if titled, else discard. The glyph
  // menu owns clicks via its own backdrop while open, so we stand down then.
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
    // While editing, this input fully owns the keyboard. Stop the native event
    // from reaching the window-level list handler: React 18 flushes the commit's
    // state updates synchronously before the event bubbles to window, so without
    // this the very Enter that commits would also be seen (with editing already
    // torn down) and open the row.
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
      transition={layerTransition}
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
 * The permanent terminal "+ADD" birther row. It is a selectable list cell
 * (`key = ADD_KEY`); activating it (click, or Enter while selected) asks the
 * list to birth a new entity. Always rendered last, so creating one never
 * reflows the rows above it.
 */
function AddRow({ onActivate }: { onActivate: () => void }) {
  const { showHighlight, lift, hoverProps, ref } = useRowSelection("list", ADD_KEY)
  return (
    <li>
      <motion.button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        onClick={onActivate}
        {...hoverProps}
        style={{ borderRadius: 4 }}
        animate={{
          scale: lift ? 1.02 : 1,
          boxShadow: showHighlight ? HIGHLIGHT_SHADOW : HIGHLIGHT_SHADOW_NONE,
        }}
        className="flex w-full items-center justify-center gap-1.5 border border-border bg-card-solid px-2.5 py-2 text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        Add
      </motion.button>
    </li>
  )
}

export function TaskList({ spaceId }: { spaceId: string }) {
  const { dataVersion, notifyDataChanged, open, selection, select, moveSelection, publishNavOrder, isClosing } =
    useZeroNav()
  // Re-read whenever data mutates (new item created / pin changed) or context
  // changes. Pinned items are promoted to the SPACES row, so they're excluded
  // here.
  const items = useMemo(
    () => getContextItems(spaceId).filter((it) => !isPinned(spaceId, it.id)),
    [spaceId, dataVersion],
  )
  const [filter, setFilter] = useState<"open" | "all">("open")
  // Id of the row currently being edited inline (just-created or renaming).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  // Reset filter view when the context changes.
  useEffect(() => setFilter("open"), [spaceId])

  const shown = useMemo(
    () =>
      filter === "open"
        ? items.filter((it) => it.kind !== "task" || !it.task!.completed)
        : items,
    [items, filter],
  )
  const openCount = items.filter((it) => it.kind === "task" && !it.task!.completed).length

  // The navigable keys of the DO list, ALWAYS ending with the ADD birther row.
  const listKeys = useMemo(() => [...shown.map((it) => it.id), ADD_KEY], [shown])

  // Publish list order so the store can do arrow-key math centrally.
  useEffect(() => {
    publishNavOrder("list", listKeys)
  }, [listKeys, publishNavOrder])

  // Default selection when the viewed context changes: first DO item, or ADD
  // when empty. No input mode is forced, so it won't paint a stray highlight
  // until the user actually drives via mouse or keyboard.
  useEffect(() => {
    const first = shown[0]?.id
    select("list", first ?? ADD_KEY)
    // Only on context change — intentionally omit `shown`/`select`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId])

  // Birth a new entity: it's created in the store immediately (default kind
  // task), appears as a real row directly above ADD, and enters edit mode while
  // selected. Because the row is born in its final slot, nothing above reflows.
  const beginCreate = useCallback(() => {
    if (editingId) return
    const entity = addTask({ title: "", spaceId })
    notifyDataChanged()
    setEditingId(entity.id)
    select("list", entity.id, "keyboard")
  }, [editingId, spaceId, notifyDataChanged, select])

  // Commit edit: keep the row selected (keyboard mode) so the next Enter opens it.
  const finishEdit = useCallback(
    (id: string) => {
      setEditingId(null)
      notifyDataChanged()
      select("list", id, "keyboard")
    },
    [notifyDataChanged, select],
  )

  // Cancel an untitled new row: delete it (AnimatePresence shrinks it out) and
  // fall the selection back to the ADD row so the user can try again.
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
  // selection and no text input is focused (so an EditRow's own input keeps
  // Enter/Esc while editing). Arrows delegate to the store's spatial nav.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selection || selection.region !== "list") return
      // While a row is being edited, the EditRow's input fully owns the keyboard
      // (its own Enter/Esc). Bailing on `editingId` — not on focus detection —
      // prevents the same Enter that commits a title from also opening the row.
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
          // Choose the neighbor to select BEFORE removing the current row.
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
  }, [selection, editingId, moveSelection, open, beginCreate, listKeys, notifyDataChanged, select])

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
          label: "Pin to Spaces",
          icon: <Pin className="h-3.5 w-3.5" />,
          onSelect: () => {
            pinItem(spaceId, item.id)
            notifyDataChanged()
          },
        },
        ...(canCancel
          ? [
              {
                label: isCancelled ? "Restore" : "Cancel",
                icon: isCancelled ? (
                  <RotateCcw className="h-3.5 w-3.5" />
                ) : (
                  <Ban className="h-3.5 w-3.5" />
                ),
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
    <section aria-label="Do list" className="flex min-h-0 flex-col">
      {/* The DO label is hidden; the Open/All filters stay pinned to the right
          on a short header row that keeps alignment with the INPUTS / OUTPUTS
          columns on each side. */}
      <div className="relative mb-1 flex h-5 items-center justify-end px-1">
        <div className="flex items-center gap-1">
          {(["open", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[11px] capitalize transition-colors",
                filter === f
                  ? "text-foreground"
                  : "text-muted-foreground/70 hover:text-foreground",
              )}
            >
              {f === "open" ? `Open ${openCount}` : "All"}
            </button>
          ))}
        </div>
      </div>

      {/* Keyed by context: switching nodes hard-swaps the list (instant, no
          cross-fade) while add/remove within a context still animates. The
          -mx-2/px-2 gutter gives the hover scale room so rows aren't clipped
          horizontally by overflow-y's implicit overflow-x clip.

          While a close morph runs we drop to overflow-visible: the closing
          entity's title morphs IN from the frame header (ABOVE this box), so an
          `auto` clip would shear it to a fragment ("...roduct") mid-flight.
          Restored to scrolling the moment the morph settles. */}
      <ul
        key={spaceId}
        className={cn(
          "-mx-2 flex min-h-0 flex-1 flex-col gap-1.5 px-2 no-scrollbar",
          isClosing ? "overflow-visible" : "overflow-y-auto",
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {/* Empty state renders nothing but the ADD birther row below. The row
              being edited swaps to EditRow in its own slot (no remount churn). */}
          {shown.map((it) =>
            it.id === editingId ? (
              <EditRow key={it.id} entity={it.entity} onCommit={finishEdit} onCancelEmpty={cancelEdit} />
            ) : it.kind === "task" ? (
              <TaskRow key={it.id} task={it.task!} onContext={(e) => openMenu(e, it)} />
            ) : it.kind === "space" ? (
              <SpaceRow key={it.id} item={it} onContext={(e) => openMenu(e, it)} />
            ) : it.kind === "event" ? (
              <EventRow key={it.id} item={it} onContext={(e) => openMenu(e, it)} />
            ) : (
              <InstantRow key={it.id} item={it} onContext={(e) => openMenu(e, it)} />
            ),
          )}
          {/* The ADD birther row is a permanent terminal list cell. */}
          <AddRow key={ADD_KEY} onActivate={beginCreate} />
        </AnimatePresence>
      </ul>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </section>
  )
}
