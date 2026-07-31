"use client"

import { useCallback, useState } from "react"
import type { Entity, Recurrence } from "@/lib/zero/types"
import { getOccurrenceRows, describeRecurrence } from "@/lib/zero/face-model"
import { parseSlotToken, parseRepeatToken } from "@/lib/zero/create-parse"

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

  // One occurrence/instance row — shared by both sub-lists. Renders DAY · TIME · STATUS · [NEXT] and the
  // per-row actions (edit · cancel/restore · delete). Cancel/delete dispatch is discriminated by origin.
  // `inSeries` (v0.2.240): a series instance suppresses its TIME column, since the rule title already
  // states the shared anchor time — showing "1:00 PM – unset" on every instance is redundant noise.
  // (When per-occurrence time-edit lands, an overridden instance can opt back into showing its time.)
  const renderRow = (r: Row, inSeries = false) => (
    <li key={`${r.origin}-${r.index}`} className="flex items-center gap-2 text-[10px] tabular-nums">
      <span aria-hidden className="text-muted-foreground opacity-50">
        ·
      </span>
      {/* DAY fixed-width so every TIME lines up; TIME min-width-fixed so the STATUS word starts at a
          constant x whether point or range. "unset" segments fade like the status word. */}
      <span className={"flex items-baseline gap-2 " + (r.cancelled ? "line-through opacity-60" : "")}>
        <span className="w-20 shrink-0 text-muted-foreground">{r.day}</span>
        {!inSeries && (
          <span className="min-w-[7.5rem] text-foreground">
            {r.time.map((seg, i) => (
              <span key={i} className={seg.muted ? "text-muted-foreground" : undefined}>
                {seg.text}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="text-muted-foreground">{r.statusWord}</span>
      {r.isNext && <span className="text-[9px] uppercase tracking-wider text-foreground opacity-70">next</span>}
      {onAction && (
        <span className="ml-auto flex items-center gap-2">
          {/* EDIT — placeholder (v0.2.240): the per-occurrence time-edit feature isn't wired yet, so the
              control is present-but-disabled to signal it's coming. */}
          <button type="button" disabled className="text-[9px] uppercase tracking-wider text-muted-foreground opacity-30" title="Edit (coming soon)">
            edit
          </button>
          {/* CANCEL / RESTORE — restorable struck tombstone. Offered only while the occurrence hasn't
              ended (r.cancellable — future or ongoing), so history can't be retroactively cancelled;
              RESTORE is always offered for an already-cancelled row so a mistaken cancel is undoable. */}
          {(r.cancelled || r.cancellable) && (
            <button
              type="button"
              onClick={() =>
                onAction(
                  entity,
                  r.origin === "rule"
                    ? { type: "cancel", origin: "rule", recurrenceId: r.recurrenceId!, cancelled: !r.cancelled }
                    : { type: "cancel", origin: "definite", primary: r.primary, occIndex: r.occIndex, cancelled: !r.cancelled },
                )
              }
              className={ACTION_CLS}
              title={r.cancelled ? "Restore this occurrence" : "Cancel this occurrence"}
            >
              {r.cancelled ? "restore" : "cancel"}
            </button>
          )}
          {/* DELETE — hard removal (definite: splice/clear the slot; rule: a `removed` EXDATE that drops
              the instance from the projection). Distinct from the restorable cancel. */}
          <button
            type="button"
            onClick={() =>
              onAction(
                entity,
                r.origin === "rule"
                  ? { type: "delete", origin: "rule", recurrenceId: r.recurrenceId! }
                  : { type: "delete", origin: "definite", primary: r.primary, occIndex: r.occIndex },
              )
            }
            className={ACTION_CLS}
            title="Delete this occurrence"
          >
            delete
          </button>
        </span>
      )}
    </li>
  )

  return (
    <div className="col-span-2 mt-3">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">planned occurrences</div>

      {/* ── SERIES sub-list (only when a repeat rule is set) ── */}
      {hasRepeat && (
        <div className="mb-2">
          <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span aria-hidden className="opacity-50">
              ↻
            </span>
            <span className="text-foreground">{describeRecurrence(entity)}</span>
            {onAction && (
              <span className="ml-auto flex items-center gap-2">
                <button type="button" disabled className="text-[9px] uppercase tracking-wider text-muted-foreground opacity-30" title="Edit the recurrence rule (coming soon)">
                  edit
                </button>
                <button
                  type="button"
                  onClick={() => onAction(entity, { type: "clearRepeat" })}
                  className={ACTION_CLS}
                  title="Clear the recurrence rule (stop repeating)"
                >
                  clear
                </button>
              </span>
            )}
          </div>
          {ruleRows.length > 0 && <ul className="flex flex-col gap-0.5">{ruleRows.map((r) => renderRow(r, true))}</ul>}
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
        {definiteRows.length > 0 && <ul className="flex flex-col gap-0.5">{definiteRows.map((r) => renderRow(r, false))}</ul>}
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
    </div>
  )
}
