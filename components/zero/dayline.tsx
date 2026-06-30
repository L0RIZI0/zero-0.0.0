"use client"

import { useEffect, useMemo, useState } from "react"
import { useZeroNav } from "@/lib/zero/nav-store"
import { getTimelineOccurrences, getInheritedAccent } from "@/lib/zero/data"
import { entityInterval } from "@/lib/zero/timeline-index"
import { KIND_META } from "@/lib/zero/kinds"
import { rangeText, NOW_COLOR } from "@/lib/zero/timeline-format"
import { DAYLINE_ROW_H } from "@/lib/zero/layout"
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
// A single thin lane buckets ~one day (5am → 5am next day) and overlays EVERY
// planned occurrence from across the Individual's world onto one line. No chrome:
// no ribbon title, no nav arrows, no date label, no graduation. Not zoomable, not
// draggable. Ticks/bars highlight on hover and surface a helper (glyph + title +
// time range / recurrence rule) that opens DOWNWARD into the View below.
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

  // Recompute the window each minute so it rolls over the 5am boundary on its own.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const [winStart, winEnd] = useMemo(() => dayWindow(now), [now])

  const [hovered, setHovered] = useState<string | null>(null)

  const items = useMemo<DayItem[]>(() => {
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
  }, [rootId, winStart, winEnd, dataVersion])

  const hoveredItem = hovered ? items.find((i) => i.key === hovered) : null
  // "Now" position within the 5am→5am window (always in-range by construction).
  const nowPct = ((now - winStart) / DAY_MS) * 100

  return (
    // Constant-height header row. `pointer-events-none` lets the gaps fall through;
    // the lane + its ticks re-enable pointer events for themselves. px-5 aligns the
    // lane edges with the top bar's content (header paddingLeft/Right = 20).
    <div
      className="pointer-events-none relative z-30 flex w-full items-center px-5"
      style={{ height: DAYLINE_ROW_H }}
    >
      {/* The lane. A thin full-width strip forming the Individual's day insight. */}
      <div className="pointer-events-auto relative h-7 w-full overflow-visible rounded-md border border-border/60 bg-card/40">
        {items.map((it) => {
          const isHot = hovered === it.key
          if (it.isDuration) {
            return (
              <button
                key={it.key}
                type="button"
                aria-label={`${it.title}, ${it.range}`}
                onMouseEnter={() => setHovered(it.key)}
                onMouseLeave={() => setHovered((h) => (h === it.key ? null : h))}
                onClick={() => open(it.id)}
                className="absolute top-1/2 -translate-y-1/2 rounded-[3px] transition-[filter,height] duration-150"
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
              onClick={() => open(it.id)}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[filter,height,width] duration-150"
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
            timeline's now-marker so the live-time indicator reads identically on both. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-px -top-px z-30 w-[2px] -translate-x-1/2 rounded-full"
          style={{ left: `${nowPct}%`, backgroundColor: NOW_COLOR, boxShadow: `0 0 4px ${NOW_COLOR}` }}
        >
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
        </div>
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
