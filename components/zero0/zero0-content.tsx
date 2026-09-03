"use client"

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core"
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import { motion } from "motion/react"
import { getChildren, getEntity } from "@/lib/zero/data"
  import { isClosed, entityHiddenState } from "@/lib/zero/kinds"
import { serializeEntityToMarkdown, type MarkdownBaseline } from "@/lib/zero/entity-markdown"
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
// DRAG-AND-DROP (v0.2.152 … reworked v0.2.157 for TREE drag): powered by @dnd-kit with
// motion for a buttery lift/settle — deliberately RICHER than the /0 minimal aesthetic. The
// WHOLE ROW is draggable (a 6px activation distance means a plain click still drills). ONE
// DndContext lives at the ROOT (depth 0) and spans the ENTIRE visible tree, so a drag can
// cross levels. Three drop zones per row: TOP third = before it, BOTTOM third = after it
// (both reorder within THAT row's own parent — unambiguous, no depth projection), MIDDLE
// third = NEST inside it. DWELL-TO-EXPAND: holding the cursor over a collapsed row that has
// children auto-expands it (after DWELL_MS) so you can then drop precisely among its kids.
// Drop position is decided by hit-testing the LIVE cursor against every visible row's rect
// (window `pointermove`, NOT dnd-kit's `over`, which lagged).

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
  /** Reconcile `contextId`'s children from an edited markdown "code view" (zoom-out commit),
      then re-render. `baseline` is the id/line snapshot captured when the view OPENED, giving
      each line a stable identity so removals unlink + reorders reorder. See lib/zero/entity-markdown.ts. */
  applyMarkdown: (contextId: string, text: string, baseline?: MarkdownBaseline) => void
  /** Persist a drag-and-drop sibling order for `contextId` (full visible order). */
  reorder: (contextId: string, orderedIds: string[]) => void
  /** Move an entity INTO another context (nest it as a child). Returns false (no-op) on
      cycle/self so callers can abort a follow-up reorder. */
  reparent: (entityId: string, newContextId: string) => boolean
}

// Cap pathological trees. `getChildren` follows `taggedContextIds` (multi-parent), so a
// subtree can be arbitrarily deep or even cyclic; the ancestry guard blocks true cycles
// and this caps everything else so a deep chain can't lock the UI.
const MAX_CONTENT_DEPTH = 8

// How long the cursor must rest over a collapsed row (with children) before it auto-expands.
const DWELL_MS = 550

export type ContentAxis = "list"

// Where a drop will land relative to the row under the cursor.
//   before/after → REORDER as a sibling of the target, within the target's OWN parent
//   inside       → NEST as a child of the target
type DropMode = "before" | "after" | "inside"
interface DropIntent {
  /** The row the cursor is acting on. */
  overId: string
  mode: DropMode
  /** The target row's container (for before/after placement). Null for inside (overId IS
      the new parent). */
  parentId: string | null
}

// ── Shared drag state, provided ONCE at the root and read by every row in the tree ──
// Only the drop INTENT crosses component boundaries (to draw the indicator/nest ring on the
// right row). It updates only when the target changes (guarded), so consumers re-render
// rarely despite the drag firing on every pixel.
const ContentDragContext = createContext<{ dropIntent: DropIntent | null }>({ dropIntent: null })

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
  /** How it's hidden: "manual" (user) vs "auto" (system, closed before today) — drives the
   *  "(hidden)" vs "(auto-hidden)" title prefix. null when visible. */
  hiddenSource: "manual" | "auto" | null
  collapsed: boolean
  num: number | null
  }

// Build the full ordered id list for `parentId` with `draggedId` placed before/after
// `targetId` among its (current) children. Reads live data, so call AFTER any reparent.
function placeRelative(parentId: string, draggedId: string, targetId: string, mode: "before" | "after"): string[] {
  const ids = getChildren(parentId)
    .map((c) => c.id)
    .filter((id) => id !== draggedId)
  const ti = ids.indexOf(targetId)
  if (ti < 0) return [...ids, draggedId] // fallback: append
  ids.splice(mode === "after" ? ti + 1 : ti, 0, draggedId)
  return ids
}

// ── Public entry: at depth 0 install the single DndContext + drag controller; deeper levels
// render only their body (they share the root's context). ───────────────────────────────
export function Zero0Content(props: Zero0ContentProps) {
  if (props.mounted === false) return null
  if (props.depth === 0) return <ContentDragRoot {...props} />
  return <ContentBody {...props} />
}

// ── The ROOT drag controller — owns all drag state + the one DndContext + the overlay. ──
function ContentDragRoot(props: Zero0ContentProps) {
  const { entity, ctx } = props

  const [activeId, setActiveId] = useState<string | null>(null)
  const [dropIntent, setDropIntentState] = useState<DropIntent | null>(null)
  // Mirror the intent in a ref so onDragEnd (and the equality guard) always see the latest,
  // never a stale closure.
  const dropIntentRef = useRef<DropIntent | null>(null)
  // The top <ul> — its subtree contains EVERY visible row (nested lists render inside rows),
  // so one query gets the whole tree.
  const rootRef = useRef<HTMLUListElement>(null)
  const moveHandlerRef = useRef<((e: PointerEvent) => void) | null>(null)
  // Latest computeIntent, so the window listener (bound once at drag start) always runs the
  // current closure (fresh expandedIds, etc.).
  const computeIntentRef = useRef<(draggedId: string, cursorY: number) => void>(() => {})
  // Pending dwell-to-expand timer for the row currently under the cursor's middle band.
  const dwellRef = useRef<{ id: string; timer: number } | null>(null)

  const clearDwell = () => {
    if (dwellRef.current) {
      clearTimeout(dwellRef.current.timer)
      dwellRef.current = null
    }
  }

  const setDropIntent = (next: DropIntent | null) => {
    const cur = dropIntentRef.current
    if (cur && next && cur.overId === next.overId && cur.mode === next.mode && cur.parentId === next.parentId) return
    if (!cur && !next) return
    dropIntentRef.current = next
    setDropIntentState(next)
  }

  // A plain click must still drill (title) / toggle (glyph) even though the whole row is a
  // drag source: a 6px activation distance means the drag only begins once the pointer
  // actually moves, so click-through is preserved.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // Hit-test the LIVE cursor against every visible row in the tree and derive a drop intent.
  // Three zones per row (top/middle/bottom); the dragged row itself yields no intent so it
  // never targets itself. Dwelling over a collapsed row-with-children arms auto-expand.
  const computeIntent = (draggedId: string, cursorY: number) => {
    const root = rootRef.current
    if (!root) return
    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-drag-id]"))
    if (rows.length === 0) {
      setDropIntent(null)
      clearDwell()
      return
    }
    // Find the row whose vertical band contains the cursor.
    let hit: HTMLElement | null = null
    let rect: DOMRect | null = null
    for (const el of rows) {
      const r = el.getBoundingClientRect()
      if (cursorY >= r.top && cursorY <= r.bottom) {
        hit = el
        rect = r
        break
      }
    }
    // Above the first / below the last visible row → clamp to that edge row.
    if (!hit) {
      const firstR = rows[0].getBoundingClientRect()
      if (cursorY < firstR.top) {
        hit = rows[0]
        rect = firstR
      } else {
        hit = rows[rows.length - 1]
        rect = hit.getBoundingClientRect()
      }
    }
    const overId = hit.dataset.dragId!
    // Never target the dragged row itself — leave the last good intent's shape but blank it.
    if (overId === draggedId) {
      setDropIntent(null)
      clearDwell()
      return
    }
    const parentId = hit.dataset.parentId || null
    const ratio = (cursorY - rect!.top) / rect!.height
    let mode: DropMode
    if (ratio < 0.3) mode = "before"
    else if (ratio > 0.7) mode = "after"
    else mode = "inside"
    setDropIntent({ overId, mode, parentId })

    // Dwell-to-expand only in the middle (nest) zone, on a collapsed row that has children.
    if (mode === "inside" && hit.dataset.haschildren === "1" && !ctx.expandedIds[overId]) {
      if (!dwellRef.current || dwellRef.current.id !== overId) {
        clearDwell()
        const id = overId
        dwellRef.current = { id, timer: window.setTimeout(() => ctx.toggleExpand(id), DWELL_MS) }
      }
    } else {
      clearDwell()
    }
  }
  useEffect(() => {
    computeIntentRef.current = computeIntent
  })

  const onDragStart = (event: DragStartEvent) => {
    const draggedId = String(event.active.id)
    setActiveId(draggedId)
    const handler = (e: PointerEvent) => computeIntentRef.current(draggedId, e.clientY)
    moveHandlerRef.current = handler
    window.addEventListener("pointermove", handler)
    const activator = event.activatorEvent
    if (activator instanceof MouseEvent) computeIntentRef.current(draggedId, activator.clientY)
  }

  const clearDrag = () => {
    if (moveHandlerRef.current) {
      window.removeEventListener("pointermove", moveHandlerRef.current)
      moveHandlerRef.current = null
    }
    clearDwell()
    setActiveId(null)
    setDropIntent(null)
  }

  const onDragEnd = (event: DragEndEvent) => {
    const draggedId = String(event.active.id)
    const intent = dropIntentRef.current
    clearDrag()
    if (!intent || intent.overId === draggedId) return
    if (!getEntity(draggedId)) return

    if (intent.mode === "inside") {
      // NEST — the dragged entity becomes a child of the target (appended last). EXCEPT a web
      // resource is a browsing LEAF whose focused view shows only the web page (no child do-list),
      // so nesting inside it would make the dragged entity unreachable (the v0.2.288 "vanished"
      // data-loss bug). When the target is a web resource, DON'T nest — drop the dragged entity as a
      // SIBLING right AFTER it, within the resource's own parent, so the gesture is still meaningful
      // and nothing is lost. moveEntityToContext also refuses the nest as a belt-and-suspenders guard.
      const target = getEntity(intent.overId)
      if (target?.webUrl) {
        const sibParent = target.parentId
        if (!sibParent) return
        if (getEntity(draggedId)!.parentId !== sibParent && !ctx.reparent(draggedId, sibParent)) return
        ctx.reorder(sibParent, placeRelative(sibParent, draggedId, intent.overId, "after"))
        return
      }
      ctx.reparent(draggedId, intent.overId)
      return
    }

    // REORDER as a sibling of the target, within the target's own parent.
    const parentId = intent.parentId
    if (!parentId) return
    const dragged = getEntity(draggedId)!
    if (dragged.parentId === parentId) {
      ctx.reorder(parentId, placeRelative(parentId, draggedId, intent.overId, intent.mode))
    } else {
      // Cross-parent: move in first (guards cycles), then order within the new parent.
      if (!ctx.reparent(draggedId, parentId)) return
      ctx.reorder(parentId, placeRelative(parentId, draggedId, intent.overId, intent.mode))
    }
  }

  const activeEntity = activeId ? getEntity(activeId) ?? null : null

  // ── ZOOM: markdown "code view" of this entity's content (v0.2.353) ──────────────────
  // The entity's content IS a markdown file; the rows list is a projection of it. Pinch-IN
  // (ctrl+wheel, deltaY<0) reveals that file for inline editing; pinch-OUT re-parses it back
  // to rows. See lib/zero/entity-markdown.ts. Only at depth 0 (this component is depth-0 only).
  const [codeView, setCodeView] = useState(false)
  const [draft, setDraft] = useState("")
  // Refs so the NON-passive native wheel listener (bound once) always reads latest state.
  const codeViewRef = useRef(false)
  const draftRef = useRef("")
  const zoomAccumRef = useRef(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  // The id/line snapshot captured when the view OPENED — lets the commit give each line a stable
  // identity (so a removed line unlinks its child + moved lines reorder rows), not a positional guess.
  const baselineRef = useRef<MarkdownBaseline | null>(null)
  codeViewRef.current = codeView
  draftRef.current = draft

  // Reset to the rows view whenever we navigate to a different entity.
  useEffect(() => {
    setCodeView(false)
    zoomAccumRef.current = 0
  }, [entity.id])

  // Commit the edited file back into the children graph against the open-time snapshot: rename/
  // recolor/create, UNLINK removed lines, and reorder to the new line order. Idempotent — an
  // untouched file matches the baseline line-for-line ⇒ no writes — so it's safe from BOTH blur
  // and zoom-out.
  const commitDraft = () => ctx.applyMarkdown(entity.id, draftRef.current, baselineRef.current ?? undefined)

  const enterCodeView = () => {
    const text = serializeEntityToMarkdown(entity.id)
    setDraft(text)
    // Align ids ↔ lines 1:1 (serialize emits exactly one line per child, in getChildren order).
    baselineRef.current = {
      ids: getChildren(entity.id).map((c) => c.id),
      lines: text === "" ? [] : text.split("\n"),
    }
    setCodeView(true)
  }
  const exitCodeView = () => {
    commitDraft()
    setCodeView(false)
  }

  // ctrl+wheel (= trackpad pinch) flips ONE zoom level, with an accumulator + hysteresis so a
  // single gesture doesn't oscillate. Bound natively as { passive:false } so preventDefault
  // actually blocks the browser's page-zoom.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const THRESH = 45
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return // plain scroll passes through untouched
      e.preventDefault()
      e.stopPropagation()
      // Reset the accumulator when the gesture reverses direction.
      if (Math.sign(zoomAccumRef.current) !== Math.sign(e.deltaY)) zoomAccumRef.current = 0
      zoomAccumRef.current += e.deltaY
      if (zoomAccumRef.current <= -THRESH && !codeViewRef.current) {
        enterCodeView()
        zoomAccumRef.current = 0
      } else if (zoomAccumRef.current >= THRESH && codeViewRef.current) {
        exitCodeView()
        zoomAccumRef.current = 0
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handler reads latest via refs
  }, [entity.id])

  if (codeView) {
    const lineCount = draft.split("\n").length
    const rows = Math.max(3, lineCount + 1)
    return (
      <div ref={wrapRef}>
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground/70">
          <span>markdown</span>
          <span aria-hidden>pinch out to close</span>
        </div>
        {/* Gutter + textarea share the SAME font-mono / text-[11px] / leading-relaxed / py-2 so
            the numbers sit on their lines. The gutter counts only REAL lines (1…lineCount); the
            extra trailing row the textarea reserves for typing gets no number. */}
        <div className="flex rounded-sm border border-border bg-card/40 font-mono text-[11px] leading-relaxed">
          <div
            aria-hidden
            className="shrink-0 select-none border-r border-border/60 py-2 pl-2 pr-2 text-right text-muted-foreground/50 tabular-nums"
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            spellCheck={false}
            rows={rows}
            aria-label={`Markdown source for ${entity.title}`}
            className="w-full resize-none bg-transparent py-2 pl-2 pr-2 text-foreground caret-foreground outline-none"
          />
        </div>
      </div>
    )
  }

  return (
    <div ref={wrapRef}>
    <ContentDragContext.Provider value={{ dropIntent }}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={clearDrag}
      >
        <ContentBody {...props} listRef={rootRef} />

        {/* The floating clone that follows the cursor — a lifted card with a spring pop.
            On drop, `keyframes` animates it from its lifted state (opacity 0.85) TO the
            settled destination transform at opacity 0, so it DISSOLVES into place instead of
            blinking out. Transform strings are built inline to avoid a phantom
            `@dnd-kit/utilities` dep. */}
        <DragOverlay
          dropAnimation={{
            duration: 240,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            keyframes: ({ transform }) => {
              const t = (x: number, y: number, sx: number, sy: number) =>
                `translate3d(${x}px, ${y}px, 0) scaleX(${sx}) scaleY(${sy})`
              const { initial, final } = transform
              return [
                { opacity: 0.85, transform: t(initial.x, initial.y, initial.scaleX, initial.scaleY) },
                { opacity: 0, transform: t(final.x, final.y, final.scaleX, final.scaleY) },
              ]
            },
          }}
        >
          {activeEntity ? (
            <motion.div
              initial={{ scale: 1, opacity: 1 }}
              animate={{ scale: 1.03, opacity: 0.85 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] text-card-foreground shadow-lg"
            >
              {/* Explicit box: the glyph SVG has a viewBox but NO intrinsic width/height, so
                  inside the portaled overlay (no width constraint) it would balloon to fill
                  the screen without this size class. */}
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-foreground">
                <Zero0Glyph kind={activeEntity.kind} filled={isClosed(activeEntity)} className="h-4 w-4" />
              </span>
              <span className="truncate">{activeEntity.title}</span>
            </motion.div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </ContentDragContext.Provider>
    </div>
  )
}

// ── The recursive body: this level's children as a SortableContext + <ul> of rows. Rendered
// at every depth; only the root passes a `listRef` (for whole-tree hit-testing). ─────────
function ContentBody({
  entity,
  axis,
  depth,
  ancestry,
  ctx,
  isRoot,
  listRef,
}: Zero0ContentProps & { listRef?: React.Ref<HTMLUListElement> }) {
  const { showHidden, rev } = ctx

  // Which row the cursor is over — drives the reveal of the delete ×. Local per level.
  const [hoverId, setHoverId] = useState<string | null>(null)

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
  let n = 0
  return children.map((e) => {
  // Effective hide state comes from the SHARED helper (same rule the right-click menu labels
  // from), so manual + auto-hide + the explicit-unhide override all agree in one place.
  const hiddenSource = entityHiddenState(e, now)
  const hidden = hiddenSource != null
  const collapsed = hidden && !showHidden
  return { e, hidden, hiddenSource, collapsed, num: collapsed ? null : ++n }
  })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rev re-reads after mutations
  }, [children, showHidden, rev])

  const sortableIds = useMemo(() => childRows.map((r) => r.e.id), [childRows])

  // A NESTED content always ends with an inline create row so you can populate ANY entity
  // in place. The top-level content leaves creation to the canvas's own field.
  const createRow = !isRoot ? <ContentCreateRow onCreate={(raw) => ctx.createChild(entity.id, raw)} /> : null

  if (children.length === 0) {
    if (isRoot) {
      return <p className="text-[11px] text-muted-foreground">— empty — create below</p>
    }
    return <ul className="text-[11px] tabular-nums">{createRow}</ul>
  }

  return (
    <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
      <ul ref={listRef} className="text-[11px] tabular-nums">
        {childRows.map((row) => (
          <ContentRow
            key={row.e.id}
            row={row}
            parentId={entity.id}
            axis={axis}
            depth={depth}
            ancestry={ancestry}
            ctx={ctx}
            hoverId={hoverId}
            setHoverId={setHoverId}
          />
        ))}
        {createRow}
      </ul>
    </SortableContext>
  )
}

// ── A single ENTITY CONTENT row ────────────────────────────────────────────────
// Owns its `useSortable` (drag handle + isDragging). The whole row body is the drag handle;
// inner buttons (title/glyph/caret/×) still receive clicks thanks to the activation distance.
function ContentRow({
  row,
  parentId,
  axis,
  depth,
  ancestry,
  ctx,
  hoverId,
  setHoverId,
}: {
  row: ChildRow
  parentId: string
  axis: ContentAxis
  depth: number
  ancestry: ReadonlySet<string>
  ctx: Zero0ContentCtx
  hoverId: string | null
  setHoverId: (id: string | null) => void
}) {
  const { e, hidden, hiddenSource, collapsed, num } = row
  const { nowSec, sizeOf, makeOf, expandedIds } = ctx
  const { dropIntent } = useContext(ContentDragContext)

  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: e.id })

  // ENDED (closed/dead/retired/cancelled) fades the whole row.
  const closed = isClosed(e)
  const size = sizeOf(e.id)
  const isBlock = size === "l" || size === "xl" || size === "full"
  const make = makeOf(e.id)

  // RECURSION — a row may open into its OWN Content (see MAX_CONTENT_DEPTH + ancestry guard).
  const canExpand = depth + 1 < MAX_CONTENT_DEPTH && !ancestry.has(e.id)
  const expanded = canExpand && !!expandedIds[e.id]
  const hasChildren = getChildren(e.id).length > 0

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
      hiddenPrefix={hidden ? (hiddenSource ?? "manual") : false}
    />
  )

  const num2 = num != null ? String(num).padStart(2, "0") : ""

  const caretCell = canExpand ? (
    <button
      type="button"
      onClick={() => ctx.toggleExpand(e.id)}
      onPointerDown={(ev) => ev.stopPropagation()}
      className={
        "flex w-4 shrink-0 items-center justify-end leading-none transition-colors hover:text-foreground " +
        (hasChildren ? "text-muted-foreground" : "text-muted-foreground/40")
      }
      aria-label={expanded ? `Collapse ${e.title}` : `Expand ${e.title}`}
      aria-expanded={expanded}
    >
      {/* A single chevron-right SVG that rotates 90° to point down when expanded — crisper
          than the old ▸/▾ triangle glyphs and it animates the open/close transition. */}
      <svg
        viewBox="0 0 16 16"
        aria-hidden
        className={
          "h-3 w-3 transition-transform duration-150 motion-reduce:transition-none " +
          (expanded ? "rotate-90" : "")
        }
      >
        <path
          d="M6 4l4 4-4 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
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
        {/* Relative wrapper hosts the before/after REORDER indicator bars + the nest ring.
            The drop-measurement data-* live HERE (the header BAND) — NOT on the motion.li,
            which also wraps the nested children and whose rect would therefore span the whole
            subtree, so the hit-test always matched the ancestor and never the hovered child. */}
        <div
          className="relative"
          data-drag-id={e.id}
          data-parent-id={parentId}
          data-haschildren={hasChildren ? "1" : "0"}
        >
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
              (intentHere === "inside" ? "bg-primary/10 ring-1 ring-inset ring-primary/60 " : "hover:bg-muted/40 ") +
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
