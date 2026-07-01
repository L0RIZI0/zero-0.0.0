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
      // `right-14` clears the Published panel's full-height rail (a 48px strip on the
      // right edge). `z-[300]` puts it above EVERY layer — window (z-140), rails (z-20),
      // do-list dropdown backdrops (`fixed inset-0 z-[140]`) — so nothing intercepts it.
      // The button carries generous invisible padding (`p-3`) so the actual TAP TARGET is
      // ~60×44px even though the visible track stays 36×20 — the track is `bg-foreground/10`
      // on near-black (nearly invisible), so without the padding it's easy to click just
      // off the tiny target and have nothing happen. Group-hover lights the track.
      className="group fixed right-11 bottom-2 z-[300] flex items-center justify-center rounded-full p-3"
    >
      <span className="flex h-5 w-9 items-center rounded-full border border-foreground/15 bg-foreground/10 px-1 shadow-md backdrop-blur transition-colors group-hover:bg-foreground/20">
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
      </span>
    </button>
  )
}
