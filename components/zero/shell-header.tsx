"use client"

import { useEffect, useState } from "react"
import { motion } from "motion/react"
import { Search } from "lucide-react"
import { UserIdentity } from "./user-identity"
import { useZeroNav } from "@/lib/zero/nav-store"
import { shellStageFor, HEADER_PAD_Y } from "@/lib/zero/layout"
import { layerTransition } from "@/lib/zero/motion"
import { cn } from "@/lib/utils"

function useClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    const update = () => setNow(new Date())
    update()
    // Tick every 30s so both the time and the date (e.g. crossing midnight)
    // stay current without a refresh.
    const id = setInterval(update, 1000 * 30)
    return () => clearInterval(id)
  }, [])

  const time = now
    ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : ""
  // Three-letter caps, e.g. "SAT" and "JUN 13", to keep the bar compact.
  const weekday = now
    ? new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(now).toUpperCase()
    : ""
  const monthDay = now
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(now).toUpperCase()
    : ""

  return { time, weekday, monthDay }
}

export function ShellHeader() {
  const { time, weekday, monthDay } = useClock()
  const { activeNode } = useZeroNav()
  // The header bar reacts to dive depth. The whole bar slides up a touch at
  // stage 1 (first child) without any shrinking; it only compacts — avatar,
  // handle, search, logo — at stage 2 (a second child open).
  const stage = shellStageFor(activeNode)
  const compact = stage === 2

  return (
    <motion.header
      className="flex items-center justify-between gap-4 px-5"
      initial={false}
      animate={{ paddingTop: HEADER_PAD_Y[stage], paddingBottom: HEADER_PAD_Y[stage] }}
      transition={layerTransition}
    >
      <div className="flex flex-1 items-center">
        <UserIdentity compact={compact} />
      </div>

      {/* Time/date: weekday on the left, time at the dead center of the bar,
          month+day on the right. The flanking weekday/date take equal flex
          basis so the time stays optically centered regardless of their width. */}
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

      <div className="flex flex-1 items-center justify-end gap-3">
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
        <motion.span
          className="font-semibold tracking-tight text-foreground"
          initial={false}
          animate={{ fontSize: compact ? 16 : 20 }}
          transition={layerTransition}
        >
          zero
        </motion.span>
      </div>
    </motion.header>
  )
}
