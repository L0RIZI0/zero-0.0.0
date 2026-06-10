"use client"

import { useEffect, useState } from "react"
import { Search } from "lucide-react"
import { useZeroNav } from "@/lib/zero/nav-store"
import { UserIdentity } from "./user-identity"

function useClock() {
  const [time, setTime] = useState<string>("")
  useEffect(() => {
    const update = () =>
      setTime(
        new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      )
    update()
    const id = setInterval(update, 1000 * 30)
    return () => clearInterval(id)
  }, [])
  return time
}

export function ShellHeader({ dateLabel }: { dateLabel: string }) {
  const { stack } = useZeroNav()
  const time = useClock()
  // The user identity always lives in the top-left. It's a touch larger on
  // Space 0 and shrinks once a layer is open to make room for the breadcrumb.
  const inLayer = stack.length > 1

  return (
    <header className="flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="flex flex-1 items-center">
        <UserIdentity size={inLayer ? "sm" : "md"} />
      </div>

      <div className="hidden flex-1 items-center justify-center gap-2.5 sm:flex">
        <span className="text-[13px] tabular-nums tracking-tight text-foreground/80">{time}</span>
        <span className="text-[13px] tracking-tight text-muted-foreground">{dateLabel}</span>
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
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
        <span className="text-[17px] font-semibold tracking-tight text-foreground">Zero</span>
      </div>
    </header>
  )
}
