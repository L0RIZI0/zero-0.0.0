"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

/**
 * A small night/light mode switch pinned to the bottom-right corner. It mirrors
 * the iOS-style track+thumb pattern and toggles next-themes' resolved theme.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Theme is only known on the client; render a stable placeholder until mounted
  // to avoid a hydration mismatch.
  useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === "dark"

  return (
    <button
      type="button"
      role="switch"
      aria-checked={mounted ? isDark : undefined}
      aria-label="Toggle dark mode"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      // Back in the bottom-right corner (`bottom-5 right-5`), compact — the earlier `p-3`
      // aura was capturing clicks on empty space next to the visible track. `z-[300]`
      // keeps it above every layer (window z-140, rails z-20, do-list dropdown backdrops
      // `fixed inset-0 z-[140]`) so nothing intercepts its clicks.
      className="fixed right-5 bottom-5 z-[300] flex h-5 w-9 items-center rounded-full border border-foreground/15 bg-foreground/10 px-1 shadow-md backdrop-blur transition-colors hover:bg-foreground/15"
    >
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-transform duration-200",
          mounted && isDark ? "translate-x-0" : "translate-x-3",
        )}
      >
        {mounted && isDark ? (
          <Moon className="h-2.5 w-2.5" />
        ) : (
          <Sun className="h-2.5 w-2.5" />
        )}
      </span>
    </button>
  )
}
