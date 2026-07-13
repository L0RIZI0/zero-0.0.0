"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getFrequentEntities, type FrequentGroup } from "@/lib/zero/data"
import { isSleepTitle, sleepDotColor } from "@/lib/zero/sleep-sky"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import { Zero0FrameMarker } from "@/components/zero0/zero0-frame-marker"

/** How a right-click block is filed: as already finished, or still going. */
export type FrequentLogMode = "ended" | "ongoing"

/** Quick-duration presets offered in the right-click log form (minutes). */
const DURATIONS: { label: string; minutes: number }[] = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "45m", minutes: 45 },
  { label: "1h", minutes: 60 },
  { label: "1h30m", minutes: 90 },
  { label: "2h", minutes: 120 },
]

const MIN = 60_000

/** ms → a `<input type="time">` value ("HH:MM") in the viewer's local day. */
function msToTimeInput(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}
/** An "HH:MM" input value → absolute ms on the SAME calendar day as `baseMs`. */
function timeInputToMs(value: string, baseMs: number): number {
  const [hh, mm] = value.split(":").map((n) => Number.parseInt(n, 10))
  const d = new Date(baseMs)
  d.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0)
  return d.getTime()
}
/** A span of ms → a compact "1h 12m" / "45m" label. */
function fmtDur(ms: number): string {
  const total = Math.max(0, Math.round(ms / MIN))
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
/** ms → a short local clock time ("13:30"). */
function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

/**
 * FREQUENT (§4) — the topmost band, a quick-LOG palette of the activities the user repeats
 * most (Sleep, Walk the dog, Eat, Cook, Clean…). A horizontal row of minimal TILES, each
 * `[dot] [glyph] [title] (n)`:
 *
 *   • CLICK the TITLE/body → punch IN (start now) and DRILL into the new occurrence.
 *   • CLICK the GLYPH      → punch IN and STAY on the canvas (start several in a row). The
 *     glyph SPINS whenever any occurrence of that activity is currently ongoing, so the tile
 *     reads its own live state — no "End…" label needed.
 *   • CLICK the (n) COUNTER (shown only when n>0) → EXPAND a vertical list of that activity's
 *     ongoing occurrences (animated). §4 is collapsed by default; the next click inside it
 *     collapses it again: a list row's GLYPH punches that occurrence OUT (stays), a row's
 *     TITLE/meta OPENS it (no punch-out).
 *   • RIGHT-CLICK a tile → a small form to log a fixed block: a START time, a DURATION
 *     (chips or a number), and an ongoing/ended toggle. "ended" files [start, start+dur];
 *     "ongoing" files a still-running block (no end) — and auto-flips to "ended" if the
 *     duration lands the end in the past.
 *
 * Data (ranking, usual parent, ongoing members + their starts) comes from
 * {@link getFrequentEntities}; `dataRev` is the parent's mutation counter (re-read trigger).
 */
export function Zero0Frequent({
  dataRev,
  onPunchIn,
  onPunchOut,
  onLog,
  onOpen,
}: {
  dataRev: number
  /** Start a new occurrence now; drill in unless `stay` (glyph click). */
  onPunchIn: (group: FrequentGroup, opts: { stay: boolean }) => void
  /** End a specific ongoing occurrence now (stays on the canvas). */
  onPunchOut: (id: string) => void
  /** Log a block: absolute `startAt`, and `endAt` (complete) or `null` (still ongoing). */
  onLog: (group: FrequentGroup, startAt: number, endAt: number | null) => void
  /** Open (drill into) an existing occurrence by id. */
  onOpen: (id: string) => void
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dataRev is the intended re-read trigger
  const groups = useMemo(() => getFrequentEntities(), [dataRev])

  // Which tile's ongoing list is expanded (null = collapsed). Kept as a KEY so it survives
  // re-reads; a ref remembers the last group so the list still renders while COLLAPSING.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const lastGroupRef = useRef<FrequentGroup | null>(null)
  const expandedGroup = expandedKey ? groups.find((g) => g.key === expandedKey) : undefined
  if (expandedGroup) lastGroupRef.current = expandedGroup
  const listGroup = expandedGroup ?? lastGroupRef.current

  // Right-click log form: which group + where.
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const menuGroup = menu ? groups.find((g) => g.key === menu.key) : undefined

  // A slow ticking clock, live only while a list is expanded or the form is open — powers
  // "duration so far" and the ongoing/ended auto-flip without churning when §4 is idle.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (!menu && !expandedKey) return
    setNowTick(Date.now())
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [menu, expandedKey])

  // Collapse whenever the underlying group loses all ongoing members (e.g. after punch-out).
  useEffect(() => {
    if (expandedKey && !groups.some((g) => g.key === expandedKey && g.ongoing.length > 0)) {
      setExpandedKey(null)
    }
  }, [groups, expandedKey])

  const collapse = useCallback(() => setExpandedKey(null), [])

  return (
    <section className="relative flex flex-col border-b border-border px-4 py-3 text-[11px] text-muted-foreground">
      <div className="flex items-start gap-3">
        {/* FRAME TITLE — a "plus without center" mark: the quick-create affordance this band is. */}
        <span
          className="mt-0.5 shrink-0 text-muted-foreground"
          aria-label="frequent"
          title="frequent — quick-log recurring activities"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
            <path d="M8 2.5V6M8 10v3.5M2.5 8H6M10 8h3.5" strokeLinecap="round" />
          </svg>
        </span>

        {groups.length === 0 ? (
          <p className="mt-0.5 text-muted-foreground">— nothing frequent yet —</p>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto pb-0.5">
            {groups.map((g) => {
              // DOT color: the activity's own accent, else the bluey Sleep default, else grey.
              const dot = g.accent ?? (isSleepTitle(g.title) ? sleepDotColor : undefined)
              const n = g.ongoing.length
              const running = n > 0
              return (
                <div key={g.key} className="flex shrink-0 items-center gap-1.5">
                  {/* DOT — pure color indicator (decorative). */}
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: dot ?? "var(--muted-foreground)" }}
                  />
                  {/* GLYPH — punch IN + STAY. Spins while any occurrence is ongoing. */}
                  <button
                    type="button"
                    onClick={() => {
                      onPunchIn(g, { stay: true })
                      collapse()
                    }}
                    className={
                      "shrink-0 transition-opacity hover:opacity-70 " +
                      (running ? "text-foreground" : "text-muted-foreground")
                    }
                    title={`Start ${g.title} now — stay here`}
                    aria-label={`Start ${g.title} now, stay on canvas`}
                  >
                    <Zero0Glyph kind={g.kind} ongoing={running} filled={running} className="h-3.5 w-3.5" />
                  </button>
                  {/* TITLE — punch IN + DRILL into the new occurrence. */}
                  <button
                    type="button"
                    onClick={() => {
                      onPunchIn(g, { stay: false })
                      collapse()
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ key: g.key, x: e.clientX, y: e.clientY })
                    }}
                    className={
                      "max-w-[10rem] truncate transition-opacity hover:opacity-70 " +
                      (running ? "text-foreground" : "text-muted-foreground")
                    }
                    title={`Start ${g.title} now — open it · right-click to log a block`}
                  >
                    {g.title}
                  </button>
                  {/* (n) COUNTER — expand/collapse the ongoing list. Only when n>0. */}
                  {running && (
                    <button
                      type="button"
                      onClick={() => setExpandedKey((k) => (k === g.key ? null : g.key))}
                      className={
                        "shrink-0 tabular-nums transition-colors " +
                        (expandedKey === g.key ? "text-foreground" : "text-muted-foreground hover:text-foreground")
                      }
                      aria-expanded={expandedKey === g.key}
                      title={`${n} ongoing — show the list`}
                    >
                      ({n})
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <Zero0FrameMarker flag="frequent" label="the frequent band" />
      </div>

      {/* EXPANDED ONGOING LIST — animated grid-rows collapse. `listGroup` persists through
          the collapse (via the ref) so the rows animate out instead of vanishing. */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: expandedKey ? "1fr" : "0fr" }}
        inert={!expandedKey}
      >
        <div className="overflow-hidden">
          {listGroup && (
            <ul className="mt-2 flex flex-col gap-1 pl-7">
              {listGroup.ongoing.map((o) => (
                <li key={o.id} className="flex items-center gap-2">
                  {/* GLYPH — punch this occurrence OUT (stay). */}
                  <button
                    type="button"
                    onClick={() => {
                      onPunchOut(o.id)
                      collapse()
                    }}
                    className="shrink-0 text-foreground transition-opacity hover:opacity-70"
                    title={`Punch out ${o.title} now`}
                    aria-label={`Punch out ${o.title} now`}
                  >
                    <Zero0Glyph kind={o.kind} ongoing filled className="h-3.5 w-3.5" />
                  </button>
                  {/* TITLE + META — open it (no punch-out). */}
                  <button
                    type="button"
                    onClick={() => {
                      onOpen(o.id)
                      collapse()
                    }}
                    className="flex min-w-0 items-baseline gap-2 text-left transition-opacity hover:opacity-70"
                    title={`Open ${o.title}`}
                  >
                    <span className="truncate text-foreground">{o.title}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {fmtClock(o.startAt)} · ongoing · {fmtDur(nowTick - o.startAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* RIGHT-CLICK LOG FORM */}
      {menu && menuGroup && (
        <LogForm
          group={menuGroup}
          x={menu.x}
          y={menu.y}
          nowTick={nowTick}
          onClose={() => setMenu(null)}
          onLog={onLog}
        />
      )}
    </section>
  )
}

/**
 * The right-click LOG form: a START time, a DURATION, and an ongoing/ended toggle. Renders
 * as a fixed popover at the cursor behind a dismissing backdrop. Commit paths:
 *   • a duration CHIP commits immediately with the current start + mode (the fast path);
 *   • the number field + "log" button commits an arbitrary duration.
 * The ongoing/ended toggle auto-flips to "ended" whenever start+duration lands in the past.
 */
function LogForm({
  group,
  x,
  y,
  nowTick,
  onClose,
  onLog,
}: {
  group: FrequentGroup
  x: number
  y: number
  nowTick: number
  onClose: () => void
  onLog: (group: FrequentGroup, startAt: number, endAt: number | null) => void
}) {
  const [mode, setMode] = useState<FrequentLogMode>("ended")
  const [startAt, setStartAt] = useState(() => Date.now())
  const [durationMin, setDurationMin] = useState(30)
  const [durationTouched, setDurationTouched] = useState(false)

  // While "ongoing" and untouched, the duration shows live elapsed (now − start).
  const effectiveMin = mode === "ongoing" && !durationTouched ? Math.max(0, Math.round((nowTick - startAt) / MIN)) : durationMin
  const endCandidate = startAt + effectiveMin * MIN

  // Auto-flip: if an ongoing block's end has already passed, it isn't ongoing — it ended.
  useEffect(() => {
    if (mode === "ongoing" && durationTouched && startAt + durationMin * MIN < nowTick - 1000) {
      setMode("ended")
    }
  }, [mode, durationTouched, durationMin, startAt, nowTick])

  // Dismiss on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const commit = useCallback(
    (minutes: number, forceMode?: FrequentLogMode) => {
      const end = startAt + minutes * MIN
      const m = forceMode ?? (mode === "ongoing" && end < nowTick - 1000 ? "ended" : mode)
      onLog(group, startAt, m === "ended" ? end : null)
      onClose()
    },
    [group, startAt, mode, nowTick, onLog, onClose],
  )

  const vw = typeof window !== "undefined" ? window.innerWidth : 9999
  const vh = typeof window !== "undefined" ? window.innerHeight : 9999

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        role="menu"
        aria-label={`Log a ${group.title} block`}
        className="fixed z-50 flex w-52 flex-col gap-2 rounded-md border border-border bg-background p-2 text-[11px] shadow-md"
        style={{ left: Math.min(x, vw - 220), top: Math.min(y, vh - 170) }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-foreground">{group.title}</span>
          <div className="flex shrink-0 overflow-hidden rounded border border-border">
            {(["ended", "ongoing"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={
                  "px-1.5 py-0.5 transition-colors " +
                  (mode === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")
                }
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* START + DURATION fields. */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-muted-foreground">
            start
            <input
              type="time"
              value={msToTimeInput(startAt)}
              onChange={(e) => setStartAt(timeInputToMs(e.target.value, startAt))}
              className="w-[4.5rem] rounded border border-border bg-background px-1 py-0.5 text-foreground tabular-nums"
            />
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">
            <input
              type="number"
              min={0}
              value={effectiveMin}
              onChange={(e) => {
                setDurationTouched(true)
                setDurationMin(Math.max(0, Number.parseInt(e.target.value, 10) || 0))
              }}
              className="w-12 rounded border border-border bg-background px-1 py-0.5 text-right text-foreground tabular-nums"
            />
            min
          </label>
        </div>

        {/* Quick-duration chips — commit immediately with the current start + mode. */}
        <div className="flex flex-wrap gap-1">
          {DURATIONS.map((d) => (
            <button
              key={d.minutes}
              type="button"
              onClick={() => commit(d.minutes)}
              className="rounded border border-border px-1.5 py-1 text-muted-foreground transition-colors hover:bg-foreground hover:text-background"
              title={
                mode === "ended"
                  ? `Log ${group.title} for ${d.label} from ${msToTimeInput(startAt)}`
                  : `Log ${group.title} started ${d.label} ago (ongoing)`
              }
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* Commit the number field. Shows the resolved span / ongoing state. */}
        <button
          type="button"
          onClick={() => commit(effectiveMin)}
          className="rounded bg-foreground px-1.5 py-1 text-background transition-opacity hover:opacity-80"
        >
          {mode === "ongoing" && endCandidate >= nowTick - 1000
            ? `log · ongoing since ${msToTimeInput(startAt)}`
            : `log · ${msToTimeInput(startAt)}–${msToTimeInput(endCandidate)}`}
        </button>
      </div>
    </>
  )
}
