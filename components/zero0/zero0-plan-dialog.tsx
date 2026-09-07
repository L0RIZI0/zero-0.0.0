"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Entity, Recurrence } from "@/lib/zero/types"
import { fmt, formatDuration, describeRecurrenceRule } from "@/lib/zero/face-model"
import { projectOccurrences } from "@/lib/zero/data"

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
  | { kind: "timeblocks"; timeblocks: { startAt: number; endAt: number }[]; repeat?: Recurrence } // Blocks → setEntityTimeblocks
  | { kind: "duration"; minutes: number } // Length → setEntityDuration (unanchored, no start/end)
  | { kind: "session"; start: number; end?: number } // PAST → addManualSession (end omitted = ongoing)
  | { kind: "due"; due: number } // deadline → setEntityScheduleField("dueDate")

type Mode = "span" | "point" | "blocks" | "length" | "due"

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
  onRemoveRule,
}: {
  entity: Entity
  now: number
  onApply: (result: PlanResult) => void
  onClose: () => void
  /** Remove an existing repeat rule in place (null = the primary `repeat`; a string = a series id). */
  onRemoveRule: (ruleId: string | null) => void
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

  // TIMEBLOCKS (Phase 3, "Blocks" mode) — a multi-span DAY (e.g. 8:00–11:30 AND 13:30–18:00), all on
  // the anchor day (= `startDate`). Times only; the anchor date drives absolute epochs. Seeded with two
  // sensible morning/afternoon rows so the mode is immediately meaningful (a single block is just a span).
  const [blocks, setBlocks] = useState<{ start: string; end: string }[]>([
    { start: "09:00", end: "12:00" },
    { start: "13:00", end: "17:00" },
  ])

  // LENGTH ("length" mode) — an UNANCHORED contiguous duration (schedule.duration, minutes) with NO
  // start/end. Answers "how long is this?" without pinning it to a clock. Seeded from the entity's
  // current duration so re-opening shows the existing value; split into hours + minutes inputs.
  const seedDurMin = entity.schedule?.duration ?? 0
  const [durH, setDurH] = useState(Math.floor(seedDurMin / 60))
  const [durM, setDurM] = useState(seedDurMin % 60)

  const startEpoch = useMemo(() => toEpoch(startDate, startTime), [startDate, startTime])
  const endEpoch = useMemo(() => toEpoch(endDate, endTime), [endDate, endTime])
  const untilEpoch = useMemo(() => (untilDate ? toEpoch(untilDate, "23:59") : null), [untilDate])
  const isPast = startEpoch != null && startEpoch <= now
  // ONTOLOGY (Loris, v0.2.360): a span whose END is in the FUTURE is a PLAN, not a record — a recorded
  // fact is past-tense and can't end in the future. So even when the START is in the past, an explicit
  // future end makes this a PLANNED OCCURRENCE that straddles `now` (⇒ it reads ongoing and its glyph
  // spins), NOT a recorded session. Only a span that is ENTIRELY past records a session. This is the
  // classification chokepoint for the plan flow; the same invariant should be enforced in the engine
  // across every entry point (upstream ask for Grok's engine — the ontology owns this rule).
  const endsInFuture = mode === "span" && hasEnd && endEpoch != null && endEpoch > now
  const treatAsFuture = !isPast || endsInFuture

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

  const updateBlock = useCallback((i: number, key: "start" | "end", v: string) => {
    setBlocks((prev) => prev.map((b, j) => (j === i ? { ...b, [key]: v } : b)))
  }, [])
  const addBlock = useCallback(() => {
    // Append a 1h block starting an hour after the last block's end (or 9:00 if none parse).
    setBlocks((prev) => {
      const last = prev[prev.length - 1]
      const [h, m] = (last?.end ?? "17:00").split(":").map(Number)
      const startH = Number.isNaN(h) ? 9 : Math.min(22, h + 1)
      const s = `${String(startH).padStart(2, "0")}:${String(Number.isNaN(m) ? 0 : m).padStart(2, "0")}`
      const e = `${String(Math.min(23, startH + 1)).padStart(2, "0")}:${String(Number.isNaN(m) ? 0 : m).padStart(2, "0")}`
      return [...prev, { start: s, end: e }]
    })
  }, [])
  const removeBlock = useCallback((i: number) => {
    setBlocks((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)))
  }, [])

  // Build the Recurrence rule from the current recur state (shared by the "repeat" + "blocks" branches).
  const buildRule = useCallback((): Recurrence => {
    const rule: Recurrence = { freq }
    if (interval > 1) rule.interval = interval
    if (freq === "weekly" && byWeekday.length) rule.byWeekday = [...byWeekday].sort((a, b) => a - b)
    if (untilEpoch != null) rule.until = untilEpoch
    return rule
  }, [freq, interval, byWeekday, untilEpoch])

  // Derive the final PlanResult + a human preview from the current state. `null` result ⇒ invalid
  // (missing/!parseable start) and Apply is disabled.
  const { result, preview, invalid } = useMemo((): {
    result: PlanResult | null
    preview: string
    invalid: string | null
  } => {
    // LENGTH — an unanchored duration in minutes; valid iff > 0. No start/end, no recurrence.
    if (mode === "length") {
      const minutes = durH * 60 + durM
      if (minutes <= 0) return { result: null, preview: "", invalid: "Set a length above zero" }
      return {
        result: { kind: "duration", minutes },
        preview: `Length · ${formatDuration(minutes * 60_000)} (no fixed time)`,
        invalid: null,
      }
    }
    // BLOCKS (Phase 3) — a multi-span day on the anchor date. Validate: date parses, ≥2 blocks, each
    // end>start, and no overlaps (sorted). Optionally recurring via the shared repeat builder.
    if (mode === "blocks") {
      if (!startDate) return { result: null, preview: "", invalid: "Pick an anchor date" }
      const tbs: { startAt: number; endAt: number }[] = []
      for (const b of blocks) {
        const s = toEpoch(startDate, b.start)
        const e = toEpoch(startDate, b.end)
        if (s == null || e == null) return { result: null, preview: "", invalid: "A block time is invalid" }
        if (e <= s) return { result: null, preview: "", invalid: "Each block must end after it starts" }
        tbs.push({ startAt: s, endAt: e })
      }
      if (tbs.length < 2) return { result: null, preview: "", invalid: "Add at least two blocks" }
      tbs.sort((a, b) => a.startAt - b.startAt)
      for (let i = 1; i < tbs.length; i++) {
        if (tbs[i].startAt < tbs[i - 1].endAt) return { result: null, preview: "", invalid: "Blocks overlap" }
      }
      const totalMs = tbs.reduce((acc, b) => acc + (b.endAt - b.startAt), 0)
      const rule = recur ? buildRule() : undefined
      if (rule && untilEpoch != null && untilEpoch <= tbs[0].startAt)
        return { result: null, preview: "", invalid: "Until must be after the start" }
      const rulePart = rule ? ` · ${describeRecurrenceRule(rule, tbs[0].startAt, tbs[tbs.length - 1].endAt)}` : ""
      return {
        result: { kind: "timeblocks", timeblocks: tbs, repeat: rule },
        preview: `${tbs.length} blocks · ${formatDuration(totalMs)} total${rulePart}`,
        invalid: null,
      }
    }
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

    if (treatAsFuture) {
      // FUTURE + RECURRING ⇒ a repeat rule anchored at the chosen start/end (Phase 2). Recurrence is
      // future-ANCHOR-only, so it never applies to a past-start / future-end straddling span.
      if (recur && !isPast) {
        if (untilEpoch != null && untilEpoch <= startEpoch)
          return { result: null, preview: "", invalid: "Until must be after the start" }
        const rule = buildRule()
        const label = describeRecurrenceRule(rule, startEpoch, end)
        const untilStr = untilEpoch != null ? ` · until ${fmt(untilEpoch)}` : ""
        return { result: { kind: "repeat", repeat: rule, start: startEpoch, end }, preview: `Recurring · ${label}${untilStr}`, invalid: null }
      }
      // FUTURE ⇒ a planned occurrence.
      const span = end != null ? `${fmt(startEpoch)} → ${fmt(end)} · ${formatDuration(end - startEpoch)}` : fmt(startEpoch)
      return { result: { kind: "occurrence", start: startEpoch, end }, preview: `Planned occurrence · ${span}`, invalid: null }
    }
    // ENTIRELY PAST ⇒ a recorded session (a future end was rerouted to a planned occurrence above).
    // Ongoing ⇒ no end (still running). Not ongoing ⇒ end = the span end, else NOW (started in the
    // past and ran until now).
    if (ongoing) {
      return { result: { kind: "session", start: startEpoch }, preview: `Recorded session · ${fmt(startEpoch)} → ongoing`, invalid: null }
    }
    const sessEnd = end ?? now
    return {
      result: { kind: "session", start: startEpoch, end: sessEnd },
      preview: `Recorded session · ${fmt(startEpoch)} → ${fmt(sessEnd)} · ${formatDuration(sessEnd - startEpoch)}`,
      invalid: null,
    }
  }, [mode, startEpoch, endEpoch, hasEnd, isPast, treatAsFuture, ongoing, now, recur, freq, interval, byWeekday, untilEpoch, startDate, blocks, buildRule, durH, durM])

  // EXISTING REPEATS (Phase 2) — the entity's current rules, so they can be removed in place. The
  // primary `repeat` (anchored by `repeatAnchor`) comes first, then each additional `series[]` entry.
  // `id: null` marks the primary (→ onRemoveRule(null) ⇒ setEntityRepeat(id, null)); a string is a
  // series id (→ removeSeries). Derived from `entity.schedule`, which gets a fresh reference after a
  // remove (the canvas re-sets planTarget), so this list re-computes and the removed row disappears.
  const existingRules = useMemo(() => {
    const s = entity.schedule
    if (!s) return [] as { id: string | null; label: string }[]
    const rows: { id: string | null; label: string }[] = []
    if (s.repeat) {
      rows.push({ id: null, label: describeRecurrenceRule(s.repeat, s.repeatAnchor?.start, s.repeatAnchor?.end) })
    }
    for (const sr of s.series ?? []) {
      rows.push({ id: sr.id, label: describeRecurrenceRule(sr.repeat, sr.anchorStart, sr.anchorEnd) })
    }
    return rows
  }, [entity.schedule])

  // MULTI-OCCURRENCE PREVIEW (Phase 2) — when a recurring plan is valid, project the next few concrete
  // instances so the user sees real dates, not just the rule label. Uses the SAME `projectOccurrences`
  // engine the timeline/§0 use, on a synthetic schedule anchored at the chosen start/end (pure call — no
  // store mutation). Floored at the start so the anchor day is the first instance.
  const previewOccs = useMemo(() => {
    if (!recur || result?.kind !== "repeat") return [] as { start: number; end?: number }[]
    const synthetic = { id: "__preview__", schedule: { repeat: result.repeat, repeatAnchor: { start: result.start, end: result.end } } }
    return projectOccurrences(synthetic, result.start, 4).map((o) => ({ start: o.start, end: o.end }))
  }, [recur, result])

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

  // ENTRANCE ANIMATION (Phase 3 polish) — flip `mounted` on after first paint so the dialog fades +
  // scales in via a CSS transition (no animation dependency). Also focus the panel for immediate Esc/Enter.
  const [mounted, setMounted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const r = requestAnimationFrame(() => setMounted(true))
    panelRef.current?.focus()
    return () => cancelAnimationFrame(r)
  }, [])

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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Plan ${entity.title ?? "entity"}`}
        tabIndex={-1}
        className={
          "w-[680px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-background p-5 shadow-2xl outline-none " +
          "transition-[opacity,transform] duration-150 ease-out " +
          (mounted ? "opacity-100 scale-100" : "opacity-0 scale-[0.97]")
        }
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

        {/* TWO-COLUMN BODY (v0.2.276) — LEFT = what & when (type, start, end/duration or blocks);
            RIGHT = how often & existing rules. The wider dialog makes clever use of horizontal space. */}
        <div className="grid grid-cols-2 gap-5">
          {/* ── LEFT COLUMN ─────────────────────────────────────────────────────── */}
          <div className="min-w-0">
        {/* TYPE SEGMENTED CONTROL */}
        <div className="mb-3 inline-flex gap-1 rounded-sm border border-border p-0.5" role="tablist" aria-label="Plan type">
          <button role="tab" aria-selected={mode === "span"} className={segCls(mode === "span")} onClick={() => setMode("span")}>
            Span
          </button>
          <button role="tab" aria-selected={mode === "point"} className={segCls(mode === "point")} onClick={() => setMode("point")}>
            Point
          </button>
          <button role="tab" aria-selected={mode === "blocks"} className={segCls(mode === "blocks")} onClick={() => setMode("blocks")}>
            Blocks
          </button>
          <button role="tab" aria-selected={mode === "length"} className={segCls(mode === "length")} onClick={() => setMode("length")}>
            Length
          </button>
          <button role="tab" aria-selected={mode === "due"} className={segCls(mode === "due")} onClick={() => setMode("due")}>
            Due
          </button>
        </div>

        {/* START — hidden in LENGTH mode (an unanchored duration has no clock time). Anchor DATE only in
            blocks mode; DATE+TIME otherwise; labelled "Due" in due mode. */}
        {mode !== "length" && (
          <div className="mb-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {mode === "due" ? "Due" : mode === "blocks" ? "Day" : "Start"}
            </div>
            <div className="flex gap-2">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldCls + " flex-1"} aria-label={mode === "blocks" ? "Anchor day" : "Start date"} />
              {mode !== "blocks" && (
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={fieldCls} aria-label="Start time" />
              )}
            </div>
          </div>
        )}

        {/* LENGTH (length mode) — an unanchored duration: hours + minutes, plus quick chips. */}
        {mode === "length" && (
          <div className="mb-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Length</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={durH}
                onChange={(e) => setDurH(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className={fieldCls + " w-16"}
                aria-label="Length hours"
              />
              <span className="text-[10px] text-muted-foreground">h</span>
              <input
                type="number"
                min={0}
                max={59}
                value={durM}
                onChange={(e) => setDurM(Math.min(59, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
                className={fieldCls + " w-16"}
                aria-label="Length minutes"
              />
              <span className="text-[10px] text-muted-foreground">m</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {QUICK_DURATIONS.map((q) => (
                <button
                  key={q.label}
                  onClick={() => {
                    const mins = Math.round(q.ms / 60_000)
                    setDurH(Math.floor(mins / 60))
                    setDurM(mins % 60)
                  }}
                  className="rounded-sm border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* TIMEBLOCKS (blocks mode) — a multi-span day: a list of within-day start–end rows. */}
        {mode === "blocks" && (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Blocks</span>
              <button className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground" onClick={addBlock}>
                + add block
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {blocks.map((b, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input type="time" value={b.start} onChange={(e) => updateBlock(i, "start", e.target.value)} className={fieldCls} aria-label={`Block ${i + 1} start`} />
                  <span className="text-[10px] text-muted-foreground">→</span>
                  <input type="time" value={b.end} onChange={(e) => updateBlock(i, "end", e.target.value)} className={fieldCls} aria-label={`Block ${i + 1} end`} />
                  <button
                    onClick={() => removeBlock(i)}
                    disabled={blocks.length <= 1}
                    className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground"
                    aria-label={`Remove block ${i + 1}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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
          </div>
          {/* ── RIGHT COLUMN — how often & existing rules ───────────────────────── */}
          <div className="min-w-0">

        {/* REPEAT (Phase 2/3) — future span/point OR any blocks day (not due, not length). Off =
            one-off; on reveals the frequency / interval / weekday / until builder. */}
        {(mode === "blocks" || (!isPast && mode !== "due" && mode !== "length")) && (
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

        {/* EXISTING REPEATS (Phase 2) — manage the entity's current rules; each removable in place. */}
        {existingRules.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {existingRules.length === 1 ? "Existing repeat" : `Existing repeats (${existingRules.length})`}
            </div>
            <div className="flex flex-col gap-1">
              {existingRules.map((r) => (
                <div
                  key={r.id ?? "__primary__"}
                  className="flex items-center gap-2 rounded-sm border border-border/60 px-2 py-1 text-[11px]"
                >
                  <span className="flex-1 truncate text-foreground">{r.label}</span>
                  <button
                    onClick={() => onRemoveRule(r.id)}
                    className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-destructive"
                    aria-label={`Remove repeat: ${r.label}`}
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STILL-HAPPENING toggle (past start, span/point only — blocks & due never record sessions).
            Hidden when the span ENDS in the future: that's a planned occurrence, not a recordable
            session, so "record as ongoing session" would be misleading. */}
        {isPast && !endsInFuture && mode !== "due" && mode !== "blocks" && (
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} className="[color-scheme:dark]" />
            still happening (record as an ongoing session)
          </label>
        )}
          </div>
        </div>

        {/* LIVE PREVIEW / TENSE line */}
        <div className="mb-4 min-h-[1.5rem] rounded-sm bg-muted/30 px-2 py-1.5 text-[11px] tabular-nums">
          {invalid ? (
            <span className="text-muted-foreground/60">{invalid}</span>
          ) : (
            <span className="text-foreground">{preview}</span>
          )}
          {/* NEXT OCCURRENCES — real projected dates for a recurring plan, so the rule label is concrete. */}
          {!invalid && previewOccs.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5 border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground">
              {previewOccs.map((o, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span aria-hidden className="text-muted-foreground/40">·</span>
                  <span>{o.end != null ? `${fmt(o.start)} → ${fmt(o.end)}` : fmt(o.start)}</span>
                </li>
              ))}
              {/* Only hint "more" when we hit the projection cap (4) — a bounded `until` returns fewer. */}
              {previewOccs.length >= 4 && <li className="pl-3 text-muted-foreground/40">…and on</li>}
            </ul>
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
