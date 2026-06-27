"use client"

import { useRef } from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import {
  DAY_COUNT,
  HOUR_AXIS_W,
  ATLAS_HEADER_H,
  HOUR_MARKS,
  MORPH_S,
  MORPH_EASE_OUT,
  atlasGeom,
  startOfDay,
  firstDayFor,
  type MorphPair,
  type MorphRect,
} from "@/lib/zero/timeline-morph"
import type { Entity } from "@/lib/zero/types"

const DAY_MS = 86_400_000

/** "1 PM" / "12 AM" — compact 12-hour axis labels. */
function fmtHour(h: number): string {
  const period = h < 12 ? "AM" : "PM"
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr} ${period}`
}

/** Motion transform style for a rect (x/y as transforms — cheaper than left/top). */
function rectStyle(r: MorphRect) {
  return { x: r.x, y: r.y, width: Math.max(0, r.w), height: Math.max(0, r.h) }
}

/**
 * THIS WEEK — a true day-column calendar AND the morph between the linear Lifelane
 * and that calendar, rendered as ONE layer (no separate overlay).
 *
 * Every morphable element (day column, hour graduation, column title, event chip)
 * is positioned by its geometry pair: it flies from its LIFELANE rect (`pair.lane`)
 * to its ATLAS rect (`pair.atlas`) — or back — so a day's horizontal span visibly
 * ROTATES into its vertical column while chips slide from their linear slot into the
 * day/time grid. The same elements that morph are the ones that stay, so there is no
 * cross-fade and no hand-off to a duplicate tree.
 *
 *   `atlas`    = TARGET state. Entering → animate to `pair.atlas`; leaving → `pair.lane`.
 *   `morphing` = whether to animate the flight (MORPH_S) or sit instantly (pan/zoom).
 *
 * Atlas-only CHROME (opaque background, hour-axis labels, fine hourly gridlines,
 * today tint, now-line, header underline) doesn't morph geometrically — it just
 * fades in/out with `atlas`, so it appears once the columns have formed.
 */
export function TimelineWeek({
  pairs,
  atlas,
  morphing,
  now,
  centerMs,
  width,
  viewHeightPx,
  onPanDays,
  onOpen,
  onMenu,
}: {
  pairs: MorphPair[]
  atlas: boolean
  morphing: boolean
  now: number
  centerMs: number
  width: number
  viewHeightPx: number
  onPanDays: (deltaDays: number) => void
  onOpen: (id: string) => void
  onMenu: (e: React.MouseEvent, entity: Entity) => void
}) {
  const today0 = startOfDay(now)
  const firstDay = firstDayFor(centerMs)
  const { colW, bodyTop, bodyH, colX } = atlasGeom(width, viewHeightPx)
  const transition = { duration: morphing ? MORPH_S : 0, ease: MORPH_EASE_OUT }

  // --- Drag-to-pan ----------------------------------------------------------
  // Dragging the grid horizontally pans the visible window by whole days: each time
  // the pointer crosses one column-width we step `onPanDays(±1)`. `panGuard` blocks
  // the click that follows a pan so a pan-drag starting on a chip doesn't open it.
  const drag = useRef<{ x0: number; colW: number; lastStep: number; panned: boolean } | null>(null)
  const panGuard = useRef(false)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const w = e.currentTarget.clientWidth
    const cw = Math.max(1, (w - HOUR_AXIS_W) / DAY_COUNT)
    drag.current = { x0: e.clientX, colW: cw, lastStep: 0, panned: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x0
    // Drag RIGHT (dx > 0) reveals EARLIER days, so the center moves back (negative).
    const step = Math.trunc(-dx / d.colW)
    if (step !== d.lastStep) {
      onPanDays(step - d.lastStep)
      d.lastStep = step
      d.panned = true
    }
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    const wasPanned = drag.current?.panned ?? false
    drag.current = null
    if (wasPanned) {
      panGuard.current = true
      setTimeout(() => (panGuard.current = false), 0)
    }
  }

  // Now-line: vertical position of "now" within today's column (null if off-window).
  const todayIdx = Math.round((today0 - firstDay) / DAY_MS)
  const nowOnGrid = todayIdx >= 0 && todayIdx < DAY_COUNT ? (now - today0) / DAY_MS : null

  return (
    <div
      className="absolute inset-0 touch-none select-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{ cursor: "grab" }}
    >
      {/* ATLAS-ONLY CHROME — opaque background + fine gridlines + axis + today tint +
          now-line + header underline. Fades in once the columns have formed. */}
      <motion.div
        className="pointer-events-none absolute inset-0"
        initial={false}
        animate={{ opacity: atlas ? 1 : 0 }}
        transition={transition}
        aria-hidden
      >
        <div className="absolute inset-0 bg-background" />
        {/* Header underline. */}
        <div className="absolute inset-x-0 border-b border-border" style={{ top: 0, height: ATLAS_HEADER_H }} />
        {/* Hour-axis labels in the left gutter. */}
        {HOUR_MARKS.map((h) => (
          <span
            key={`ax-${h}`}
            className="absolute -translate-y-1/2 text-right text-[9px] font-medium tabular-nums text-muted-foreground/50"
            style={{ right: width - HOUR_AXIS_W + 6, top: bodyTop + (h / 24) * bodyH }}
          >
            {fmtHour(h)}
          </span>
        ))}
        {Array.from({ length: DAY_COUNT }, (_, i) => {
          const ds = firstDay + i * DAY_MS
          const isToday = ds === today0
          return (
            <div key={`col-chrome-${ds}`}>
              {/* Today column tint. */}
              {isToday && (
                <div
                  className="absolute bg-foreground/[0.03]"
                  style={{ left: colX(i), top: bodyTop, width: colW, height: bodyH }}
                />
              )}
              {/* Fine hourly gridlines (the non-mark hours; marks are morph elements). */}
              {Array.from({ length: 23 }, (_, k) => k + 1)
                .filter((h) => !HOUR_MARKS.includes(h))
                .map((h) => (
                  <div
                    key={`gl-${ds}-${h}`}
                    className="absolute h-px bg-border/15"
                    style={{ left: colX(i), top: bodyTop + (h / 24) * bodyH, width: colW }}
                  />
                ))}
            </div>
          )
        })}
        {/* Now-line across today's column. */}
        {nowOnGrid != null && (
          <div
            className="absolute z-20 h-px bg-foreground/70"
            style={{ left: colX(todayIdx), top: bodyTop + nowOnGrid * bodyH, width: colW }}
          >
            <span className="absolute -top-2 left-0.5 text-[7px] font-semibold uppercase tracking-wide text-foreground/70">
              now
            </span>
          </div>
        )}
      </motion.div>

      {/* MORPH ELEMENTS — each flies between its Lifelane and Atlas rect. */}
      {pairs.map((p) => {
        const target = atlas ? p.atlas : p.lane
        if (p.kind === "chip") {
          return (
            <motion.button
              key={p.key}
              type="button"
              initial={rectStyle(p.lane)}
              animate={rectStyle(target)}
              transition={transition}
              onClick={() => {
                if (panGuard.current) return
                if (p.entity) onOpen(p.entity.id)
              }}
              onContextMenu={(ev) => p.entity && onMenu(ev, p.entity)}
              title={p.title}
              className={cn(
                "absolute left-0 top-0 z-10 flex items-center gap-1 overflow-hidden rounded-[4px] px-1.5",
                "text-left text-[10px] leading-tight tracking-tight text-foreground/85 transition-[filter] hover:brightness-110",
                !p.isInstant && "border",
              )}
              style={{
                borderColor: p.isInstant ? undefined : p.color ? `${p.color}59` : "var(--border)",
                backgroundColor: p.isInstant ? undefined : p.color ? `${p.color}26` : "var(--secondary)",
                opacity: p.dim ?? 1,
              }}
            >
              {p.isInstant && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
              )}
              <span className={cn("truncate font-medium", p.cancelled && "line-through")}>{p.title}</span>
            </motion.button>
          )
        }
        if (p.kind === "title") {
          const ds = Number(p.key.split(":")[1])
          const isToday = ds === today0
          return (
            <motion.div
              key={p.key}
              className="pointer-events-none absolute left-0 top-0 flex items-center justify-center"
              initial={rectStyle(p.lane)}
              animate={rectStyle(target)}
              transition={transition}
              aria-hidden
            >
              <span
                className={cn(
                  "truncate rounded px-1.5 py-0.5 text-[9.5px] font-semibold tabular-nums tracking-wide",
                  isToday ? "bg-foreground text-background" : "text-muted-foreground/70",
                )}
              >
                {p.title}
              </span>
            </motion.div>
          )
        }
        // cell + hour graduation
        return (
          <motion.div
            key={p.key}
            className={cn(
              "pointer-events-none absolute left-0 top-0",
              p.kind === "cell" ? "border-l border-border/30 bg-foreground/[0.02]" : "bg-border/40",
            )}
            initial={rectStyle(p.lane)}
            animate={rectStyle(target)}
            transition={transition}
            aria-hidden
          />
        )
      })}
    </div>
  )
}
