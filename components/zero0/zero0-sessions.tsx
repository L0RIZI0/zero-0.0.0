"use client"

import { useCallback, useState } from "react"
import type { Entity } from "@/lib/zero/types"
import { getSessionRows, type SessionRow } from "@/lib/zero/face-model"
import { parseSlotToken } from "@/lib/zero/create-parse"
import type { MenuItem } from "@/lib/zero/menu-model"
import { Zero0DomMenu, type Zero0DomMenuState } from "./zero0-dom-menu"

// The §0 RECORDED SESSIONS + ACCESS block (v0.2.293) — shown BELOW planned occurrences. It surfaces the
// two DERIVED session rails as plain lists (they used to be single meta-grid summary rows, hidden since
// the .279 default profile emptied the meta grid — so nothing displayed them anymore):
//   • RECORDED SESSIONS = `via:"play"` — the bottom rail (deliberate Play/Stop AND auto-enter play).
//     Each row is ONE stored session = one log entry, so it is individually EDITABLE: right-click (or
//     click) → Edit time / Delete. Edit reuses the same inline time-editor as planned occurrences
//     (prefilled with the session's clock, re-anchored onto its own day). Only CLOSED, anchored rows are
//     editable (see SessionRow.editable); the live/ongoing one uses the --start flow, not this menu.
//   • ACCESS = `via:"focus"` — the middle rail (machine-truth "where I was"). DISPLAY-ONLY: it's
//     presence, not a deliberate record, so it carries no edit/delete affordance.
// Empty rails render nothing (no header). Marks are excluded upstream by getSessionRows (not spans).

const ACTION_CLS =
  "text-[9px] uppercase tracking-wider text-muted-foreground opacity-60 hover:text-foreground hover:opacity-100"
const EDIT_PLACEHOLDER = "e.g. 1400 or 1400-1530"

/** Local-clock `HHMM` for prefilling the time editor — same convention as the occurrence editor. */
function clockHHMM(epoch: number): string {
  const d = new Date(epoch)
  return String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0")
}

/** Re-anchor a parsed clock onto a session's EXISTING day: keep the day of `dayAnchor`, overwrite only the
    H:M:S from `parsedTime` (which parseSlotToken may have placed on a different logical day). Mirrors the
    occurrence editor's applyClock exactly — editing a session's time is a time-of-day correction. */
function applyClock(dayAnchor: number, parsedTime: number): number {
  const day = new Date(dayAnchor)
  const t = new Date(parsedTime)
  day.setHours(t.getHours(), t.getMinutes(), t.getSeconds(), 0)
  return day.getTime()
}

/** A user action on a RECORDED session, dispatched up to the canvas (which owns the writers + re-render).
    Both are keyed by `anchorId` — the fold's correction handle (see Session.anchorId / editSession). */
export type SessionAction =
  | { type: "editSession"; anchorId: number; start: number; end: number }
  | { type: "deleteSession"; anchorId: number }

export function Zero0Sessions({
  entity,
  now,
  onAction,
}: {
  entity: Entity
  /** Epoch (ms) driving the live duration of any still-open session. */
  now: number
  /** Dispatch an edit/delete. Absent ⇒ read-only (no right-click menu, no inline editor). */
  onAction?: (e: Entity, action: SessionAction) => void
}) {
  const recorded = getSessionRows(entity, now, "play")
  const access = getSessionRows(entity, now, "focus")

  const [draft, setDraft] = useState("")
  const [error, setError] = useState(false)
  // EDIT MODE — when set, the inline input re-times this recorded session's clock (day fixed). Only ever a
  // recorded (editable) row is placed here. Cleared on commit / Esc / blur.
  const [editing, setEditing] = useState<SessionRow | null>(null)
  const [menu, setMenu] = useState<Zero0DomMenuState | null>(null)

  // Enter EDIT mode for one recorded session: open the inline input prefilled with the session's current
  // clock (HHMM-HHMM). A closed editable row always has both bounds, so the prefill is always a range.
  const startEdit = useCallback(
    (r: SessionRow) => {
      if (!onAction || !r.editable) return
      const prefill = r.endedAt != null ? `${clockHHMM(r.startedAt)}-${clockHHMM(r.endedAt)}` : clockHHMM(r.startedAt)
      setEditing(r)
      setDraft(prefill)
      setError(false)
      setMenu(null)
    },
    [onAction],
  )

  // Commit a TIME edit: parse the draft as a clock token, re-anchor both bounds onto the session's own day,
  // and dispatch `{type:"editSession"}` keyed by anchorId. A single-time token (no dash) is rejected here —
  // a recorded session needs BOTH a start and an end — so the editor errors rather than guess an end.
  const submitEdit = useCallback(() => {
    if (!editing || editing.anchorId == null) return
    const parsed = parseSlotToken(draft.trim(), now)
    if (!parsed || parsed.end == null) {
      setError(true)
      return
    }
    const dayAnchor = editing.startedAt
    const start = applyClock(dayAnchor, parsed.start)
    let end = applyClock(dayAnchor, parsed.end)
    // An overnight span (e.g. 2330-0100) re-anchors with end <= start ⇒ push end to the next day.
    if (end <= start) end += 24 * 60 * 60 * 1000
    onAction?.(entity, { type: "editSession", anchorId: editing.anchorId, start, end })
    setEditing(null)
    setDraft("")
    setError(false)
  }, [editing, draft, now, onAction, entity])

  // Open the recorded-row menu at the cursor: Edit time · Delete. Wired to BOTH right-click and plain click
  // so it's reachable without a physical right button (trackpads). stopPropagation: the §0 detail panel
  // wraps everything in an onContextMenu that opens the ENTITY menu, so without this a right-click here
  // would bubble up and open that instead (same guard the occurrence rows use).
  const openRowMenu = useCallback(
    (r: SessionRow, ev: React.MouseEvent) => {
      if (!onAction || !r.editable || r.anchorId == null) return
      ev.preventDefault()
      ev.stopPropagation()
      const items: MenuItem[] = [
        { type: "item", id: "edit", label: "Edit time" },
        { type: "item", id: "delete", label: "Delete", danger: true },
      ]
      setMenu({
        items,
        x: ev.clientX,
        y: ev.clientY,
        onSelect: (id) => {
          if (id === "edit") startEdit(r)
          else if (id === "delete") onAction(entity, { type: "deleteSession", anchorId: r.anchorId! })
        },
      })
    },
    [onAction, entity, startEdit],
  )

  if (recorded.length === 0 && access.length === 0) return null

  // One session row — a single tight line: `·` · DAY · TIME · DURATION. A recorded editable row is a
  // right-click/click target (Edit time / Delete); access + non-editable rows render as plain text. An
  // ONGOING recorded row shows its duration counting live and is NOT a menu target (edit is for closed).
  const renderRow = (r: SessionRow) => {
    const interactive = !!onAction && r.editable
    const body = (
      <div className="flex items-baseline gap-2">
        <span aria-hidden className="text-muted-foreground opacity-50">
          ·
        </span>
        <span className="w-16 shrink-0 text-muted-foreground">{r.day}</span>
        <span className="whitespace-nowrap text-foreground">{r.timeText}</span>
        <span className="whitespace-nowrap text-muted-foreground">{r.durationText}</span>
        {r.open && <span className="text-[9px] uppercase tracking-wider text-foreground opacity-70">ongoing</span>}
      </div>
    )
    return (
      <li key={r.key} className="text-[10px] tabular-nums leading-5">
        {interactive ? (
          <button
            type="button"
            onClick={(ev) => openRowMenu(r, ev)}
            onContextMenu={(ev) => openRowMenu(r, ev)}
            title="Recorded session — Edit time / Delete"
            className="w-full cursor-pointer text-left hover:opacity-100"
          >
            {body}
          </button>
        ) : (
          body
        )}
      </li>
    )
  }

  return (
    <div className="col-span-2 mt-3">
      {/* RECORDED SESSIONS — the editable bottom rail. Header only when the rail is non-empty. */}
      {recorded.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">recorded sessions</div>
          <ul className="flex flex-col">{recorded.map(renderRow)}</ul>
        </div>
      )}

      {/* ACCESS — the machine-truth presence rail. DISPLAY-ONLY (no onAction passed through to rows). */}
      {access.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">access</div>
          <ul className="flex flex-col">{access.map(renderRow)}</ul>
        </div>
      )}

      {/* Inline TIME editor (v0.2.293) — mirrors the occurrence editor: prefilled clock, day fixed. Only a
          recorded editable row ever sets `editing`. */}
      {onAction && editing && (
        <div className="mt-1">
          <div className="mb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">{`editing session · ${editing.day}`}</div>
          <input
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(false)
            }}
            onKeyDown={(e) => {
              // CJK IME guard: don't submit while composing (or on Safari's unreliable 229).
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === "Enter") {
                e.preventDefault()
                submitEdit()
              } else if (e.key === "Escape") {
                setEditing(null)
                setDraft("")
                setError(false)
              }
            }}
            onBlur={() => {
              // A blur cancels the edit (no accidental commit), same as the occurrence editor.
              setEditing(null)
              setDraft("")
              setError(false)
            }}
            placeholder={EDIT_PLACEHOLDER}
            aria-label="Edit session time"
            aria-invalid={error}
            className={
              "w-full bg-transparent text-[10px] tabular-nums placeholder:text-muted-foreground/60 focus:outline-none " +
              (error ? "text-foreground underline decoration-dotted decoration-muted-foreground underline-offset-2" : "text-foreground")
            }
          />
          {error && (
            <div className="mt-0.5 text-[9px] text-muted-foreground">Unrecognized — enter a range like 1400-1530.</div>
          )}
        </div>
      )}

      {/* Recorded-row right-click / click menu — the shared popup (viewport-clamped, self-dismissing). */}
      {menu && <Zero0DomMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
