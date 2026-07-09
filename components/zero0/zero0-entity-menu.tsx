"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  deleteEntity,
  setEntityCompleted,
  setEntityClosed,
  setEventCancelled,
  setEntityRequested,
  reopenEntity,
  changeEntityKind,
} from "@/lib/zero/data"
import { isClosed, KIND_META } from "@/lib/zero/kinds"
import { isDone } from "@/lib/zero/entity-log"
import type { Entity, EntityKind } from "@/lib/zero/types"
import { Zero0Glyph } from "./zero0-glyph"

// The kinds an entity can be turned INTO — the creatable set only (identity kinds
// `individual`/`soul` are excluded: not user-creatable, and changing them would
// break root-scoping).
const CHANGE_KINDS: EntityKind[] = ["task", "space", "resource", "moment", "instant", "community", "organism"]

export interface Zero0MenuAnchor {
  entity: Entity
  x: number
  y: number
}

interface MenuRow {
  label: string
  onSelect: () => void
}

/**
 * A self-contained, dependency-light right-click menu for the root canvas. It is
 * deliberately NOT the orphaned `components/zero` `EntityContextMenu` (which pulls
 * in the GSAP nav-store + morph stage): zero0 stays lean and data-styled, so this
 * calls the backbone lifecycle mutators directly.
 *
 * The menu is a pure function of the entity's kind + state, following the TWO-AXIS
 * model. For a LIVE entity with a lifecycle it offers:
 *   - Mark as Done / Undone  — the SOFT marker (checkmark), only kinds WITH a done
 *                              axis (Task / Moment / Instant);
 *   - Close                  — end the lifecycle. Fillable kinds fill+fade ("complete"),
 *                              terminal kinds just fade (retire / die);
 *   - Cancel                 — called off (bar + strike, closes).
 * An ENDED entity (closed / cancelled / derived / legacy complete) offers just Reopen
 * (one return path via {@link reopenEntity}). Plus Send as request (tasks), Change
 * into…, and Delete. No Pin — the dock is flashy-UX that root doesn't have.
 */
export function Zero0EntityMenu({
  anchor,
  onMutate,
  onClose,
}: {
  anchor: Zero0MenuAnchor
  onMutate: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [changing, setChanging] = useState(false)
  // Clamp the menu inside the viewport once its size is known.
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y })
  const { entity } = anchor
  const id = entity.id

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { innerWidth, innerHeight } = window
    const rect = el.getBoundingClientRect()
    setPos({
      x: Math.min(anchor.x, innerWidth - rect.width - 8),
      y: Math.min(anchor.y, innerHeight - rect.height - 8),
    })
  }, [anchor.x, anchor.y, changing])

  // Dismiss on outside pointer-down or Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  const run = (fn: () => void) => {
    fn()
    onMutate()
    onClose()
  }

  const meta = KIND_META[entity.kind]
  // A kind has a lifecycle if it can close (fillable) or reach a terminal end.
  const closeable = meta.fillsWhenClosed || meta.terminal != null
  // An entity is ENDED once it's closed for ANY reason — plain Close, Cancel, a
  // DERIVED time-close, or a LEGACY complete verdict. All converge on {@link
  // reopenEntity} as the single return path, which clears whichever applied.
  const ended = isClosed(entity)
  const done = isDone(entity)
  const requested = entity.kind === "task" && !!entity.requested
  // "Close" reads as its terminal flavor for non-fillable kinds.
  const closeLabel = meta.terminal === "retire" ? "Retire" : meta.terminal === "death" ? "End" : "Close"

  const rows: MenuRow[] = []
  if (closeable) {
    if (ended) {
      rows.push({ label: "Reopen", onSelect: () => run(() => reopenEntity(id)) })
    } else {
      // DONE is the soft marker — only kinds that HAVE a done axis.
      if (meta.hasDoneState) {
        rows.push({
          label: done ? "Mark as Undone" : "Mark as Done",
          onSelect: () => run(() => setEntityCompleted(id, !done)),
        })
      }
      rows.push({ label: closeLabel, onSelect: () => run(() => setEntityClosed(id, true)) })
      rows.push({ label: "Cancel", onSelect: () => run(() => setEventCancelled(id, true)) })
    }
  }
  if (entity.kind === "task") {
    rows.push({
      label: requested ? "Unsend request" : "Send as request",
      onSelect: () => run(() => setEntityRequested(id, !requested)),
    })
  }

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-40 border border-border bg-background py-1 text-[11px] tabular-nums shadow-none"
      style={{ left: pos.x, top: pos.y, fontFamily: "var(--font-zero0-mono), ui-monospace, monospace" }}
    >
      {rows.map((r) => (
        <button
          key={r.label}
          type="button"
          role="menuitem"
          onClick={r.onSelect}
          className="block w-full px-3 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {r.label}
        </button>
      ))}

      {/* Change into… — expands an inline sub-list of the other creatable kinds. */}
      <button
        type="button"
        aria-expanded={changing}
        onClick={() => setChanging((c) => !c)}
        className="flex w-full items-center justify-between px-3 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <span>Change into…</span>
        <span aria-hidden className="text-muted-foreground/60">
          {changing ? "−" : "+"}
        </span>
      </button>
      {changing && (
        <div className="border-t border-border/60">
          {CHANGE_KINDS.filter((k) => k !== entity.kind).map((k) => (
            <button
              key={k}
              type="button"
              role="menuitem"
              onClick={() => run(() => changeEntityKind(id, k))}
              className="flex w-full items-center gap-2 px-3 py-1 pl-5 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Zero0Glyph kind={k} className="h-3 w-3" />
              <span>{KIND_META[k].label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="my-1 border-t border-border/60" />
      <button
        type="button"
        role="menuitem"
        onClick={() => run(() => deleteEntity(id))}
        className="block w-full px-3 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        Delete
      </button>
    </div>
  )
}
