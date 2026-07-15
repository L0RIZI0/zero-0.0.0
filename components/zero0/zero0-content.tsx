"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { getChildren } from "@/lib/zero/data"
import { isClosed } from "@/lib/zero/kinds"
import { Zero0Face } from "./zero0-face"
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

export interface Zero0ContentCtx {
  /** Toggle a task's soft DONE marker. */
  toggleDone: (e: Entity) => void
  /** Play/Stop a playable ("whenever") moment/space's background session. */
  togglePlay: (e: Entity) => void
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
}

// Cap pathological trees. `getChildren` follows `taggedContextIds` (multi-parent), so a
// subtree can be arbitrarily deep or even cyclic; the ancestry guard blocks true cycles
// and this caps everything else so a deep chain can't lock the UI.
const MAX_CONTENT_DEPTH = 8

export type ContentAxis = "list"

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

export function Zero0Content({ entity, axis, depth, ancestry, ctx, isRoot, mounted = true }: Zero0ContentProps) {
  const { showHidden, rev, nowSec, sizeOf, makeOf, expandedIds } = ctx

  // DRAG-AND-DROP reorder state (this Content instance only — a row can only be dragged
  // among its own siblings). `dragId` = the row being dragged. `previewOrder` = the LIVE
  // reordered id list while dragging: the list physically rearranges under the cursor (the
  // rows slide via the FLIP effect below), and the arrangement is committed to persistence
  // on drop. Session-only; the committed order persists via `ctx.reorder`.
  const [dragId, setDragId] = useState<string | null>(null)
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null)

  const children = useMemo(
    () => getChildren(entity.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rev re-reads after mutations
    [entity.id, rev],
  )

  // FLIP animation — record each row's top before every render, and when the order changes
  // MID-DRAG animate each moved row from its old position to its new one (a smooth slide
  // instead of a snap). Refs, not state, so measuring never triggers a re-render. Gated on
  // an active drag so it never fights the collapse (grid-rows) animation.
  const rowEls = useRef(new Map<string, HTMLLIElement>())
  const prevTops = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const next = new Map<string, number>()
    rowEls.current.forEach((el, id) => next.set(id, el.getBoundingClientRect().top))
    if (dragId) {
      next.forEach((top, id) => {
        if (id === dragId) return // the dragged row follows the OS cursor, don't animate it
        const prev = prevTops.current.get(id)
        if (prev != null && Math.abs(prev - top) > 0.5) {
          rowEls.current
            .get(id)
            ?.animate([{ transform: `translateY(${prev - top}px)` }, { transform: "translateY(0)" }], {
              duration: 180,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            })
        }
      })
    }
    prevTops.current = next
  })

  // HIDE MODEL — decorate each child with whether it's hidden and (when not collapsed) its
  // display number. A child is hidden if EITHER the manual `hidden` flag is set (right-click
  // ▸ Hide) OR it is closed and was closed BEFORE today's logical 5am day-start (a derived,
  // non-destructive rule computed from the stamped close time, never stored). Collapsed =
  // hidden AND not currently revealed by `showHidden`. Display numbers count only VISIBLE
  // rows so the list never shows gaps. (Moved verbatim from the canvas.)
  const childRows = useMemo(() => {
    const now = Date.now()
    const d = new Date(now)
    d.setHours(5, 0, 0, 0)
    let dayStart = d.getTime()
    if (now < dayStart) dayStart -= 86_400_000 // before 5am → the logical day opened yesterday
    // Apply the live drag ORDER (falls back to natural order). Any preview id that no longer
    // exists is dropped; any real child missing from the preview is appended, so the list is
    // always exactly the current children, just reordered.
    let ordered = children
    if (previewOrder) {
      const byId = new Map(children.map((c) => [c.id, c]))
      const seen = new Set<string>()
      const front = previewOrder.map((id) => byId.get(id)).filter((c): c is (typeof children)[number] => !!c)
      front.forEach((c) => seen.add(c.id))
      ordered = [...front, ...children.filter((c) => !seen.has(c.id))]
    }
    let n = 0
    return ordered.map((e) => {
      const closedAt = e.closeAt ?? e.closedOn ?? e.cancelledOn ?? e.completeOn
      const autoHidden = isClosed(e) && closedAt != null && closedAt < dayStart
      const hidden = !!e.hidden || autoHidden
      const collapsed = hidden && !showHidden
      return { e, hidden, collapsed, num: collapsed ? null : ++n }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rev re-reads after mutations
  }, [children, showHidden, rev, previewOrder])

  // While dragging, live-reorder the preview so `dragId` sits before/after `targetId`
  // depending on which half of the target the cursor is over. Operates on the FULL child id
  // list (incl. collapsed) so hidden rows keep their slots.
  const dragOverRow = (targetId: string, clientY: number, rect: DOMRect) => {
    if (!dragId || dragId === targetId) return
    const base = previewOrder ?? children.map((c) => c.id)
    const without = base.filter((id) => id !== dragId)
    let idx = without.indexOf(targetId)
    if (idx < 0) return
    if (clientY > rect.top + rect.height / 2) idx += 1 // past the midpoint ⇒ drop AFTER
    without.splice(idx, 0, dragId)
    setPreviewOrder((cur) => (cur && cur.join("\u0000") === without.join("\u0000") ? cur : without))
  }

  // Commit the live preview order to persistence (or just clear if nothing moved).
  const endDrag = (commit: boolean) => {
    if (commit && previewOrder && dragId) ctx.reorder(entity.id, previewOrder)
    setDragId(null)
    setPreviewOrder(null)
  }

  if (!mounted) return null

  // A NESTED content always ends with an inline create row so you can populate ANY entity
  // in place (item: "create-entity row in content for each"). The top-level content leaves
  // creation to the canvas's own field, so it keeps the plain empty hint.
  const createRow = !isRoot ? (
    <ContentCreateRow onCreate={(raw) => ctx.createChild(entity.id, raw)} />
  ) : null

  if (children.length === 0) {
    if (isRoot) {
      return <p className="text-[11px] text-muted-foreground">— empty — create below</p>
    }
    // A nested empty entity: no children yet, but offer the create row so it can be filled.
    return <ul className="text-[11px] tabular-nums">{createRow}</ul>
  }

  return (
    <ul className="text-[11px] tabular-nums">
      {childRows.map(({ e, hidden, collapsed, num }) => {
        // ENDED (closed/dead/retired/cancelled) fades the whole row — a Content-side
        // decision (the row's opacity), so it lives here rather than in the Face.
        const closed = isClosed(e)
        // The rung this row is shown at (right-click ▸ Size). `l`/`xl`/`full` are BLOCK
        // cards (identity line + a meta dl) that grow the row VERTICALLY; the smaller rungs
        // stay a single inline line.
        const size = sizeOf(e.id)
        const isBlock = size === "l" || size === "xl" || size === "full"
        // The make this row READS as (right-click ▸ Make), orthogonal to size.
        const make = makeOf(e.id)

        // RECURSION — a row may open into its OWN Content. Offered for EVERY row (even a
        // childless one, so you can expand + create children inline via the nested create
        // row), as long as we're under the depth cap and expanding wouldn't re-enter an
        // ancestor (a `taggedContextIds` cycle). This is the Face(outside)/Content(inside)
        // nesting made literal.
        const canExpand = depth + 1 < MAX_CONTENT_DEPTH && !ancestry.has(e.id)
        const expanded = canExpand && !!expandedIds[e.id]

        // The Face fragment — one call for every rung. xs is a projection rung, so it drills
        // in via `onActivate`; the entity rungs use `onOpen`. Passing both is harmless.
        const face = (
          <Zero0Face
            entity={e}
            size={size}
            make={make}
            now={nowSec}
            onToggleDone={ctx.toggleDone}
            onTogglePlay={ctx.togglePlay}
            onOpen={ctx.openEntity}
            onActivate={() => ctx.openEntity(e)}
            onActivateContextMenu={(ev) => ctx.openMenu(e, ev, { size, make })}
            hiddenPrefix={hidden}
          />
        )
        // Content-side chrome shared by both layouts: drag grip + expand caret + row index
        // + delete ×.
        const num2 = num != null ? String(num).padStart(2, "0") : ""
        // Drag HANDLE — the only draggable element (so the title/glyph stay clickable). Hidden
        // by default; fades IN on row hover (and stays visible while THIS row is being dragged,
        // so it doesn't vanish mid-drag when the cursor leaves the row). Wide hit area so the
        // cursor doesn't fully cover it.
        const isDragging = dragId === e.id
        const gripCell = (
          <span
            draggable
            onDragStart={(ev) => {
              setDragId(e.id)
              setPreviewOrder(children.map((c) => c.id))
              ev.dataTransfer.effectAllowed = "move"
              try {
                ev.dataTransfer.setData("text/plain", e.id)
              } catch {
                /* some browsers restrict setData; the ref state is enough */
              }
            }}
            onDragEnd={() => endDrag(true)}
            className={
              // Reveal-on-hover via TEXT COLOR (same proven pattern as the delete ×) rather
              // than opacity — the opacity variant wasn't taking on hover. transition-colors
              // gives the smooth fade in/out; stays lit while THIS row is being dragged.
              "flex w-4 shrink-0 cursor-grab items-center justify-center self-center transition-colors duration-150 hover:!text-foreground active:cursor-grabbing motion-reduce:transition-none " +
              (isDragging ? "text-muted-foreground" : "text-transparent group-hover:text-muted-foreground")
            }
            aria-label={`Reorder ${e.title}`}
            title="Drag to reorder"
          >
            <svg viewBox="0 0 6 10" className="h-3.5 w-2" fill="currentColor" aria-hidden>
              <circle cx="1.5" cy="1.5" r="1" />
              <circle cx="4.5" cy="1.5" r="1" />
              <circle cx="1.5" cy="5" r="1" />
              <circle cx="4.5" cy="5" r="1" />
              <circle cx="1.5" cy="8.5" r="1" />
              <circle cx="4.5" cy="8.5" r="1" />
            </svg>
          </span>
        )
        // Caret column holds the ▸/▾ toggle when expandable, else an empty spacer so the
        // index column stays aligned across rows with and without children.
        // A childless row still gets a caret (expand to reveal its inline create row), but
        // it's drawn dimmer so a glance still tells apart "has content" from "empty".
        const hasChildren = getChildren(e.id).length > 0
        const caretCell = canExpand ? (
          <button
            type="button"
            onClick={() => ctx.toggleExpand(e.id)}
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
            className="w-4 shrink-0 text-right text-transparent group-hover:text-muted-foreground hover:!text-foreground"
            aria-label={`Delete ${e.title}`}
          >
            ×
          </button>
        )
        return (
          // COLLAPSE WRAPPER — a hidden-and-not-revealed row animates to 0fr height + 0
          // opacity via the dep-free grid-rows trick, staying MOUNTED so hide AND show both
          // animate. A long (650ms) eased slide+fade so rows glide away/in gently rather than
          // snapping. `inert` drops a collapsed row from tab/hit-testing.
          <li
            key={e.id}
            ref={(el) => {
              if (el) rowEls.current.set(e.id, el)
              else rowEls.current.delete(e.id)
            }}
            className="grid transition-[grid-template-rows,opacity] duration-[650ms] ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none"
            style={{ gridTemplateRows: collapsed ? "0fr" : "1fr", opacity: collapsed ? 0 : 1 }}
            inert={collapsed || undefined}
          >
            <div className="overflow-hidden">
              <div
                onContextMenu={(ev) => ctx.openMenu(e, ev, { size, make })}
                // Hovering a row LIGHTS its matching tick(s) in the dayline (grow + opaque).
                // Cleared on leave, falling back to the open-context highlight.
                onMouseEnter={() => ctx.setHoveredRowId(e.id)}
                onMouseLeave={() => ctx.setHoveredRowId(null)}
                // DROP TARGET — while a sibling is being dragged, live-reorder the list so the
                // dragged row lands here (before/after depending on the cursor half). The rows
                // physically slide via the FLIP effect; drop commits the arrangement.
                onDragOver={(ev) => {
                  if (!dragId || dragId === e.id) return
                  ev.preventDefault()
                  ev.dataTransfer.dropEffect = "move"
                  dragOverRow(e.id, ev.clientY, ev.currentTarget.getBoundingClientRect())
                }}
                onDrop={(ev) => {
                  ev.preventDefault()
                  endDrag(true)
                }}
                className={
                  "group border-b border-border/60 py-1.5 transition-opacity " +
                  (closed ? "opacity-60 " : "") +
                  (isDragging ? "opacity-40 " : "") +
                  // Inline rungs lay the columns out on a single baseline; block rungs stack
                  // the caret/index/× strip above the card body.
                  (isBlock ? "" : "flex items-baseline gap-3")
                }
              >
                {isBlock ? (
                  <div className="flex items-baseline gap-3">
                    {gripCell}
                    {caretCell}
                    {indexCell}
                    {/* The Face card takes the remaining width; its identity line + meta dl
                        stack inside. */}
                    <div className="min-w-0 flex-1">{face}</div>
                    {deleteCell}
                  </div>
                ) : (
                  <>
                    {gripCell}
                    {caretCell}
                    {indexCell}
                    {face}
                    {deleteCell}
                  </>
                )}
              </div>

              {/* NESTED CONTENT — the row's own inside, indented, sliding open/closed with
                  the same grid-rows trick. Kept MOUNTED while expanded so a data change
                  inside it stays live; unmounted when collapsed to keep deep trees cheap. */}
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
                          // Extend the ancestry with the CHILD (the new container), so a
                          // deeper descendant that points back at `e` is blocked too.
                          ancestry={new Set(ancestry).add(e.id)}
                          ctx={ctx}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </li>
        )
      })}
      {/* Inline create row so a non-empty nested entity can also gain more children in
          place. (Top-level uses the canvas's own create field.) */}
      {createRow}
    </ul>
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
