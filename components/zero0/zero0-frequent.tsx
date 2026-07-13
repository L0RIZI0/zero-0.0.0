"use client"

import { useMemo } from "react"
import { getFrequentEntities, type FrequentGroup } from "@/lib/zero/data"
import { isSleepTitle, sleepDotColor } from "@/lib/zero/sleep-sky"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import { Zero0FrameMarker } from "@/components/zero0/zero0-frame-marker"

/**
 * FREQUENT (§4) — the topmost band, a quick-create palette of the activities the user
 * repeats most. A horizontal row of minimal tiles: a color DOT + the title. Clicking a
 * tile creates a NEW entity of the same kind+title starting NOW (and drills into it).
 * Under each tile sits a vertical stack of the CURRENTLY-ONGOING occurrences of that
 * activity, each drawn as its spinning glyph (click → open it).
 *
 * Data (ranking, usual parent, ongoing members) all comes from {@link getFrequentEntities};
 * `dataRev` is the parent's mutation counter so the band re-reads after every change.
 */
export function Zero0Frequent({
  dataRev,
  onCreate,
  onOpen,
}: {
  dataRev: number
  /** Create a fresh occurrence of this activity (same kind+title, start = now). */
  onCreate: (group: FrequentGroup) => void
  /** Open an existing (ongoing) occurrence by id. */
  onOpen: (id: string) => void
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dataRev is the intended re-read trigger
  const groups = useMemo(() => getFrequentEntities(), [dataRev])

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
            return (
              <div key={g.key} className="flex min-w-0 shrink-0 flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => onCreate(g)}
                  className="flex max-w-[10rem] items-center gap-1.5 text-foreground transition-opacity hover:opacity-70"
                  title={`New ${g.title} (start now)`}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: dot ?? "var(--muted-foreground)" }}
                  />
                  <span className="truncate">{g.title}</span>
                </button>

                {/* ONGOING occurrences — one spinning glyph per live instance. */}
                {g.ongoing.length > 0 && (
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
    </section>
  )
}
