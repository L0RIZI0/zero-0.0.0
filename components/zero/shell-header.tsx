"use client"

import { Search } from "lucide-react"
import { currentUser } from "@/lib/zero/data"

function ZeroMark() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-full border border-foreground/15 bg-foreground text-background">
        <span className="text-[15px] font-semibold leading-none">0</span>
      </div>
      <span className="text-[17px] font-semibold tracking-tight text-foreground">Zero</span>
    </div>
  )
}

export function ShellHeader({ dateLabel }: { dateLabel: string }) {
  const initials = currentUser.name.slice(0, 1).toUpperCase()

  return (
    <header className="flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="flex flex-1 items-center gap-4">
        <ZeroMark />
      </div>

      <div className="hidden flex-1 items-center justify-center sm:flex">
        <span className="text-[13px] tracking-tight text-muted-foreground">{dateLabel}</span>
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
        <button
          type="button"
          className="group flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden text-[12.5px] md:inline">Search Zero</span>
          <kbd className="ml-1 hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80 md:inline">
            ⌘K
          </kbd>
        </button>
        <button
          type="button"
          aria-label="Account"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-foreground/15 bg-secondary text-[13px] font-medium text-foreground transition-colors hover:border-foreground/30"
        >
          {initials}
        </button>
      </div>
    </header>
  )
}
