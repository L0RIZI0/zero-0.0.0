"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Search } from "lucide-react"
import { useZeroNav } from "@/lib/zero/nav-store"
import { contentTransition, userIdentityLayoutId } from "@/lib/zero/motion"
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
  // When the user has opened a space or task, Space 0 fills the screen and its
  // identity (the user) is promoted into the header in place of the Zero logo.
  const inLayer = stack.length > 1

  return (
    <header className="flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="relative flex min-h-9 flex-1 items-center gap-4">
        {/* Zero mark is absolutely anchored to the left so the identity always
            morphs into the exact same slot — no horizontal jump while Zero exits. */}
        <AnimatePresence initial={false}>
          {!inLayer && (
            <motion.span
              key="zero-mark"
              initial={{ opacity: 0, x: -12, y: -12 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: -14, y: -14 }}
              transition={contentTransition}
              className="absolute left-0 text-[17px] font-semibold tracking-tight text-foreground"
            >
              Zero
            </motion.span>
          )}
        </AnimatePresence>
        {inLayer && <UserIdentity size="sm" layoutId={userIdentityLayoutId} />}
      </div>

      <div className="hidden flex-1 items-center justify-center gap-2.5 sm:flex">
        <span className="text-[13px] tabular-nums tracking-tight text-foreground/80">{time}</span>
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
      </div>
    </header>
  )
}
