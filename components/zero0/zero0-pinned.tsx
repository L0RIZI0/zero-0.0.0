"use client"

import { useEffect, useMemo, useState } from "react"
import type React from "react"
import {
  getStarterPinnedEntities,
  getInheritedAccent,
} from "@/lib/zero/data"
import { getOpenEngagement } from "@/lib/zero/kinds"
import type { Entity } from "@/lib/zero/types"
import { isSleepTitle, sleepDotColor } from "@/lib/zero/sleep-sky"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"

/** A span of ms → a compact, second-resolved duration ("1h 05m 03s" / "12m 34s" / "45s"). */
function fmtElapsed(ms: number): string {
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
 * §4 PINNED — the user's curated shelf of "starters". Each tile is one entity the user
 * pinned (via the ENTITY CONTENT right-click "Pin as starter"). Clicking a tile DRILLS
 * into that entity and spins a fresh SESSION in its Sessions sub-Space; the glyph is the
 * stay-here toggle (start/stop the session without navigating). Distinct from the old
 * FREQUENT band (auto-grouped occurrences) — this list is exactly what you pin, in pin
 * order. Reads its data fresh on every `dataRev` bump.
 */
export function Zero0Pinned({
  dataRev,
  onOpen,
  onToggleEngagement,
  onContextMenu,
}: {
  dataRev: number
  /** Frame/title click — drill INTO the entity and start a session. */
  onOpen: (id: string) => void
  /** Glyph click — start/stop the session WITHOUT navigating (stay on canvas). */
  onToggleEngagement: (id: string) => void
  /** Right-click a tile — open the unified entity menu (carries "Unpin starter"). */
  onContextMenu: (entity: Entity, ev: React.MouseEvent) => void
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dataRev is the intended re-read trigger
  const pinned = useMemo(() => getStarterPinnedEntities(), [dataRev])

  // The live OPEN session pair per pinned entity, recomputed on every data change. A pinned
  // entity with a running session spins its glyph + shows an elapsed timer.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dataRev re-read trigger
  const engagements = useMemo(() => pinned.map((e) => getOpenEngagement(e)), [pinned, dataRev])
  const anyOngoing = engagements.some(Boolean)

  // A 1s clock powering the elapsed timers — only ticks while something is running.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (!anyOngoing) return
    setNowTick(Date.now())
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [anyOngoing])

  return (
    <section className="relative flex flex-col border-b border-border px-4 py-3 text-[11px] text-muted-foreground">
      <div className="flex items-start gap-3">
        {/* FRAME TITLE — a bookmark/pin mark: the "kept at hand" affordance this band is. */}
        <span
          className="mt-0.5 shrink-0 text-muted-foreground"
          aria-label="pinned"
          title="pinned — the starters you keep at hand; click to drill in and start a session"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
            <path d="M4 2.5h8v11l-4-3-4 3v-11Z" strokeLinejoin="round" />
          </svg>
        </span>

        {pinned.length === 0 ? (
          <p className="mt-0.5 text-muted-foreground">
            {"— nothing pinned yet — right-click an entity and “Pin as starter” —"}
          </p>
        ) : (
          <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
            {pinned.map((e, i) => {
              const session = engagements[i]
              const running = !!session
              const startAt = session?.startAt ?? null
              const dot = e.accent ?? getInheritedAccent(e.parentId) ?? (isSleepTitle(e.title) ? sleepDotColor : undefined)
              const meta =
                running && startAt != null
                  ? { text: fmtElapsed(nowTick - startAt), title: `session since ${fmtClock(startAt)}` }
                  : null
              return (
                <div
                  key={e.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(e.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault()
                      onOpen(e.id)
                    }
                  }}
                  onContextMenu={(ev) => {
                    ev.preventDefault()
                    onContextMenu(e, ev)
                  }}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1.5 transition-colors hover:border-foreground/40"
                  title={
                    running
                      ? `${e.title} — open · glyph stops the running session · right-click to unpin`
                      : `${e.title} — open & start a session · right-click to unpin`
                  }
                >
                  {/* DOT — the entity's accent (decorative). */}
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: dot ?? "var(--muted-foreground)" }}
                  />
                  {/* GLYPH — the STAY-here session toggle: stop the running session, else start
                      one without drilling in. Spins as an OUTLINE while ongoing. */}
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onToggleEngagement(e.id)
                    }}
                    className={
                      "shrink-0 transition-opacity hover:opacity-70 " +
                      (running ? "text-foreground" : "text-muted-foreground")
                    }
                    title={running ? `Stop ${e.title} session — stay here` : `Start ${e.title} session — stay here`}
                    aria-label={running ? `Stop ${e.title} session` : `Start ${e.title} session, stay on canvas`}
                  >
                    <Zero0Glyph kind={e.kind} ongoing={running} filled={false} className="h-3.5 w-3.5" />
                  </button>
                  {/* TITLE — the whole tile carries the drill-in click. */}
                  <span className={"max-w-[10rem] truncate " + (running ? "text-foreground" : "text-muted-foreground")}>
                    {e.title}
                  </span>
                  {/* LIVE SESSION META — elapsed timer while a session runs. */}
                  {meta && (
                    <span className="shrink-0 tabular-nums text-muted-foreground" title={meta.title}>
                      {meta.text}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
