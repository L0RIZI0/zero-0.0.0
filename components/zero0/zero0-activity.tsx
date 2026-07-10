"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { getEntity, getInheritedAccent } from "@/lib/zero/data"
import { titleAt } from "@/lib/zero/entity-log"
import {
  useActivityRevision,
  getDayRollup,
  getSegmentsForDay,
  clearActivityLog,
  recordPresence,
  type DaySegment,
  type SpaceRollup,
} from "@/lib/zero/activity-log"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import { Zero0Dayline } from "@/components/zero0/zero0-dayline"
import { useZero0Readout, toggleZero0Readout } from "@/lib/zero/zero0-chord"
import type { EntityKind } from "@/lib/zero/types"

// The root context id — its label is "Home" when it surfaces as a place, matching the
// canvas + the old shell's convention.
const ROOT_ID = "s_root"

/** Clock time (HH:MM) for a segment edge. Client-only (called under `mounted`). */
function clock(epoch: number): string {
  return new Date(epoch).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

/**
 * Compact human duration with SECONDS granularity (ported from /2's §3): "1h 20m",
 * "5m 12s", "45s". Keeping seconds is what makes the OPEN segment visibly count up.
 */
function dur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

/** The kind of a place id, for its glyph. Defaults to space (the container kind). */
function kindOf(id: string): EntityKind {
  return getEntity(id)?.kind ?? "space"
}

/**
 * A place's OWN color for its bar: its `accent` (set via `:color:` on ANY kind — so a
 * blue Moment reads blue), else the nearest ancestor SPACE accent, else undefined
 * (⇒ the white+hairline fallback). Mirrors the dayline's planned-bar rule; note
 * `getInheritedAccent` alone only sees SPACE accents, so we check the node itself first.
 */
function accentOf(id: string): string | undefined {
  const e = getEntity(id)
  return e?.accent ?? getInheritedAccent(e?.parentId ?? null)
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
 * fed by the isolated presence log (`zero:root-activity:v1`). Renders the presence
 * DAYLINE above a live textual READOUT (rollup + feed). Structural changes (new/closed
 * segments) refresh via `useActivityRevision`; the per-second live counting lives in
 * {@link ActivityReadout} so this heavy dayline sibling is NOT re-rendered every tick.
 */
export function Zero0Activity({
  onOpen,
  dataRev,
  currentContextId,
}: {
  onOpen: (id: string) => void
  dataRev: number
  /** The canvas's current place — re-seeded into the log right after a clear, so the
   *  tracker keeps recording (a bare `clearActivityLog` would leave it idle). */
  currentContextId: string
}) {
  // Time formatting is client-only; gate to avoid an SSR/static-export hydration trap.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  // Re-render on structural log changes (segments are mutated in place).
  useActivityRevision()
  // `§ 3` chord: hide/show just the textual READOUT — the dayline below stays put.
  const readoutVisible = useZero0Readout()

  if (!mounted) {
    return (
      <div className="border-b border-border px-4 py-3 text-[11px] text-muted-foreground tabular-nums">
        activity · loading…
      </div>
    )
  }

  return (
    <>
      {/* The ported presence DAYLINE — fluid pan/ripple + live NOW marker, sitting
          above the textual rollup/feed. Clicking a bar drills the canvas into it.
          NOT gated by `§ 3` — only the readout below is. */}
      <Zero0Dayline onOpen={onOpen} dataRev={dataRev} />
      {readoutVisible && <ActivityReadout onOpen={onOpen} currentContextId={currentContextId} />}
    </>
  )
}

/**
 * The LIVE textual readout — a per-place ROLLUP (proportional bars + running totals)
 * and a recent-SEGMENTS feed. Holds its own 1-second clock so the CURRENT (open)
 * segment's duration, its bar width, and the "tracked" total all count up in real time,
 * exactly like /2's §3 inspector. Isolated from the dayline so the tick is cheap.
 */
/**
 * A tiny dep-free FLIP animator for the rollup list. Give it a ref to the list
 * container; every row inside must carry a `data-flip-id`. After each render it
 * measures each row's top, and for any row whose position changed since the last
 * render it plays the FLIP: snap back to the OLD top (no transition), then on the
 * next frame release to the new top with an eased transition — so when a place
 * accumulates enough time to overtake a sibling, it slides past instead of jumping.
 * Querying the DOM by attribute (rather than per-row refs) avoids ref churn from the
 * once-a-second re-render. Kept manual on purpose: zero0 stays free of the `motion`
 * dependency the rest of the app uses.
 */
function useFlipList(listRef: React.RefObject<HTMLElement | null>) {
  const prevTops = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const rows = list.querySelectorAll<HTMLElement>("[data-flip-id]")
    const nextTops = new Map<string, number>()
    rows.forEach((el) => nextTops.set(el.dataset.flipId!, el.getBoundingClientRect().top))
    rows.forEach((el) => {
      const id = el.dataset.flipId!
      const prev = prevTops.current.get(id)
      const next = nextTops.get(id)
      if (prev == null || next == null || prev === next) return
      const delta = prev - next
      el.style.transition = "none"
      el.style.transform = `translateY(${delta}px)`
      requestAnimationFrame(() => {
        el.style.transition = "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)"
        el.style.transform = ""
      })
    })
    prevTops.current = nextTops
  })
}

function ActivityReadout({
  onOpen,
  currentContextId,
}: {
  onOpen: (id: string) => void
  currentContextId: string
}) {
  const listRef = useRef<HTMLDListElement>(null)
  useFlipList(listRef)
  // Structural changes here too (so a place switch refreshes immediately, not only on
  // the next whole-second tick).
  useActivityRevision()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Feed `now` through so the OPEN segment's effective end tracks the live clock.
  const rollup: SpaceRollup[] = getDayRollup(now, now)
  const segments: DaySegment[] = getSegmentsForDay(now, now)
  const trackedMs = rollup.reduce((sum, r) => sum + r.totalMs, 0)
  const recent = segments.slice(-12).reverse() // newest first, capped
  // The current place = the open segment (leftAt === null), if any.
  const openId = segments.length > 0 && segments[segments.length - 1].leftAt === null
    ? segments[segments.length - 1].entityId
    : null

  return (
    <section
      aria-label="Activity today"
      className="border-b border-border px-4 py-3 text-[11px] leading-relaxed tabular-nums"
    >
      <div className="mb-2 flex items-center justify-between text-muted-foreground">
        <span className="uppercase tracking-wider">
          activity · today
          <span className="ml-2 text-muted-foreground/60">{dur(trackedMs)} tracked</span>
        </span>
        <button
          type="button"
          onClick={() => {
            // Wipe the log, then IMMEDIATELY re-open a segment for where we are now —
            // otherwise `clearActivityLog` nulls the current place and, since the canvas
            // only records on a context CHANGE, the tracker would sit idle (0s, no bars)
            // until the next drill. This keeps it live: cleared, then counting again.
            clearActivityLog()
            recordPresence(currentContextId)
          }}
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
          {/* ROLLUP — per-place totals with live proportional bars. */}
          <dl ref={listRef} className="space-y-1">
            {rollup.map((r) => {
              const pct = trackedMs > 0 ? (r.totalMs / trackedMs) * 100 : 0
              const isOpen = r.entityId === openId
              // A bar is TINTED only when the user actually chose a color (via `:color:`,
              // own or inherited). Otherwise it's the plain monochrome `bg-foreground`
              // (dark on light, light on dark). The out-of-focus place fades to half.
              const accent = accentOf(r.entityId)
              return (
                <div key={r.entityId} data-flip-id={r.entityId} className="flex items-center gap-2">
                  <Zero0Glyph kind={kindOf(r.entityId)} className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => onOpen(r.entityId)}
                    className="w-24 shrink-0 truncate text-left text-foreground transition-colors hover:text-muted-foreground"
                    title={titleForAt(r.entityId, Date.now())}
                  >
                    {titleForAt(r.entityId, Date.now())}
                  </button>
                  {/* Live proportional bar — the open place's fill grows each second.
                      Tinted to the user-chosen color if any, else plain foreground. */}
                  <span className="relative h-1.5 flex-1 overflow-hidden rounded-[2px] bg-muted">
                    <span
                      className={
                        "absolute inset-y-0 left-0 rounded-[2px] transition-[width] duration-1000 ease-linear " +
                        (accent ? "" : "bg-foreground")
                      }
                      style={{
                        width: `${pct}%`,
                        backgroundColor: accent ?? undefined,
                        opacity: isOpen ? 1 : 0.5,
                      }}
                    />
                  </span>
                  <span className="w-14 shrink-0 text-right text-muted-foreground">
                    {dur(r.totalMs)}
                    {isOpen ? " ·" : ""}
                  </span>
                </div>
              )
            })}
          </dl>

          {/* FEED — recent segments, newest first, each with the historical title. The
              current (open) segment is marked with a filled dot + a trailing "·". */}
          <ol className="space-y-1">
            {recent.map((s, i) => {
              const isOpen = s.leftAt === null
              return (
                <li key={`${s.entityId}-${s.startAt}-${i}`} className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      isOpen ? "bg-foreground" : "bg-muted-foreground/40"
                    }`}
                    aria-hidden
                  />
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
                  <span className="shrink-0 text-muted-foreground">
                    {dur(s.durationMs)}
                    {isOpen ? " ·" : ""}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {/* Chord affordance — mirrors /2's footer. Clicking it (or pressing `§ 3`)
          hides just this readout; the dayline above stays. */}
      <div className="mt-2 border-t border-border/50 pt-1.5">
        <button
          type="button"
          onClick={() => toggleZero0Readout()}
          className="text-[10px] text-muted-foreground/60 transition-colors hover:text-foreground"
          title="Hide the activity readout (toggle with § 3)"
        >
          {"§3 hide"}
        </button>
      </div>
    </section>
  )
}
