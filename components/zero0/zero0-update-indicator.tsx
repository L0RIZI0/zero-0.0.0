"use client"

import { useEffect, useState } from "react"

/**
 * Minimal, dependency-free update affordance for the root `/0` footer.
 *
 * WHY THIS EXISTS: the Surface (Electron) loads `app://local/index.html` = the root
 * route = `/0`, but the original "Restart to update" pill lives in the OLD SHELL
 * (`components/zero/update-indicator.tsx`), which `/0` never renders. This ports the
 * affordance into the zero0 footer.
 *
 * MANUAL DOWNLOAD FLOW (v0.4.7) — three states, each a single click:
 *   1. available   → "↓ download <latest>"    click ⇒ start the download
 *   2. downloading → "⟳ downloading <version>"  (spinner; disabled)
 *   3. downloaded  → "⟳ restart for <version>"  click ⇒ quit + install + relaunch
 * The pill always tracks the LATEST version the feed offers: nothing is fetched behind
 * your back, so a stalled build is never auto-installed and a newer one always supersedes
 * an older download in the label.
 *
 * Feature-detects `window.zero.updates` (only present inside the Electron preload), so on
 * the web it renders NOTHING and adds no deps. Inline SVG glyphs keep the zero0 tree
 * dependency-free (no lucide-react).
 */

interface ZeroUpdatesApi {
  onAvailable: (cb: (p: { version?: string }) => void) => () => void
  onProgress: (cb: (p: { percent: number }) => void) => () => void
  onDownloaded: (cb: (p: { version?: string }) => void) => () => void
  onError: (cb: (p: { message?: string }) => void) => () => void
  startDownload: () => void
  restartToApply: () => void
}

function getUpdatesApi(): ZeroUpdatesApi | null {
  if (typeof window === "undefined") return null
  const z = (window as unknown as { zero?: { updates?: ZeroUpdatesApi } }).zero
  return z?.updates ?? null
}

type Phase = "idle" | "available" | "downloading" | "downloaded" | "restarting" | "error"

// Normalise a bare electron-updater version ("0.4.7") to Zero's leading-"v" tag form.
function tag(version?: string | null): string | null {
  if (!version) return null
  return version.startsWith("v") ? version : `v${version}`
}

export function Zero0UpdateIndicator() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [version, setVersion] = useState<string | null>(null)
  const [percent, setPercent] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    const api = getUpdatesApi()
    if (!api) return

    const offAvailable = api.onAvailable((p) => {
      // A newer build is offered for download. Don't clobber an in-flight download or the
      // "restarting" beat; otherwise (idle / error / superseding an older downloaded build)
      // show it — a fresh availability clears any prior error.
      setPhase((cur) => (cur === "downloading" || cur === "restarting" ? cur : "available"))
      setVersion(p?.version ?? null)
      setErrorMsg(null)
    })
    const offProgress = api.onProgress((p) => {
      setPercent(p?.percent ?? 0)
      // Progress can arrive a tick before our optimistic click state; make sure we reflect it.
      setPhase((cur) => (cur === "downloaded" || cur === "restarting" ? cur : "downloading"))
    })
    const offDownloaded = api.onDownloaded((p) => {
      setPhase("downloaded")
      if (p?.version) setVersion(p.version)
      setErrorMsg(null)
    })
    const offError = api.onError((p) => {
      // Download/check failed. Surface it as a distinct, clickable RETRY state instead of
      // silently snapping back to "download" (which read as a no-op "click → flash → nothing"
      // loop). The main process now re-checks the feed before each download, so a retry
      // targets the live latest artifact and generally succeeds. A later `update-available`
      // or `update-downloaded` supersedes this state on its own.
      setPhase((cur) => (cur === "downloading" || cur === "error" ? "error" : cur))
      setErrorMsg(p?.message ?? null)
    })

    return () => {
      offAvailable()
      offProgress()
      offDownloaded()
      offError()
    }
  }, [])

  if (phase === "idle") return null

  const ver = tag(version)

  let label: string
  let onClick: (() => void) | undefined
  let disabled = false
  let spinning = false

  switch (phase) {
    case "available":
      label = ver ? `download ${ver}` : "download update"
      onClick = () => {
        setPhase("downloading")
        setPercent(0)
        getUpdatesApi()?.startDownload()
      }
      break
    case "downloading":
      label = ver ? `downloading ${ver}` : "downloading…"
      disabled = true
      spinning = true
      break
    case "downloaded":
      label = ver ? `restart for ${ver}` : "restart to update"
      onClick = () => {
        setPhase("restarting")
        getUpdatesApi()?.restartToApply()
      }
      break
    case "restarting":
      label = "restarting…"
      disabled = true
      spinning = true
      break
    case "error":
      // Clickable retry. The main process re-checks the feed before downloading, so the retry
      // re-syncs to the live latest artifact (the usual cause of failure is a superseded/pruned
      // target) and typically succeeds.
      label = "update failed — retry"
      onClick = () => {
        setPhase("downloading")
        setPercent(0)
        setErrorMsg(null)
        getUpdatesApi()?.startDownload()
      }
      break
    default:
      label = ""
  }

  const title =
    phase === "available"
      ? `Download update${ver ? ` ${ver}` : ""}`
      : phase === "downloading"
        ? `Downloading${ver ? ` ${ver}` : ""} — ${percent}%`
        : phase === "downloaded" || phase === "restarting"
          ? `Restart to update${ver ? ` to ${ver}` : ""}`
          : phase === "error"
            ? `Update failed${errorMsg ? `: ${errorMsg}` : ""} — click to retry`
            : label

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex items-center gap-1.5 rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-70"
    >
      {phase === "available" || phase === "error" ? <DownloadGlyph /> : <RestartGlyph spinning={spinning} />}
      <span className="tabular-nums">{label}</span>
    </button>
  )
}

/** Download arrow (available state) — arrow into a tray. */
function DownloadGlyph() {
  return (
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
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  )
}

/** Refresh/restart arc — used while downloading (spins) and for the restart state. */
function RestartGlyph({ spinning }: { spinning: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={"h-3 w-3" + (spinning ? " motion-safe:animate-spin" : "")}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}
