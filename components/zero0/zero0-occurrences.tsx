"use client"

import { useCallback, useState } from "react"
import type { Entity, Recurrence } from "@/lib/zero/types"
import { getOccurrenceRows } from "@/lib/zero/face-model"
import { parseSlotToken, parseRepeatToken } from "@/lib/zero/create-parse"

// The §0 PLANNED OCCURRENCES block (v0.2.229; ALWAYS-ON + primary-cancellable v0.2.232; renamed from
// "occurrences" v0.2.233) — the SINGLE way an occurrence kind (moment/space) shows its schedule in §0.
// (Backing field: schedule.plannedOccurrences[].) It is displayed at ALL times for those
// kinds (even with zero slots — just the header + "+ add slot"), which removed the old flat PLANNED
// START/END rows and the 0/1-vs-2+ swap entirely: one render path, always. Each line is one
// occurrence: DAY · TIME · derived STATUS word, cancelled slots struck through, and the current/next
// one tagged NEXT (v0.2.235 — computed view-time from `now` in getOccurrenceRows; replaced the old
// write-time PRIMARY tag that got stuck on a stale/missed earliest-past slot). EVERY line is
// cancellable (see resyncPrimary/cancelPrimaryOccurrence in data.ts). A trailing "+ add slot" reveals
// an inline token field: it accepts a TIME (`1400-1530`, `2330`, `in 2h` — via parseSlotToken, the
// create-field grammar) OR a RULE word (`daily`, `12h daily`, `weekdays` — via parseRepeatToken, which
// sets schedule.repeat with the time as anchor). DORMANT-by-design: only the STATUS word shows, never
// the planned-vs-actual delta numbers.

const PLACEHOLDER = "e.g. 1400-1530, 2330, in 2h, 12h daily"

/** A user action on the block, dispatched up to the canvas (which owns the writers + re-render). A
    cancel is discriminated by `origin` (v0.2.234) so the canvas routes to the right writer without
    guessing: a DEFINITE row carries whether it's the PRIMARY (scalar) span + its plannedOccurrences[]
    index; a RULE row carries its `recurrenceId` (the day-key the exceptions layer targets). */
export type OccurrenceAction =
  | { type: "add"; start: number; end?: number }
  | { type: "cancel"; origin: "definite"; primary: boolean; occIndex: number; cancelled: boolean }
  | { type: "cancel"; origin: "rule"; recurrenceId: number; cancelled: boolean }
  // SET A RULE from the add-slot field (v0.2.235) — "12h daily", "daily", "weekdays 9h", etc. `start`/
  // `end` (when a time was also given) become the rule ANCHOR; absent ⇒ anchored at now by the writer.
  | { type: "repeat"; repeat: Recurrence; start?: number; end?: number }

export function Zero0Occurrences({
  entity,
  now,
  onAction,
}: {
  entity: Entity
  /** Epoch (ms) driving the derived status words. */
  now: number
  /** Dispatch an add / cancel. Absent ⇒ read-only (no + add slot, no cancel controls). */
  onAction?: (e: Entity, action: OccurrenceAction) => void
}) {
  const rows = getOccurrenceRows(entity, now)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState(false)
  // INSTANT (v0.2.237) is a single point in time — it renders its one AT row but READ-ONLY: no
  // "+ add slot" (a point has no slots to add) and no per-row cancel. Suppressing `onAction` for
  // instants hides both affordances at once, since each already gates on it.
  const isInstant = entity.kind === "instant"
  const editAction = isInstant ? undefined : onAction

  const submit = useCallback(() => {
    // RECURRENCE-AWARE (v0.2.235): if any word parses as a recurrence ("daily", "weekdays", …) the field
    // sets the entity's RULE instead of adding a one-off slot — the rest of the tokens (if any) parse as
    // the anchor TIME ("12h daily" ⇒ daily rule anchored at 12:00; bare "daily" ⇒ anchored at now by the
    // writer). Otherwise it's the original definite-slot path.
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

  return (
    <div className="col-span-2 mt-3">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">planned occurrences</div>
      {/* The list is empty when there are no slots yet — the header + "+ add slot" still render, so the
          block is present at all times (v0.2.232) rather than swapping in only at 2+ occurrences. */}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {rows.map((r) => (
            <li key={r.index} className="flex items-center gap-2 text-[10px] tabular-nums">
              <span aria-hidden className="text-muted-foreground opacity-50">
                ·
              </span>
              {/* DAY column is fixed-width so every occurrence's TIME lines up, whatever the day label. */}
              <span className={"flex items-baseline gap-2 " + (r.cancelled ? "line-through opacity-60" : "")}>
                <span className="w-20 shrink-0 text-muted-foreground">{r.day}</span>
                {/* TIME column is min-width-fixed so the following STATUS word starts at a constant x
                    whether the time is a point ("19:19") or a range ("17:00 – 18:00"). A rare very-wide
                    cross-day range is allowed to grow past it (min, not fixed) rather than clip. Rendered
                    as segments so the "unset" placeholder + its dash fade like the status word. */}
                <span className="min-w-[7.5rem] text-foreground">
                  {r.time.map((seg, i) => (
                    <span key={i} className={seg.muted ? "text-muted-foreground" : undefined}>
                      {seg.text}
                    </span>
                  ))}
                </span>
              </span>
              <span className="text-muted-foreground">{r.statusWord}</span>
              {/* NEXT (v0.2.235) — marks the current/next occurrence, computed view-time from `now`
                  (see getOccurrenceRows). Replaces the old write-time PRIMARY tag, which got stuck on a
                  stale/missed earliest-past slot. Rendered a touch brighter than the status word so the
                  "when's this next?" row stands out. */}
              {r.isNext && (
                <span className="text-[9px] uppercase tracking-wider text-foreground opacity-70">next</span>
              )}
              {/* Cancel / restore — offered for EVERY occurrence now (v0.2.232), the PRIMARY included:
                  the scalar is just the mirror of the soonest live occurrence, so the canvas routes an
                  index-0 cancel to cancelPrimaryOccurrence (which promotes the next slot). Kept
                  always-visible-but-faint, not a group-hover reveal, which silently no-ops in the
                  Electron/webview build where `(hover:hover)` is false. */}
              {editAction && (
                <button
                  type="button"
                  onClick={() =>
                    editAction(
                      entity,
                      r.origin === "rule"
                        ? { type: "cancel", origin: "rule", recurrenceId: r.recurrenceId!, cancelled: !r.cancelled }
                        : { type: "cancel", origin: "definite", primary: r.primary, occIndex: r.occIndex, cancelled: !r.cancelled },
                    )
                  }
                  className="ml-auto text-[9px] uppercase tracking-wider text-muted-foreground opacity-60 hover:text-foreground hover:opacity-100"
                  title={r.cancelled ? "Restore this occurrence" : "Cancel this occurrence"}
                >
                  {r.cancelled ? "restore" : "cancel"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editAction && (
        <div className="mt-1">
          {adding ? (
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
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              + add slot
            </button>
          )}
          {error && (
            <div className="mt-0.5 text-[9px] text-muted-foreground">{'Unrecognized — try a time (1400-1530, 2330, "in 2h") or a rule ("daily", "12h daily", "weekdays").'}</div>
          )}
        </div>
      )}
    </div>
  )
}
