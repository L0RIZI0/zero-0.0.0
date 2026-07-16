"use client"

import { useEffect, useMemo, useState } from "react"
import type React from "react"
import { ROOT_ID, collectDescendants, getEntity, getInheritedAccent } from "@/lib/zero/data"
import { isOwnOngoing } from "@/lib/zero/kinds"
import type { Entity } from "@/lib/zero/types"
import { isSleepTitle, sleepDotColor } from "@/lib/zero/sleep-sky"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"

/** How often to re-scan for ongoing entities so time-crossing spans (a Moment span that
 *  just ended, a scheduled one that just started) appear/disappear without a data mutation.
 *  Engagement toggles (focus/play) already bump `dataRev` for an instant refresh. */
const RESCAN_MS = 10000

/**
 * §4 PINS — the ONGOING band. A horizontal row of colored chips, one per entity that is
 * ongoing BY ITSELF (open engagement or a running concrete span — see `isOwnOngoing`;
 * rollup-only containers are excluded since you can't END them here). Rendered inline at
 * the very top, to the RIGHT of the live clock. Each chip is the entity's accent color and
 * carries its GLYPH (spinning) + TITLE:
 *   - CLICK the chip/title → drill INTO the entity.
 *   - CLICK the spinning GLYPH → END the ongoing entity (close its engagement, or end its
 *     running span) without navigating.
 *   - RIGHT-CLICK → the unified entity menu.
 * The whole band renders NOTHING when nothing is ongoing (empty ⇒ hidden).
 *
 * NAME: called PINS (not "pinned") as a placeholder — the eventual goal is to let the user
 * PIN an ongoing entity so its chip stays listed here even after it stops being ongoing.
 */
export function Zero0Pins({
  dataRev,
  onOpen,
  onEnd,
  onContextMenu,
}: {
  dataRev: number
  /** Chip/title click — drill INTO the entity. */
  onOpen: (id: string) => void
  /** Glyph click — END the ongoing entity (stay on canvas). */
  onEnd: (id: string) => void
  /** Right-click a chip — open the unified entity menu. */
  onContextMenu: (entity: Entity, ev: React.MouseEvent) => void
}) {
  // A coarse tick so spans that cross `now` re-evaluate even without a data mutation.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), RESCAN_MS)
    return () => clearInterval(t)
  }, [])

  const ongoing = useMemo(() => {
    const now = Date.now()
    const out: Entity[] = []
    for (const id of collectDescendants(ROOT_ID)) {
      const e = getEntity(id)
      if (e && isOwnOngoing(e, now)) out.push(e)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataRev + nowTick are the intended re-read triggers
  }, [dataRev, nowTick])

  if (ongoing.length === 0) return null

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto normal-case tracking-normal"
      aria-label="ongoing"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {ongoing.map((e) => {
        const accent =
          e.accent ?? getInheritedAccent(e.parentId) ?? (isSleepTitle(e.title) ? sleepDotColor : undefined)
        const tint = accent ?? "var(--muted-foreground)"
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
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-none text-foreground transition-colors hover:bg-foreground/5"
            style={{ borderColor: tint }}
            title={`${e.title} — click to open · click the glyph to end · right-click for menu`}
          >
            {/* GLYPH — the spinning end-button, tinted with the entity's accent. */}
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation()
                onEnd(e.id)
              }}
              className="shrink-0 transition-opacity hover:opacity-60"
              style={{ color: tint }}
              title={`End ${e.title} — stay here`}
              aria-label={`End ${e.title}`}
            >
              <Zero0Glyph kind={e.kind} ongoing filled={false} className="h-3.5 w-3.5" />
            </button>
            {/* TITLE — the chip body carries the drill-in click. */}
            <span className="max-w-[10rem] truncate">{e.title}</span>
          </div>
        )
      })}
    </div>
  )
}
