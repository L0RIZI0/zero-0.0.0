"use client"

import { useEffect, useState } from "react"
import { Minus, Square, Copy, X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * In-app window controls for the frameless desktop shell. Zero owns its chrome,
 * so on Windows/Linux there's no native title bar — these buttons drive the real
 * window via the `window.zero.win` bridge. They render ONLY inside the desktop app
 * and NOT on macOS (which keeps its native traffic-lights top-left), so the web
 * build and Mac are untouched. Marked no-drag so clicks aren't eaten by the
 * draggable header region.
 */
export function WindowControls() {
  const [show, setShow] = useState(false)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const zero = typeof window !== "undefined" ? window.zero : undefined
    if (!zero?.isDesktop || zero.platform === "darwin") return
    setShow(true)
    zero.win.isMaximized().then(setMaximized)
    return zero.win.onMaximizeChange(setMaximized)
  }, [])

  if (!show) return null

  const win = window.zero!.win

  return (
    <div
      // Stacked just above the logo, right-aligned to its edge, so the logo stays
      // flush with the window edge. Hidden by default; fades in when the corner
      // (the parent `group`) is hovered, or while a control has focus.
      className="absolute bottom-full right-0 mb-0.5 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      aria-label="Window controls"
    >
      <ControlButton label="Minimize" onClick={() => win.minimize()}>
        <Minus className="h-2.5 w-2.5" />
      </ControlButton>
      <ControlButton label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
        {maximized ? <Copy className="h-2 w-2 -scale-x-100" /> : <Square className="h-2 w-2" />}
      </ControlButton>
      <ControlButton label="Close" danger onClick={() => win.close()}>
        <X className="h-2.5 w-2.5" />
      </ControlButton>
    </div>
  )
}

function ControlButton({
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
      className={cn(
        "flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors",
        danger
          ? "hover:bg-destructive hover:text-destructive-foreground"
          : "hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
