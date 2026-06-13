"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Search } from "lucide-react"
import { UserIdentity } from "./user-identity"
import { useZeroNav } from "@/lib/zero/nav-store"
import { shellStageFor } from "@/lib/zero/layout"
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
  const date = now
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(now)
    : ""

  return { time, date }
}

export function ShellHeader() {
  const { time, date } = useClock()
  const { activeNode } = useZeroNav()
  // The header bar reacts to dive depth. It only compacts at stage 2 (a second
  // child open); stages 0 and 1 keep the header at full size — the timeline
  // lift alone carries the "responsive" feel for the first dive.
  const compact = shellStageFor(activeNode) === 2

  return (
    <motion.header
      className="flex items-center justify-between gap-4 px-5"
      initial={false}
      animate={{ paddingTop: compact ? 8 : 14, paddingBottom: compact ? 8 : 14 }}
      transition={layerTransition}
    >
      <div className="flex flex-1 items-center">
        <UserIdentity compact={compact} />
      </div>

      <motion.div
        className="hidden flex-1 items-center justify-center gap-2.5 sm:flex"
        initial={false}
        animate={{ fontSize: compact ? 12 : 13 }}
        transition={layerTransition}
      >
        <span className="tracking-tight text-foreground/80">{time}</span>
        <span className="tracking-tight text-muted-foreground">{date}</span>
      </motion.div>

      <div className="flex flex-1 items-center justify-end gap-3">
        <button
          type="button"
          className={cn(
            "group flex items-center gap-1.5 rounded-full px-2.5 py-1 text-muted-foreground transition-colors",
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
              glass — the label + shortcut animate away. */}
          <AnimatePresence initial={false}>
            {!compact && (
              <motion.span
                key="search-label"
                className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap"
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
