"use client"

import { useMemo } from "react"
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
  // rows so the list never shows gaps. (Moved verbatim from the canvas.)
  const childRows = useMemo(() => {
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

  if (!mounted) return null

  if (children.length === 0) {
    // Only the top-level content shows the create hint; a nested empty just reads "— empty —".
    return (
      <p className="text-[11px] text-muted-foreground">{isRoot ? "— empty — create below" : "— empty —"}</p>
    )
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

        // RECURSION — a row may open into its OWN Content. Offered only when the child
        // actually has children, we're under the depth cap, and expanding wouldn't re-enter
        // an ancestor (a `taggedContextIds` cycle). This is the Face(outside)/Content(inside)
        // nesting made literal.
        const hasChildren = getChildren(e.id).length > 0
        const canExpand = hasChildren && depth + 1 < MAX_CONTENT_DEPTH && !ancestry.has(e.id)
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
        // Content-side chrome shared by both layouts: expand caret + row index + delete ×.
        const num2 = num != null ? String(num).padStart(2, "0") : ""
        // Caret column holds the ▸/▾ toggle when expandable, else an empty spacer so the
        // index column stays aligned across rows with and without children.
        const caretCell = canExpand ? (
          <button
            type="button"
            onClick={() => ctx.toggleExpand(e.id)}
            className="w-3 shrink-0 text-left text-muted-foreground transition-colors hover:text-foreground"
            aria-label={expanded ? `Collapse ${e.title}` : `Expand ${e.title}`}
            aria-expanded={expanded}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-3 shrink-0" aria-hidden />
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
                className={
                  "group border-b border-border/60 py-1.5 " +
                  (closed ? "opacity-60 " : "") +
                  // Inline rungs lay the columns out on a single baseline; block rungs stack
                  // the caret/index/× strip above the card body.
                  (isBlock ? "" : "flex items-baseline gap-3")
                }
              >
                {isBlock ? (
                  <div className="flex items-baseline gap-3">
                    {caretCell}
                    {indexCell}
                    {/* The Face card takes the remaining width; its identity line + meta dl
                        stack inside. */}
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
    </ul>
  )
}
