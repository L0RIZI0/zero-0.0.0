"use client"

import { useEffect, useState } from "react"

/**
 * Minimal, dependency-free "update ready" affordance for the root `/0` footer.
 *
 * WHY THIS EXISTS: the Surface (Electron) loads `app://local/index.html` = the root
 * route = `/0`, but the original "Restart to update" pill lives in the OLD SHELL
 * (`components/zero/update-indicator.tsx`), which `/0` never renders. So on the Surface
 * a background update would download + stage silently with no in-app signal. This ports
 * the affordance into the zero0 footer.
 *
 * It feature-detects `window.zero.updates` (only present inside the Electron preload),
 * so on the web it renders NOTHING and adds no deps. Uses an inline SVG glyph to stay
 * consistent with the rest of the dep-free zero0 tree (no lucide-react).
 */

interface ZeroUpdatesApi {
  onDownloaded: (cb: (p: { version?: string }) => void) => () => void
  restartToApply: () => void
}

function getUpdatesApi(): ZeroUpdatesApi | null {
  if (typeof window === "undefined") return null
  const z = (window as unknown as { zero?: { updates?: ZeroUpdatesApi } }).zero
  return z?.updates ?? null
}

export function Zero0UpdateIndicator() {
  const [staged, setStaged] = useState<{ version?: string } | null>(null)

  useEffect(() => {
    const api = getUpdatesApi()
    if (!api) return
    // An update finished downloading and is staged for the next restart.
    const off = api.onDownloaded((payload) => setStaged(payload ?? {}))
    return off
  }, [])

  if (!staged) return null

  return (
    <button
      type="button"
      onClick={() => getUpdatesApi()?.restartToApply()}
      title={staged.version ? `Restart to update to ${staged.version}` : "Restart to update"}
      aria-label={staged.version ? `Restart to update to ${staged.version}` : "Restart to update"}
      className="inline-flex items-center gap-1.5 rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* A simple refresh/restart arc — signals "relaunch to apply". */}
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v5h-5" />
      </svg>
      <span className="tabular-nums">restart to update</span>
    </button>
  )
}
