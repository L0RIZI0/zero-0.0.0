"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { getFrequentEntities, type FrequentGroup, type FrequentInstance } from "@/lib/zero/data"
import { isSleepTitle, sleepDotColor } from "@/lib/zero/sleep-sky"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import { Zero0FrameMarker } from "@/components/zero0/zero0-frame-marker"

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
/**
 * A span of ms → a compact duration. `withSeconds` adds the seconds unit — used ONLY for
 * ONGOING occurrences (a live, second-ticking timer); COMPLETE spans read to the minute.
 *   withSeconds:  "1h 05m 03s" / "12m 34s" / "45s"
 *   without:      "1h 05m"     / "12m"     / "<1m"
 */
function fmtDur(ms: number, withSeconds: boolean): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (withSeconds) {
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`
    if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`
    return `${s}s`
  }
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`
  if (m > 0) return `${m}m`
  return "<1m"
}
/** ms → a short local clock time ("13:30"). */
function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

/** The live meta shown in the header's counter slot when EXACTLY ONE occurrence is ongoing:
 *  a down-counter of time remaining if the occurrence has a future end, else the elapsed
 *  time since it started. Always second-resolved (it's an ongoing timer). */
function ongoingHeaderMeta(inst: FrequentInstance, now: number): { text: string; title: string } {
  if (inst.endAt != null && inst.endAt > now) {
    return { text: `${fmtDur(inst.endAt - now, true)} left`, title: `${inst.title} — time remaining until end` }
  }
  return { text: fmtDur(now - inst.startAt, true), title: `${inst.title} — running for` }
}

/** A chevron that points down when collapsed and up when expanded (rotates with a transition). */
function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={"h-3.5 w-3.5 transition-transform duration-300 ease-out " + (expanded ? "rotate-180" : "")}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6 L8 10 L12 6" />
    </svg>
  )
}

/**
 * STARTERS (§4) — the topmost band, a quick-LOG palette of the activities the user repeats
 * most (Sleep, Walk the dog, Eat, Cook…). Renamed from FREQUENT (Jul 2026): the DISPLAY name
 * is now "starters" (it starts engagements); the persisted flag key, the `getFrequentEntities`
 * data source, and the `Frequent*` code identifiers stay until §4 becomes real pinned Spaces
 * (see /excerpts, step b). A horizontal row of bordered TILES, each headed by
 * `[dot] [glyph] [title] [(n) | live-meta]` with its own vertical list beneath it.
 *
 * §4 is EXPANDED BY DEFAULT and never auto-collapses; a CHEVRON (or a tile's `(n)` counter)
 * toggles it manually. The height change animates fluidly (per-tile grid-rows collapse).
 *
 * A tile allows only ONE occurrence running at a time: the FRAME click is a pure TOGGLE
 * (start↔end), and the canvas punch-in/log paths also punch out any current ongoing before
 * starting a fresh one, so accumulation is impossible from either route.
 *
 *   • CLICK the whole TILE FRAME → a TOGGLE: when idle, start a fresh occurrence and DRILL
 *     into it (create + open + ongoing); when one is already ongoing, END it and STAY where
 *     you are (no navigation). Clicking the same tile again from anywhere punches it out.
 *   • CLICK the GLYPH → when idle, start a fresh occurrence and STAY on the canvas; when
 *     ongoing, punch it OUT (end it) — it never starts a second. The glyph spins (as an
 *     OUTLINE, matching the entity header) while ongoing.
 *   • The COUNTER SLOT (after the title) shows nothing when nothing runs; a LIVE meta
 *     (elapsed, or a down-counter to the end) when exactly ONE occurrence is ongoing; and
 *     `(n)` (a toggle) when more than one is.
 *   • Each list row is an ONGOING or COMPLETE-not-closed occurrence with live meta. A row's
 *     GLYPH punches an ongoing occurrence OUT; its TITLE/meta OPENS it. Neither collapses §4.
 *   • RIGHT-CLICK a tile → a small MENU: "Log…" (opens the block form), plus "End all
 *     ongoing" / "Close all ongoing" when any occurrence is running.
 *
 * Data comes from {@link getFrequentEntities}; `dataRev` is the parent's mutation counter.
 */
export function Zero0Frequent({
  dataRev,
  onPunchIn,
  onPunchOut,
  onLog,
  onEndAll,
  onCloseAll,
  onOpen,
}: {
  dataRev: number
  /** Start a new occurrence now; drill in unless `stay` (glyph click). */
  onPunchIn: (group: FrequentGroup, opts: { stay: boolean }) => void
  /** End a specific ongoing occurrence now (stays on the canvas). */
  onPunchOut: (id: string) => void
  /** Log a block: absolute `startAt`, and `endAt` (complete) or `null` (still ongoing). */
  onLog: (group: FrequentGroup, startAt: number, endAt: number | null) => void
  /** End (punch out) EVERY ongoing occurrence of this activity now. */
  onEndAll: (group: FrequentGroup) => void
  /** Close EVERY listed occurrence (ongoing + complete) of this activity now. */
  onCloseAll: (group: FrequentGroup) => void
  /** Open (drill into) an existing occurrence by id. */
  onOpen: (id: string) => void
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dataRev is the intended re-read trigger
  const groups = useMemo(() => getFrequentEntities(), [dataRev])

  // §4's ONE expand state — EXPANDED BY DEFAULT (per Loris), toggled only manually via the
  // chevron or a tile's `(n)`. It never auto-collapses on a list interaction.
  const [expanded, setExpanded] = useState(true)
  const toggle = useCallback(() => setExpanded((v) => !v), [])

  // A 1-second clock powering every live readout (header metas, list durations, the log
  // form auto-flip). It runs whenever ANYTHING is ongoing (so collapsed header timers still
  // tick) or the log form is open — idle otherwise.
  const anyOngoing = groups.some((g) => g.ongoingCount > 0)
  // The right-click popover, pinned to a tile at the cursor: a bulk-action row (End/Close all)
  // stacked directly above the block log form — no intermediate menu step.
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const menuGroup = menu ? groups.find((g) => g.key === menu.key) : undefined
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (!menu && !anyOngoing) return
    setNowTick(Date.now())
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [menu, anyOngoing])

  return (
    <section className="relative flex flex-col border-b border-border px-4 py-3 text-[11px] text-muted-foreground">
      <div className="flex items-start gap-3">
        {/* FRAME TITLE — a "plus without center" mark: the quick-create affordance this band is. */}
        <span
          className="mt-0.5 shrink-0 text-muted-foreground"
          aria-label="starters"
          title="starters — quick-log the activities you clock in and out of"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
            <path d="M8 2.5V6M8 10v3.5M2.5 8H6M10 8h3.5" strokeLinecap="round" />
          </svg>
        </span>

        {groups.length === 0 ? (
          <p className="mt-0.5 text-muted-foreground">— nothing to start yet —</p>
        ) : (
          <>
            {/* CHEVRON — manual expand/collapse of every tile's list at once. */}
            <button
              type="button"
              onClick={toggle}
              className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse starter lists" : "Expand starter lists"}
              title={expanded ? "Collapse the lists" : "Expand the lists"}
            >
              <Chevron expanded={expanded} />
            </button>

            {/* TILES — a horizontal, wrapping row of bordered cards, each its natural width. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
              {groups.map((g) => {
                // DOT color: the activity's own accent, else the bluey Sleep default, else grey.
                const dot = g.accent ?? (isSleepTitle(g.title) ? sleepDotColor : undefined)
                const n = g.ongoingCount
                const running = n > 0
                const soleOngoing = n === 1 ? g.instances.find((i) => i.state === "ongoing") : undefined
                const soleMeta = soleOngoing ? ongoingHeaderMeta(soleOngoing, nowTick) : undefined
                // FRAME click = a pure TOGGLE of the activity (single-instance rule): when
                // idle, START a fresh occurrence and DRILL into it (create + open + ongoing);
                // when one is already running, END that ongoing occurrence and STAY where you
                // are (no navigation). So clicking the same tile again from anywhere just
                // punches the activity out.
                const onFrame = () => (running ? onEndAll(g) : onPunchIn(g, { stay: false }))
                return (
                  <div
                    key={g.key}
                    role="button"
                    tabIndex={0}
                    onClick={onFrame}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onFrame()
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ key: g.key, x: e.clientX, y: e.clientY })
                    }}
                    className="flex cursor-pointer flex-col gap-1 rounded-md border border-border px-2 py-1.5 transition-colors hover:border-foreground/40"
                    title={
                      running
                        ? `End ${g.title} now — stay here · right-click for options`
                        : `Start ${g.title} now — open it · right-click for options`
                    }
                  >
                    {/* TILE HEADER — dot · glyph · title · (n)/meta */}
                    <div className="flex items-center gap-1.5">
                      {/* DOT — pure color indicator (decorative). */}
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: dot ?? "var(--muted-foreground)" }}
                      />
                      {/* GLYPH — the STAY-here control: punch OUT the ongoing occurrence when
                          running, else START a fresh one without drilling in. Spins as an
                          OUTLINE (never filled) while ongoing, matching the entity header. */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (running) onEndAll(g)
                          else onPunchIn(g, { stay: true })
                        }}
                        className={
                          "shrink-0 transition-opacity hover:opacity-70 " +
                          (running ? "text-foreground" : "text-muted-foreground")
                        }
                        title={running ? `End ${g.title} now — stay here` : `Start ${g.title} now — stay here`}
                        aria-label={running ? `End ongoing ${g.title}` : `Start ${g.title} now, stay on canvas`}
                      >
                        <Zero0Glyph kind={g.kind} ongoing={running} filled={false} className="h-3.5 w-3.5" />
                      </button>
                      {/* TITLE — plain text; the whole frame carries the click. */}
                      <span
                        className={
                          "max-w-[10rem] truncate " + (running ? "text-foreground" : "text-muted-foreground")
                        }
                      >
                        {g.title}
                      </span>
                      {/* COUNTER SLOT — the single ongoing's live meta, or `(n)` to toggle. */}
                      {n === 1 && soleMeta && (
                        <span className="shrink-0 tabular-nums text-muted-foreground" title={soleMeta.title}>
                          {soleMeta.text}
                        </span>
                      )}
                      {n > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggle()
                          }}
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

                    {/* PER-TILE LIST — animated grid-rows collapse (fluid height). When
                        collapsed, `max-w-0` clips it to zero width too so an ongoing tile no
                        longer inflates to its (wide) list width, AND `pointer-events-none` lets
                        clicks fall THROUGH to the frame beneath (the collapsed wrapper still
                        occupies part of the tile, so without this it silently ate frame clicks
                        in its zone). Expanded: row clicks stop propagation so they don't trigger
                        the frame's toggle. */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className={
                        "grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none " +
                        (expanded ? "pointer-events-auto" : "pointer-events-none max-w-0")
                      }
                      style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
                      inert={!expanded}
                    >
                      <div className="overflow-hidden">
                        {g.instances.length === 0 ? (
                          <p className="py-1 text-muted-foreground/60">— none active —</p>
                        ) : (
                          <ul className="flex flex-col gap-1 py-1">
                            {g.instances.map((inst) => (
                              <InstanceRow
                                key={inst.id}
                                inst={inst}
                                nowTick={nowTick}
                                onPunchOut={onPunchOut}
                                onOpen={onOpen}
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
          </>
        )}

        <Zero0FrameMarker flag="frequent" label="the starters band" />
      </div>

      {/* RIGHT-CLICK POPOVER — bulk actions above the block log form. */}
      {menu && menuGroup && (
        <TilePopover
          group={menuGroup}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onLog={onLog}
          onEndAll={onEndAll}
          onCloseAll={onCloseAll}
        />
      )}
    </section>
  )
}

/** One expanded-list row: an ONGOING or COMPLETE occurrence. The glyph punches an ongoing
 *  one OUT; the title/meta opens it. A complete row opens from either target. The glyph fill
 *  is CANONICAL (`inst.filled` from `fillsGlyph`) so it matches the entity header exactly —
 *  ongoing outlines + spins, complete fills. Duration shows seconds ONLY while ongoing. */
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
    ? `${fmtClock(inst.startAt)} · ongoing · ${fmtDur(durMs, true)}`
    : `${fmtClock(inst.startAt)}–${fmtClock(inst.endAt ?? inst.startAt)} · complete · ${fmtDur(durMs, false)}`
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
        <Zero0Glyph kind={inst.kind} ongoing={ongoing} filled={inst.filled} className="h-3.5 w-3.5" />
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
 * The right-click TILE POPOVER: a BULK-ACTION row (End all / Close all ongoing) on top, then
 * the block LOG form directly below — no intermediate menu step. Fixed at the cursor behind a
 * dismissing backdrop.
 *
 * BULK ROW: "End all" punches every ONGOING occurrence out (→ COMPLETE, tz-stable midnight
 * close; disabled when none are ongoing). "Close all" files every LISTED occurrence now — both
 * ongoing AND complete-not-yet-closed — clearing the tile list (disabled only when the list is
 * empty, so it can still sweep away complete rows that End all leaves behind).
 *
 * LOG FORM — a START time, a DURATION, and a binary "ended: yes/no" toggle defaulting to NO
 * (the activity is about to START now and run ongoing). Flip to YES and the block becomes one
 * that JUST ENDED after lasting `duration`: the start is recalculated back by the duration so
 * the END lands at the flip moment (never future-dated). The commit button reads "Start Now"
 * when no (opens an ongoing occurrence) and "Log" + the span when yes (files a completed block).
 *
 *   • ended = NO  → onLog(start, null)              → ongoing, starting at `start` (now).
 *   • ended = YES → onLog(start, start + duration)  → completed block [start, start+dur].
 *
 * While ended, changing the duration keeps the END anchored (start shifts) so it stays a
 * "just finished" block. Duration chips only SET the duration; the button is the sole commit.
 */
function TilePopover({
  group,
  x,
  y,
  onClose,
  onLog,
  onEndAll,
  onCloseAll,
}: {
  group: FrequentGroup
  x: number
  y: number
  onClose: () => void
  onLog: (group: FrequentGroup, startAt: number, endAt: number | null) => void
  onEndAll: (group: FrequentGroup) => void
  onCloseAll: (group: FrequentGroup) => void
}) {
  const [ended, setEnded] = useState(false)
  const [startAt, setStartAt] = useState(() => Date.now())
  const [durationMin, setDurationMin] = useState(30)
  const endMs = startAt + durationMin * MIN

  // Toggling recalculates the start so the END stays put: switching to "ended" pulls start
  // back by the duration (end = the flip moment ≈ now); switching back pushes it forward.
  const toggleEnded = useCallback(
    (next: boolean) => {
      if (next === ended) return
      setStartAt((s) => s + (next ? -1 : 1) * durationMin * MIN)
      setEnded(next)
    },
    [ended, durationMin],
  )

  // Changing the duration while "ended" keeps the END anchored (start absorbs the delta), so
  // it remains a block that finished at the same moment. While ongoing, start stays put.
  const changeDuration = useCallback(
    (next: number) => {
      const n = Math.max(0, next)
      setStartAt((s) => (ended ? s + (durationMin - n) * MIN : s))
      setDurationMin(n)
    },
    [ended, durationMin],
  )

  // Dismiss on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const commit = useCallback(() => {
    onLog(group, startAt, ended ? startAt + durationMin * MIN : null)
    onClose()
  }, [group, startAt, ended, durationMin, onLog, onClose])

  const ongoing = group.ongoingCount // End all only touches these
  const listed = group.instances.length // Close all clears the whole list (ongoing + complete)
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
        aria-label={`${group.title} — actions & log`}
        className="fixed z-50 flex w-52 flex-col gap-2 rounded-md border border-border bg-background p-2 text-[11px] shadow-md"
        style={{ left: Math.min(x, vw - 220), top: Math.min(y, vh - 240) }}
      >
        {/* BULK ACTIONS, same row on top. END ALL punches every ONGOING occurrence out (→
            complete; disabled when none ongoing). CLOSE ALL files every LISTED occurrence now
            — ongoing AND complete — clearing the tile list (disabled only when the list is
            empty). */}
        <div className="flex gap-1">
          {(
            [
              {
                label: "End all",
                run: onEndAll,
                count: ongoing,
                disabledHint: "Nothing ongoing",
                hint: "punch every ongoing out → complete",
              },
              {
                label: "Close all",
                run: onCloseAll,
                count: listed,
                disabledHint: "Nothing to close",
                hint: "close every listed occurrence now (ongoing + complete)",
              },
            ] as const
          ).map((b) => (
            <button
              key={b.label}
              type="button"
              disabled={b.count === 0}
              onClick={() => {
                b.run(group)
                onClose()
              }}
              className="flex-1 rounded border border-border px-1.5 py-1 text-muted-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              title={b.count === 0 ? b.disabledHint : `${b.label} — ${b.hint} (${b.count})`}
            >
              {b.label}
              {b.count > 0 ? ` (${b.count})` : ""}
            </button>
          ))}
        </div>

        <div className="border-t border-border" />

        {/* Title + the binary "ended: yes/no" toggle. */}
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-foreground">{group.title}</span>
          <div className="flex shrink-0 items-center gap-1">
            <span className="text-muted-foreground">ended</span>
            <div className="flex overflow-hidden rounded border border-border">
              {([
                { on: false, label: "no" },
                { on: true, label: "yes" },
              ] as const).map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => toggleEnded(o.on)}
                  className={
                    "px-1.5 py-0.5 transition-colors " +
                    (ended === o.on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
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
              value={durationMin}
              onChange={(e) => changeDuration(Number.parseInt(e.target.value, 10) || 0)}
              className="w-12 rounded border border-border bg-background px-1 py-0.5 text-right text-foreground tabular-nums"
            />
            min
          </label>
        </div>

        {/* Quick-duration chips — set the duration (the button commits). */}
        <div className="flex flex-wrap gap-1">
          {DURATIONS.map((d) => (
            <button
              key={d.minutes}
              type="button"
              onClick={() => changeDuration(d.minutes)}
              className={
                "rounded border px-1.5 py-1 transition-colors hover:bg-foreground hover:text-background " +
                (durationMin === d.minutes
                  ? "border-foreground text-foreground"
                  : "border-border text-muted-foreground")
              }
              title={`Set duration to ${d.label}`}
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* Commit — "Start" (ongoing) or "Log" (completed block), with the resolved span. */}
        <button
          type="button"
          onClick={commit}
          className="rounded bg-foreground px-1.5 py-1 text-background transition-opacity hover:opacity-80"
        >
          {ended ? `Log · ${msToTimeInput(startAt)}–${msToTimeInput(endMs)}` : "Start Now"}
        </button>
      </div>
    </>
  )
}
