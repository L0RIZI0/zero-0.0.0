"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type React from "react"
import { getInheritedAccent, getStarterPinnedEntities, getOwnOngoingEntities, getRecentlyMarkedInstants, getRecentlyEndedEntities } from "@/lib/zero/data"
 import { isOwnOngoing, getOpenSession, concreteStart, effectiveEndAt } from "@/lib/zero/kinds"
import { getFaceModel } from "@/lib/zero/face-model"
import { webLabel } from "@/lib/zero/web-resources"
import type { Entity } from "@/lib/zero/types"
import { isSleepTitle, sleepDotColor } from "@/lib/zero/sleep-sky"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import { Zero0Frame } from "@/components/zero0/zero0-frame"

/** Tick cadence. 1s so each chip's live timer (elapsed / countdown) advances smoothly AND
 *  so time-crossing spans (a Moment that just ended or just started) appear/disappear without
 *  a data mutation. The scanned set is tiny (ongoing ∪ pinned), so a 1s re-scan is cheap.
 *  Session toggles (focus/play) also bump `dataRev` for an instant refresh. */
const TICK_MS = 1000

/** FLIP move animation duration + easing — deliberately GENEROUS so a chip sliding between
 *  the pinned and ongoing lists reads as a smooth, noticeable trip, not a snap. */
const FLIP_MS = 480
const FLIP_EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

/** §4 chip enter/exit fade duration — MUST match the `.zero0-chip-out` CSS animation so a
 *  leaving chip is unmounted exactly when its fade-out finishes. */
const CHIP_FADE_MS = 1200

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
 *   - no known end (an open session, or an open-ended running span) ⇒ ELAPSED so far,
 *     counting UP from whichever "since" anchor applies (the open session's punch-in if
 *     there is one, else the concrete span start).
 * Returns null when there's nothing sensible to show.
 */
function ongoingTimer(e: Entity, now: number): { text: string; countdown: boolean } | null {
  const end = effectiveEndAt(e)
  if (end != null && end > now) {
    return { text: `-${formatTimer(end - now)}`, countdown: true }
  }
  // v0.6.32: the ONGOING timer tracks the PLAY (ongoing) session — not a `focus` presence session,
  // which can now be open concurrently (e.g. on a done task you're viewing) without meaning ongoing.
  const open = getOpenSession(e, "play")
  const since = open?.startedAt ?? concreteStart(e)
  if (since != null && now > since) {
    return { text: formatTimer(now - since), countdown: false }
  }
  return null
}

type PinItem = {
  entity: Entity
  ongoing: boolean
  pinned: boolean
  focused: boolean
  timer: { text: string; countdown: boolean } | null
  /** Which §4 list this chip renders in — drives the split (and keeps a fading-out chip on the
   *  side it was on when it left). */
  side: "pinned" | "ongoing"
  /** A NOTIFICATION chip — the universal transient acknowledgement that lingers on the ongoing
   *  side after an entity STOPPED being ongoing (10s) or an INSTANT was marked (30s), before
   *  fading away. Its glyph is NON-interactive and reflects the entity's ACTUAL state (it flashes
   *  filled on entry + pulses gently); only the chip body opens the entity. Shows `notifyText`
   *  (a frozen final duration, or "Ns ago") instead of a live timer. */
  notify?: boolean
  /** The muted trailing text on a notification chip — the just-ended session's final duration,
   *  or "Ns ago" for a marked instant. Only set when `notify`. */
  notifyText?: string
}

/**
 * Dep-free FLIP: animates chips as they change layout position between renders — most
 * importantly when a chip is REPARENTED from the pinned list to the ongoing list (or back),
 * which React does as an unmount+remount. We key stored positions by ENTITY ID (not DOM node),
 * so the move survives the reparent: measure last position → after commit measure the new
 * position → invert with a transform → play back to zero with a transition. Position-only
 * (translate) on a WRAPPER element, so each chip keeps its own bg/border color transitions.
 */
function useFlipRow(sig: string) {
  const nodes = useRef(new Map<string, HTMLElement>())
  const cbs = useRef(new Map<string, (el: HTMLElement | null) => void>())
  const prevRects = useRef(new Map<string, DOMRect>())
  const prevSig = useRef<string | null>(null)

  useLayoutEffect(() => {
    // ONLY react to STRUCTURAL layout changes — a chip crossing lists, or the order/membership
    // shifting (that's exactly what `sig` encodes). Pure re-renders (the 1s timer tick, a focus
    // change) leave `sig` unchanged, so we bail out. This is the fix for the "chip bounces right
    // a little every second, decaying" bug: previously this effect ran on EVERY render and, when
    // a tick landed while a move's CSS transition was still settling, `getBoundingClientRect()`
    // returned the mid-flight (interpolated) position, which got stored as the new baseline and
    // then re-animated as a residual on the next tick — a self-feeding decaying oscillation.
    if (sig === prevSig.current) return
    const firstRun = prevSig.current === null
    prevSig.current = sig

    const prev = prevRects.current
    const next = new Map<string, DOMRect>()
    nodes.current.forEach((node, id) => {
      // Clear any in-flight transform/transition FIRST so we measure the true settled LAST
      // position (not a mid-animation one). An interrupted move still animates smoothly below,
      // re-inverting from its stored FIRST rect.
      node.style.transition = "none"
      node.style.transform = ""
      const nb = node.getBoundingClientRect()
      next.set(id, nb)
      const ob = prev.get(id)
      if (!firstRun && ob) {
        const dx = ob.left - nb.left
        const dy = ob.top - nb.top
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
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
 *       · pinned-IDLE   → START an session AND focus it.
 *   - ALT/⌘/CTRL-CLICK the chip body → START in the BACKGROUND (parallel; stay on the current
 *     canvas). No-op if it's already ongoing. (Alt is the safe modifier — ⌘/Ctrl+click is a
 *     right-click on some platforms; we accept all three.)
 *   - CLICK the GLYPH → ongoing ��� STOP it; idle ⇒ START in the background. Stays here.
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
  /** START an session on the entity. `focus` ⇒ ALSO navigate the canvas onto it (a plain
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
      side: on ? "ongoing" : "pinned",
    })
    // NOTIFICATION CHIPS — the universal transient band on the ONGOING side. Two feeders, both
    // lingering: (a) any entity that JUST STOPPED being ongoing (10s), showing its FROZEN final
    // session duration; (b) a RECENTLY-MARKED instant (30s), showing "Ns ago". These are read
    // FIRST so the pinned/ongoing passes can defer to them: a recently-ended entity — pinned OR
    // not — becomes a notification chip during its linger, then transitions to its resting place.
    const ended = getRecentlyEndedEntities(now) // [{entity, endedAt, lastMs}]
    const marked = getRecentlyMarkedInstants(now) // [{entity, markedAt}]
    const notifyIds = new Set<string>([...ended.map((x) => x.entity.id), ...marked.map((x) => x.entity.id)])

    const pinnedIdle: PinItem[] = []
    const ongoing: PinItem[] = []
    // PINNED pass: ongoing ⇒ ongoing side; recently-ended/marked ⇒ DEFER to the notify pass
    // (so a pinned entity MORPHS into a notification chip in place, THEN slides to the pins —
    // it never leaves the memo, so the move is a pure FLIP slide with NO fade); else ⇒ pinned.
    for (const e of pinned) {
      if (isOwnOngoing(e, now)) ongoing.push(mk(e, true, true))
      else if (notifyIds.has(e.id)) continue // notify pass places it
      else pinnedIdle.push(mk(e, false, true))
    }
    for (const e of getOwnOngoingEntities(now)) {
      if (pinnedIds.has(e.id)) continue // already handled in the pinned pass
      ongoing.push(mk(e, true, false))
    }
    // Dedupe the notify pass against anything already ONGOING (a recently-ended entity is not
    // ongoing, so this only guards against odd overlaps).
    const shownIds = new Set(ongoing.map((i) => i.entity.id))
    const pushNotify = (e: Entity, notifyText: string) => {
      if (shownIds.has(e.id)) return
      shownIds.add(e.id)
      ongoing.push({
        entity: e,
        ongoing: false,
        pinned: pinnedIds.has(e.id),
        focused: e.id === focusId,
        timer: null,
        side: "ongoing",
        notify: true,
        notifyText,
      })
    }
    // (a) recently STOPPED — FROZEN final session duration (never a `now`-relative string, so it
    //     can't flicker to "00s" as the chip fades).
    for (const { entity: e, lastMs } of ended) pushNotify(e, formatTimer(lastMs))
    // (b) recently-MARKED instants — "Ns ago" since the latest occurrence.
    for (const { entity: e, markedAt } of marked) {
      pushNotify(e, `${Math.max(0, Math.floor((now - markedAt) / 1000))}s ago`)
    }
    return { pinnedIdle, ongoing }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataRev + nowTick are the intended re-read triggers
  }, [dataRev, nowTick, focusId])

  // The FLIP signature = the ORDERED ids in each list (with a `|` list boundary). It changes
  // ONLY on a structural layout change (a chip crossing lists, reorder, or membership change) —
  // NOT on the 1s timer tick or a focus change — so FLIP fires exactly when a chip should slide.
  // ── PRESENCE (enter/exit fade) ──────────────────────────────────────────────────────────
  // Keep a chip mounted for CHIP_FADE_MS after it leaves the computed set, so it can fade OUT
  // (a bare unmount would just pop). Entering chips fade IN via the `.zero0-chip-in` class on
  // mount. We snapshot each item by id so a leaving chip still renders (with its last-known
  // side/label) while it fades. A chip that reappears mid-fade is revived (its timer cancelled).
  const snapshots = useRef(new Map<string, PinItem>())
  const prevIds = useRef<Set<string>>(new Set())
  const leaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [leaving, setLeaving] = useState<PinItem[]>([])
  const memoSig =
    pinnedIdle.map((i) => i.entity.id).join(",") + "|" + ongoing.map((i) => i.entity.id).join(",")

  useEffect(() => {
    const current = [...pinnedIdle, ...ongoing]
    const currentIds = new Set(current.map((i) => i.entity.id))
    for (const it of current) snapshots.current.set(it.entity.id, it)
    // Revive any currently-fading chip that came back.
    let revived = false
    currentIds.forEach((id) => {
      const t = leaveTimers.current.get(id)
      if (t) {
        clearTimeout(t)
        leaveTimers.current.delete(id)
        revived = true
      }
    })
    if (revived) setLeaving((prev) => prev.filter((li) => !currentIds.has(li.entity.id)))
    // Newly gone (present last render, absent now) → start fading + schedule unmount.
    const gone: PinItem[] = []
    prevIds.current.forEach((id) => {
      if (!currentIds.has(id) && !leaveTimers.current.has(id)) {
        const snap = snapshots.current.get(id)
        if (snap) {
          gone.push(snap)
          const timer = setTimeout(() => {
            leaveTimers.current.delete(id)
            snapshots.current.delete(id)
            setLeaving((cur) => cur.filter((x) => x.entity.id !== id))
          }, CHIP_FADE_MS)
          leaveTimers.current.set(id, timer)
        }
      }
    })
    if (gone.length) setLeaving((cur) => [...cur, ...gone])
    prevIds.current = currentIds
    // eslint-disable-next-line react-hooks/exhaustive-deps -- memoSig captures the membership change
  }, [memoSig])

  // Clear any pending fade timers on unmount.
  useEffect(() => () => leaveTimers.current.forEach((t) => clearTimeout(t)), [])

  // Merge present chips with the fading-out ones, each staying on the side it left from.
  const leavingIds = new Set(leaving.map((i) => i.entity.id))
  const pinnedRender = [
    ...pinnedIdle,
    ...leaving.filter((i) => i.side === "pinned" && !pinnedIdle.some((p) => p.entity.id === i.entity.id)),
  ]
  const ongoingRender = [
    ...ongoing,
    ...leaving.filter((i) => i.side === "ongoing" && !ongoing.some((o) => o.entity.id === i.entity.id)),
  ]

  const layoutSig =
    pinnedRender.map((i) => i.entity.id).join(",") + "|" + ongoingRender.map((i) => i.entity.id).join(",")
  const setNode = useFlipRow(layoutSig)

  // Present (excluding fading-out) vs everything rendered (incl. leaving chips).
  const presentTotal = pinnedIdle.length + ongoing.length
  const total = pinnedRender.length + ongoingRender.length
  // The FRAME is open whenever something is present, or §4 forces the empty hint. When it goes
  // false the frame plays its close sequence (below) while any leaving chips fade inside it.
  const visible = presentTotal > 0 || forceShow
  // Show the muted empty hint only when truly empty (nothing present AND nothing still fading).
  const showHint = total === 0 && forceShow

  const renderChip = (item: PinItem) => (
    <div
      key={item.entity.id}
      ref={setNode(item.entity.id)}
      className={"shrink-0 " + (leavingIds.has(item.entity.id) ? "zero0-chip-out" : "zero0-chip-in")}
      style={{ willChange: "transform" }}
    >
      <PinChip item={item} onOpen={onOpen} onEnd={onEnd} onStart={onStart} onContextMenu={onContextMenu} />
    </div>
  )

  // The §4 band SHOWS/HIDES with the SAME unified 0.8s frame animation as every other § frame
  // (height + fade together — see <Zero0Frame>). `visible` opens it whenever something is
  // present (or §4 forces the empty hint). Individual chips ENTERING/LEAVING a shown frame keep
  // their own 1.2s per-chip fade (`.zero0-chip-in/out`); the frame move is orthogonal.
  return (
    <Zero0Frame open={visible} className="shrink-0">
      {showHint ? (
        <div
          className="flex shrink-0 items-center gap-1.5 border-b border-border px-4 py-2 text-[11px] italic text-muted-foreground/60"
          aria-label="pinned and ongoing entities"
        >
          nothing pinned or ongoing
        </div>
      ) : (
        <div
          className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-4 py-2"
          aria-label="pinned and ongoing entities"
        >
          {pinnedRender.map(renderChip)}
          {/* DIVIDER — a full-height hairline separating the pinned list from the ongoing
              list. Only when BOTH sides exist. `-my-2` cancels the band's py-2 so it spans
              the whole frame height, edge to edge. */}
          {pinnedRender.length > 0 && ongoingRender.length > 0 && (
            <div className="-my-2 w-px shrink-0 self-stretch bg-border" aria-hidden />
          )}
          {/* ONGOING label — far LEFT of the ongoing list (pinned-idle chips to its left).
              Shown only when something is ongoing; otherwise the band is just the pins. */}
          {ongoingRender.length > 0 && (
            <span className="shrink-0 select-none px-1 text-[10px] font-medium uppercase tracking-wider tabular-nums text-muted-foreground/70">
              ongoing
            </span>
          )}
          {ongoingRender.map(renderChip)}
        </div>
      )}
    </Zero0Frame>
  )
}

/** The label shown ON a §4 chip. A WEB RESOURCE uses its concise DISPLAYED title CROPPED to the same
 *  width as ENTITY CONTENT (`webLabel().display`, {@link WEB_TITLE_MAX_LEN} chars) — so a chip reads
 *  "v0 by Vercel -…" rather than the full fetched `<title>` or the raw `https://www.v0.app` (a
 *  curated human name stays full). The CSS `truncate` remains a secondary width guard. Everything
 *  else uses the entity's own `title`. */
function chipLabel(e: Entity): string {
  return e.webUrl
    ? webLabel({ webUrl: e.webUrl, webResourceId: e.webResourceId, webTitle: e.webTitle, title: e.title }).display
    : e.title
}

/** The FULL (uncropped) label for a chip's hover tooltip / aria — so hovering still reveals the
 *  whole web title even though the visible chip is cropped, exactly like ENTITY CONTENT. */
function chipFullLabel(e: Entity): string {
  return e.webUrl
    ? webLabel({ webUrl: e.webUrl, webResourceId: e.webResourceId, webTitle: e.webTitle, title: e.title }).full
    : e.title
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
  const { entity: e, ongoing, focused, timer, notify, notifyText } = item
  const label = chipLabel(e) // cropped — what's shown on the chip
  const fullLabel = chipFullLabel(e) // uncropped — for the hover tooltip
  const accent = e.accent ?? getInheritedAccent(e.parentId) ?? (isSleepTitle(e.title) ? sleepDotColor : undefined)
  const tint = accent ?? "var(--muted-foreground)"
  // GLYPH readability (v0.2.147) — an accent picked for its HUE can sit too close to the
  // background lightness (a dark purple on dark mode, a pale color on light mode), so the small
  // animated glyph nearly vanishes. Nudge ONLY the glyph color toward `--foreground` (theme-aware:
  // near-white in dark, near-black in light) via an oklab mix — this LIFTS a dark accent and DARKENS
  // a light one while keeping its hue, "just enough" to read. The border + bg wash keep the pure
  // accent (they read fine as a thin line / faint fill). No adjustment when there's no accent (the
  // muted-foreground default is already legible).
  const glyphTint = accent ? `color-mix(in oklab, ${accent} 62%, var(--foreground))` : tint
  // Faint accent WASH behind every chip; a touch STRONGER when FOCUSED (the entity that IS the
  // current canvas context — the one you're drilled into), so it reads as "the one you're in"
  // without shouting. Deliberately gentle — no ring.
  const fillPct = focused ? 26 : 10
  // FLASH-ON-ENTRY — when this chip BECOMES a notification (an ongoing entity stopped, or an
  // instant was marked), bump a counter so the glyph flashes filled once ("state just switched").
  // `prevNotify` starts false so a chip that mounts already-notifying (e.g. a fresh mark) flashes
  // on its first commit too.
  const [flashN, setFlashN] = useState(0)
  const prevNotify = useRef(false)
  useEffect(() => {
    if (notify && !prevNotify.current) setFlashN((n) => n + 1)
    prevNotify.current = !!notify
  }, [notify])
  // Plain body click: ongoing ⇒ just focus; idle ⇒ start AND focus. Any modifier ⇒ start in
  // the background (parallel), staying put; skip if already ongoing.
  const bodyClick = (ev: React.MouseEvent | React.KeyboardEvent) => {
    // A NOTIFICATION chip (stopped/marked) is not interactive beyond opening — body click drills in.
    if (notify) {
      onOpen(e.id)
      return
    }
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
        notify
          ? `${fullLabel} — just happened · click to open · right-click for menu`
          : ongoing
            ? `${fullLabel} — click to focus · alt-click to start another in parallel · glyph to stop · right-click for menu`
            : `${fullLabel} — click to start & focus · alt-click to start in background · glyph to start in background · right-click for menu`
      }
    >
      {/* GLYPH — a NOTIFICATION chip's glyph reflects the entity's ACTUAL state (filled when
          complete/closed, checked when done, barred when cancelled), flashes filled once on entry,
          and pulses gently while it lingers. For a startable kind (moment/space/task/…) it is
          INTERACTIVE during the linger — clicking RESUMES the entity (starts it in the background),
          which lifts it back into the ongoing list. An instant's mark glyph stays static (a past
          occurrence isn't resumable). Otherwise (live chip) the glyph spins while ongoing and
          STOPS (ongoing) / STARTS in the background (idle). */}
      {notify ? (
        <NotifyChipGlyph e={e} tint={glyphTint} flashN={flashN} onStart={onStart} />
      ) : (
        <MarkableChipGlyph e={e} tint={glyphTint} ongoing={ongoing} onEnd={onEnd} onStart={onStart} />
      )}
      {/* TITLE — the chip body carries the drill-in click. Web resources show their concise
          displayed title (see chipLabel) rather than the raw URL. */}
      <span className="max-w-[10rem] truncate">{label}</span>
      {/* LIVE TIMER (ongoing) — elapsed-so-far or countdown, ticking each second. Muted +
          tabular so the chip width never jitters. A NOTIFICATION chip instead shows its frozen
          final duration (a stopped session) or "Ns ago" (a marked instant). */}
      {notify ? (
        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground" title="just happened">
          {notifyText}
        </span>
      ) : (
        timer && (
          <span
            className="shrink-0 tabular-nums text-[10px] text-muted-foreground"
            title={timer.countdown ? "time remaining" : "elapsed so far"}
          >
            {timer.text}
          </span>
        )
      )}
    </div>
  )
}

/** The glyph inside a §4 NOTIFICATION chip. Always reflects the entity's ACTUAL state (via
 *  getFaceModel), FLASHES filled once on entry (`flashN`), and PULSES gently while it lingers.
 *  For a startable kind it is a BUTTON that RESUMES the entity (starts it in the background) —
 *  clicking lifts it back into the ongoing list; an instant (a past occurrence) is static. */
function NotifyChipGlyph({
  e,
  tint,
  flashN,
  onStart,
}: {
  e: Entity
  tint: string
  flashN: number
  onStart: (id: string, focus: boolean) => void
}) {
  const gm = getFaceModel(e, Date.now())
  const glyph = (
    <Zero0Glyph
      kind={e.kind}
      filled={gm.filled}
      done={gm.done}
      cancelled={gm.cancelled}
      requested={gm.requested}
      flashFill={flashN}
      pulse
      className="h-3.5 w-3.5"
    />
  )
  // Instants aren't resumable (a mark is a finished point) — render a static, non-interactive glyph.
  if (e.kind === "instant") {
    return (
      <span className="shrink-0" style={{ color: tint }} aria-hidden="true">
        {glyph}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation()
        onStart(e.id, false)
      }}
        className="shrink-0 transition-opacity hover:opacity-60"
        style={{ color: tint }}
        title={`Resume ${chipFullLabel(e)} in background`}
        aria-label={`Resume ${chipFullLabel(e)} in background`}
    >
      {glyph}
    </button>
  )
}

/** The glyph BUTTON inside a §4 ongoing/idle chip — STOPS (ongoing) or STARTS in the background
 *  (idle) on click; never navigates. (Mark chips render a static filled glyph instead — a past
 *  occurrence is not interactive.) */
function MarkableChipGlyph({
  e,
  tint,
  ongoing,
  onEnd,
  onStart,
}: {
  e: Entity
  tint: string
  ongoing: boolean
  onEnd: (id: string) => void
  onStart: (id: string, focus: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation()
        if (ongoing) onEnd(e.id)
        else onStart(e.id, false)
      }}
        className="shrink-0 transition-opacity hover:opacity-60"
        style={{ color: tint }}
        title={ongoing ? `Stop ${chipFullLabel(e)}` : `Start ${chipFullLabel(e)} in background`}
        aria-label={ongoing ? `Stop ${chipFullLabel(e)}` : `Start ${chipFullLabel(e)} in background`}
    >
      <Zero0Glyph kind={e.kind} ongoing={ongoing} filled={false} className="h-3.5 w-3.5" />
    </button>
  )
}
