"use client"

import { useCallback, useState } from "react"
import type { Entity, Recurrence } from "@/lib/zero/types"
import { getOccurrenceRows, describeRecurrence } from "@/lib/zero/face-model"
import { parseSlotToken, parseRepeatToken } from "@/lib/zero/create-parse"
import type { MenuItem } from "@/lib/zero/menu-model"
import { Zero0DomMenu, type Zero0DomMenuState } from "./zero0-dom-menu"

// The §0 PLANNED OCCURRENCES block (v0.2.229; ALWAYS-ON v0.2.232; renamed from "occurrences" v0.2.233)
// — the SINGLE way an entity shows its schedule in §0. Shown+editable for EVERY kind except the Soul
// (v0.2.238). (Backing field: schedule.plannedOccurrences[] + schedule.repeat + schedule.exceptions.)
//
// TWO-FOLD LAYOUT (v0.2.240): the occurrences are no longer one merged start-ordered list. They split
// into two independently start-ordered sub-lists:
//   1. SERIES (optional, only when schedule.repeat is set) — the projected rule INSTANCES, under a title
//      that names the rule (describeRecurrence, e.g. "repeats every Tuesday and Friday · 1:00 PM"). The
//      title carries the series-level actions: EDIT (placeholder, not wired yet) + CLEAR (stop repeating).
//   2. ONE-OFF — the explicitly-planned DEFINITE occurrences (scalar primary + plannedOccurrences[]).
//      Its title carries CANCEL ALL + "+ add slot".
// Each row (instance or occurrence) carries per-item actions: EDIT (placeholder) · CANCEL/RESTORE · DELETE.
// CANCEL is a restorable struck tombstone, gated to not-yet-ended occurrences (r.cancellable); DELETE is
// a hard removal (definite: splice/clear; rule: a `removed` EXDATE that drops the instance from the
// projection). An INSTANT kind still renders each occurrence as a single POINT time (isInstant path in
// formatOccurrenceParts). DORMANT-by-design: only the STATUS word shows, never the planned-vs-actual delta.

const PLACEHOLDER = "e.g. 1400-1530, 2330, in 2h, 12h daily"

/** A user action on the block, dispatched up to the canvas (which owns the writers + re-render). Cancel
    and delete are discriminated by `origin` (v0.2.234) so the canvas routes to the right writer without
    guessing: a DEFINITE row carries whether it's the PRIMARY (scalar) span + its plannedOccurrences[]
    index; a RULE row carries its `recurrenceId` (the day-key the exceptions layer targets). */
export type OccurrenceAction =
  | { type: "add"; start: number; end?: number }
  | { type: "cancel"; origin: "definite"; primary: boolean; occIndex: number; cancelled: boolean }
  | { type: "cancel"; origin: "rule"; recurrenceId: number; cancelled: boolean }
  | { type: "delete"; origin: "definite"; primary: boolean; occIndex: number }
  | { type: "delete"; origin: "rule"; recurrenceId: number }
  // CANCEL ALL not-yet-ended DEFINITE occurrences (v0.2.240) — the one-off list's title action.
  | { type: "cancelAll" }
  // SET A RULE from the add-slot field (v0.2.235) — "12h daily", "daily", "weekdays 9h", etc. `start`/
  // `end` (when a time was also given) become the rule ANCHOR; absent ⇒ anchored at now by the writer.
  | { type: "repeat"; repeat: Recurrence; start?: number; end?: number }
  // CLEAR the recurrence rule (v0.2.239) — the "clear" / "stop repeating" control. Drops schedule.repeat.
  | { type: "clearRepeat" }

type Row = ReturnType<typeof getOccurrenceRows>[number]

const ACTION_CLS =
  "text-[9px] uppercase tracking-wider text-muted-foreground opacity-60 hover:text-foreground hover:opacity-100"

export function Zero0Occurrences({
  entity,
  now,
  onAction,
}: {
  entity: Entity
  /** Epoch (ms) driving the derived status words. */
  now: number
  /** Dispatch an add / cancel / delete. Absent ⇒ read-only (no titles' actions, no per-row controls). */
  onAction?: (e: Entity, action: OccurrenceAction) => void
}) {
  const rows = getOccurrenceRows(entity, now)
  const ruleRows = rows.filter((r) => r.origin === "rule")
  const definiteRows = rows.filter((r) => r.origin === "definite")
  const hasRepeat = !!entity.schedule?.repeat
  const anyCancellableDefinite = definiteRows.some((r) => !r.cancelled && r.cancellable)

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState(false)
  // Right-click menu for the series chips (v0.2.242) — reuses the shared Zero0DomMenu popup.
  const [menu, setMenu] = useState<Zero0DomMenuState | null>(null)

  // Dispatch a per-instance/occurrence action, discriminated by `origin` so the canvas routes to the
  // right writer without guessing. Shared by the one-off rows' inline buttons AND the series chips' menu.
  const dispatchRowAction = useCallback(
    (r: Row, kind: "cancel" | "delete") => {
      if (!onAction) return
      if (kind === "cancel") {
        onAction(
          entity,
          r.origin === "rule"
            ? { type: "cancel", origin: "rule", recurrenceId: r.recurrenceId!, cancelled: !r.cancelled }
            : { type: "cancel", origin: "definite", primary: r.primary, occIndex: r.occIndex, cancelled: !r.cancelled },
        )
      } else {
        onAction(
          entity,
          r.origin === "rule"
            ? { type: "delete", origin: "rule", recurrenceId: r.recurrenceId! }
            : { type: "delete", origin: "definite", primary: r.primary, occIndex: r.occIndex },
        )
      }
    },
    [onAction, entity],
  )

  // Open the series-chip menu at the cursor: EDIT (disabled placeholder) · CANCEL/RESTORE (when the
  // instance is cancellable or already cancelled) · DELETE. Wired to BOTH right-click and plain click,
  // so the actions are reachable without a physical right-mouse button (trackpads, etc.).
  const openRowMenu = useCallback(
    (r: Row, ev: React.MouseEvent) => {
      if (!onAction) return
      ev.preventDefault()
      const items: MenuItem[] = [{ type: "item", id: "edit", label: "Edit", disabled: true }]
      if (r.cancelled || r.cancellable) items.push({ type: "item", id: r.cancelled ? "restore" : "cancel", label: r.cancelled ? "Restore" : "Cancel" })
      items.push({ type: "item", id: "delete", label: "Delete", danger: true })
      setMenu({
        items,
        x: ev.clientX,
        y: ev.clientY,
        onSelect: (id) => {
          if (id === "cancel" || id === "restore") dispatchRowAction(r, "cancel")
          else if (id === "delete") dispatchRowAction(r, "delete")
        },
      })
    },
    [onAction, dispatchRowAction],
  )

  // Visual tone of a series chip by derived status (the vertical list's STATUS word is dropped here —
  // the chip conveys it via color + a `title` tooltip; NEXT is brightened + ringed).
  const chipCls = (r: Row) => {
    const interactive = onAction ? "cursor-pointer hover:text-foreground " : ""
    if (r.cancelled) return interactive + "rounded-sm px-1 line-through text-muted-foreground/40"
    if (r.isNext) return interactive + "rounded-sm px-1 text-foreground ring-1 ring-border"
    const tone = r.status === "missed" ? "text-muted-foreground/50" : "text-muted-foreground"
    return interactive + "rounded-sm px-1 " + tone
  }

  const submit = useCallback(() => {
    // RECURRENCE-AWARE (v0.2.235): if any word parses as a recurrence ("daily", "weekdays", …) the field
    // sets the entity's RULE instead of adding a one-off slot — the rest of the tokens (if any) parse as
    // the anchor TIME ("12h daily" ⇒ daily rule anchored at 12:00; bare "daily" ⇒ anchored at now by the
    // writer). Otherwise it's the definite-slot path.
    const words = draft.trim().split(/\s+/).filter(Boolean)
    let repeat: Recurrence | null = null
    let repeatIdx = -1
    for (let i = 0; i < words.length; i++) {
      const r = parseRepeatToken(words[i])
      if (r) {
        repeat = r
        repeatIdx = i
        break
      }
    }
    if (repeat) {
      const timePart = words.filter((_, i) => i !== repeatIdx).join(" ").trim()
      let anchor: { start: number; end?: number } | undefined
      if (timePart) {
        const parsed = parseSlotToken(timePart, now)
        if (!parsed) {
          setError(true)
          return
        }
        anchor = { start: parsed.start, end: parsed.end }
      }
      onAction?.(entity, { type: "repeat", repeat, start: anchor?.start, end: anchor?.end })
      setDraft("")
      setError(false)
      setAdding(false)
      return
    }
    const parsed = parseSlotToken(draft, now)
    if (!parsed) {
      setError(true)
      return
    }
    onAction?.(entity, { type: "add", start: parsed.start, end: parsed.end })
    setDraft("")
    setError(false)
    setAdding(false)
  }, [draft, now, onAction, entity])

  // One DEFINITE (one-off) occurrence row — DAY · TIME · STATUS · [NEXT] + inline actions (edit ·
  // cancel/restore · delete). The SERIES sub-list no longer uses this; it renders horizontal chips
  // (v0.2.242) whose actions live in a right-click menu instead of inline text buttons.
  const renderRow = (r: Row) => (
    <li key={`${r.origin}-${r.index}`} className="flex items-center gap-2 text-[10px] tabular-nums">
      <span aria-hidden className="text-muted-foreground opacity-50">
        ·
      </span>
      {/* DAY fixed-width so every TIME lines up; TIME min-width-fixed so the STATUS word starts at a
          constant x whether point or range. "unset" segments fade like the status word. */}
      <span className={"flex items-baseline gap-2 " + (r.cancelled ? "line-through opacity-60" : "")}>
        <span className="w-20 shrink-0 text-muted-foreground">{r.day}</span>
        <span className="min-w-[7.5rem] text-foreground">
          {r.time.map((seg, i) => (
            <span key={i} className={seg.muted ? "text-muted-foreground" : undefined}>
              {seg.text}
            </span>
          ))}
        </span>
      </span>
      <span className="text-muted-foreground">{r.statusWord}</span>
      {r.isNext && <span className="text-[9px] uppercase tracking-wider text-foreground opacity-70">next</span>}
      {onAction && (
        <span className="ml-auto flex items-center gap-2">
          {/* EDIT — placeholder (v0.2.240): per-occurrence time-edit isn't wired yet. */}
          <button type="button" disabled className="text-[9px] uppercase tracking-wider text-muted-foreground opacity-30" title="Edit (coming soon)">
            edit
          </button>
          {/* CANCEL / RESTORE — restorable struck tombstone, gated to not-yet-ended occurrences. */}
          {(r.cancelled || r.cancellable) && (
            <button type="button" onClick={() => dispatchRowAction(r, "cancel")} className={ACTION_CLS} title={r.cancelled ? "Restore this occurrence" : "Cancel this occurrence"}>
              {r.cancelled ? "restore" : "cancel"}
            </button>
          )}
          {/* DELETE — hard removal (splice/clear the slot). Distinct from the restorable cancel. */}
          <button type="button" onClick={() => dispatchRowAction(r, "delete")} className={ACTION_CLS} title="Delete this occurrence">
            delete
          </button>
        </span>
      )}
    </li>
  )

  return (
    <div className="col-span-2 mt-3">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">planned occurrences</div>

      {/* ── SERIES sub-list (only when a repeat rule is set) ── HORIZONTAL chips (v0.2.242): the rule
          label is followed inline by a wrapping flow of day chips (Today · Aug 7 · Aug 14 …) instead of
          a tall vertical list. Each chip opens a right-click / click menu (edit · cancel/restore ·
          delete); status is conveyed by tone (NEXT brightened + ringed, missed faded, cancelled struck)
          plus a `title` tooltip. The rule-level EDIT/CLEAR actions stay pinned to the right. */}
      {hasRepeat && (
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[10px]">
          <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
            <span aria-hidden className="opacity-50">
              ↻
            </span>
            <span className="text-foreground">{describeRecurrence(entity)}</span>
          </span>
          {ruleRows.length > 0 && (
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1 gap-y-1 tabular-nums">
              {ruleRows.map((r) => (
                <button
                  key={`rule-${r.index}`}
                  type="button"
                  onClick={onAction ? (ev) => openRowMenu(r, ev) : undefined}
                  onContextMenu={onAction ? (ev) => openRowMenu(r, ev) : undefined}
                  title={`${r.day} — ${r.statusWord}${r.isNext ? " · next" : ""}`}
                  className={chipCls(r)}
                >
                  {r.day}
                </button>
              ))}
            </span>
          )}
          {onAction && (
            <span className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground">
              <button type="button" disabled className="text-[9px] uppercase tracking-wider text-muted-foreground opacity-30" title="Edit the recurrence rule (coming soon)">
                edit
              </button>
              <button type="button" onClick={() => onAction(entity, { type: "clearRepeat" })} className={ACTION_CLS} title="Clear the recurrence rule (stop repeating)">
                clear
              </button>
            </span>
          )}
        </div>
      )}

      {/* ── ONE-OFF sub-list (the explicitly-planned definite occurrences) ── */}
      <div>
        <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>one-off</span>
          {onAction && (
            <span className="ml-auto flex items-center gap-2">
              {anyCancellableDefinite && (
                <button
                  type="button"
                  onClick={() => onAction(entity, { type: "cancelAll" })}
                  className={ACTION_CLS}
                  title="Cancel all upcoming one-off occurrences"
                >
                  cancel all
                </button>
              )}
              <button type="button" onClick={() => setAdding(true)} className={ACTION_CLS} title="Add a one-off occurrence (or type a rule like 'daily')">
                + add slot
              </button>
            </span>
          )}
        </div>
        {definiteRows.length > 0 && <ul className="flex flex-col gap-0.5">{definiteRows.map((r) => renderRow(r))}</ul>}
        {onAction && adding && (
          <div className="mt-1">
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
                  submit()
                } else if (e.key === "Escape") {
                  setAdding(false)
                  setDraft("")
                  setError(false)
                }
              }}
              onBlur={() => {
                if (!draft) setAdding(false)
              }}
              placeholder={PLACEHOLDER}
              aria-label="New occurrence time"
              aria-invalid={error}
              className={
                "w-full bg-transparent text-[10px] tabular-nums placeholder:text-muted-foreground/60 focus:outline-none " +
                (error ? "text-foreground underline decoration-dotted decoration-muted-foreground underline-offset-2" : "text-foreground")
              }
            />
            {error && (
              <div className="mt-0.5 text-[9px] text-muted-foreground">{'Unrecognized — try a time (1400-1530, 2330, "in 2h") or a rule ("daily", "12h daily", "weekdays").'}</div>
            )}
          </div>
        )}
      </div>

      {/* Series-chip right-click / click menu — the shared popup (viewport-clamped, self-dismissing). */}
      {menu && <Zero0DomMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
