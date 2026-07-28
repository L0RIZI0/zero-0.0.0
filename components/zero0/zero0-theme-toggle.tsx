"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"

/**
 * Minimal, data-style theme control for the root `/` canvas — a bare monospace
 * text button (no track, no shadow, no pill) that reads `light`/`dark` and flips
 * the GLOBAL next-themes theme. Because the theme is app-wide, the choice made
 * here persists across `/1` and `/2` too; those routes keep their own iOS-style
 * pill (`components/zero/theme-toggle.tsx`) untouched. Renders a stable
 * placeholder until mounted to avoid a hydration mismatch.
 */
export function Zero0ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === "dark"

  // Relay Zero's light/dark choice to the native web host (desktop only) so web content's default
  // right-click menu + prefers-color-scheme match Zero instead of the OS. Fires on mount and on every
  // toggle; newly-mounted webviews pick up the stored scheme from the host. No-op on the web.
  useEffect(() => {
    if (!mounted) return
    try {
      window.zero?.resource?.setTheme?.(isDark ? "dark" : "light")
    } catch {
      /* ignore */
    }
  }, [mounted, isDark])
  const label = !mounted ? "····" : isDark ? "dark" : "light"

  return (
    <button
      type="button"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="tabular-nums text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
    >
      {label}
    </button>
  )
}
