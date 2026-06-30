"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useZeroNav } from "@/lib/zero/nav-store"
import { getTimelineOccurrences, getInheritedAccent } from "@/lib/zero/data"
import { entityInterval } from "@/lib/zero/timeline-index"
import { KIND_META } from "@/lib/zero/kinds"
import { rangeText, NOW_COLOR } from "@/lib/zero/timeline-format"
import { DAYLINE_ROW_H } from "@/lib/zero/layout"
import { useNow } from "@/lib/zero/use-now"
import { cn } from "@/lib/utils"
import { NodeGlyph } from "./node-glyph"

// ============================================================================
// The DAYLINE — the Individual's at-a-glance insight on their day.
// ----------------------------------------------------------------------------
// This is NOT a region component you add to any space. It is an Individual-
// SPECIFIC piece of title chrome: the SECOND ROW of the header overlay, directly
// below the top bar (avatar+handle / date+time / version+search+logo). It is a
// constant-height row (DAYLINE_ROW_H) so the focus-window stage region below the
// header never moves as the user dives (matching the header's fixed-box rule).
//
// A single thin lane buckets ~one day (24h) and overlays EVERY planned occurrence
// from across the Individual's world onto one line. No chrome: no ribbon title, no
// nav arrows, no date label, no graduation. Ticks/bars highlight on hover and surface
// a helper (glyph + title + time range / recurrence rule) that opens DOWNWARD.
//
// PAN + AUTO-SHIFT (simple, linear, no zoom):
//   • Drag the lane left/right to pan its 24h window through time. Double-click
//     recenters on the live "now" window.
//   • The NOW marker lives its own life: it sits at the true time position within the
//     shown window and advances minute by minute, sliding off-screen when you pan away.
//   • AUTO-SHIFT: when the marker reaches the RIGHT edge *on its own* — i.e. time (not a
//     pan) carries `now` past the window end — the lane jumps forward one natural 24h
//     window, landing the marker back at the LEFT edge. Un-panned, that boundary is 5am
//     daily. A pan that pushes the marker past the edge does NOT trigger this; only a
//     time transition does.
//
// The timeline⇄dayline MORPH is intentionally NOT here yet.
// ============================================================================

const DAY_MS = 86_400_000
// The day "bucket" runs 5am→5am so a normal day (and its late-evening items)
// land inside one window instead of being split at midnight.
const DAY_START_HOUR = 5
const NEUTRAL = "oklch(0.72 0.004 75)"

/** [start,end) of the 5am→5am window containing `now`. */
function dayWindow(now: number): [number, number] {
  const d = new Date(now)
  d.setHours(DAY_START_HOUR, 0, 0, 0)
  let start = d.getTime()
  if (now < start) start -= DAY_MS // before 5am → the window opened at yesterday's 5am
  return [start, start + DAY_MS]
}

interface DayItem {
  key: string
  id: string
  kind: Parameters<typeof NodeGlyph>[0]["kind"]
  title: string
  color: string
  leftPct: number
  widthPct: number
  isDuration: boolean
  centerPct: number
  range: string
  /** Glyph fills only for completable kinds once done; otherwise it's a silhouette. */
  filled: boolean
}

export function Dayline() {
  const { stack, dataVersion, open } = useZeroNav()
  const rootId = stack[0]

  // `now` advances minute by minute and drives the NOW marker. It comes from the SHARED
  // minute clock (`useNow`) — the same source the header time reads — so the marker
  // tooltip and the header can never drift onto different minutes. It is time-dependent,
  // so SSR and the client's first paint would disagree and trip a hydration mismatch;
  // we therefore keep all time-positioned content (items, NOW marker, helper) OUT of the
  // server render: `mounted` starts false (server + first client render → identical empty
  // lane), then flips true in an effect, after which `now` drives the real content.
  const now = useNow()
  const [mounted, setMounted] = useState(false)
  // `viewStart` is the left edge of the shown 24h window. Panning moves it directly;
  // the auto-shift advances it on a time boundary. Independent of `now` so a pan never
  // drags the marker's true position and the marker never drags the window.
  const [viewStart, setViewStart] = useState(0)
  const prevNowRef = useRef(0)
  useEffect(() => {
    const n = Date.now()
    setMounted(true)
    setViewStart(dayWindow(n)[0])
    prevNowRef.current = n
  }, [])

  // AUTO-SHIFT — fires ONLY on a `now` transition (this effect depends on `now`, never
  // on `viewStart`, so panning can't trigger it). When time carries `now` across the
  // shown window's right edge on its own, jump to the natural 24h window containing
  // `now` (un-panned, that boundary is 5am daily) — landing the marker at the left edge.
  useEffect(() => {
    if (!mounted) return
    const prev = prevNowRef.current
    prevNowRef.current = now
    setViewStart((vs) => {
      const viewEnd = vs + DAY_MS
      // Crossing detected as prev<edge && now>=edge → it's time, not a pan. A pan that
      // already left `now` outside the window has no transition here, so it's ignored.
      return prev < viewEnd && now >= viewEnd ? dayWindow(now)[0] : vs
    })
  }, [now, mounted])

  const winStart = viewStart
  const winEnd = viewStart + DAY_MS

  const [hovered, setHovered] = useState<string | null>(null)
  // Hover state for the NOW marker's time tooltip (React-driven, like the chips —
  // the Tailwind `group-hover` variant isn't reliably compiled in this project).
  const [nowHover, setNowHover] = useState(false)

  const items = useMemo<DayItem[]>(() => {
    if (!mounted) return []
    const occ = getTimelineOccurrences(rootId, winStart, winEnd)
    const out: DayItem[] = []
    for (const e of occ) {
      const [st, en] = entityInterval(e)
      // One-offs are NOT range-clipped by the query, so intersect the window here.
      if (en < winStart || st > winEnd) continue
      const cs = Math.max(st, winStart)
      const ce = Math.min(en, winEnd)
      const leftPct = ((cs - winStart) / DAY_MS) * 100
      const widthPct = Math.max(0, ((ce - cs) / DAY_MS) * 100)
      const isDuration = en > st
      out.push({
        key: e.occKey,
        id: e.id,
        kind: e.kind,
        title: e.title,
        color: getInheritedAccent(e.parentId ?? "s_root") ?? NEUTRAL,
        leftPct,
        widthPct,
        isDuration,
        centerPct: leftPct + widthPct / 2,
        range: rangeText(st, en, e.schedule?.repeat),
        filled: KIND_META[e.kind].fillGlyphWhenDone && !!e.completed,
      })
    }
    // Paint durations first so the thin instant ticks sit visually on top.
    return out.sort((a, b) => Number(b.isDuration) - Number(a.isDuration))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId, winStart, winEnd, dataVersion, mounted])

  const hoveredItem = hovered ? items.find((i) => i.key === hovered) : null
  // NOW marker position within the shown window; off-screen (outside 0–100) when panned away.
  const nowPct = ((now - winStart) / DAY_MS) * 100
  const nowInView = nowPct >= 0 && nowPct <= 100

  // --- Panning (linear drag, no zoom) ---------------------------------------
  const laneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startView: number } | null>(null)
  // Set true once a drag moves past threshold; suppresses the chip click that would
  // otherwise fire on pointerup, and reset on the next pointerdown.
  const draggedRef = useRef(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      draggedRef.current = false
      dragRef.current = { startX: e.clientX, startView: viewStart }
      laneRef.current?.setPointerCapture(e.pointerId)
    },
    [viewStart],
  )
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    const lane = laneRef.current
    if (!d || !lane) return
    const w = lane.clientWidth || 1
    const dx = e.clientX - d.startX
    if (Math.abs(dx) > 3) draggedRef.current = true
    // Drag right → reveal earlier time (window slides back), and vice-versa.
    setViewStart(d.startView - (dx / w) * DAY_MS)
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null
    if (laneRef.current?.hasPointerCapture(e.pointerId)) laneRef.current.releasePointerCapture(e.pointerId)
  }, [])
  // Double-click snaps back to the live window containing now.
  const recenter = useCallback(() => setViewStart(dayWindow(Date.now())[0]), [])

  return (
    // Constant-height header row. `pointer-events-none` lets the gaps fall through;
    // the lane + its ticks re-enable pointer events for themselves. px-5 aligns the
    // lane edges with the top bar's content (header paddingLeft/Right = 20).
    <div
      className="pointer-events-none relative z-30 flex w-full items-center px-5"
      style={{ height: DAYLINE_ROW_H }}
    >
      {/* The lane. A thin full-width strip forming the Individual's day insight.
          Time-dependent content is gated on `mounted` to keep SSR == first client paint.
          Drag to pan (linear), double-click to recenter on now. `touch-action: none`
          and `select-none` keep horizontal drags from scrolling/selecting. */}
      <div
        ref={laneRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={recenter}
        className="pointer-events-auto relative h-7 w-full cursor-default select-none overflow-visible rounded-md border border-border/60 bg-card/40 [touch-action:none]"
      >
        {mounted &&
          items.map((it) => {
          const isHot = hovered === it.key
          if (it.isDuration) {
            return (
              <button
                key={it.key}
                type="button"
                aria-label={`${it.title}, ${it.range}`}
                onMouseEnter={() => setHovered(it.key)}
                onMouseLeave={() => setHovered((h) => (h === it.key ? null : h))}
                onClick={() => {
                  if (draggedRef.current) return // a pan, not a tap
                  open(it.id)
                }}
                className="absolute top-1/2 -translate-y-1/2 cursor-default rounded-[3px] transition-[filter,height] duration-150"
                style={{
                  left: `${it.leftPct}%`,
                  width: `max(3px, ${it.widthPct}%)`,
                  height: isHot ? 18 : 12,
                  backgroundColor: it.color,
                  opacity: isHot ? 0.9 : 0.42,
                  filter: isHot ? "saturate(1.4) brightness(1.1)" : "none",
                  zIndex: isHot ? 20 : 1,
                }}
              />
            )
          }
          // Instant → a thin solid vertical tick spanning the lane.
          return (
            <button
              key={it.key}
              type="button"
              aria-label={`${it.title}, ${it.range}`}
              onMouseEnter={() => setHovered(it.key)}
              onMouseLeave={() => setHovered((h) => (h === it.key ? null : h))}
              onClick={() => {
                if (draggedRef.current) return // a pan, not a tap
                open(it.id)
              }}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full transition-[filter,height,width] duration-150"
              style={{
                left: `${it.leftPct}%`,
                width: isHot ? 3 : 2,
                height: isHot ? 22 : 16,
                backgroundColor: it.color,
                filter: isHot ? "saturate(1.5) brightness(1.15)" : "none",
                zIndex: isHot ? 20 : 2,
              }}
            />
          )
        })}

        {/* NOW marker — a thin, bright-orange vertical tick (discrete but visible),
            painted above every item. A small downward cap at the top edge mirrors the
            timeline's now-marker so the live-time indicator reads identically on both.
            Gated on `mounted`: its position is time-derived, so it must not render on the
            server (would mismatch the client's clock). Also hidden when panned out of view
            (`nowInView`) so it doesn't spill past the overflow-visible lane into the header. */}
        {mounted && nowInView && (
          <div
            aria-hidden
            className="pointer-events-auto absolute -bottom-px -top-px z-30 w-[2px] -translate-x-1/2 rounded-full"
            style={{ left: `${nowPct}%`, backgroundColor: NOW_COLOR, boxShadow: `0 0 4px ${NOW_COLOR}` }}
          >
            {/* Invisible, wider hit zone so the 2px line is hoverable in practice; it
                toggles the time pill via React state. */}
            <span
              className="absolute -bottom-1 -top-1 left-1/2 w-4 -translate-x-1/2 cursor-default"
              onMouseEnter={() => setNowHover(true)}
              onMouseLeave={() => setNowHover(false)}
            />
            {/* Downward cap at the top edge. */}
            <span
              className="absolute -top-1 left-1/2 -translate-x-1/2"
              style={{
                width: 0,
                height: 0,
                borderLeft: "3px solid transparent",
                borderRight: "3px solid transparent",
                borderTop: `5px solid ${NOW_COLOR}`,
              }}
            />
            {/* Matching upward cap at the bottom edge (mirror of the top triangle). */}
            <span
              className="absolute -bottom-1 left-1/2 -translate-x-1/2"
              style={{
                width: 0,
                height: 0,
                borderLeft: "3px solid transparent",
                borderRight: "3px solid transparent",
                borderBottom: `5px solid ${NOW_COLOR}`,
              }}
            />
            {/* Live time tooltip — shown ONLY on hover of the marker, pinned to its center.
                24h format; tabular-nums keeps the digits from jittering as the minute advances. */}
            <span
              className={cn(
                "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border border-border/70 bg-card px-2 py-1 text-[10.5px] font-medium leading-none tracking-tight tabular-nums text-foreground/80 shadow-sm transition-opacity duration-150",
                nowHover ? "opacity-100" : "opacity-0",
              )}
            >
              {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
            </span>
          </div>
        )}
      </div>

      {/* HOVER HELPER — floats just below the lane (the header sits directly above,
          so there's no room to place it on top). Shows glyph + title + time range. */}
      {hoveredItem && (
        <div
          className="pointer-events-none absolute top-full z-40 flex max-w-[40vw] -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded border border-border/70 bg-card px-2 py-1 text-[10.5px] font-medium leading-none tracking-tight text-foreground/80 shadow-sm animate-in fade-in duration-150"
          style={{ left: `calc(${Math.min(94, Math.max(6, hoveredItem.centerPct))}% )`, marginTop: 4 }}
        >
          <span className="h-3 w-3 shrink-0" style={{ color: hoveredItem.color }}>
            <NodeGlyph kind={hoveredItem.kind} filled={hoveredItem.filled} strokeWidth={2} />
          </span>
          <span className="truncate text-foreground">{hoveredItem.title}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">{hoveredItem.range}</span>
        </div>
      )}
    </div>
  )
}
