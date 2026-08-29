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
import { Zero0DaylineCanvas, readDaylineTheme } from "./zero0-dayline-canvas"
import { buildDaylineInput } from "@/lib/dayline-adapter/build-input"
import type { DaylineTheme } from "@/packages/dayline-contract"

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
}: Zero0DaylineViewProps) {
  // 1s clock — enough for the now-marker; the engine runs its own rAF for smooth motion.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Theme resolved from Zero's CSS vars. Re-read when the color scheme flips.
  const [theme, setTheme] = useState<DaylineTheme>({})
  useEffect(() => {
    const read = () => setTheme(readDaylineTheme())
    read()
    const mo = new MutationObserver(read)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => mo.disconnect()
  }, [])

  // Snapshot rebuilt on clock tick, model change, or rail-visibility change.
  const data = useMemo(() => {
    const anchor = Date.now()
    return buildDaylineInput({
      lo: anchor - GATHER_PAST,
      hi: anchor + GATHER_FUTURE,
      now,
      rails: { planned: true, recorded: !!showSessionRail, access: !!showAccessRail },
    })
    // `now` at 1s granularity is intentional; dataRev catches model edits between ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, dataRev, showSessionRail, showAccessRail])

  // Band right-click menu (rail visibility). The axis toggle is gone — the engine owns its axis.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = () => setMenu(null)

  const callbacks = useMemo(
    () => ({
      onActivate: (id: string) => onOpen(id),
      onOccurrenceMenu: (id: string, ref: OccToken, x: number, y: number) =>
        onOccurrenceMenu?.(id, ref, synthEvent(x, y)),
      onSessionMenu: (id: string, sid: number, x: number, y: number) =>
        onSessionMenu?.(id, sid, synthEvent(x, y)),
      onOccurrenceRetime,
      onSessionRetime,
      onEmptyClick,
      onBandMenu: (x: number, y: number) => setMenu({ x, y }),
    }),
    [onOpen, onOccurrenceMenu, onSessionMenu, onOccurrenceRetime, onSessionRetime, onEmptyClick],
  )

  return (
    <div className={hideBottomBorder ? "relative" : "relative border-b border-border"}>
      <div style={{ height: minimized ? 40 : 96 }}>
        <Zero0DaylineCanvas
          data={data}
          theme={theme}
          callbacks={callbacks}
          options={{ nowRestFraction: 1 / 3 }}
          className="h-full w-full"
        />
      </div>

      {menu && (
        <BandMenu
          x={menu.x}
          y={menu.y}
          showAccessRail={!!showAccessRail}
          showSessionRail={!!showSessionRail}
          onToggleRail={onToggleRail}
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
  onClose,
}: {
  x: number
  y: number
  showAccessRail: boolean
  showSessionRail: boolean
  onToggleRail?: (rail: "access" | "session", visible: boolean) => void
  onClose: () => void
}) {
  return (
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
      </div>
    </>
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
