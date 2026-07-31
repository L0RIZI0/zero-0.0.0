"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ROOT_ID, getEntity, getInheritedAccent } from "@/lib/zero/data"
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
import { Zero0Face } from "@/components/zero0/zero0-face"
import { Zero0Dayline, type DaylineOccRef } from "@/components/zero0/zero0-dayline"
import { Zero0FrameMarker } from "@/components/zero0/zero0-frame-marker"
import { useZero0Readout, toggleZero0Readout } from "@/lib/zero/zero0-chord"
import { formatLocale } from "@/lib/zero/format-locale"
import type { EntityKind } from "@/lib/zero/types"

/** Clock time (HH:MM) for a segment edge. Client-only (called under `mounted`). */
function clock(epoch: number): string {
  return new Date(epoch).toLocaleTimeString(formatLocale(), { hour: "2-digit", minute: "2-digit" })
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
  return e?.color ?? getInheritedAccent(e?.parentId ?? null)
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
 * AGENDA frame (root `/0`) — the FORWARD-looking band: what is PLANNED today. Just a
 * frame title over the PLANNED dayline (scheduled occurrences, fluid pan/ripple + live
 * NOW marker). Split off from ACTIVITY (Jul 2026) so planning and presence are two
 * independent, separately-toggled frames. No `clear` — that belongs to the presence log.
 */
export function Zero0Agenda({
  onOpen,
  onContextMenuEntity,
  onOccurrenceMenu,
  onFrameMenu,
  onToggleMinimize,
  minimized = false,
  hideBottomBorder = false,
  dataRev,
  highlightId = null,
}: {
  onOpen: (id: string) => void
  /** Right-click a planned tick → the entity menu for that occurrence. */
  onContextMenuEntity?: (id: string, ev: React.MouseEvent) => void
  /** Right-click a TOP-rail tick → the PER-OCCURRENCE menu (Edit time / Cancel / Delete). Only the
   *  agenda dayline has a top rail, so only this component forwards it (v0.2.249). */
  onOccurrenceMenu?: (
    entityId: string,
    occ: NonNullable<DaylineOccRef>,
    ev: React.MouseEvent,
  ) => void
  /** Right-click the frame chrome (header / empty area) → the frame menu (minimize). */
  onFrameMenu?: (frame: "agenda" | "activity", ev: React.MouseEvent) => void
  /** Toggle minimize/maximize directly (LEFT-click): the chevron in the maximized title,
   *  and a click on the minimized band's empty area (not a tick). */
  onToggleMinimize?: () => void
  /** When minimized, render ONLY the dayline band (with its day-label header) — no frame
   *  title, no border, tight margins. Click empty area (or right-click) → maximize. */
  minimized?: boolean
  /** Drop the bottom separator when the frame below (ACTIVITY) is ALSO a minimized band,
   *  so the two merge into one grouped strip. */
  hideBottomBorder?: boolean
  dataRev: number
  /** Entity focused elsewhere on the canvas — its ticks light up. Passed to the dayline. */
  highlightId?: string | null
}) {
  return (
    <section
      aria-label="Today"
      className="relative"
      onContextMenu={onFrameMenu ? (ev) => onFrameMenu("agenda", ev) : undefined}
    >
      {/* Frame TITLE — this frame is named TODAY (dropped the "agenda ·" prefix Jul 2026;
          the footer toggle link stays labelled "agenda"). Its divider is INSET (inset-x-4)
          and lighter (border/50) so a within-frame division reads differently from the
          full-bleed `border-border` separators that mark FRAME boundaries. ALWAYS MOUNTED —
          it COLLAPSES (grid-rows 0fr↔1fr) when minimized so the title glides in/out smoothly
          in both directions rather than popping. The chevron (right) minimizes on click. */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: minimized ? "0fr" : "1fr" }}
        inert={minimized}
      >
        <div className="overflow-hidden">
          <div className="relative flex items-center justify-between px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/50 after:content-['']">
            <span>today</span>
            {onToggleMinimize && (
              <button
                type="button"
                onClick={onToggleMinimize}
                aria-label="Minimize today"
                className="-my-1 -mr-1 rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                <ChevronCollapse />
              </button>
            )}
          </div>
        </div>
      </div>
      {/* The dayline band. When minimized, a LEFT-click on empty area (anywhere that isn't a
          tick button) maximizes the frame — a big, forgiving hit target. Tick clicks still
          open their entity (guarded by the `[data-barkey]` closest check). */}
      <div
        className={minimized ? "cursor-pointer" : undefined}
        onClick={
          minimized && onToggleMinimize
            ? (ev) => {
                if (!(ev.target as HTMLElement).closest("[data-barkey]")) onToggleMinimize()
              }
            : undefined
        }
      >
        <Zero0Dayline
          onOpen={onOpen}
          onContextMenuEntity={onContextMenuEntity}
          onOccurrenceMenu={onOccurrenceMenu}
          dataRev={dataRev}
          tracks="both"
          minimized={minimized}
          hideBottomBorder={hideBottomBorder}
          highlightId={highlightId}
        />
      </div>
      {/* The §x corner affordance is chrome — hide it on a minimized band (which is meant
          to be nothing but the dayline). Re-show via the § chord or the footer link. */}
      {!minimized && <Zero0FrameMarker flag="agenda" label="the agenda" />}
    </section>
  )
}

/** A small chevron-up used as the "minimize" affordance in the TODAY title. Inline SVG so
 *  zero0 stays free of an icon dependency (matches the dep-free glyph approach). */
function ChevronCollapse() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 15l-6-6-6 6" />
    </svg>
  )
}

/**
 * ACTIVITY frame (root `/0`) — the BACKWARD-looking band: WHERE the user has been today,
 * fed by the isolated presence log (`zero:root-activity:v1`). Frame title (+ the `clear`
 * action) over the PRESENCE dayline, which is ALWAYS shown while the frame is open; the
 * `§ 3` chord hides only the textual DETAILS (rollup + feed) below it. The per-second
 * live counting lives in {@link ActivityBody} so the toggle chrome here is cheap.
 */
export function Zero0Activity({
  onOpen,
  onContextMenuEntity,
  onFrameMenu,
  minimized = false,
  dataRev,
  currentContextId,
  highlightId = null,
}: {
  onOpen: (id: string) => void
  /** Right-click a rollup/feed row OR a presence tick → the entity menu for that place. */
  onContextMenuEntity?: (id: string, ev: React.MouseEvent) => void
  /** Right-click the frame chrome (header / empty area) → the frame menu (minimize). */
  onFrameMenu?: (frame: "agenda" | "activity", ev: React.MouseEvent) => void
  /** When minimized, render ONLY the presence dayline (with its "x tracked" total) — no
   *  frame title, no details, no border, tight margins. Right-click → maximize. */
  minimized?: boolean
  dataRev: number
  /** The canvas's current place — re-seeded into the log right after a clear, so the
   *  tracker keeps recording (a bare `clearActivityLog` would leave it idle). */
  currentContextId: string
  /** Entity focused elsewhere on the canvas — its presence ticks light up. */
  highlightId?: string | null
}) {
  // Time formatting is client-only; gate to avoid an SSR/static-export hydration trap.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  // Re-render on structural log changes (segments are mutated in place).
  useActivityRevision()
  // `§ 3` chord: hide/show just the textual DETAILS — the presence dayline stays put.
  const detailsVisible = useZero0Readout()

  if (!mounted) {
    return (
      <div className="border-b border-border px-4 py-3 text-[11px] text-muted-foreground tabular-nums">
        activity · loading…
      </div>
    )
  }

  return (
    <section
      aria-label="Activity today"
      className="relative"
      onContextMenu={onFrameMenu ? (ev) => onFrameMenu("activity", ev) : undefined}
    >
      {/* FRAME TITLE — "activity · today" heading, carrying the frame-level `clear`
          action. The tracked total lives on the PRESENCE dayline row below, not here.
          Its divider is INSET + lighter (see AGENDA) so within-frame divisions stay
          distinct from the full-bleed FRAME separators. Hidden while minimized. */}
      {!minimized && (
        <div className="relative flex items-center justify-between px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/50 after:content-['']">
          <span>activity · today</span>
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
            className="normal-case text-muted-foreground/60 transition-colors hover:text-foreground"
            aria-label="Clear today's activity log"
          >
            clear
          </button>
        </div>
      )}
      <ActivityBody
        onOpen={onOpen}
        onContextMenuEntity={onContextMenuEntity}
        dataRev={dataRev}
        showDetails={detailsVisible}
        minimized={minimized}
        highlightId={highlightId}
      />
      {/* §x corner affordance hidden on a minimized band (chrome-free). */}
      {!minimized && <Zero0FrameMarker flag="activity" label="the activity frame" />}
    </section>
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
 *
 * Tops are measured RELATIVE TO THE LIST CONTAINER, not the viewport. Otherwise any
 * ANCESTOR layout shift — e.g. collapsing/expanding the AGENDA frame above, which
 * slides this whole list up/down — would change every row's absolute top and fire a
 * bogus FLIP on each frame of that animation (the "bars jump / re-animate" bug). With
 * a container-relative offset, the list and its rows move together, so only a genuine
 * INTRA-list reorder produces a non-zero delta.
 */
function useFlipList(listRef: React.RefObject<HTMLElement | null>) {
  const prevTops = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const listTop = list.getBoundingClientRect().top
    const rows = list.querySelectorAll<HTMLElement>("[data-flip-id]")
    const nextTops = new Map<string, number>()
    rows.forEach((el) => nextTops.set(el.dataset.flipId!, el.getBoundingClientRect().top - listTop))
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

function ActivityBody({
  onOpen,
  onContextMenuEntity,
  dataRev,
  showDetails,
  minimized = false,
  highlightId = null,
}: {
  onOpen: (id: string) => void
  /** Right-click a rollup/feed row → the entity menu for that place. */
  onContextMenuEntity?: (id: string, ev: React.MouseEvent) => void
  dataRev: number
  /** `§ 3` — whether the textual rollup/feed DETAILS show. The presence dayline is
   *  always rendered regardless, so ACTIVITY still shows PRESENCE when details hide. */
  showDetails: boolean
  /** When minimized, render ONLY the presence dayline (keeping the live "x tracked"
   *  total) — no details, no toggle, no bottom border. */
  minimized?: boolean
  /** Entity focused elsewhere on the canvas — its presence ticks light up. */
  highlightId?: string | null
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
    // Always keep the bottom divider — even minimized — so ACTIVITY stays visually
    // separated from the next frame (ZERO HEADER). The presence dayline never carries its
    // own border, so this wrapper is the sole separator.
    <div className="border-b border-border">
      {/* The dedicated PRESENCE dayline — tracked activity ("where I was"), ALWAYS shown
          while the ACTIVITY frame is open. Carries the "x tracked" total in its header
          (next to the "presence · today" label). Right-click a tick → the entity menu.
          When minimized, the total overlays inside the band (see Zero0Dayline). */}
      <Zero0Dayline
        onOpen={onOpen}
        onContextMenuEntity={onContextMenuEntity}
        dataRev={dataRev}
        tracks="presence"
        trailing={`${dur(trackedMs)} tracked`}
        minimized={minimized}
        highlightId={highlightId}
      />

      {/* Presence tracker DETAILS — per-place rollup + recent-segments feed. Gated by
          `§ 3` (showDetails) AND hidden while minimized; the presence dayline above stays
          regardless. */}
      {!minimized && showDetails && (
      <div className="px-4 pb-3 pt-1 text-[11px] leading-relaxed tabular-nums">
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
                  {/* The place as an XS Face — a neutral kind glyph + its (current) title.
                      A rollup is PRESENCE, not the entity's lifecycle, so the Face is a
                      projection (faceLike); the bar + duration below stay Content-side. */}
                  <Zero0Face
                    size="xs"
                    faceLike={{ kind: kindOf(r.entityId), title: titleForAt(r.entityId, Date.now()) }}
                    onActivate={() => onOpen(r.entityId)}
                    onActivateContextMenu={
                      onContextMenuEntity ? (ev) => onContextMenuEntity(r.entityId, ev) : undefined
                    }
                    titleClassName="w-24 shrink-0"
                  />
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
                  {/* Duration is content-width, nowrap, and the LAST flex child, so its
                      right edge pins to the frame while the flex-1 bar absorbs any
                      width change. This kills the old bugs: no fixed cell for the live
                      "·" to wrap out of, and a ticking single→double digit no longer
                      shifts the row — only the one open bar breathes by ~1 char. */}
                  <span className="shrink-0 whitespace-nowrap text-muted-foreground">
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
                  {/* The visited place as an XS Face — using the AS-OF title (its name at
                      the time of the visit, resolved by titleForAt). Projection, like the
                      rollup; the leading dot + clock and trailing duration stay Content-side. */}
                  <Zero0Face
                    size="xs"
                    faceLike={{ kind: kindOf(s.entityId), title: titleForAt(s.entityId, s.startAt) }}
                    onActivate={() => onOpen(s.entityId)}
                    onActivateContextMenu={
                      onContextMenuEntity ? (ev) => onContextMenuEntity(s.entityId, ev) : undefined
                    }
                  />
                  <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                    {dur(s.durationMs)}
                    {isOpen ? " ·" : ""}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      )}
      </div>
      )}

      {/* DETAILS toggle — shows/hides just the rollup+feed; the presence dayline above
          always stays. Always rendered so it's reversible by click even when the details
          are hidden. (No § chord — §2 now toggles the whole ACTIVITY frame instead.)
          Hidden while minimized — the compact render is the bare dayline. */}
      {!minimized && (
        <div className="px-4 pb-2 pt-1.5">
          <button
            type="button"
            onClick={() => toggleZero0Readout()}
            className="text-[10px] text-muted-foreground/60 transition-colors hover:text-foreground"
            title="Show or hide the activity details"
          >
            {showDetails ? "hide details" : "show details"}
          </button>
        </div>
      )}
    </div>
  )
}
