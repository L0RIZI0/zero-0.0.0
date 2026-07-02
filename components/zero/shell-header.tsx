"use client"

import { useState } from "react"
import { motion } from "motion/react"
import { Search } from "lucide-react"
import { UserIdentity } from "./user-identity"
import { WindowControls } from "./window-controls"
import { VersionSwitcher } from "@/components/version-switcher"
import { useZeroNav } from "@/lib/zero/nav-store"
import { shellStageFor, HEADER_H, HEADER_H_COMPACT, HEADER_PAD_Y, HEADER_PAD_Y_COMPACT } from "@/lib/zero/layout"
import { layerTransition } from "@/lib/zero/motion"
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
  const { activeEntity } = useZeroNav()
  // Reveal the version switcher only when the right cluster is hovered/focused. Uses
  // React state rather than Tailwind `group-hover` — the CSS hover variant is gated
  // behind `@media (hover: hover)` in Tailwind v4 and doesn't fire reliably here (same
  // reason CollapsibleColumn's rail hover is state-driven).
  const [rightHover, setRightHover] = useState(false)
  // The header bar reacts to dive depth. The whole bar slides up a touch at
  // stage 1 (first child) without any shrinking; it only compacts — avatar,
  // handle, search, logo — at stage 2 (a second child open).
  const stage = shellStageFor(activeEntity)
  const compact = stage === 2

  return (
    <motion.header
      // relative z-40 keeps the header's painted content (avatar, handle,
      // search, logo) ABOVE the timeline, which now bleeds upward into the
      // header row with z-30 at depth. The header has no background, so the
      // timeline's centered day label still shows through the empty center gap.
      // pointer-events-none lets hovers/clicks fall through the header's empty
      // areas to the timeline label / "Today" link underneath; the interactive
      // side clusters re-enable pointer events on themselves.
      //
      // The BOX height is depth-responsive: HEADER_H at rest, HEADER_H_COMPACT at
      // stage 2. Shrinking the box pulls the Dayline (the next row in the absolute
      // overlay) up with it. This is SAFE — the header lives out of flow and the
      // window region's inset is the CONSTANT HEADER_OVERLAY_H, so the box shrink
      // never moves the region rect; the reclaimed px is handed to the windows via
      // WINDOW_TOP_LIFT (they lift up in lockstep to stay flush below the Dayline).
      className="pointer-events-none relative z-40 flex items-center justify-between gap-4"
      // The header doubles as the frameless window's drag handle (desktop). Empty
      // areas drag the window; interactive clusters below opt out with no-drag.
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      initial={false}
      // At stage 2 the whole bar shrinks vertically (height + padding) and its side
      // margins tighten, pulling the avatar and "zero" logo nearer the screen edges.
      // Everything eases with the shared morph curve.
      animate={{
        height: compact ? HEADER_H_COMPACT : HEADER_H,
        paddingTop: compact ? HEADER_PAD_Y_COMPACT : HEADER_PAD_Y,
        paddingBottom: compact ? HEADER_PAD_Y_COMPACT : HEADER_PAD_Y,
        paddingLeft: compact ? 10 : 20,
        paddingRight: compact ? 10 : 20,
      }}
      transition={layerTransition}
    >
      <div
        className="pointer-events-auto flex flex-1 items-center"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <UserIdentity compact={compact} />
      </div>

      {/* Time/date: weekday on the left, time at the dead center of the bar,
          month+day on the right. The flanking weekday/date take equal flex
          basis so the time stays optically centered regardless of their width. */}
      {/* Center date/time block inherits pointer-events-none from the header,
          so hovers fall through to the timeline label/link underneath. */}
      <motion.div
        className="hidden flex-1 items-center justify-center gap-3 sm:flex"
        initial={false}
        animate={{ fontSize: compact ? 12 : 13 }}
        transition={layerTransition}
      >
        <span className="flex-1 truncate text-right tracking-tight text-muted-foreground">
          {weekday}
        </span>
        <span className="shrink-0 tabular-nums tracking-tight text-foreground/80">{time}</span>
        <span className="flex-1 truncate tracking-tight text-muted-foreground">{monthDay}</span>
      </motion.div>

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
            // When compact the field is just the magnifying glass — its border
            // and fill are hidden and only reappear on hover, keeping the
            // collapsed control quiet. Expanded, the bordered pill always shows.
            compact
              ? "border border-transparent hover:border-foreground/20 hover:text-foreground"
              : "border border-border bg-card/60 hover:border-foreground/20 hover:text-foreground",
          )}
          aria-label="Search"
        >
          <Search className="h-3 w-3 shrink-0" />
          {/* The label collapses to zero when compact, leaving just the glass.
              We animate a NUMERIC maxWidth (not width:"auto") on an
              always-mounted element: animating to "auto" makes framer-motion
              measure a target pixel width once, but the sibling "zero" logo
              shrinks at the same time and reflows the row, so that measurement
              goes stale and snaps on the final frame — the jump you saw. A
              fixed numeric target springs cleanly and never re-measures. */}
          <motion.span
            className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap"
            initial={false}
            animate={{
              maxWidth: compact ? 0 : 80,
              opacity: compact ? 0 : 1,
              paddingLeft: compact ? 0 : 6,
            }}
            transition={layerTransition}
          >
            <span className="hidden text-[11.5px] md:inline">Search</span>
            <kbd className="hidden rounded border border-border px-1 py-0.5 font-mono text-[9px] text-muted-foreground/80 md:inline">
              ⌘K
            </kbd>
          </motion.span>
        </button>
        {/* Logo stays flush at the right edge; the window controls are stacked
            ABOVE it (absolutely positioned) so they add no horizontal spacing,
            and fade in only when the corner is hovered. */}
        <div className="group relative flex items-center">
          <WindowControls />
          <motion.span
            className="font-semibold tracking-tight text-foreground"
            initial={false}
            animate={{ fontSize: compact ? 16 : 20 }}
            transition={layerTransition}
          >
            zero
          </motion.span>
        </div>
      </div>
    </motion.header>
  )
}
