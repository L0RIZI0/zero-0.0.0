"use client"

import { useEffect, useMemo, useState } from "react"
import type React from "react"
import { ROOT_ID, collectDescendants, getEntity, getInheritedAccent, getStarterPinnedEntities } from "@/lib/zero/data"
import { isOwnOngoing } from "@/lib/zero/kinds"
import type { Entity } from "@/lib/zero/types"
import { isSleepTitle, sleepDotColor } from "@/lib/zero/sleep-sky"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import { cn } from "@/lib/utils"

/** How often to re-scan for ongoing entities so time-crossing spans (a Moment span that
 *  just ended, a scheduled one that just started) appear/disappear without a data mutation.
 *  Engagement toggles (focus/play) already bump `dataRev` for an instant refresh. */
const RESCAN_MS = 10000

/**
 * §4 PINS — the ONGOING + PINNED band. A horizontal row of colored chips. Membership is the
 * UNION of two sets:
 *   - OWN-ONGOING entities (open engagement or a running concrete span — see `isOwnOngoing`;
 *     rollup-only containers are excluded since you can't END them here), and
 *   - PINNED entities (`getStarterPinnedEntities`, toggled by the entity menu's Pin/Unpin) —
 *     these STAY listed even when NOT ongoing, so a pinned chip lingers after it stops.
 * Pinned chips come first (in pin order) and read as "stuck" (subtle filled bg); transient
 * ongoing-but-unpinned chips follow. Each chip is the entity's accent color + GLYPH + TITLE:
 *   - CLICK the chip/title → drill INTO the entity.
 *   - CLICK the GLYPH → ongoing ⇒ END it (stop); idle (pinned) ⇒ START it (play). Stays here.
 *   - RIGHT-CLICK → the unified entity menu (Pin / Unpin at the top).
 * By default the band renders NOTHING when the union is empty (⇒ hidden), appearing on its
 * own the moment something starts or is pinned. The `forceShow` flag (the §4 keybinding)
 * force-reveals the frame even while EMPTY, showing a muted placeholder.
 */
export function Zero0Pins({
  dataRev,
  forceShow = false,
  onOpen,
  onEnd,
  onStart,
  onContextMenu,
}: {
  dataRev: number
  /** §4 override — reveal the (otherwise auto-hidden) EMPTY band. */
  forceShow?: boolean
  /** Chip/title click — drill INTO the entity. */
  onOpen: (id: string) => void
  /** Glyph click on an ONGOING chip — END it (stay on canvas). */
  onEnd: (id: string) => void
  /** Glyph click on an IDLE pinned chip — START it (play engagement; stay on canvas). */
  onStart: (id: string) => void
  /** Right-click a chip — open the unified entity menu. */
  onContextMenu: (entity: Entity, ev: React.MouseEvent) => void
}) {
  // A coarse tick so spans that cross `now` re-evaluate even without a data mutation.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), RESCAN_MS)
    return () => clearInterval(t)
  }, [])

  // The chip list = PINNED (in pin order) ∪ own-ONGOING (unpinned, appended after). Each
  // item carries its live `ongoing` + `pinned` flags for rendering.
  const items = useMemo(() => {
    const now = Date.now()
    const pinned = getStarterPinnedEntities()
    const pinnedIds = new Set(pinned.map((e) => e.id))
    const out: { entity: Entity; ongoing: boolean; pinned: boolean }[] = pinned.map((e) => ({
      entity: e,
      ongoing: isOwnOngoing(e, now),
      pinned: true,
    }))
    for (const id of collectDescendants(ROOT_ID)) {
      if (pinnedIds.has(id)) continue
      const e = getEntity(id)
      if (e && isOwnOngoing(e, now)) out.push({ entity: e, ongoing: true, pinned: false })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataRev + nowTick are the intended re-read triggers
  }, [dataRev, nowTick])

  // Empty: hidden by default, but §4 (`forceShow`) reveals the frame with a muted hint so
  // you can confirm the band exists / is toggled on even with nothing pinned or ongoing.
  if (items.length === 0) {
    if (!forceShow) return null
    return (
      <div
        className="flex shrink-0 items-center gap-1.5 border-b border-border px-4 py-2 text-[11px] italic text-muted-foreground/60"
        aria-label="pinned and ongoing entities"
      >
        nothing pinned or ongoing
      </div>
    )
  }

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-4 py-2"
      aria-label="pinned and ongoing entities"
    >
      {items.map(({ entity: e, ongoing, pinned }) => {
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
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-none text-foreground transition-colors hover:bg-foreground/5",
              // A PINNED chip reads as "stuck" with a subtle filled bg; a transient
              // ongoing-only chip is outline-only.
              pinned && "bg-foreground/[0.06]",
            )}
            style={{ borderColor: tint }}
            title={`${e.title} — click to open · click the glyph to ${ongoing ? "end" : "start"} · right-click for menu`}
          >
            {/* GLYPH — spins while ongoing; the button STARTS (idle) or ENDS (ongoing). */}
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation()
                if (ongoing) onEnd(e.id)
                else onStart(e.id)
              }}
              className="shrink-0 transition-opacity hover:opacity-60"
              style={{ color: tint }}
              title={ongoing ? `End ${e.title} — stay here` : `Start ${e.title} — stay here`}
              aria-label={ongoing ? `End ${e.title}` : `Start ${e.title}`}
            >
              <Zero0Glyph kind={e.kind} ongoing={ongoing} filled={false} className="h-3.5 w-3.5" />
            </button>
            {/* TITLE — the chip body carries the drill-in click. */}
            <span className="max-w-[10rem] truncate">{e.title}</span>
          </div>
        )
      })}
    </div>
  )
}
