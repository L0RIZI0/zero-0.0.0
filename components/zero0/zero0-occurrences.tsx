"use client"

import { useCallback, useState } from "react"
import type { Entity } from "@/lib/zero/types"
import { getOccurrenceRows } from "@/lib/zero/face-model"
import { parseSlotToken } from "@/lib/zero/create-parse"

// The §0 PLANNED OCCURRENCES block (v0.2.229; ALWAYS-ON + primary-cancellable v0.2.232; renamed from
// "occurrences" v0.2.233) — the SINGLE way an occurrence kind (moment/space) shows its schedule in §0.
// (Backing field: schedule.plannedOccurrences[].) It is displayed at ALL times for those
// kinds (even with zero slots — just the header + "+ add slot"), which removed the old flat PLANNED
// START/END rows and the 0/1-vs-2+ swap entirely: one render path, always. Each line is one
// occurrence: DAY · TIME · derived STATUS word, cancelled slots struck through, the current one
// tagged PRIMARY. EVERY line (primary included) is cancellable now that the scalar is just the
// mirror of the soonest live occurrence (see resyncPrimary/cancelPrimaryOccurrence in data.ts). A
// trailing "+ add slot" reveals an inline token field (reusing parseSlotToken — the same local
// grammar as the create field: `1400-1530`, `2330`, `260709`, `in 2h`). DORMANT-by-design: only the
// STATUS word shows, never the planned-vs-actual delta numbers.

const PLACEHOLDER = "e.g. 1400-1530, 2330, 260709, in 2h"

/** A user action on the block, dispatched up to the canvas (which owns the writers + re-render). A
    cancel is discriminated by `origin` (v0.2.234) so the canvas routes to the right writer without
    guessing: a DEFINITE row carries whether it's the PRIMARY (scalar) span + its plannedOccurrences[]
    index; a RULE row carries its `recurrenceId` (the day-key the exceptions layer targets). */
export type OccurrenceAction =
  | { type: "add"; start: number; end?: number }
  | { type: "cancel"; origin: "definite"; primary: boolean; occIndex: number; cancelled: boolean }
  | { type: "cancel"; origin: "rule"; recurrenceId: number; cancelled: boolean }

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
                <span className="text-foreground">{r.time}</span>
              </span>
              <span className="text-muted-foreground">{r.statusWord}</span>
              {r.primary && (
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground opacity-50">primary</span>
              )}
              {/* Cancel / restore — offered for EVERY occurrence now (v0.2.232), the PRIMARY included:
                  the scalar is just the mirror of the soonest live occurrence, so the canvas routes an
                  index-0 cancel to cancelPrimaryOccurrence (which promotes the next slot). Kept
                  always-visible-but-faint, not a group-hover reveal, which silently no-ops in the
                  Electron/webview build where `(hover:hover)` is false. */}
              {onAction && (
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
            <div className="mt-0.5 text-[9px] text-muted-foreground">{'Unrecognized time — try 1400-1530, 2330, 260709, or "in 2h".'}</div>
          )}
        </div>
      )}
    </div>
  )
}
