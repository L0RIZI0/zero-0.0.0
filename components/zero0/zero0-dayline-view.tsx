"use client"

// ─────────────────────────────────────────────────────────────────────────────
// ZERO0 DAYLINE VIEW — the CANVAS dayline (v0.2.348).
//
// This replaces the legacy DOM dayline (linear + .347 fisheye) as the ONE main
// dayline. It maps the agenda mount's props onto the neutral engine contract:
//
//   Zero model ──buildDaylineInput──▶ DaylineData ──▶ Zero0DaylineCanvas ──▶ engine
//        ▲                                                     │
//        └──────────────── intent callbacks ◀─────────────────┘
//
// The engine (`@/lib/dayline`, authored externally against @zero/dayline-contract)
// owns ALL view geometry — axis, warp/fisheye, sun, pan, labels. Zero owns the
// model and every commit. There is no longer a linear/fisheye toggle here: the
// engine owns its own axis, so `onToggleAxis`/`horizon` are gone.
//
// NOTE: the compact ACCESS tracker (Zero0Dayline tracks="access") is a different
// widget and still uses the legacy renderer — out of scope for the canvas dayline.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Zero0DaylineCanvas, readDaylineTheme } from "./zero0-dayline-canvas"
import { buildDaylineInput } from "@/lib/dayline-adapter/build-input"
import { useActivityRevision } from "@/lib/zero/activity-log"
import type { DaylineTheme } from "@/packages/dayline-contract"
import { useShowMenu } from "./zero0-menu-context"
import type { MenuItem as MenuModelItem } from "@/lib/zero/menu-model"

// The occurrence dispatch token is opaque at this seam (contract `OccRef = unknown`) — Zero only ever
// echoes it back to its own handlers. Typed `any` here so the agenda's `DaylineOccRef`-typed handlers
// slot in without function-parameter variance friction; the real shape lives in Zero's model.
type OccToken = any

// The minimal shape the agenda's menu handlers actually read off their event. `any`-compatible so a real
// React.MouseEvent also satisfies it, and cheap to synthesize from the engine's screen coordinates.
type MenuEvent = { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void }
const synthEvent = (x: number, y: number): MenuEvent => ({
  clientX: x,
  clientY: y,
  preventDefault: () => {},
  stopPropagation: () => {},
})

const DAY = 86_400_000
/** How much history/future to feed the engine. The engine pans far past this; this is only the mark
 *  gather window, kept small (Zero caps lenses at ~240 anyway). */
const GATHER_PAST = 45 * DAY
const GATHER_FUTURE = 400 * DAY

// Dayline band height (px), drag-resizable from the bottom edge and persisted per uzer. The engine
// re-lays-out to whatever height its canvas gets (ResizeObserver → handle.resize), so a taller band
// simply shows more of the sun arc + rails.
const HEIGHT_KEY = "zero0.dayline.height"
const MIN_H = 72
const MAX_H = 420
const DEFAULT_H = 96

// Sky curves (@zero/dayline v0.4.0): the engine draws a sun arc (default on) and now an optional moon
// arc (default off), chosen via DaylineData.sky. Persisted per-user like the band height, and surfaced
// as toggles in the band's existing right-click menu.
const SKY_KEY = "zero0.dayline.sky"

// Sky-bleed (@zero/dayline v0.7.7): extra transparent canvas pixels BELOW the band into which only the
// sun/moon curves draw. The AGENDA passes this so, when §1 sits directly beneath the dayline, the curves
// bleed behind the §1 header. MUST match the negative margin the canvas applies to the AGENDA frame so
// the frame below slides up by exactly this much. Mount-time only (the engine can't change it live).
export const AGENDA_SKY_BLEED_PX = 72

export interface Zero0DaylineViewProps {
  onOpen: (entityId: string) => void
  // The agenda's menu handlers take a (synthetic) mouse event and read clientX/clientY off it — matching
  // the legacy DOM dayline. The engine gives us plain screen coords, so the view synthesizes an event.
  // `ev` typed loosely: the agenda passes handlers expecting a full React.MouseEvent, but they only read
  // clientX/clientY/preventDefault — exactly what `synthEvent` supplies. `any` avoids event-type variance.
  onOccurrenceMenu?: (entityId: string, occRef: OccToken, ev: any) => void
  onSessionMenu?: (entityId: string, sessionAnchorId: number, ev: any) => void
  onOccurrenceRetime?: (entityId: string, occRef: OccToken, start: number, end: number) => void
  onSessionRetime?: (entityId: string, sessionAnchorId: number, start: number, end: number) => void
  onEmptyClick?: (centerTime: number) => void
  /** Bumped by the store on every model change; forces a fresh snapshot. */
  dataRev?: number
  minimized?: boolean
  hideBottomBorder?: boolean
  showAccessRail?: boolean
  showSessionRail?: boolean
  onToggleRail?: (rail: "access" | "session", visible: boolean) => void
  /** Extra transparent canvas pixels below the band for sun/moon bleed (v0.7.7). The band's flow height
   *  stays `bandH`; the canvas box is `bandH + skyBleedPx` and the excess overlays whatever is below. */
  skyBleedPx?: number
}

export function Zero0DaylineView({
  onOpen,
  onOccurrenceMenu,
  onSessionMenu,
  onOccurrenceRetime,
  onSessionRetime,
  onEmptyClick,
  dataRev,
  minimized,
  hideBottomBorder,
  showAccessRail,
  showSessionRail,
  onToggleRail,
  skyBleedPx = 0,
}: Zero0DaylineViewProps) {
  // NOTE: no React clock tick. The engine advances its own now-marker (wall clock, see mount.ts), so a
  // per-second rebuild here is both unnecessary and harmful — it called handle.update() every second,
  // and the engine's loadData() rebuilds all events, wiping any in-progress drag (the snap-back bug).

  // Theme resolved from Zero's CSS vars. Re-read when the color scheme flips.
  const [theme, setTheme] = useState<DaylineTheme>({})
  useEffect(() => {
    const read = () => setTheme(readDaylineTheme())
    read()
    const mo = new MutationObserver(read)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => mo.disconnect()
  }, [])

  // The access rail is fed by the activity log, which mutates on navigation WITHOUT bumping `dataRev`
  // (that tracks the schedule/occurrence model). Subscribe to the activity revision so the access rail
  // reflects focus moves live. It's cheap; it only meaningfully changes output while access is on.
  const activityRev = useActivityRevision()

  // Sky curve visibility, persisted. Sun defaults ON, moon OFF — mirroring the engine's own defaults, so
  // a fresh user sees exactly today's dayline. Declared BEFORE the data snapshot below because that memo
  // reads `sky`. Feeds DaylineData.sky; the engine draws/omits each curve accordingly.
  const [sky, setSky] = useState<{ sun: boolean; moon: boolean }>(() => {
    if (typeof window === "undefined") return { sun: true, moon: false }
    try {
      const raw = window.localStorage.getItem(SKY_KEY)
      if (raw) {
        const p = JSON.parse(raw) as { sun?: boolean; moon?: boolean }
        return { sun: p.sun !== false, moon: !!p.moon }
      }
    } catch {
      /* private-mode Safari or malformed value — fall through to defaults */
    }
    return { sun: true, moon: false }
  })
  const toggleSky = (which: "sun" | "moon") =>
    setSky((s) => {
      const next = { ...s, [which]: !s[which] }
      try {
        window.localStorage.setItem(SKY_KEY, JSON.stringify(next))
      } catch {
        /* keep the in-memory value */
      }
      return next
    })

  // Snapshot rebuilt ONLY on model change (dataRev), activity change (access rail), or rail toggle —
  // never on a clock tick. Because the model is stable during a drag, no update() fires mid-drag, so the
  // engine keeps the dragged chip; on drop, the retime persists and a single update() reflects it.
  const data = useMemo(() => {
    const anchor = Date.now()
    return buildDaylineInput({
      lo: anchor - GATHER_PAST,
      hi: anchor + GATHER_FUTURE,
      now: anchor,
      rails: { planned: true, recorded: !!showSessionRail, access: !!showAccessRail },
      sky,
    })
    // `accessRev` only forces a rebuild while access is on (0 otherwise, so it's inert when off).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataRev, showSessionRail, showAccessRail, showAccessRail ? activityRev : 0, sky.sun, sky.moon])

  // Drag-resizable band height, read lazily from localStorage so it's correct on first paint.
  const [height, setHeight] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_H
    const raw = Number(window.localStorage.getItem(HEIGHT_KEY))
    return Number.isFinite(raw) && raw >= MIN_H && raw <= MAX_H ? raw : DEFAULT_H
  })
  // `pendingH` tracks the live drag value in a ref so persistence at pointerup never reads a stale
  // committed height (React may not have flushed the last setHeight yet on a fast drag).
  const pendingHRef = useRef(height)
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null)
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { startY: e.clientY, startH: pendingHRef.current }
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* no active pointer (synthetic) — capture is optional, the drag still tracks via move */
    }
  }
  const onResizeMove = (e: React.PointerEvent) => {
    const r = resizeRef.current
    if (!r) return
    const next = Math.max(MIN_H, Math.min(MAX_H, r.startH + (e.clientY - r.startY)))
    pendingHRef.current = next
    setHeight(next)
  }
  const onResizeUp = () => {
    if (!resizeRef.current) return
    resizeRef.current = null
    try {
      window.localStorage.setItem(HEIGHT_KEY, String(pendingHRef.current))
    } catch {
      /* private-mode Safari — keep the in-memory value */
    }
  }
  const bandH = minimized ? 40 : height
  // No bleed while minimized (the band is a thin strip with no room, and there's nothing to reveal).
  const bleed = minimized ? 0 : skyBleedPx

  // Band right-click menu (rail + sky visibility). The axis toggle is gone — the engine owns its axis.
  // Prefer the canvas's shared `showMenu` (DOM popup normally, NATIVE overlay when a web Resource is up,
  // so it never crops behind the WebView2 content layer). `menu`/`closeMenu` are only the fallback for
  // when this view is rendered outside the MenuProvider (no `showMenu`).
  const showMenu = useShowMenu()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = () => setMenu(null)

  const openBandMenu = (x: number, y: number) => {
    const items: MenuModelItem[] = [
      { type: "header", label: "Show" },
      // Rail rows CLOSE on toggle (single flip is the common case); sky rows keepOpen so both curves
      // can be flipped in one pass. All four show a leading ✓ reflecting current state.
      { type: "item", id: "rail:session", label: "Session rail", checkmark: !!showSessionRail },
      { type: "item", id: "rail:access", label: "Access rail", checkmark: !!showAccessRail },
      { type: "divider" },
      { type: "header", label: "Sky" },
      { type: "item", id: "sky:sun", label: "Sun", checkmark: sky.sun, keepOpen: true },
      { type: "item", id: "sky:moon", label: "Moon", checkmark: sky.moon, keepOpen: true },
    ]
    const onSelect = (id: string) => {
      if (id === "rail:session") onToggleRail?.("session", !showSessionRail)
      else if (id === "rail:access") onToggleRail?.("access", !showAccessRail)
      else if (id === "sky:sun") toggleSky("sun")
      else if (id === "sky:moon") toggleSky("moon")
    }
    if (showMenu) showMenu(items, x, y, onSelect)
    else setMenu({ x, y }) // no provider → local DOM fallback below
  }

  // The engine reads `cbRef.current` at call time (see zero0-dayline-canvas), so rebuilding this each
  // render is harmless and keeps `openBandMenu` closing over fresh rail/sky state.
  const callbacks = {
    onActivate: (id: string) => onOpen(id),
    onOccurrenceMenu: (id: string, ref: OccToken, x: number, y: number) =>
      onOccurrenceMenu?.(id, ref, synthEvent(x, y)),
    onSessionMenu: (id: string, sid: number, x: number, y: number) => onSessionMenu?.(id, sid, synthEvent(x, y)),
    onOccurrenceRetime,
    onSessionRetime,
    onEmptyClick,
    onBandMenu: (x: number, y: number) => openBandMenu(x, y),
  }

  return (
    <div
      className={hideBottomBorder ? "relative" : "relative border-b border-border"}
      // Stop a right-click inside the dayline from bubbling to the agenda <section>'s onContextMenu
      // ("Minimize the frame"). The engine already handled it via its own native listener (firing the
      // occurrence / session / band menu) — this just prevents the frame menu from racing it.
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* The canvas BOX is `bandH + bleed` tall so the engine gets an alpha canvas with room to draw the
          sun/moon strokes below the band. A matching NEGATIVE bottom margin means the parent flow still
          reserves only `bandH`, so the sibling below slides up under the transparent bleed. The bleed is
          non-interactive (`pointer-events-none`) so clicks/hovers pass through to whatever sits beneath;
          the engine's own hit-testing uses `height - skyBleedPx`, so the band area still responds. Bleed
          is disabled while minimized (no room, and the band collapses to a thin strip). */}
      <div
        className="pointer-events-none"
        style={{
          height: bandH + bleed,
          marginBottom: bleed ? -bleed : undefined,
        }}
      >
        <div className="pointer-events-auto h-full w-full">
          <Zero0DaylineCanvas
            data={data}
            theme={theme}
            callbacks={callbacks}
            options={{ nowRestFraction: 1 / 3, skyBleedPx: bleed }}
            className="h-full w-full"
          />
        </div>
      </div>
      {!minimized && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize dayline height"
          title="Drag to resize"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          // `bottom-0` sits at the BAND edge: the positioned ancestor is only `bandH` tall (the bleed box
          // carries a negative margin), so the canvas bleed spills BELOW this container. The grab strip
          // lands over the band's bottom edge (above §1, which starts exactly at that edge), so resizing
          // works. z-10 keeps it above the static canvas within this frame's stacking context.
          className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize hover:bg-accent/40"
        />
      )}

      {menu && (
        <BandMenu
          x={menu.x}
          y={menu.y}
          showAccessRail={!!showAccessRail}
          showSessionRail={!!showSessionRail}
          onToggleRail={onToggleRail}
          showSun={sky.sun}
          showMoon={sky.moon}
          onToggleSky={toggleSky}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}

/** Minimal portable rail-visibility menu shown on band right-click. Fixed to the viewport at the click. */
function BandMenu({
  x,
  y,
  showAccessRail,
  showSessionRail,
  onToggleRail,
  showSun,
  showMoon,
  onToggleSky,
  onClose,
}: {
  x: number
  y: number
  showAccessRail: boolean
  showSessionRail: boolean
  onToggleRail?: (rail: "access" | "session", visible: boolean) => void
  showSun: boolean
  showMoon: boolean
  onToggleSky: (which: "sun" | "moon") => void
  onClose: () => void
}) {
  // PORTAL TO <body>: the menu is rendered from inside the AGENDA frame, whose stacking context is
  // `z-0`, while §1 is a sibling `z-10` context. Because a stacking context is atomic, the menu's own
  // `fixed z-50` cannot rise above §1 from in there — so any part overlapping §1 gets sampled by §1's
  // `backdrop-blur-xs` and comes out frosted (the reported bug). Portaling to <body> lifts the menu to
  // the ROOT stacking context, where it paints AFTER §1 and is never part of §1's backdrop.
  if (typeof document === "undefined") return null
  return createPortal(
    <>
      {/* Dismiss layer. `data-zero-menu` mirrors the legacy tag so global dismiss logic ignores it. */}
      <div className="fixed inset-0 z-40" data-zero-menu onPointerDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        data-zero-menu
        className="fixed z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        style={{ left: x, top: y }}
      >
        <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Show</p>
        <MenuItem
          checked={showSessionRail}
          label="Session rail"
          onClick={() => {
            onToggleRail?.("session", !showSessionRail)
            onClose()
          }}
        />
        <MenuItem
          checked={showAccessRail}
          label="Access rail"
          onClick={() => {
            onToggleRail?.("access", !showAccessRail)
            onClose()
          }}
        />
        <div className="my-1 h-px bg-border" />
        <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Sky</p>
        {/* Sky toggles leave the menu OPEN (no onClose) so both curves can be flipped in one pass. */}
        <MenuItem checked={showSun} label="Sun" onClick={() => onToggleSky("sun")} />
        <MenuItem checked={showMoon} label="Moon" onClick={() => onToggleSky("moon")} />
      </div>
    </>,
    document.body,
  )
}

function MenuItem({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
    >
      <span className="inline-flex h-3 w-3 items-center justify-center">{checked ? "✓" : ""}</span>
      {label}
    </button>
  )
}
