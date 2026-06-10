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
      className="fixed bottom-5 right-5 z-50 flex h-8 w-14 items-center rounded-full border border-foreground/15 bg-foreground/10 px-1 shadow-md backdrop-blur transition-colors hover:bg-foreground/15"
    >
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-transform duration-200",
          mounted && isDark ? "translate-x-0" : "translate-x-6",
        )}
      >
        {mounted && isDark ? (
          <Moon className="h-3.5 w-3.5" />
        ) : (
          <Sun className="h-3.5 w-3.5" />
        )}
      </span>
    </button>
  )
}
