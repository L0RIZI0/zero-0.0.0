"use client"

import { useCallback, useState } from "react"
import type { Entity, Recurrence } from "@/lib/zero/types"
import { getOccurrenceRows } from "@/lib/zero/face-model"
import { parseSlotToken, parseRepeatToken } from "@/lib/zero/create-parse"

// The §0 PLANNED OCCURRENCES block (v0.2.229; ALWAYS-ON + primary-cancellable v0.2.232; renamed from
// "occurrences" v0.2.233) — the SINGLE way an entity shows its schedule in §0. Shown+editable for EVERY
// kind except the Soul (v0.2.238; was moment/space/instant). An instant lists each occurrence as a
// single POINT time (isInstant path in formatOccurrenceParts) but is otherwise editable like any kind.
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
  // CLEAR the recurrence rule (v0.2.239) — the "stop repeating" control. Drops schedule.repeat so the
  // block stops projecting the infinite series and falls back to the definite slots.
  | { type: "clearRepeat" }

/** Human label for a recurrence rule, e.g. "repeats daily", "repeats every 2 weeks". */
function describeRecurrence(r: Recurrence): string {
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[r.freq]
  const n = r.interval ?? 1
  const every = n > 1 ? `every ${n} ${unit}s` : { daily: "daily", weekly: "weekly", monthly: "monthly", yearly: "yearly" }[r.freq]
  return `repeats ${every}`
}

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
      {/* RECURRENCE control (v0.2.239) — shown only when a `repeat` rule is set. Names the rule and
          offers "stop repeating", the ONLY UI to clear a series (previously you could set `daily` from
          the add-slot field but had no way to remove it, leaving an infinite projected list). */}
      {onAction && entity.schedule?.repeat && (
        <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span aria-hidden className="opacity-50">
            ↻
          </span>
          <span>{describeRecurrence(entity.schedule.repeat)}</span>
          <button
            type="button"
            onClick={() => onAction(entity, { type: "clearRepeat" })}
            className="ml-auto text-[9px] uppercase tracking-wider opacity-60 hover:text-foreground hover:opacity-100"
            title="Stop repeating (clear the recurrence rule)"
          >
            stop repeating
          </button>
        </div>
      )}
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
              {/* Cancel / restore — the PRIMARY included (v0.2.232): the scalar is just the mirror of the
                  soonest live occurrence, so the canvas routes an index-0 cancel to
                  cancelPrimaryOccurrence (which promotes the next slot). CANCEL is offered only while the
                  occurrence hasn't ended (`r.cancellable` — future or ongoing); a fully-past occurrence is
                  locked, since you can't cancel history (v0.2.239). RESTORE is always offered for an
                  already-cancelled row so a mistaken cancel is undoable. Kept always-visible-but-faint,
                  not a group-hover reveal, which silently no-ops in the Electron/webview build where
                  `(hover:hover)` is false. */}
              {onAction && (r.cancelled || r.cancellable) && (
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
      {onAction && (
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
