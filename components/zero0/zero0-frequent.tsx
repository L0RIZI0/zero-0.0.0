"use client"

import { useEffect, useMemo, useState } from "react"
import { getFrequentEntities, type FrequentGroup } from "@/lib/zero/data"
import { isSleepTitle, sleepDotColor } from "@/lib/zero/sleep-sky"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import { Zero0FrameMarker } from "@/components/zero0/zero0-frame-marker"

/** How a right-click duration chip files the block: as already finished, or still going. */
export type FrequentLogMode = "ended" | "ongoing"

/** The duration chips offered in the right-click log menu (minutes). */
const DURATIONS: { label: string; minutes: number }[] = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "45m", minutes: 45 },
  { label: "1h", minutes: 60 },
  { label: "1h30m", minutes: 90 },
  { label: "2h", minutes: 120 },
]

/**
 * FREQUENT (§4) — the topmost band, a quick-create palette of the activities the user
 * repeats most. A horizontal row of minimal tiles: a color DOT + the title. Two ways to
 * log an activity, matching the mix of live + retroactive tracking:
 *
 *   • LEFT-CLICK a tile = the live PUNCH TOGGLE. If nothing of that activity is ongoing,
 *     it starts one NOW (punch in) and drills into it; if one IS ongoing, the click ENDS
 *     it now (punch out) and stays put. ALT/OPTION-click punches in WITHOUT drilling, for
 *     starting several in a row. The tile shows its running state so you know which the
 *     next tap does.
 *   • RIGHT-CLICK a tile = the retroactive DURATION menu (stays on the canvas). Pick a
 *     duration chip to log a block of that length; the ongoing/ended toggle decides whether
 *     it's filed as already finished ([now−D, now]) or still running (started D ago, no end).
 *
 * Under each tile sits a vertical stack of the CURRENTLY-ONGOING occurrences, each drawn as
 * its spinning glyph (click → open it). Data (ranking, usual parent, ongoing members) comes
 * from {@link getFrequentEntities}; `dataRev` is the parent's mutation counter so the band
 * re-reads after every change.
 */
export function Zero0Frequent({
  dataRev,
  onPunch,
  onLog,
  onOpen,
}: {
  dataRev: number
  /** Live punch toggle: start now (drill unless `stay`) OR end the ongoing one. */
  onPunch: (group: FrequentGroup, opts: { stay: boolean }) => void
  /** Retroactive log of a fixed-duration block (stays on the canvas). */
  onLog: (group: FrequentGroup, minutes: number, mode: FrequentLogMode) => void
  /** Open an existing (ongoing) occurrence by id. */
  onOpen: (id: string) => void
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dataRev is the intended re-read trigger
  const groups = useMemo(() => getFrequentEntities(), [dataRev])

  // Right-click duration popover: which group, where, and the ongoing/ended mode.
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const [mode, setMode] = useState<FrequentLogMode>("ended")
  const menuGroup = menu ? groups.find((g) => g.key === menu.key) : undefined

  // Dismiss the popover on Escape.
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [menu])

  return (
    <section className="relative flex items-start gap-3 border-b border-border px-4 py-3 text-[11px] text-muted-foreground">
      {/* FRAME TITLE — a "plus without center" mark (a plus with a hollow middle): the
          quick-CREATE affordance this band is. Four short strokes that stop short of the
          centre, so the plus reads as open/hollow. Purely decorative label. */}
      <span
        className="mt-0.5 shrink-0 text-muted-foreground"
        aria-label="frequent"
        title="frequent — quick-create recurring activities"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
          <path d="M8 2.5V6M8 10v3.5M2.5 8H6M10 8h3.5" strokeLinecap="round" />
        </svg>
      </span>

      {groups.length === 0 ? (
        <p className="mt-0.5 text-muted-foreground">— nothing frequent yet —</p>
      ) : (
        <div className="flex min-w-0 flex-1 gap-5 overflow-x-auto pb-0.5">
          {groups.map((g) => {
            // DOT color: the activity's own accent, else the bluey Sleep default, else grey.
            const dot = g.accent ?? (isSleepTitle(g.title) ? sleepDotColor : undefined)
            const running = g.ongoing.length > 0
            return (
              <div key={g.key} className="flex min-w-0 shrink-0 flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => onPunch(g, { stay: e.altKey })}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMode("ended")
                    setMenu({ key: g.key, x: e.clientX, y: e.clientY })
                  }}
                  className={
                    "flex max-w-[10rem] items-center gap-1.5 transition-opacity hover:opacity-70 " +
                    (running ? "text-foreground" : "text-muted-foreground")
                  }
                  title={
                    running
                      ? `End ${g.title} now (ongoing) · right-click to log a block`
                      : `Start ${g.title} now · alt-click to stay · right-click to log a past block`
                  }
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: dot ?? "var(--muted-foreground)",
                      // Running → a faint ring so the tile reads as "active, click to stop".
                      boxShadow: running ? "0 0 0 2px var(--background), 0 0 0 3px currentColor" : undefined,
                    }}
                  />
                  <span className="truncate">{g.title}</span>
                </button>

                {/* ONGOING occurrences — one spinning glyph per live instance. */}
                {running && (
                  <div className="flex flex-col items-center gap-1.5">
                    {g.ongoing.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => onOpen(o.id)}
                        className="text-foreground transition-opacity hover:opacity-70"
                        title={`Open ${o.title} (ongoing)`}
                        aria-label={`Open ${o.title} (ongoing)`}
                      >
                        <Zero0Glyph kind={o.kind} ongoing filled className="h-3.5 w-3.5" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Zero0FrameMarker flag="frequent" label="the frequent band" />

      {/* RIGHT-CLICK DURATION POPOVER — log a fixed-length block. A full-screen backdrop
          catches the dismissing click/right-click; the panel is fixed at the cursor. */}
      {menu && menuGroup && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div
            role="menu"
            aria-label={`Log a ${menuGroup.title} block`}
            className="fixed z-50 flex flex-col gap-2 rounded-md border border-border bg-background p-2 text-[11px] shadow-md"
            style={{
              left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 180),
              top: Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 120),
            }}
          >
            <div className="flex items-center justify-between gap-3 px-0.5">
              <span className="truncate text-foreground">{menuGroup.title}</span>
              {/* ONGOING / ENDED toggle — is the block still running, or already finished? */}
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
            <div className="flex gap-1">
              {DURATIONS.map((d) => (
                <button
                  key={d.minutes}
                  type="button"
                  onClick={() => {
                    onLog(menuGroup, d.minutes, mode)
                    setMenu(null)
                  }}
                  className="rounded border border-border px-1.5 py-1 text-muted-foreground transition-colors hover:bg-foreground hover:text-background"
                  title={
                    mode === "ended"
                      ? `Log ${menuGroup.title} for ${d.label}, ending now`
                      : `Log ${menuGroup.title} started ${d.label} ago, still ongoing`
                  }
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
