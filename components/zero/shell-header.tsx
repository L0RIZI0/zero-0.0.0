"use client"

import { useState } from "react"
import { Search } from "lucide-react"
import { UserIdentity } from "./user-identity"
import { WindowControls } from "./window-controls"
import { UpdateIndicator } from "./update-indicator"
import { VersionSwitcher } from "@/components/version-switcher"
import { HEADER_H, HEADER_PAD_Y } from "@/lib/zero/layout"
import { useNow } from "@/lib/zero/use-now"
import { cn } from "@/lib/utils"

function useClock() {
  // Shared minute clock — same source as the Dayline NOW marker, so the header
  // time and the marker tooltip never drift apart. `ms === 0` means not-yet-mounted.
  const ms = useNow()
  const now = ms ? new Date(ms) : null

  const time = now
    ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : ""
  // Full weekday in caps (e.g. "SATURDAY") with "JUN 13" (month first, then day).
  const weekday = now
    ? new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now).toUpperCase()
    : ""
  const monthDay = now
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(now).toUpperCase()
    : ""

  return { time, weekday, monthDay }
}

export function ShellHeader() {
  const { time, weekday, monthDay } = useClock()
  // Reveal the version switcher only when the right cluster is hovered/focused. Uses
  // React state rather than Tailwind `group-hover` — the CSS hover variant is gated
  // behind `@media (hover: hover)` in Tailwind v4 and doesn't fire reliably here (same
  // reason CollapsibleColumn's rail hover is state-driven).
  const [rightHover, setRightHover] = useState(false)
  // entity0's header is now a CONSTANT-height full-bleed backdrop chrome — it no longer
  // compacts on dive (the old shell-stage compaction was removed when entity0 was
  // unified into the recursive ancestor model). Children always stick to entity0's
  // fixed real View top, so no header shrink / window lift is needed.

  return (
    <header
      // relative z-40 keeps the header's painted content (avatar, handle,
      // search, logo) ABOVE the timeline, which now bleeds upward into the
      // header row with z-30 at depth. The header has no background, so the
      // timeline's centered day label still shows through the empty center gap.
      // pointer-events-none lets hovers/clicks fall through the header's empty
      // areas to the timeline label / "Today" link underneath; the interactive
      // side clusters re-enable pointer events on themselves.
      //
      // CONSTANT height (HEADER_H) + padding — the header no longer compacts on dive.
      className="pointer-events-none relative z-40 flex items-center justify-between gap-4"
      // The header doubles as the frameless window's drag handle (desktop). Empty
      // areas drag the window; interactive clusters below opt out with no-drag.
      style={{
        WebkitAppRegion: "drag",
        height: HEADER_H,
        paddingTop: HEADER_PAD_Y,
        paddingBottom: HEADER_PAD_Y,
        paddingLeft: 20,
        paddingRight: 20,
      } as React.CSSProperties}
    >
      <div
        className="pointer-events-auto flex flex-1 items-center"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <UserIdentity />
      </div>

      {/* Time/date: weekday on the left, time at the dead center of the bar,
          month+day on the right. The flanking weekday/date take equal flex
          basis so the time stays optically centered regardless of their width. */}
      {/* Center date/time block inherits pointer-events-none from the header,
          so hovers fall through to the timeline label/link underneath. */}
      <div
        className="hidden flex-1 items-center justify-center gap-3 text-[13px] sm:flex"
      >
        <span className="flex-1 truncate text-right tracking-tight text-muted-foreground">
          {weekday}
        </span>
        <span className="shrink-0 tabular-nums tracking-tight text-foreground/80">{time}</span>
        <span className="flex-1 truncate tracking-tight text-muted-foreground">{monthDay}</span>
      </div>

      <div
        className="pointer-events-auto flex flex-1 items-center justify-end gap-3"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        onPointerEnter={() => setRightHover(true)}
        onPointerLeave={() => setRightHover(false)}
        onFocus={() => setRightHover(true)}
        onBlur={(e) => {
          // Keep it revealed while focus stays within the cluster (keyboard users).
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setRightHover(false)
        }}
      >
        {/* Update pill (desktop only): stays hidden until a background update has
            downloaded, then is always visible (not hover-gated) so the user can
            restart to apply whenever they like. */}
        <UpdateIndicator />
        {/* Version switcher stays quiet until the right cluster is hovered (or something
            in it is focused, for keyboard users). Opacity-only so it never shifts the
            row's layout as it reveals. */}
        <span
          className={cn(
            "transition-opacity duration-200",
            rightHover ? "opacity-100" : "opacity-0",
          )}
        >
          <VersionSwitcher />
        </span>
        <button
          type="button"
          className={cn(
            "group flex items-center rounded-full px-2.5 py-1 text-muted-foreground transition-colors",
            "hover:text-foreground",
          )}
          aria-label="Search"
        >
          <Search className="h-3 w-3 shrink-0" />
        </button>
        {/* Logo stays flush at the right edge; the window controls are stacked
            ABOVE it (absolutely positioned) so they add no horizontal spacing,
            and fade in only when the corner is hovered. */}
        <div className="group relative flex items-center">
          <WindowControls />
          <span className="text-[20px] font-semibold tracking-tight text-foreground">
            zero
          </span>
        </div>
      </div>
    </header>
  )
}
