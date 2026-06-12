"use client"

import { useEffect, useState } from "react"
import { Search } from "lucide-react"
import { UserIdentity } from "./user-identity"

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

  return (
    <header className="flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="flex flex-1 items-center">
        <UserIdentity size="md" />
      </div>

      <div className="hidden flex-1 items-center justify-center gap-2.5 sm:flex">
        <span className="text-[13px] tracking-tight text-foreground/80">{time}</span>
        <span className="text-[13px] tracking-tight text-muted-foreground">{date}</span>
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
        <button
          type="button"
          className="group flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-1 text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
        >
          <Search className="h-3 w-3" />
          <span className="hidden text-[11.5px] md:inline">Search</span>
          <kbd className="ml-0.5 hidden rounded border border-border px-1 py-0.5 font-mono text-[9px] text-muted-foreground/80 md:inline">
            ⌘K
          </kbd>
        </button>
        <span className="whitespace-nowrap text-[20px] font-semibold tracking-tight text-foreground">
          {/* Hourglass "z": a mirrored copy of the glyph sits precisely behind
              the real one. The two diagonals cross into an X between the shared
              top/bottom bars, reading as an hourglass. The back copy is
              aria-hidden + non-selectable so only the front z catches a drag.
              paint-order: stroke renders the thin stroke beneath the fill, so
              the black border reads as an external outline. */}
          <span className="relative inline-block">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 select-none [transform:scaleX(-1)]"
              style={{ WebkitTextStroke: "1.5px #000", paintOrder: "stroke" }}
            >
              z
            </span>
            <span
              className="relative"
              style={{ WebkitTextStroke: "1.5px #000", paintOrder: "stroke" }}
            >
              z
            </span>
          </span>
          <span style={{ WebkitTextStroke: "1.5px #000", paintOrder: "stroke" }}>
            ero
          </span>
        </span>
      </div>
    </header>
  )
}
