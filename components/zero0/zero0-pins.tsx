"use client"

import { useEffect, useMemo, useState } from "react"
import type React from "react"
import { getInheritedAccent, getStarterPinnedEntities, getOwnOngoingEntities } from "@/lib/zero/data"
import { isOwnOngoing, getOpenEngagement, concreteStart, effectiveEndAt } from "@/lib/zero/kinds"
import { formatDuration } from "@/lib/zero/face-model"
import type { Entity } from "@/lib/zero/types"
import { isSleepTitle, sleepDotColor } from "@/lib/zero/sleep-sky"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import { cn } from "@/lib/utils"

/** Tick cadence. 1s so each chip's live timer (elapsed / countdown) advances smoothly AND
 *  so time-crossing spans (a Moment that just ended or just started) appear/disappear without
 *  a data mutation. The scanned set is tiny (ongoing ∪ pinned), so a 1s re-scan is cheap.
 *  Engagement toggles (focus/play) also bump `dataRev` for an instant refresh. */
const TICK_MS = 1000

/**
 * The live timer shown on an ONGOING chip. Two flavors, mirroring how the entity is ongoing:
 *   - a KNOWN end (declared `endAt`, or a concrete start + duration) ⇒ COUNTDOWN "-Nm Ss"
 *     (time remaining until it ends), so a timed span reads like a stopwatch winding down.
 *   - no known end (an open engagement, or an open-ended running span) ⇒ ELAPSED so far,
 *     counting UP from whichever "since" anchor applies (the open engagement's punch-in if
 *     there is one, else the concrete span start).
 * Returns null when there's nothing sensible to show.
 */
function ongoingTimer(e: Entity, now: number): { text: string; countdown: boolean } | null {
  const end = effectiveEndAt(e)
  if (end != null && end > now) {
    return { text: `-${formatDuration(end - now)}`, countdown: true }
  }
  const open = getOpenEngagement(e)
  const since = open?.startAt ?? concreteStart(e)
  if (since != null && now > since) {
    return { text: formatDuration(now - since), countdown: false }
  }
  return null
}

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
  // A 1s tick driving both the live per-chip timer and re-scans across `now`.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [])

  // The chip list = PINNED (in pin order) ∪ own-ONGOING (unpinned, appended after). Each
  // item carries its live `ongoing` + `pinned` flags plus a live `timer` label.
  const items = useMemo(() => {
    const now = Date.now()
    const pinned = getStarterPinnedEntities()
    const pinnedIds = new Set(pinned.map((e) => e.id))
    const mk = (e: Entity, ongoing: boolean, isPinned: boolean) => ({
      entity: e,
      ongoing,
      pinned: isPinned,
      timer: ongoing ? ongoingTimer(e, now) : null,
    })
    const out = pinned.map((e) => mk(e, isOwnOngoing(e, now), true))
    for (const e of getOwnOngoingEntities(now)) {
      if (pinnedIds.has(e.id)) continue // already covered by the pinned pass
      out.push(mk(e, true, false))
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
      {items.map(({ entity: e, ongoing, pinned, timer }) => {
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
            {/* LIVE TIMER — elapsed-so-far (counts up) or countdown-to-end ("-…"), ticking
                each second. Muted + tabular so digits don't jitter the chip width. */}
            {timer && (
              <span
                className="shrink-0 tabular-nums text-[10px] text-muted-foreground"
                title={timer.countdown ? "time remaining" : "elapsed so far"}
              >
                {timer.text}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
