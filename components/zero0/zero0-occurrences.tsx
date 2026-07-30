"use client"

import { useCallback, useState } from "react"
import type { Entity } from "@/lib/zero/types"
import { getOccurrenceRows } from "@/lib/zero/face-model"
import { parseSlotToken } from "@/lib/zero/create-parse"

// The §0 OCCURRENCES block (v0.2.229) — the per-occurrence view that REPLACES the flat PLANNED
// START / PLANNED END rows once an entity has 2+ planned occurrences (single-slot keeps the flat
// rows, zero regression — Option A). Each line is one occurrence: WHEN · derived STATUS word, with
// cancelled slots struck through. A trailing "+ add slot" reveals an inline token field (reusing
// parseSlotToken — the same local grammar as the create field: `1400-1530`, `2330`, `260709`,
// `in 2h`). DORMANT-by-design: only the STATUS word shows, never the planned-vs-actual delta numbers.

const PLACEHOLDER = "e.g. 1400-1530, 2330, 260709, in 2h"

/** A user action on the block, dispatched up to the canvas (which owns the writers + re-render). */
export type OccurrenceAction =
  | { type: "add"; start: number; end?: number }
  | { type: "cancel"; index: number; cancelled: boolean }

export function Zero0Occurrences({
  entity,
  now,
  onAction,
  addOnly = false,
}: {
  entity: Entity
  /** Epoch (ms) driving the derived status words. */
  now: number
  /** Dispatch an add / cancel. Absent ⇒ read-only (no + add slot, no cancel controls). */
  onAction?: (e: Entity, action: OccurrenceAction) => void
  /** ADD-ONLY bootstrap (v0.2.229): render JUST the "+ add slot" control, no per-occurrence list.
      Used beneath the flat PLANNED rows for a 0-/1-slot occurrence-kind, so the user can GROW from
      1→2 (at which point §0 swaps to the full list block). No label, no rows — just the affordance. */
  addOnly?: boolean
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
    <div className={addOnly ? "col-span-2" : "col-span-2 mt-0.5"}>
      {!addOnly && (
        <>
      <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">occurrences</div>
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
            {/* Cancel / restore — offered only for NON-primary occurrences this cut (the primary is the
                scalar mirror, which has no per-occurrence cancelled flag; cancelling it is deferred).
                Kept always-visible-but-faint rather than a group-hover reveal, which silently no-ops in
                the Electron/webview build where `(hover:hover)` is false. */}
            {onAction && r.index >= 1 && (
              <button
                type="button"
                onClick={() => onAction(entity, { type: "cancel", index: r.index, cancelled: !r.cancelled })}
                className="ml-auto text-[9px] uppercase tracking-wider text-muted-foreground opacity-60 hover:text-foreground hover:opacity-100"
                title={r.cancelled ? "Restore this occurrence" : "Cancel this occurrence"}
              >
                {r.cancelled ? "restore" : "cancel"}
              </button>
            )}
          </li>
        ))}
      </ul>
        </>
      )}
      {onAction && (
        <div className={addOnly ? "" : "mt-1"}>
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
