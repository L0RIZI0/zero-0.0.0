"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type React from "react"
import { getInheritedAccent, getStarterPinnedEntities, getOwnOngoingEntities } from "@/lib/zero/data"
import { isOwnOngoing, getOpenEngagement, concreteStart, effectiveEndAt } from "@/lib/zero/kinds"
import type { Entity } from "@/lib/zero/types"
import { isSleepTitle, sleepDotColor } from "@/lib/zero/sleep-sky"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"

/** Tick cadence. 1s so each chip's live timer (elapsed / countdown) advances smoothly AND
 *  so time-crossing spans (a Moment that just ended or just started) appear/disappear without
 *  a data mutation. The scanned set is tiny (ongoing ∪ pinned), so a 1s re-scan is cheap.
 *  Engagement toggles (focus/play) also bump `dataRev` for an instant refresh. */
const TICK_MS = 1000

/** FLIP move animation duration + easing — deliberately GENEROUS so a chip sliding between
 *  the pinned and ongoing lists reads as a smooth, noticeable trip, not a snap. */
const FLIP_MS = 480
const FLIP_EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

const pad2 = (n: number) => String(n).padStart(2, "0")

/**
 * Live-timer duration format for a chip. UNLIKE the shared `formatDuration` (which trims a
 * trailing `0s`, so a ticking clock jumps `2h 4m 59s → 2h 5m → 2h 5m 1s`), this ALWAYS keeps
 * the seconds slot AND zero-pads every non-day unit to 2 digits — so within a tier the string
 * is a CONSTANT character count and the chip never changes width as it ticks (`00s`→`59s`,
 * `05m 00s`→`05m 59s`). Only crossing a tier boundary (→ a new leading unit, e.g. `59m 59s`
 * → `01h 00m 00s`) changes width, which is rare and gets smoothed by the FLIP row animation.
 * At day-scale seconds stop mattering, so it drops to `Nd HHh MMm`. Negative clamps to 0.
 */
function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600) % 24
  const d = Math.floor(total / 86400)
  if (d > 0) return `${d}d ${pad2(h)}h ${pad2(m)}m`
  if (h > 0) return `${pad2(h)}h ${pad2(m)}m ${pad2(s)}s`
  if (m > 0) return `${pad2(m)}m ${pad2(s)}s`
  return `${pad2(s)}s`
}

/**
 * The live timer shown on an ONGOING chip. Two flavors, mirroring how the entity is ongoing:
 *   - a KNOWN end (declared `endAt`, or a concrete start + duration) ⇒ COUNTDOWN "-MMm SSs"
 *     (time remaining until it ends), so a timed span reads like a stopwatch winding down.
 *   - no known end (an open engagement, or an open-ended running span) ⇒ ELAPSED so far,
 *     counting UP from whichever "since" anchor applies (the open engagement's punch-in if
 *     there is one, else the concrete span start).
 * Returns null when there's nothing sensible to show.
 */
function ongoingTimer(e: Entity, now: number): { text: string; countdown: boolean } | null {
  const end = effectiveEndAt(e)
  if (end != null && end > now) {
    return { text: `-${formatTimer(end - now)}`, countdown: true }
  }
  const open = getOpenEngagement(e)
  const since = open?.startAt ?? concreteStart(e)
  if (since != null && now > since) {
    return { text: formatTimer(now - since), countdown: false }
  }
  return null
}

type PinItem = { entity: Entity; ongoing: boolean; pinned: boolean; focused: boolean; timer: { text: string; countdown: boolean } | null }

/**
 * Dep-free FLIP: animates chips as they change layout position between renders — most
 * importantly when a chip is REPARENTED from the pinned list to the ongoing list (or back),
 * which React does as an unmount+remount. We key stored positions by ENTITY ID (not DOM node),
 * so the move survives the reparent: measure last position → after commit measure the new
 * position → invert with a transform → play back to zero with a transition. Position-only
 * (translate) on a WRAPPER element, so each chip keeps its own bg/border color transitions.
 */
function useFlipRow(revision: unknown) {
  const nodes = useRef(new Map<string, HTMLElement>())
  const cbs = useRef(new Map<string, (el: HTMLElement | null) => void>())
  const prevRects = useRef(new Map<string, DOMRect>())

  useLayoutEffect(() => {
    const prev = prevRects.current
    const next = new Map<string, DOMRect>()
    nodes.current.forEach((node, id) => {
      const nb = node.getBoundingClientRect()
      next.set(id, nb)
      const ob = prev.get(id)
      if (ob) {
        const dx = ob.left - nb.left
        const dy = ob.top - nb.top
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          node.style.transition = "none"
          node.style.transform = `translate(${dx}px, ${dy}px)`
          // Force a reflow so the browser registers the inverted start position…
          void node.getBoundingClientRect()
          requestAnimationFrame(() => {
            node.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`
            node.style.transform = ""
          })
        }
      }
    })
    prevRects.current = next
  })

  const setNode = (id: string) => {
    let cb = cbs.current.get(id)
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        if (el) nodes.current.set(id, el)
        else nodes.current.delete(id)
      }
      cbs.current.set(id, cb)
    }
    return cb
  }

  // `revision` is only here to make the linter happy that the effect re-reads on data change;
  // useLayoutEffect already runs after every render.
  void revision
  return setNode
}

/**
 * §4 PINS — the PINNED + ONGOING band, split into TWO horizontal lists around an `ONGOING`
 * label:
 *   [ pinned-but-idle chips ]   ONGOING   [ ongoing chips ]
 * Left of the label: entities the user PINNED (menu Pin/Unpin) that are NOT currently ongoing
 * — they linger here as quick-start shortcuts. Right of the label: everything OWN-ongoing
 * (`isOwnOngoing`; pinned-and-ongoing counts as ongoing and sits on the right). A chip that
 * starts/stops crosses the label and is FLIP-animated between the two lists (see `useFlipRow`).
 * Each chip = accent color + GLYPH + TITLE + (when ongoing) a live TIMER. Interaction:
 *   - CLICK the chip body:
 *       · ONGOING       → FOCUS it (navigate the canvas onto it).
 *       · pinned-IDLE   → START an engagement AND focus it.
 *   - ALT/⌘/CTRL-CLICK the chip body → START in the BACKGROUND (parallel; stay on the current
 *     canvas). No-op if it's already ongoing. (Alt is the safe modifier — ⌘/Ctrl+click is a
 *     right-click on some platforms; we accept all three.)
 *   - CLICK the GLYPH → ongoing ⇒ STOP it; idle ⇒ START in the background. Stays here.
 *   - RIGHT-CLICK → the unified entity menu (Pin / Unpin at the top).
 * The band renders NOTHING when both lists are empty (⇒ hidden), unless `forceShow` (the §4
 * keybinding) reveals the empty frame with a muted placeholder.
 */
export function Zero0Pins({
  dataRev,
  focusId,
  forceShow = false,
  onOpen,
  onEnd,
  onStart,
  onContextMenu,
}: {
  dataRev: number
  /** The current canvas context (the entity you're drilled into). Its chip reads as FOCUSED
   *  — a hot fill + ring — so the thing you're actually looking at stands out in the band. */
  focusId?: string
  /** §4 override — reveal the (otherwise auto-hidden) EMPTY band. */
  forceShow?: boolean
  /** Focus the canvas ON the entity (navigate) without starting anything. Used by a plain
   *  click on an already-ONGOING chip. */
  onOpen: (id: string) => void
  /** Glyph click on an ONGOING chip — END it (stay on canvas). */
  onEnd: (id: string) => void
  /** START an engagement on the entity. `focus` ⇒ ALSO navigate the canvas onto it (a plain
   *  click on a pinned-idle chip); `focus:false` ⇒ start in the BACKGROUND, staying on the
   *  current canvas (the glyph on an idle chip, or an Alt/modifier click on any chip). */
  onStart: (id: string, focus: boolean) => void
  /** Right-click a chip — open the unified entity menu. */
  onContextMenu: (entity: Entity, ev: React.MouseEvent) => void
}) {
  // A 1s tick driving both the live per-chip timer and re-scans across `now`.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [])

  // Split into the two lists. PINNED-idle (left) in pin order; ONGOING (right) with any
  // pinned-and-ongoing first (pin order), then unpinned ongoing.
  const { pinnedIdle, ongoing } = useMemo(() => {
    const now = Date.now()
    const pinned = getStarterPinnedEntities()
    const pinnedIds = new Set(pinned.map((e) => e.id))
    const mk = (e: Entity, on: boolean, isPinned: boolean): PinItem => ({
      entity: e,
      ongoing: on,
      pinned: isPinned,
      focused: e.id === focusId,
      timer: on ? ongoingTimer(e, now) : null,
    })
    const pinnedIdle: PinItem[] = []
    const ongoing: PinItem[] = []
    for (const e of pinned) {
      const on = isOwnOngoing(e, now)
      ;(on ? ongoing : pinnedIdle).push(mk(e, on, true))
    }
    for (const e of getOwnOngoingEntities(now)) {
      if (pinnedIds.has(e.id)) continue // already handled in the pinned pass
      ongoing.push(mk(e, true, false))
    }
    return { pinnedIdle, ongoing }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataRev + nowTick are the intended re-read triggers
  }, [dataRev, nowTick, focusId])

  const setNode = useFlipRow(dataRev + nowTick)

  const total = pinnedIdle.length + ongoing.length

  // Empty: hidden by default, but §4 (`forceShow`) reveals the frame with a muted hint.
  if (total === 0) {
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

  const renderChip = (item: PinItem) => (
    <div key={item.entity.id} ref={setNode(item.entity.id)} className="shrink-0" style={{ willChange: "transform" }}>
      <PinChip item={item} onOpen={onOpen} onEnd={onEnd} onStart={onStart} onContextMenu={onContextMenu} />
    </div>
  )

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-4 py-2"
      aria-label="pinned and ongoing entities"
    >
      {pinnedIdle.map(renderChip)}
      {/* ONGOING label — sits at the far LEFT of the ongoing list (pinned-idle chips to its
          left). Shown only when something is ongoing; otherwise the band is just the pins. */}
      {ongoing.length > 0 && (
        <span className="shrink-0 select-none px-1 text-[10px] font-medium uppercase tracking-wider tabular-nums text-muted-foreground/70">
          ongoing
        </span>
      )}
      {ongoing.map(renderChip)}
    </div>
  )
}

/** A single §4 chip. Split out so both lists render it identically (and so the FLIP wrapper
 *  can own the transform while the chip owns its color transitions). */
function PinChip({
  item,
  onOpen,
  onEnd,
  onStart,
  onContextMenu,
}: {
  item: PinItem
  onOpen: (id: string) => void
  onEnd: (id: string) => void
  onStart: (id: string, focus: boolean) => void
  onContextMenu: (entity: Entity, ev: React.MouseEvent) => void
}) {
  const { entity: e, ongoing, focused, timer } = item
  const accent = e.accent ?? getInheritedAccent(e.parentId) ?? (isSleepTitle(e.title) ? sleepDotColor : undefined)
  const tint = accent ?? "var(--muted-foreground)"
  // Faint accent WASH behind every chip; a touch STRONGER when FOCUSED (the entity that IS the
  // current canvas context — the one you're drilled into), so it reads as "the one you're in"
  // without shouting. Deliberately gentle — no ring.
  const fillPct = focused ? 26 : 10
  // Plain body click: ongoing ⇒ just focus; idle ⇒ start AND focus. Any modifier ⇒ start in
  // the background (parallel), staying put; skip if already ongoing.
  const bodyClick = (ev: React.MouseEvent | React.KeyboardEvent) => {
    if ("altKey" in ev && (ev.altKey || ev.metaKey || ev.ctrlKey)) {
      if (!ongoing) onStart(e.id, false)
      return
    }
    if (ongoing) onOpen(e.id)
    else onStart(e.id, true)
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={bodyClick}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault()
          bodyClick(ev)
        }
      }}
      onContextMenu={(ev) => {
        ev.preventDefault()
        onContextMenu(e, ev)
      }}
      className="flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-none text-foreground transition-[background-color,border-color]"
      style={{
        borderColor: tint,
        backgroundColor: `color-mix(in oklab, ${tint} ${fillPct}%, transparent)`,
      }}
      title={
        ongoing
          ? `${e.title} — click to focus · alt-click to start another in parallel · glyph to stop · right-click for menu`
          : `${e.title} — click to start & focus · alt-click to start in background · glyph to start in background · right-click for menu`
      }
    >
      {/* GLYPH — spins while ongoing; the button STOPS (ongoing) or STARTS in the background
          (idle). Never navigates. */}
      <button
        type="button"
        onClick={(ev) => {
          ev.stopPropagation()
          if (ongoing) onEnd(e.id)
          else onStart(e.id, false)
        }}
        className="shrink-0 transition-opacity hover:opacity-60"
        style={{ color: tint }}
        title={ongoing ? `Stop ${e.title}` : `Start ${e.title} in background`}
        aria-label={ongoing ? `Stop ${e.title}` : `Start ${e.title} in background`}
      >
        <Zero0Glyph kind={e.kind} ongoing={ongoing} filled={false} className="h-3.5 w-3.5" />
      </button>
      {/* TITLE — the chip body carries the drill-in click. */}
      <span className="max-w-[10rem] truncate">{e.title}</span>
      {/* LIVE TIMER — elapsed-so-far (counts up) or countdown-to-end ("-…"), ticking each
          second. Muted + tabular + zero-padded so the chip width never jitters. */}
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
}
