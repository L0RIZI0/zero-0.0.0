"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Entity, Recurrence } from "@/lib/zero/types"
import { fmt, formatDuration, describeRecurrenceRule } from "@/lib/zero/face-model"

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PLAN DIALOG (v0.2.269, Phase 1) — a centered modal that replaces the cramped "+ add slot"
// textfield as the PRIMARY way to schedule an entity. Reached from the entity right-click "Plan…"
// item. Phase 1 covers the ONE-OFF surface: date, start time, end/duration (span) or a single
// point, or a due deadline — PLUS the tense split Loris asked for: a start in the FUTURE plans an
// occurrence; a start in the PAST records a SESSION (with a "still happening" toggle for an ongoing
// one). Recurrence + multiple series (Phase 2) and timeblocks (Phase 3) are deliberately absent.
// The natural-language line is deferred; a ghosted slot is reserved for it at the top.
//
// The dialog is PURE UI: it computes a discriminated {@link PlanResult} and hands it to the canvas,
// which owns the writers (addOccurrence / addManualSession / setEntityScheduleField). So no data
// logic lives here — only the tense decision, which needs `now` vs the chosen start.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** What the dialog resolved to — executed by the canvas against the existing writers. */
export type PlanResult =
  | { kind: "occurrence"; start: number; end?: number } // FUTURE span/point → addOccurrence
  | { kind: "repeat"; repeat: Recurrence; start: number; end?: number } // FUTURE recurring → setEntityRepeat / addSeries
  | { kind: "session"; start: number; end?: number } // PAST → addManualSession (end omitted = ongoing)
  | { kind: "due"; due: number } // deadline → setEntityScheduleField("dueDate")

type Mode = "span" | "point" | "due"

const HOUR = 3_600_000
const MIN = 60_000

// Local-clock <input type="date"> / <input type="time"> string builders (native inputs speak local
// wall-clock, which is exactly what a human planning "2pm tomorrow" means).
function toDateStr(epoch: number): string {
  const d = new Date(epoch)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function toTimeStr(epoch: number): string {
  const d = new Date(epoch)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}
/** Combine a "YYYY-MM-DD" + "HH:MM" pair into a local epoch, or null when either is missing/invalid. */
function toEpoch(dateStr: string, timeStr: string): number | null {
  if (!dateStr || !timeStr) return null
  const [y, mo, d] = dateStr.split("-").map(Number)
  const [h, mi] = timeStr.split(":").map(Number)
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return null
  const t = new Date(y, mo - 1, d, h, mi, 0, 0).getTime()
  return Number.isNaN(t) ? null : t
}

const QUICK_DURATIONS: { label: string; ms: number }[] = [
  { label: "15m", ms: 15 * MIN },
  { label: "30m", ms: 30 * MIN },
  { label: "1h", ms: HOUR },
  { label: "2h", ms: 2 * HOUR },
  { label: "4h", ms: 4 * HOUR },
]

// Single-letter weekday chips, index 0(Sun)–6(Sat) to match Recurrence.byWeekday.
const WEEKDAY_CHIPS = ["S", "M", "T", "W", "T", "F", "S"]
const FREQ_OPTIONS: Recurrence["freq"][] = ["daily", "weekly", "monthly", "yearly"]

// MEMOIZED (v0.2.271): the parent canvas re-renders every second (its live `nowSec` clock). Without
// memo, that re-rendered this dialog once a second — and a re-render while a native <input type="time">
// / date picker dropdown is OPEN collapses the popup back to "00" on top, eating the user's first click
// (the reported bug). Memo + a FROZEN `now` (the parent now passes an open-time snapshot, not the live
// clock) + stable `onApply`/`onClose` callbacks means the dialog only re-renders on its OWN state
// changes (typing/toggling), never on the background clock tick, so the picker stays put.
export const Zero0PlanDialog = memo(function Zero0PlanDialog({
  entity,
  now,
  onApply,
  onClose,
}: {
  entity: Entity
  now: number
  onApply: (result: PlanResult) => void
  onClose: () => void
}) {
  // Seed the start at the next round half-hour so opening the dialog lands on a sensible default.
  const seedStart = useMemo(() => {
    const d = new Date(now)
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0)
    return d.getTime()
  }, [now])

  const [mode, setMode] = useState<Mode>("span")
  const [startDate, setStartDate] = useState(() => toDateStr(seedStart))
  const [startTime, setStartTime] = useState(() => toTimeStr(seedStart))
  const [endDate, setEndDate] = useState(() => toDateStr(seedStart + HOUR))
  const [endTime, setEndTime] = useState(() => toTimeStr(seedStart + HOUR))
  const [hasEnd, setHasEnd] = useState(true) // span: is the end bound set?
  const [ongoing, setOngoing] = useState(false) // past only: still happening?

  // RECURRENCE (Phase 2) — future-only, span/point (not due). `recur` off = a one-off; on builds a
  // Recurrence rule from freq/interval/weekdays/until, anchored at the chosen start/end.
  const [recur, setRecur] = useState(false)
  const [freq, setFreq] = useState<Recurrence["freq"]>("weekly")
  const [interval, setIntervalN] = useState(1)
  const [byWeekday, setByWeekday] = useState<number[]>([]) // weekly only; empty = the anchor's own day
  const [untilDate, setUntilDate] = useState("") // optional series end (date only)

  const startEpoch = useMemo(() => toEpoch(startDate, startTime), [startDate, startTime])
  const endEpoch = useMemo(() => toEpoch(endDate, endTime), [endDate, endTime])
  const untilEpoch = useMemo(() => (untilDate ? toEpoch(untilDate, "23:59") : null), [untilDate])
  const isPast = startEpoch != null && startEpoch <= now

  // A past start defaults the "still happening" toggle ON (Loris' ask: ON by default when no end is
  // given). We only auto-flip when crossing the past boundary, never fighting a manual toggle after.
  const pastRef = useRef(isPast)
  useEffect(() => {
    if (isPast !== pastRef.current) {
      pastRef.current = isPast
      if (isPast) setOngoing(mode !== "span" || !hasEnd)
      else setOngoing(false)
    }
  }, [isPast, mode, hasEnd])

  // Apply a quick-duration chip: set the END to start + Δ (only meaningful for a span).
  const applyQuick = useCallback(
    (ms: number) => {
      if (startEpoch == null) return
      const e = startEpoch + ms
      setEndDate(toDateStr(e))
      setEndTime(toTimeStr(e))
      setHasEnd(true)
    },
    [startEpoch],
  )

  const toggleWeekday = useCallback((d: number) => {
    setByWeekday((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
  }, [])

  // Derive the final PlanResult + a human preview from the current state. `null` result ⇒ invalid
  // (missing/!parseable start) and Apply is disabled.
  const { result, preview, invalid } = useMemo((): {
    result: PlanResult | null
    preview: string
    invalid: string | null
  } => {
    if (mode === "due") {
      if (startEpoch == null) return { result: null, preview: "", invalid: "Pick a date and time" }
      return { result: { kind: "due", due: startEpoch }, preview: `Deadline · due ${fmt(startEpoch)}`, invalid: null }
    }
    if (startEpoch == null) return { result: null, preview: "", invalid: "Pick a date and time" }

    // A span carries an end when hasEnd; a point never does. A valid span end must be after start.
    let end: number | undefined
    if (mode === "span" && hasEnd) {
      if (endEpoch == null) return { result: null, preview: "", invalid: "End time is invalid" }
      if (endEpoch <= startEpoch) return { result: null, preview: "", invalid: "End must be after start" }
      end = endEpoch
    }

    if (!isPast) {
      // FUTURE + RECURRING ⇒ a repeat rule anchored at the chosen start/end (Phase 2).
      if (recur) {
        if (untilEpoch != null && untilEpoch <= startEpoch)
          return { result: null, preview: "", invalid: "Until must be after the start" }
        const rule: Recurrence = { freq }
        if (interval > 1) rule.interval = interval
        if (freq === "weekly" && byWeekday.length) rule.byWeekday = [...byWeekday].sort((a, b) => a - b)
        if (untilEpoch != null) rule.until = untilEpoch
        const label = describeRecurrenceRule(rule, startEpoch, end)
        const untilStr = untilEpoch != null ? ` · until ${fmt(untilEpoch)}` : ""
        return { result: { kind: "repeat", repeat: rule, start: startEpoch, end }, preview: `Recurring · ${label}${untilStr}`, invalid: null }
      }
      // FUTURE ⇒ a planned occurrence.
      const span = end != null ? `${fmt(startEpoch)} → ${fmt(end)} · ${formatDuration(end - startEpoch)}` : fmt(startEpoch)
      return { result: { kind: "occurrence", start: startEpoch, end }, preview: `Planned occurrence · ${span}`, invalid: null }
    }
    // PAST ⇒ a recorded session. Ongoing ⇒ no end (still running). Not ongoing ⇒ end = the span end,
    // else NOW (it started in the past and ran until now).
    if (ongoing) {
      return { result: { kind: "session", start: startEpoch }, preview: `Recorded session · ${fmt(startEpoch)} → ongoing`, invalid: null }
    }
    const sessEnd = end ?? now
    return {
      result: { kind: "session", start: startEpoch, end: sessEnd },
      preview: `Recorded session · ${fmt(startEpoch)} → ${fmt(sessEnd)} · ${formatDuration(sessEnd - startEpoch)}`,
      invalid: null,
    }
  }, [mode, startEpoch, endEpoch, hasEnd, isPast, ongoing, now, recur, freq, interval, byWeekday, untilEpoch])

  const apply = useCallback(() => {
    if (result) onApply(result)
  }, [result, onApply])

  // Esc closes; Enter applies (skip while an IME is composing / Safari's unreliable 229 keyCode).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      } else if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
        e.preventDefault()
        apply()
      }
    },
    [apply, onClose],
  )

  const fieldCls =
    "bg-transparent border border-border rounded-sm px-2 py-1 text-xs tabular-nums text-foreground outline-none focus:border-muted-foreground [color-scheme:dark]"
  const segCls = (active: boolean) =>
    "px-3 py-1 text-[10px] uppercase tracking-wider rounded-sm transition-colors " +
    (active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")

  return (
    // BACKDROP — dim the canvas; click outside closes. z high so it floats over §0 + dayline.
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={onKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Plan ${entity.title ?? "entity"}`}
        className="w-[440px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-background p-4 shadow-2xl"
      >
        {/* HEADER */}
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Plan · <span className="text-foreground">{entity.title ?? "entity"}</span>
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        {/* RESERVED NL SLOT (deferred) — a ghosted, non-interactive hint for the future parse line. */}
        <div className="mb-3 rounded-sm border border-dashed border-border/60 px-2 py-1.5 text-[10px] text-muted-foreground/40">
          describe in words — coming next
        </div>

        {/* TYPE SEGMENTED CONTROL */}
        <div className="mb-3 inline-flex gap-1 rounded-sm border border-border p-0.5" role="tablist" aria-label="Plan type">
          <button role="tab" aria-selected={mode === "span"} className={segCls(mode === "span")} onClick={() => setMode("span")}>
            Span
          </button>
          <button role="tab" aria-selected={mode === "point"} className={segCls(mode === "point")} onClick={() => setMode("point")}>
            Point
          </button>
          <button role="tab" aria-selected={mode === "due"} className={segCls(mode === "due")} onClick={() => setMode("due")}>
            Due
          </button>
        </div>

        {/* START (or DUE, when mode==="due") */}
        <div className="mb-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {mode === "due" ? "Due" : "Start"}
          </div>
          <div className="flex gap-2">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldCls + " flex-1"} aria-label="Start date" />
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={fieldCls} aria-label="Start time" />
          </div>
        </div>

        {/* END + DURATION (span only) */}
        {mode === "span" && (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">End</span>
              <button
                className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                onClick={() => setHasEnd((v) => !v)}
              >
                {hasEnd ? "remove end" : "add end"}
              </button>
            </div>
            {hasEnd && (
              <>
                <div className="flex gap-2">
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={fieldCls + " flex-1"} aria-label="End date" />
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={fieldCls} aria-label="End time" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {QUICK_DURATIONS.map((q) => (
                    <button
                      key={q.label}
                      onClick={() => applyQuick(q.ms)}
                      className="rounded-sm border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                    >
                      {q.label}
                    </button>
                  ))}
                  {startEpoch != null && endEpoch != null && endEpoch > startEpoch && (
                    <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{formatDuration(endEpoch - startEpoch)}</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* REPEAT (Phase 2) — future-only, span/point (not due). Off = one-off; on reveals the
            frequency / interval / weekday / until builder. Anchored at the chosen start/end. */}
        {!isPast && mode !== "due" && (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Repeat</span>
              <button
                className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                onClick={() => setRecur((v) => !v)}
              >
                {recur ? "one-off" : "make recurring"}
              </button>
            </div>
            {recur && (
              <div className="flex flex-col gap-2">
                {/* Frequency + interval: "every [N] [daily|weekly|monthly|yearly]". */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">every</span>
                  <input
                    type="number"
                    min={1}
                    value={interval}
                    onChange={(e) => setIntervalN(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                    className={fieldCls + " w-14"}
                    aria-label="Interval"
                  />
                  <select
                    value={freq}
                    onChange={(e) => setFreq(e.target.value as Recurrence["freq"])}
                    className={fieldCls + " flex-1"}
                    aria-label="Frequency"
                  >
                    {FREQ_OPTIONS.map((f) => (
                      <option key={f} value={f} className="bg-background text-foreground">
                        {interval > 1 ? { daily: "days", weekly: "weeks", monthly: "months", yearly: "years" }[f] : f}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Weekday chips (weekly only). Empty = repeats on the anchor's own weekday. */}
                {freq === "weekly" && (
                  <div className="flex items-center gap-1">
                    {WEEKDAY_CHIPS.map((lbl, d) => (
                      <button
                        key={d}
                        onClick={() => toggleWeekday(d)}
                        aria-pressed={byWeekday.includes(d)}
                        className={
                          "h-7 w-7 rounded-sm border text-[11px] transition-colors " +
                          (byWeekday.includes(d)
                            ? "border-foreground bg-foreground text-background"
                            : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground")
                        }
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                )}

                {/* Optional series end. */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">until</span>
                  <input
                    type="date"
                    value={untilDate}
                    onChange={(e) => setUntilDate(e.target.value)}
                    className={fieldCls + " flex-1"}
                    aria-label="Repeat until"
                  />
                  {untilDate && (
                    <button
                      onClick={() => setUntilDate("")}
                      className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    >
                      clear
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STILL-HAPPENING toggle (past start, non-due only) */}
        {isPast && mode !== "due" && (
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} className="[color-scheme:dark]" />
            still happening (record as an ongoing session)
          </label>
        )}

        {/* LIVE PREVIEW / TENSE line */}
        <div className="mb-4 min-h-[1.5rem] rounded-sm bg-muted/30 px-2 py-1.5 text-[11px] tabular-nums">
          {invalid ? (
            <span className="text-muted-foreground/60">{invalid}</span>
          ) : (
            <span className="text-foreground">{preview}</span>
          )}
        </div>

        {/* ACTIONS */}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-sm px-3 py-1 text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={!result}
            className="rounded-sm bg-foreground px-3 py-1 text-xs text-background disabled:cursor-not-allowed disabled:opacity-40"
          >
            Plan
          </button>
        </div>
      </div>
    </div>
  )
})
