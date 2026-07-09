"use client"

import { useEffect, useState } from "react"
import { getEntity } from "@/lib/zero/data"
import { titleAt } from "@/lib/zero/entity-log"
import {
  useActivityRevision,
  getDayRollup,
  getSegmentsForDay,
  clearActivityLog,
  type DaySegment,
  type SpaceRollup,
} from "@/lib/zero/activity-log"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import { Zero0Dayline } from "@/components/zero0/zero0-dayline"
import type { EntityKind } from "@/lib/zero/types"

// The root context id — its label is "Home" when it surfaces as a place, matching the
// canvas + the old shell's convention.
const ROOT_ID = "s_root"

/** Clock time (HH:MM) for a segment edge. Client-only (called under `mounted`). */
function clock(epoch: number): string {
  return new Date(epoch).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

/** Compact human duration: "1h 20m", "45m", "30s". */
function dur(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** The kind of a place id, for its glyph. Defaults to space (the container kind). */
function kindOf(id: string): EntityKind {
  return getEntity(id)?.kind ?? "space"
}

/** Title a place had AT `epoch` — folds titleLog so a past segment reads with its name
 *  then, not today's. Falls back to the current title / a friendly root label. */
function titleForAt(id: string, epoch: number): string {
  const e = getEntity(id)
  if (e) return titleAt(e, epoch)
  if (id === ROOT_ID) return "Home"
  return id
}

/**
 * Root `/0` ACTIVITY VIEW — a stripped, mono readout of WHERE the user has been today,
 * fed by the isolated presence log (`zero:root-activity:v1`). Two sections: a per-place
 * ROLLUP (totals, current-title since it aggregates the whole day) and a recent-SEGMENTS
 * feed (each row labelled with the title the place had AT that time via `titleForAt`).
 * Rows are clickable to drill the canvas into that place. Deliberately dep-free + static,
 * matching the zero0 data aesthetic — this is the ported activity tracker, minus chrome.
 */
export function Zero0Activity({ onOpen, dataRev }: { onOpen: (id: string) => void; dataRev: number }) {
  // Time formatting is client-only; gate to avoid an SSR/static-export hydration trap.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  // Re-render whenever the log changes (segments are mutated in place).
  useActivityRevision()

  if (!mounted) {
    return (
      <div className="border-b border-border px-4 py-3 text-[11px] text-muted-foreground tabular-nums">
        activity · loading…
      </div>
    )
  }

  const rollup: SpaceRollup[] = getDayRollup()
  const segments: DaySegment[] = getSegmentsForDay()
  const recent = segments.slice(-12).reverse() // newest first, capped

  return (
    <>
      {/* The ported presence DAYLINE — fluid pan/ripple + live NOW marker, sitting
          above the textual rollup/feed. Clicking a bar drills the canvas into it. */}
      <Zero0Dayline onOpen={onOpen} dataRev={dataRev} />
      <section
        aria-label="Activity today"
        className="border-b border-border px-4 py-3 text-[11px] leading-relaxed tabular-nums"
      >
      <div className="mb-2 flex items-center justify-between text-muted-foreground">
        <span className="uppercase tracking-wider">activity · today</span>
        <button
          type="button"
          onClick={() => clearActivityLog()}
          className="text-muted-foreground/60 transition-colors hover:text-foreground"
          aria-label="Clear today's activity log"
        >
          clear
        </button>
      </div>

      {segments.length === 0 ? (
        <p className="text-muted-foreground/60">— no presence recorded yet —</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* ROLLUP — per-place totals for the day. */}
          <dl className="space-y-1">
            {rollup.map((r) => (
              <div key={r.entityId} className="flex items-center gap-2">
                <Zero0Glyph kind={kindOf(r.entityId)} className="h-3 w-3 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => onOpen(r.entityId)}
                  className="flex-1 truncate text-left text-foreground transition-colors hover:text-muted-foreground"
                  title={titleForAt(r.entityId, Date.now())}
                >
                  {titleForAt(r.entityId, Date.now())}
                </button>
                <span className="shrink-0 text-muted-foreground">{dur(r.totalMs)}</span>
                <span className="w-8 shrink-0 text-right text-muted-foreground/50">×{r.visits}</span>
              </div>
            ))}
          </dl>

          {/* FEED — recent segments, each with the historical title. */}
          <ol className="space-y-1">
            {recent.map((s, i) => (
              <li key={`${s.entityId}-${s.startAt}-${i}`} className="flex items-center gap-2">
                <span className="shrink-0 text-muted-foreground/50">{clock(s.startAt)}</span>
                <Zero0Glyph kind={kindOf(s.entityId)} className="h-3 w-3 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => onOpen(s.entityId)}
                  className="flex-1 truncate text-left text-foreground transition-colors hover:text-muted-foreground"
                  title={titleForAt(s.entityId, s.startAt)}
                >
                  {titleForAt(s.entityId, s.startAt)}
                </button>
                <span className="shrink-0 text-muted-foreground">{dur(s.durationMs)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      </section>
    </>
  )
}
