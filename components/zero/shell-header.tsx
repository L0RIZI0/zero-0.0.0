"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
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
  const weekday = now
    ? new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now)
    : ""
  const monthDay = now
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(now)
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
          {/* When compact, the search field collapses to just its magnifying
              glass — the label + shortcut animate away. The inter-icon gap lives
              INSIDE this collapsing element (as left padding) rather than as a
              `gap` on the button, so when AnimatePresence unmounts it there is
              no leftover flex gap to collapse — which was causing the glass to
              snap sideways at the end of the stage-2 transition. */}
          <AnimatePresence initial={false}>
            {!compact && (
              <motion.span
                key="search-label"
                className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap pl-1.5"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={layerTransition}
              >
                <span className="hidden text-[11.5px] md:inline">Search</span>
                <kbd className="hidden rounded border border-border px-1 py-0.5 font-mono text-[9px] text-muted-foreground/80 md:inline">
                  ⌘K
                </kbd>
              </motion.span>
            )}
          </AnimatePresence>
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
