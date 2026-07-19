"use client"

import { useMemo, useRef, useState } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core"
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import { motion } from "motion/react"
import { getChildren } from "@/lib/zero/data"
import { isClosed } from "@/lib/zero/kinds"
import { Zero0Face } from "./zero0-face"
import { Zero0Glyph } from "./zero0-glyph"
import type { FaceSize, FaceMake } from "@/lib/zero/face-model"
import type { Entity } from "@/lib/zero/types"

// ── CONTENT — the SECOND primitive (see /excerpts) ─────────────────────────────
// If a Face is "an entity seen at a size", Content is "an entity's INSIDE seen along an
// AXIS": the set of entities it contains, arranged some way. Today the only axis is
// `list` (the vertical ENTITY CONTENT listing), but the axis parameter is real — a
// `timeline`/`grid`/`board` arrangement of the SAME children is a later reading.
//
// The two primitives NEST recursively, and that recursion is now literal: Content renders
// rows of Face; a row can EXPAND into its own nested Content; whose rows are Faces; … all
// the way down. A Face is the OUTSIDE of an entity, Content is the INSIDE; drilling in
// (breadcrumb) and expanding in place (▸) are the same move at two scales.
//
// Content is presentational: it fetches its children and owns the hide-model + expand
// chrome, but every ACTION and every cross-cutting VIEW accessor is threaded in via `ctx`
// (memoized once in the canvas) so the whole recursive tree shares one set of handlers.
//
// DRAG-AND-DROP (v0.2.152): powered by @dnd-kit (sortable + nestable) with motion for a
// buttery lift/settle — deliberately RICHER than the /0 minimal aesthetic, since this is an
// interaction surface. The WHOLE ROW is draggable (a 6px activation distance means a plain
// click still drills via the title); dropping on a row's TOP/BOTTOM edge REORDERS
// before/after it, dropping on its MIDDLE BAND NESTS the dragged entity INTO it (reparent).
// Each Content level owns its own DndContext, so a drag is scoped to one level's siblings.

export interface Zero0ContentCtx {
  /** Toggle a task's soft DONE marker. */
  toggleDone: (e: Entity) => void
  /** Play/Stop a playable ("whenever"/unscheduled) moment/space's background session. */
  togglePlay: (e: Entity) => void
  /** Record an occurrence on a markable instant. */
  mark: (e: Entity) => void
  /** Drill INTO an entity (push it onto the breadcrumb path). */
  openEntity: (e: Entity) => void
  /** Delete an entity (remove from its arrangement). */
  remove: (e: Entity) => void
  /** Open the entity right-click menu; `size`/`make` add the Size/Make submenus for the row. */
  openMenu: (e: Entity, ev: React.MouseEvent, opts?: { size?: FaceSize; make?: FaceMake }) => void
  /** The per-row Face rung (right-click ▸ Size), defaulting to `m`. */
  sizeOf: (id: string) => FaceSize
  /** The per-row Face make (right-click ▸ Make), defaulting to `default`. */
  makeOf: (id: string) => FaceMake
  /** Light this row's matching tick(s) in the dayline on hover. */
  setHoveredRowId: (id: string | null) => void
  /** Whether hidden (auto/manual) rows are currently revealed. */
  showHidden: boolean
  /** Epoch (seconds) driving live Face readouts. */
  nowSec: number
  /** Mutation counter — re-reads children/titles after a data change. */
  rev: number
  /** Which rows are expanded into their nested Content (session-only, canvas-owned). */
  expandedIds: Record<string, boolean>
  /** Toggle a row's inline expansion. */
  toggleExpand: (id: string) => void
  /** Create a child under `contextId` from a raw create-field line (full grammar). */
  createChild: (contextId: string, raw: string) => void
  /** Persist a drag-and-drop sibling order for `contextId` (full visible order). */
  reorder: (contextId: string, orderedIds: string[]) => void
  /** Move an entity INTO another context (nest it as a child). No-op on cycle/self. */
  reparent: (entityId: string, newContextId: string) => void
}

// Cap pathological trees. `getChildren` follows `taggedContextIds` (multi-parent), so a
// subtree can be arbitrarily deep or even cyclic; the ancestry guard blocks true cycles
// and this caps everything else so a deep chain can't lock the UI.
const MAX_CONTENT_DEPTH = 8

export type ContentAxis = "list"

// Where a drop will land relative to the row under the cursor.
//   before/after → REORDER (sit above/below the target sibling)
//   inside       → NEST (become a child of the target)
type DropMode = "before" | "after" | "inside"
interface DropIntent {
  overId: string
  mode: DropMode
}

export interface Zero0ContentProps {
  /** The container whose INSIDE we're showing. */
  entity: Entity
  /** How the children are arranged. Only `list` today; the parameter is the seam. */
  axis: ContentAxis
  /** Recursion depth (0 = the canvas's top-level content). */
  depth: number
  /** Ids from the root context down to AND INCLUDING `entity` — blocks expanding into an
      ancestor (a `taggedContextIds` cycle). */
  ancestry: ReadonlySet<string>
  ctx: Zero0ContentCtx
  /** True only for the canvas's top-level content, which shows the empty-state hint. */
  isRoot?: boolean
  /** Gate the first paint on the canvas's mount flag (avoids SSR/first-frame flicker). */
  mounted?: boolean
}

// A single decorated child row (hide model applied).
interface ChildRow {
  e: Entity
  hidden: boolean
  collapsed: boolean
  num: number | null
}

export function Zero0Content({ entity, axis, depth, ancestry, ctx, isRoot, mounted = true }: Zero0ContentProps) {
  const { showHidden, rev } = ctx

  // Which row the cursor is over — drives the reveal of the drag grip hint + delete ×.
  const [hoverId, setHoverId] = useState<string | null>(null)
  // The id being dragged (for the DragOverlay clone) and where it will land.
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dropIntent, setDropIntent] = useState<DropIntent | null>(null)
  // The cursor's Y at drag start — combined with dnd-kit's live `delta.y` this gives the
  // real-time pointer Y, so the before/after/inside decision follows the actual CURSOR
  // rather than the dragged row's geometric center (which drifts for tall rows).
  const pointerStartYRef = useRef(0)

  // A plain click must still drill (title) / toggle (glyph) even though the whole row is a
  // drag source: a 6px activation distance means the drag only begins once the pointer
  // actually moves, so click-through is preserved.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const children = useMemo(
    () => getChildren(entity.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rev re-reads after mutations
    [entity.id, rev],
  )

  // HIDE MODEL — decorate each child with whether it's hidden and (when not collapsed) its
  // display number. A child is hidden if EITHER the manual `hidden` flag is set (right-click
  // ▸ Hide) OR it is closed and was closed BEFORE today's logical 5am day-start (a derived,
  // non-destructive rule computed from the stamped close time, never stored). Collapsed =
  // hidden AND not currently revealed by `showHidden`. Display numbers count only VISIBLE
  // rows so the list never shows gaps.
  const childRows: ChildRow[] = useMemo(() => {
    const now = Date.now()
    const d = new Date(now)
    d.setHours(5, 0, 0, 0)
    let dayStart = d.getTime()
    if (now < dayStart) dayStart -= 86_400_000 // before 5am → the logical day opened yesterday
    let n = 0
    return children.map((e) => {
      const closedAt = e.closeAt ?? e.closedOn ?? e.cancelledOn ?? e.completeOn
      const autoHidden = isClosed(e) && closedAt != null && closedAt < dayStart
      const hidden = !!e.hidden || autoHidden
      const collapsed = hidden && !showHidden
      return { e, hidden, collapsed, num: collapsed ? null : ++n }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rev re-reads after mutations
  }, [children, showHidden, rev])

  const sortableIds = useMemo(() => childRows.map((r) => r.e.id), [childRows])

  // Given the row under the cursor, decide before / after / inside from which third of the
  // row the dragged item's CENTER sits in. Uses dnd-kit's translated active rect (which
  // tracks the pointer delta even with a DragOverlay) against the over row's rect.
  const onDragOver = (event: DragOverEvent) => {
    const { active, over, delta } = event
    if (!over || over.id === active.id) {
      setDropIntent(null)
      return
    }
    const overRect = over.rect
    // Live cursor Y = where the pointer started + how far dnd-kit says it has moved.
    const pointerY = pointerStartYRef.current + delta.y
    const ratio = (pointerY - overRect.top) / overRect.height
    const mode: DropMode = ratio < 0.3 ? "before" : ratio > 0.7 ? "after" : "inside"
    setDropIntent((cur) =>
      cur && cur.overId === String(over.id) && cur.mode === mode ? cur : { overId: String(over.id), mode },
    )
  }

  const onDragStart = (event: DragStartEvent) => {
    // PointerEvent extends MouseEvent, so this covers the PointerSensor's pointerdown too.
    const activator = event.activatorEvent
    if (activator instanceof MouseEvent) pointerStartYRef.current = activator.clientY
    else if (typeof TouchEvent !== "undefined" && activator instanceof TouchEvent)
      pointerStartYRef.current = activator.touches[0]?.clientY ?? 0
    setActiveId(String(event.active.id))
  }

  const clearDrag = () => {
    setActiveId(null)
    setDropIntent(null)
  }

  const onDragEnd = (event: DragEndEvent) => {
    const draggedId = String(event.active.id)
    const intent = dropIntent
    clearDrag()
    if (!intent || intent.overId === draggedId) return
    if (intent.mode === "inside") {
      // NEST — the dragged entity becomes a child of the target row.
      ctx.reparent(draggedId, intent.overId)
      return
    }
    // REORDER — rebuild the full visible sibling order with the dragged id removed then
    // re-inserted before/after the target.
    const ids = sortableIds.filter((id) => id !== draggedId)
    const targetIdx = ids.indexOf(intent.overId)
    if (targetIdx < 0) return
    const insertAt = intent.mode === "after" ? targetIdx + 1 : targetIdx
    ids.splice(insertAt, 0, draggedId)
    ctx.reorder(entity.id, ids)
  }

  if (!mounted) return null

  // A NESTED content always ends with an inline create row so you can populate ANY entity
  // in place. The top-level content leaves creation to the canvas's own field.
  const createRow = !isRoot ? <ContentCreateRow onCreate={(raw) => ctx.createChild(entity.id, raw)} /> : null

  if (children.length === 0) {
    if (isRoot) {
      return <p className="text-[11px] text-muted-foreground">— empty — create below</p>
    }
    return <ul className="text-[11px] tabular-nums">{createRow}</ul>
  }

  const activeEntity = activeId ? children.find((c) => c.id === activeId) ?? null : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={clearDrag}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <ul className="text-[11px] tabular-nums">
          {childRows.map((row) => (
            <ContentRow
              key={row.e.id}
              row={row}
              axis={axis}
              depth={depth}
              ancestry={ancestry}
              ctx={ctx}
              hoverId={hoverId}
              setHoverId={setHoverId}
              dropIntent={dropIntent}
              isAnyDragging={activeId != null}
            />
          ))}
          {createRow}
        </ul>
      </SortableContext>

      {/* The floating clone that follows the cursor — a lifted card with a spring pop. */}
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
        {activeEntity ? (
          <motion.div
            initial={{ scale: 1, opacity: 1 }}
            animate={{ scale: 1.03, opacity: 0.85 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] text-card-foreground shadow-lg"
          >
            {/* Explicit box: the glyph SVG has a viewBox but NO intrinsic width/height, so
                inside the portaled overlay (no width constraint) it would balloon to fill the
                screen without this size class. */}
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-foreground">
              <Zero0Glyph kind={activeEntity.kind} filled={isClosed(activeEntity)} className="h-4 w-4" />
            </span>
            <span className="truncate">{activeEntity.title}</span>
          </motion.div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

// ── A single ENTITY CONTENT row ────────────────────────────────────────────────
// Extracted so it can own its `useSortable` hook (one draggable+droppable per row). The
// whole row body is the drag handle; inner buttons (title/glyph/caret/×) still receive
// clicks thanks to the DndContext activation distance.
function ContentRow({
  row,
  axis,
  depth,
  ancestry,
  ctx,
  hoverId,
  setHoverId,
  dropIntent,
  isAnyDragging,
}: {
  row: ChildRow
  axis: ContentAxis
  depth: number
  ancestry: ReadonlySet<string>
  ctx: Zero0ContentCtx
  hoverId: string | null
  setHoverId: (id: string | null) => void
  dropIntent: DropIntent | null
  isAnyDragging: boolean
}) {
  const { e, hidden, collapsed, num } = row
  const { nowSec, sizeOf, makeOf, expandedIds } = ctx

  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: e.id })

  // ENDED (closed/dead/retired/cancelled) fades the whole row.
  const closed = isClosed(e)
  const size = sizeOf(e.id)
  const isBlock = size === "l" || size === "xl" || size === "full"
  const make = makeOf(e.id)

  // RECURSION — a row may open into its OWN Content (see MAX_CONTENT_DEPTH + ancestry guard).
  const canExpand = depth + 1 < MAX_CONTENT_DEPTH && !ancestry.has(e.id)
  const expanded = canExpand && !!expandedIds[e.id]

  // This row's live drop decoration (only when it's the target of the current drag).
  const intentHere = dropIntent && dropIntent.overId === e.id ? dropIntent.mode : null
  const revealed = hoverId === e.id || isDragging

  const face = (
    <Zero0Face
      entity={e}
      size={size}
      make={make}
      now={nowSec}
      onToggleDone={ctx.toggleDone}
      onTogglePlay={ctx.togglePlay}
      onMark={ctx.mark}
      onOpen={ctx.openEntity}
      onActivate={() => ctx.openEntity(e)}
      onActivateContextMenu={(ev) => ctx.openMenu(e, ev, { size, make })}
      hiddenPrefix={hidden}
    />
  )

  const num2 = num != null ? String(num).padStart(2, "0") : ""

  const hasChildren = getChildren(e.id).length > 0
  const caretCell = canExpand ? (
    <button
      type="button"
      onClick={() => ctx.toggleExpand(e.id)}
      onPointerDown={(ev) => ev.stopPropagation()}
      className={
        "w-4 shrink-0 text-left text-sm leading-none transition-colors hover:text-foreground " +
        (hasChildren ? "text-muted-foreground" : "text-muted-foreground/40")
      }
      aria-label={expanded ? `Collapse ${e.title}` : `Expand ${e.title}`}
      aria-expanded={expanded}
    >
      {expanded ? "▾" : "▸"}
    </button>
  ) : (
    <span className="w-4 shrink-0" aria-hidden />
  )
  const indexCell = <span className="w-6 shrink-0 text-right text-muted-foreground">{num2}</span>
  const deleteCell = (
    <button
      type="button"
      onClick={() => ctx.remove(e)}
      onPointerDown={(ev) => ev.stopPropagation()}
      className={
        "w-4 shrink-0 text-right text-muted-foreground transition-opacity duration-150 hover:text-foreground " +
        (revealed ? "opacity-100" : "opacity-0")
      }
      aria-label={`Delete ${e.title}`}
    >
      ×
    </button>
  )

  return (
    // motion.li with layout="position" gives a smooth spring SETTLE when the list reorders
    // (rows glide to their new spots) without fighting the grid-rows collapse animation
    // (which owns height). The collapse wrapper stays MOUNTED so hide + show both animate.
    <motion.li
      ref={setNodeRef}
      layout="position"
      transition={{ type: "spring", stiffness: 600, damping: 40 }}
      className="grid transition-[grid-template-rows,opacity] duration-[650ms] ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none"
      style={{ gridTemplateRows: collapsed ? "0fr" : "1fr", opacity: collapsed ? 0 : 1 }}
      inert={collapsed || undefined}
    >
      <div className="overflow-hidden">
        {/* Relative wrapper hosts the before/after REORDER indicator bars. */}
        <div className="relative">
          {intentHere === "before" && (
            <span aria-hidden className="pointer-events-none absolute inset-x-0 -top-px z-10 h-0.5 rounded bg-primary" />
          )}
          {intentHere === "after" && (
            <span aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px z-10 h-0.5 rounded bg-primary" />
          )}
          <div
            {...attributes}
            {...listeners}
            onContextMenu={(ev) => ctx.openMenu(e, ev, { size, make })}
            onMouseEnter={() => {
              setHoverId(e.id)
              ctx.setHoveredRowId(e.id)
            }}
            onMouseLeave={() => {
              setHoverId(hoverId === e.id ? null : hoverId)
              ctx.setHoveredRowId(null)
            }}
            className={
              // Whole row is the drag handle; grab cursor hints it. Subtle hover tint; a NEST
              // (inside) target gets a ring + tint so it reads as "drop in here".
              "group cursor-grab touch-none rounded-sm border-b border-border/60 py-1.5 transition-[opacity,background-color,box-shadow] active:cursor-grabbing motion-reduce:transition-none " +
              (intentHere === "inside"
                ? "bg-primary/10 ring-1 ring-inset ring-primary/60 "
                : "hover:bg-muted/40 ") +
              (closed ? "opacity-60 " : "") +
              // Source row while it's being dragged: SLIGHTLY translucent (a ghost left in
              // place) — the lifted DragOverlay clone is what reads as fully opaque.
              (isDragging ? "opacity-70 " : "") +
              (isBlock ? "" : "flex items-baseline gap-3")
            }
          >
            {isBlock ? (
              <div className="flex items-baseline gap-3">
                {caretCell}
                {indexCell}
                <div className="min-w-0 flex-1">{face}</div>
                {deleteCell}
              </div>
            ) : (
              <>
                {caretCell}
                {indexCell}
                {face}
                {deleteCell}
              </>
            )}
          </div>
        </div>

        {/* NESTED CONTENT — the row's own inside, indented, sliding open/closed. */}
        {canExpand && (
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
            style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              {expanded && (
                <div className="ml-3 border-l border-border/40 pl-3">
                  <Zero0Content
                    entity={e}
                    axis={axis}
                    depth={depth + 1}
                    ancestry={new Set(ancestry).add(e.id)}
                    ctx={ctx}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </motion.li>
  )
}

/** A minimal inline create field for the bottom of a nested Content list. Enter submits the
 *  raw line through the full create grammar (parsed by the canvas); CJK IME composition is
 *  respected so Enter confirming a composition doesn't create. Kept local + uncontrolled-ish
 *  via a tiny state so it never touches the canvas's main draft. */
function ContentCreateRow({ onCreate }: { onCreate: (raw: string) => void }) {
  const [value, setValue] = useState("")
  return (
    <li className="flex items-baseline gap-3 py-1.5 text-muted-foreground">
      {/* Spacers align the field with the row title column (grip + caret + index widths). */}
      <span className="w-3 shrink-0" aria-hidden />
      <span className="w-3 shrink-0 text-center" aria-hidden>
        +
      </span>
      <input
        type="text"
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key !== "Enter") return
          // Don't submit mid-IME-composition (CJK) — see coding guidelines.
          if (ev.nativeEvent.isComposing || ev.keyCode === 229) return
          const raw = value.trim()
          if (!raw) return
          onCreate(raw)
          setValue("")
        }}
        placeholder="create here…"
        className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        aria-label="Create entity here"
      />
    </li>
  )
}
