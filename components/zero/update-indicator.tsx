"use client"

import { useEffect, useState } from "react"
import { ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Quiet in-app affordance for the background auto-updater (desktop only). Stays
 * invisible until electron-updater reports an update has finished downloading,
 * then reveals a small pill in the header. Clicking it quits + installs the staged
 * update and relaunches Zero. It never nags: no update ⇒ renders nothing, and the
 * update installs on the next normal quit anyway if the user ignores it.
 *
 * Feature-detects `window.zero.updates`, so the web build renders nothing.
 */
export function UpdateIndicator() {
  const [ready, setReady] = useState(false)
  const [version, setVersion] = useState<string | undefined>()

  useEffect(() => {
    const zero = typeof window !== "undefined" ? window.zero : undefined
    if (!zero?.isDesktop || !zero.updates) return
    return zero.updates.onDownloaded(({ version }) => {
      setVersion(version)
      setReady(true)
    })
  }, [])

  if (!ready) return null

  return (
    <button
      type="button"
      onClick={() => window.zero?.updates.restartToApply()}
      aria-label={version ? `Restart to update to version ${version}` : "Restart to apply update"}
      title={version ? `Update ${version} ready — restart to apply` : "Update ready — restart to apply"}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        "bg-accent text-accent-foreground transition-colors hover:bg-accent/80",
      )}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <ArrowUp className="h-3 w-3 shrink-0" />
      <span className="whitespace-nowrap">Restart to update</span>
    </button>
  )
}
