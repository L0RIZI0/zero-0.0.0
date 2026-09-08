"use client"

import { useEffect, useState } from "react"

/**
 * Minimal, dependency-free BATTERY affordance for the root `/0` footer — sits to the RIGHT of the
 * update indicator (v0.2.327).
 *
 * SOURCE: the Chromium Battery Status API (`navigator.getBattery()`), available in the Electron Surface
 * (and Chromium browsers on the web). No native-host bridge and no deps — mirrors the update indicator's
 * feature-detect-or-render-nothing approach. Browsers without the API (Safari, Firefox) render NOTHING.
 *
 * "PORTABLE DEVICE ONLY": the web API has no `hasBattery` flag, so we hide on the CLASSIC no-battery
 * signature Chromium reports for a desktop — fully charged, charging, with no finite discharge estimate
 * (`level === 1 && charging && dischargingTime === Infinity && chargingTime === 0`). A laptop shows as
 * soon as it isn't in that exact all-clear state (i.e. essentially always once it's seen any discharge).
 * Perfect detection would need a native-host addition; this is the best the web API alone allows.
 *
 * Inline SVG glyph (battery shell + proportional fill + charging bolt) keeps the zero0 tree free of
 * lucide-react, matching zero0-update-indicator.
 */

interface BatteryLike extends EventTarget {
  level: number // 0..1
  charging: boolean
  chargingTime: number // seconds to full, or Infinity
  dischargingTime: number // seconds to empty, or Infinity
}

interface BatterySnapshot {
  level: number
  charging: boolean
  // Spec types these as number (Infinity when unknown), but real/headless engines can return null —
  // so we model that and normalise via noFiniteEstimate().
  chargingTime: number | null
  dischargingTime: number | null
}

function getBatteryApi(): (() => Promise<BatteryLike>) | null {
  if (typeof navigator === "undefined") return null
  const gb = (navigator as unknown as { getBattery?: () => Promise<BatteryLike> }).getBattery
  return typeof gb === "function" ? gb.bind(navigator) : null
}

const snap = (b: BatteryLike): BatterySnapshot => ({
  level: b.level,
  charging: b.charging,
  chargingTime: b.chargingTime,
  dischargingTime: b.dischargingTime,
})

/** A time estimate counts as "no finite estimate" when it's Infinity (per spec) OR null/NaN/≤0, which
 *  real engines return in headless / no-battery cases. */
function noFiniteEstimate(t: number | null | undefined): boolean {
  return t == null || !Number.isFinite(t) || t <= 0
}

/** The Chromium signature for a machine with NO battery (desktop, headless): pinned full, charging, and
 *  NO finite discharge estimate — a real portable device on AC still exposes a discharge estimate once
 *  it has ever run on battery. We treat this all-clear signature as "not portable" and render nothing. */
function looksBatteryless(s: BatterySnapshot): boolean {
  return s.charging && s.level >= 1 && noFiniteEstimate(s.dischargingTime) && noFiniteEstimate(s.chargingTime)
}

export function Zero0BatteryIndicator() {
  const [state, setState] = useState<BatterySnapshot | null>(null)
  // Show ONLY while the app is OS-fullscreen (v0.2.363, Loris ask): fullscreen hides the Windows taskbar
  // and its system battery readout, so Zero surfaces its own; windowed/maximized keeps the taskbar's, so
  // we stay out of the way. Driven by the desktop bridge — on the web (no `window.zero.win`) it stays
  // false, so the footer battery never shows in a browser.
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const win = typeof window !== "undefined" ? window.zero?.win : undefined
    if (!win?.onFullScreenChange) return
    let cancelled = false
    win.isFullScreen?.()
      .then((fs) => { if (!cancelled) setFullscreen(!!fs) })
      .catch(() => {})
    const off = win.onFullScreenChange((fs) => setFullscreen(!!fs))
    return () => { cancelled = true; off?.() }
  }, [])

  useEffect(() => {
    const getBattery = getBatteryApi()
    if (!getBattery) return

    let battery: BatteryLike | null = null
    let cancelled = false
    const update = () => {
      if (battery) setState(snap(battery))
    }

    getBattery()
      .then((b) => {
        if (cancelled) return
        battery = b
        update()
        b.addEventListener("levelchange", update)
        b.addEventListener("chargingchange", update)
        b.addEventListener("chargingtimechange", update)
        b.addEventListener("dischargingtimechange", update)
      })
      .catch(() => {
        /* API present but rejected (e.g. permissions) — stay hidden. */
      })

    return () => {
      cancelled = true
      if (battery) {
        battery.removeEventListener("levelchange", update)
        battery.removeEventListener("chargingchange", update)
        battery.removeEventListener("chargingtimechange", update)
        battery.removeEventListener("dischargingtimechange", update)
      }
    }
  }, [])

  // Nothing to show if there's no real battery (web desktop / headless / batteryless). Returning null
  // here is fine — there's no entrance/exit to animate in that case, and it keeps the footer clean.
  if (!state || looksBatteryless(state)) return null

  // The battery is PRESENT but only VISIBLE in OS-fullscreen. We keep the element mounted whenever a
  // battery exists and merely toggle `show`, so BOTH the entrance (fullscreen on) and the exit
  // (fullscreen off) transition — a component that unmounts on exit can't animate out.
  const show = fullscreen

  const pct = Math.round(state.level * 100)
  const title = state.charging
    ? `Battery ${pct}% — charging`
    : !noFiniteEstimate(state.dischargingTime)
      ? `Battery ${pct}% — ${fmtRemaining(state.dischargingTime)} left`
      : `Battery ${pct}%`

  // Low-battery emphasis: when not charging and at/under 20%, tint the whole pill via the destructive
  // token so it reads at a glance without adding a new color to the palette.
  const low = !state.charging && pct <= 20

  // ENTRANCE/EXIT ANIMATION (v0.2.363, Loris ask): slide in from the right / out to the right, pushing
  // the version label with an ease-out. The OUTER grid animates `grid-template-columns` 0fr↔1fr — the
  // same width-collapse trick as Zero0Frame — so the element's footprint eases between 0 and its content
  // width, and because it's the right-most item in an `ml-auto` cluster, that width change PUSHES the
  // version label left (in) / lets it slide back right (out). The INNER layer adds a translate+fade so
  // the pill reads as sliding rather than merely revealing. `pl-3` lives INSIDE the collapsing/clipping
  // region, so the gap to the version appears with the pill and fully vanishes when collapsed.
  return (
    <span
      aria-hidden={!show}
      className="grid transition-[grid-template-columns] duration-500 ease-out motion-reduce:transition-none"
      style={{ gridTemplateColumns: show ? "1fr" : "0fr" }}
    >
      {/* Clip layer (grid item): NO padding of its own, so `overflow-hidden` lets the track collapse
          fully to 0 width when hidden — leaving no residual gap after the version label. */}
      <span className="overflow-hidden">
        {/* Content layer: carries the `pl-3` gap-to-version and the slide+fade. Both live INSIDE the
            clip, so they vanish entirely when collapsed and ease back in on show. */}
        <span
          title={title}
          aria-label={title}
          className={
            "flex items-center gap-1.5 whitespace-nowrap pl-3 tabular-nums transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none " +
            (show ? "translate-x-0 opacity-100 " : "translate-x-2 opacity-0 ") +
            (low ? "text-destructive" : "text-muted-foreground")
          }
        >
          <BatteryGlyph level={state.level} charging={state.charging} />
          <span>{pct}%</span>
        </span>
      </span>
    </span>
  )
}

/** Format seconds → a compact "1h 20m" / "45m" remaining string. */
function fmtRemaining(seconds: number | null): string {
  const mins = Math.max(0, Math.round((seconds ?? 0) / 60))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** Horizontal battery shell with a proportional fill and a charging bolt overlay. */
function BatteryGlyph({ level, charging }: { level: number; charging: boolean }) {
  // Inner fill track spans x=2..17 (15 units wide) inside the shell drawn at x=1..18.
  const fillW = Math.max(0, Math.min(1, level)) * 15
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
      {/* shell */}
      <rect x="1" y="7" width="18" height="10" rx="2" />
      {/* terminal nub */}
      <path d="M21 10v4" strokeLinecap="round" />
      {/* proportional fill (no stroke; drawn as a solid bar) */}
      <rect x="2" y="8" width={fillW} height="8" rx="1" fill="currentColor" stroke="none" />
      {/* charging bolt overlay */}
      {charging && (
        <path
          d="M11 8l-3 4h3l-1 4 4-5h-3l1-3z"
          fill="currentColor"
          stroke="var(--background)"
          strokeWidth={0.75}
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}
