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
      // `right-14` (56px) keeps the toggle clear of the Published panel's full-height
      // invisible shortcut rail (a 48px strip pinned to the right edge). At the old
      // `right-5` the toggle's right half sat under that rail. `z-[300]` puts it above
      // EVERY other layer — the window layer (z-140), its rails (z-20), and the do-list
      // dropdown backdrops (`fixed inset-0 z-[140]`) — so no transient overlay spun up
      // during a panel/window animation can ever intercept its clicks.
      className="fixed bottom-5 right-14 z-[300] flex h-5 w-9 items-center rounded-full border border-foreground/15 bg-foreground/10 px-1 shadow-md backdrop-blur transition-colors hover:bg-foreground/15"
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
