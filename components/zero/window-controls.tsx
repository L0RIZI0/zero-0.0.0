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
      className="flex items-center gap-0.5"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      aria-label="Window controls"
    >
      <ControlButton label="Minimize" onClick={() => win.minimize()}>
        <Minus className="h-3.5 w-3.5" />
      </ControlButton>
      <ControlButton label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
        {maximized ? <Copy className="h-3 w-3 -scale-x-100" /> : <Square className="h-3 w-3" />}
      </ControlButton>
      <ControlButton label="Close" danger onClick={() => win.close()}>
        <X className="h-3.5 w-3.5" />
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
        "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
        danger
          ? "hover:bg-destructive hover:text-destructive-foreground"
          : "hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
