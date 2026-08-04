"use client"

import { useEffect, useState } from "react"

/**
 * Frameless-window controls for the zero0 canvas, styled to match its mono/hairline
 * language (dep-free — inline SVG glyphs, NO lucide-react, like zero0-update-indicator).
 * The desktop window is frameless on Windows/Linux (`frame:false` in main.cjs), so Zero
 * owns its chrome; these buttons drive the REAL window via the `window.zero.win` bridge
 * (min / toggle-maximize / close IPC, already handled in main.cjs).
 *
 * Renders NOTHING on the web build (no `window.zero`) and NOTHING on macOS (which keeps
 * its native traffic-lights via `titleBarStyle: "hiddenInset"`). Marked `no-drag` so the
 * buttons stay clickable inside the draggable clock band that hosts them.
 */
export function Zero0WindowControls() {
  const [show, setShow] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const zero = typeof window !== "undefined" ? window.zero : undefined
    if (!zero?.isDesktop || zero.platform === "darwin") return
    setShow(true)
    zero.win.isMaximized().then(setMaximized)
    zero.win.isFullScreen().then(setFullscreen)
    const offMax = zero.win.onMaximizeChange(setMaximized)
    const offFs = zero.win.onFullScreenChange(setFullscreen)
    return () => {
      offMax()
      offFs()
    }
  }, [])

  if (!show) return null
  const win = window.zero!.win

  return (
    <div
      className="flex items-center gap-1"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      aria-label="Window controls"
    >
      <CtrlButton
        label={fullscreen ? "Exit full screen (Esc)" : "Full screen (F11)"}
        onClick={() => win.toggleFullScreen()}
      >
        {fullscreen ? (
          <>
            <path d="M2.5 4 V2.5 H4" />
            <path d="M7 2.5 H8.5 V4" />
            <path d="M2.5 7 V8.5 H4" />
            <path d="M7 8.5 H8.5 V7" />
          </>
        ) : (
          <>
            <path d="M4 2.5 V4 H2.5" />
            <path d="M7 2.5 V4 H8.5" />
            <path d="M4 8.5 V7 H2.5" />
            <path d="M7 8.5 V7 H8.5" />
          </>
        )}
      </CtrlButton>
      <CtrlButton label="Minimize" onClick={() => win.minimize()}>
        <line x1="2.5" y1="6" x2="9.5" y2="6" />
      </CtrlButton>
      <CtrlButton label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
        {maximized ? (
          <>
            <rect x="2.5" y="3.5" width="5" height="5" />
            <path d="M4 3.5 V2.5 H8.5 V7 H7.5" />
          </>
        ) : (
          <rect x="2.5" y="2.5" width="6" height="6" />
        )}
      </CtrlButton>
      <CtrlButton label="Close" danger onClick={() => win.close()}>
        <line x1="2.5" y1="2.5" x2="8.5" y2="8.5" />
        <line x1="8.5" y1="2.5" x2="2.5" y2="8.5" />
      </CtrlButton>
    </div>
  )
}

function CtrlButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        "flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors " +
        (danger
          ? "hover:bg-destructive hover:text-destructive-foreground"
          : "hover:bg-foreground/10 hover:text-foreground")
      }
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 11 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="square"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  )
}
