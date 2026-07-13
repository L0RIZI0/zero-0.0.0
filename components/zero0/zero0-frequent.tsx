"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { getFrequentEntities, type FrequentGroup, type FrequentInstance } from "@/lib/zero/data"
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
/** A span of ms → a compact duration WITH seconds: "1h 05m 03s" / "12m 34s" / "45s". */
function fmtDur(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`
  return `${s}s`
}
/** ms → a short local clock time ("13:30"). */
function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

/**
 * FREQUENT (§4) — the topmost band, a quick-LOG palette of the activities the user repeats
 * most (Sleep, Walk the dog, Eat, Cook, Clean…). A horizontal row of minimal TILES, each a
 * COLUMN headed by `[dot] [glyph] [title] (n)` with its own vertical list beneath it:
 *
 *   • CLICK the TITLE/body → punch IN (start now) and DRILL into the new occurrence.
 *   • CLICK the GLYPH      → punch IN and STAY on the canvas — UNLESS more than one
 *     occurrence is already ongoing, in which case the spinning glyph EXPANDS §4 (like the
 *     counter) so you can end a specific one. The glyph spins whenever anything is ongoing,
 *     so the tile reads its own live state — no "End…" label needed.
 *   • CLICK the (n) COUNTER (shown only when n>0) → EXPAND/collapse §4. When expanded, EVERY
 *     tile shows its list at once. Each list row is an ONGOING or COMPLETE-not-closed
 *     occurrence, with live meta (start · state · duration incl. seconds). The next click
 *     inside a list COLLAPSES §4: a row's GLYPH punches an ongoing occurrence OUT (stays); a
 *     row's TITLE/meta OPENS it (no punch-out); a complete row opens either way.
 *   • RIGHT-CLICK a tile → a small form to log a fixed block: START time, DURATION (chips or
 *     a number), and an ongoing/ended toggle that auto-flips to "ended" if the end is past.
 *
 * Data (ranking, usual parent, ongoing/complete instances) comes from
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

  // §4's ONE expand state: collapsed shows only the tile headers; expanded reveals EVERY
  // tile's vertical list at once (per Loris — "display all of them any time §4 is expanded").
  const [expanded, setExpanded] = useState(false)

  // Right-click log form: which group + where.
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const menuGroup = menu ? groups.find((g) => g.key === menu.key) : undefined

  // A 1-second clock, live only while §4 is expanded or the form is open — powers the live
  // "duration so far" (incl. seconds) and the ongoing/ended auto-flip, idle otherwise.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (!menu && !expanded) return
    setNowTick(Date.now())
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [menu, expanded])

  const collapse = useCallback(() => setExpanded(false), [])
  const toggle = useCallback(() => setExpanded((v) => !v), [])

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
          <div
            className={
              "flex min-w-0 flex-1 pb-0.5 " +
              // COLLAPSED: a compact horizontal palette that WRAPS so every tile stays
              // visible. EXPANDED: a vertical stack so each tile's wide list sits full-width
              // beneath its header (no horizontal overflow — every tile + list is visible).
              (expanded ? "flex-col gap-2" : "flex-wrap items-start gap-x-5 gap-y-1.5")
            }
          >
            {groups.map((g) => {
              // DOT color: the activity's own accent, else the bluey Sleep default, else grey.
              const dot = g.accent ?? (isSleepTitle(g.title) ? sleepDotColor : undefined)
              const n = g.ongoingCount
              const running = n > 0
              return (
                <div key={g.key} className={"flex flex-col gap-1 " + (expanded ? "w-full" : "shrink-0")}>
                  {/* TILE HEADER — dot · glyph · title · (n) */}
                  <div className="flex items-center gap-1.5">
                    {/* DOT — pure color indicator (decorative). */}
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: dot ?? "var(--muted-foreground)" }}
                    />
                    {/* GLYPH — punch IN + STAY, or (with >1 ongoing) expand the lists. */}
                    <button
                      type="button"
                      onClick={() => (n > 1 ? toggle() : onPunchIn(g, { stay: true }))}
                      className={
                        "shrink-0 transition-opacity hover:opacity-70 " +
                        (running ? "text-foreground" : "text-muted-foreground")
                      }
                      title={n > 1 ? `${n} ${g.title} ongoing — show the list` : `Start ${g.title} now — stay here`}
                      aria-label={n > 1 ? `Show ongoing ${g.title}` : `Start ${g.title} now, stay on canvas`}
                    >
                      <Zero0Glyph kind={g.kind} ongoing={running} filled={running} className="h-3.5 w-3.5" />
                    </button>
                    {/* TITLE — punch IN + DRILL into the new occurrence. */}
                    <button
                      type="button"
                      onClick={() => onPunchIn(g, { stay: false })}
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
                    {/* (n) COUNTER — expand/collapse the lists. Only when something is ongoing. */}
                    {running && (
                      <button
                        type="button"
                        onClick={toggle}
                        className={
                          "shrink-0 tabular-nums transition-colors " +
                          (expanded ? "text-foreground" : "text-muted-foreground hover:text-foreground")
                        }
                        aria-expanded={expanded}
                        title={`${n} ongoing — ${expanded ? "hide" : "show"} the list`}
                      >
                        ({n})
                      </button>
                    )}
                  </div>

                  {/* PER-TILE LIST — animated grid-rows collapse; shown for every tile when
                      §4 is expanded (Walk Daiko, W with only complete rows, etc.). */}
                  <div
                    className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
                    style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
                    inert={!expanded}
                  >
                    <div className="overflow-hidden">
                      {g.instances.length === 0 ? (
                        <p className="py-1 pl-5 text-muted-foreground/60">— none active —</p>
                      ) : (
                        <ul className="flex flex-col gap-1 py-1 pl-5">
                          {g.instances.map((inst) => (
                            <InstanceRow
                              key={inst.id}
                              inst={inst}
                              nowTick={nowTick}
                              onPunchOut={(id) => {
                                onPunchOut(id)
                                collapse()
                              }}
                              onOpen={(id) => {
                                onOpen(id)
                                collapse()
                              }}
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <Zero0FrameMarker flag="frequent" label="the frequent band" />
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

/** One expanded-list row: an ONGOING or COMPLETE occurrence. The glyph punches an ongoing
 *  one OUT; the title/meta opens it. A complete row opens from either target (nothing to
 *  punch out). Meta reads `start · state · duration` with a live, second-resolved duration. */
function InstanceRow({
  inst,
  nowTick,
  onPunchOut,
  onOpen,
}: {
  inst: FrequentInstance
  nowTick: number
  onPunchOut: (id: string) => void
  onOpen: (id: string) => void
}) {
  const ongoing = inst.state === "ongoing"
  const durMs = ongoing ? nowTick - inst.startAt : (inst.endAt ?? inst.startAt) - inst.startAt
  const meta = ongoing
    ? `${fmtClock(inst.startAt)} · ongoing · ${fmtDur(durMs)}`
    : `${fmtClock(inst.startAt)}–${fmtClock(inst.endAt ?? inst.startAt)} · complete · ${fmtDur(durMs)}`
  return (
    <li className="flex items-center gap-2">
      {/* GLYPH — punch OUT if ongoing, else open. */}
      <button
        type="button"
        onClick={() => (ongoing ? onPunchOut(inst.id) : onOpen(inst.id))}
        className="shrink-0 text-foreground transition-opacity hover:opacity-70"
        title={ongoing ? `Punch out ${inst.title} now` : `Open ${inst.title}`}
        aria-label={ongoing ? `Punch out ${inst.title} now` : `Open ${inst.title}`}
      >
        <Zero0Glyph kind={inst.kind} ongoing={ongoing} filled className="h-3.5 w-3.5" />
      </button>
      {/* TITLE + META — open it (no punch-out). */}
      <button
        type="button"
        onClick={() => onOpen(inst.id)}
        className="flex min-w-0 items-baseline gap-2 text-left transition-opacity hover:opacity-70"
        title={`Open ${inst.title}`}
      >
        <span className="truncate text-foreground">{inst.title}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{meta}</span>
      </button>
    </li>
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
  const effectiveMin =
    mode === "ongoing" && !durationTouched ? Math.max(0, Math.round((nowTick - startAt) / MIN)) : durationMin
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
