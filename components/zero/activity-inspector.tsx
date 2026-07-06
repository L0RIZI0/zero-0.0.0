"use client"

import { useEffect, useState } from "react"
import { useDebugView } from "@/lib/zero/debug-view"
import {
  clearActivityLog,
  getDayRollup,
  getSegmentsForDay,
  useActivityLog,
} from "@/lib/zero/activity-log"
import { getEntity } from "@/lib/zero/data"

/**
 * Dev-only ACTIVITY inspector (STEP 1 of the Activity Tracker).
 *
 * Proves the presence engine works before we design the real dayline UI: it lists
 * today's presence segments (space · entered-at · duration) plus a per-space
 * rollup, live-ticking the current open segment every second. Toggle with `§ 3`.
 * Renders nothing in production. Reads the dedicated activity-log store — never
 * touches entity data.
 */
function titleFor(id: string): string {
  const e = getEntity(id)
  if (e) return e.title
  if (id === "s_root") return "Home"
  return id
}

function fmtDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function fmtClock(epoch: number): string {
  return new Date(epoch).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function ActivityInspector() {
  const { activity: visible } = useDebugView()
  // Structural updates (new/closed segments) come from the store; the 1s tick
  // keeps the OPEN segment's duration counting up live.
  useActivityLog()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !visible) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [visible])

  if (process.env.NODE_ENV === "production" || !visible) return null

  const segments = getSegmentsForDay(now, now)
  const rollup = getDayRollup(now, now)
  const trackedMs = rollup.reduce((sum, r) => sum + r.totalMs, 0)
  // Newest first so the current presence is at the top.
  const recent = [...segments].reverse().slice(0, 12)

  return (
    <div
      className="fixed bottom-3 right-3 z-[9999] max-h-[70vh] w-72 select-none overflow-hidden rounded-md border border-border bg-card/90 font-mono text-xs text-card-foreground shadow-lg backdrop-blur"
      role="status"
      aria-label="Activity inspector"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-bold">Activity · today</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {fmtDuration(trackedMs)} tracked
        </span>
      </div>

      {/* Per-space rollup */}
      <div className="border-b border-border px-3 py-2">
        {rollup.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">No presence recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rollup.map((r) => {
              const pct = trackedMs > 0 ? (r.totalMs / trackedMs) * 100 : 0
              return (
                <li key={r.entityId} className="flex items-center gap-2">
                  <span className="w-28 truncate" title={titleFor(r.entityId)}>
                    {titleFor(r.entityId)}
                  </span>
                  <span className="relative h-2 flex-1 overflow-hidden rounded-sm bg-muted">
                    <span
                      className="absolute inset-y-0 left-0 rounded-sm bg-foreground/70"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="w-14 text-right text-[10px] text-muted-foreground tabular-nums">
                    {fmtDuration(r.totalMs)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Recent segments (newest first) */}
      <div className="max-h-56 overflow-y-auto px-3 py-2">
        <ul className="flex flex-col gap-1">
          {recent.map((s, i) => {
            const isOpen = s.leftAt === null
            return (
              <li key={`${s.entityId}-${s.enteredAt}-${i}`} className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    isOpen ? "bg-foreground" : "bg-muted-foreground/50"
                  }`}
                  aria-hidden
                />
                <span className="w-10 text-[10px] text-muted-foreground tabular-nums">
                  {fmtClock(s.startAt)}
                </span>
                <span className="flex-1 truncate" title={titleFor(s.entityId)}>
                  {titleFor(s.entityId)}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {fmtDuration(s.durationMs)}
                  {isOpen ? " ·" : ""}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <span className="text-[10px] text-muted-foreground">{"§3 hide"}</span>
        <button
          type="button"
          onClick={() => clearActivityLog()}
          className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-card-foreground"
        >
          clear
        </button>
      </div>
    </div>
  )
}
