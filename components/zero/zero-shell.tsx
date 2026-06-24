"use client"

import { useTheme } from "next-themes"
import { ShellHeader } from "./shell-header"
import { WorkSurface } from "./work-surface"
import { ThemeToggle } from "./theme-toggle"
import { ZeroNavProvider, useZeroNav } from "@/lib/zero/nav-store"
import { telescopicSurface } from "@/lib/zero/motion"
import { DURATION_S, MORPH_CSS_EASE } from "@/lib/zero/flip-stage"

// Inner shell — runs inside ZeroNavProvider so it can read the stack. The whole
// home chrome (top header + timeline + work area) is window 0 of the telescopic
// surface model: in DARK mode it stays on pure --background (no-op); in LIGHT mode
// it darkens (capped) as the stack deepens, so the top header recedes in step with
// the work-surface card and there is no seam between them.
function ZeroShellInner() {
  const { stack } = useZeroNav()
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== "light"
  const homeSurface = telescopicSurface(0, Math.max(0, stack.length - 1), isDark)

  return (
    <main
      className="flex h-dvh w-full flex-col overflow-hidden"
      style={{ backgroundColor: homeSurface, transition: `background-color ${DURATION_S} ${MORPH_CSS_EASE}` }}
    >
      <ShellHeader />
      {/* No bottom padding: the focus-window region reaches the viewport bottom so an
          open Space's octagon (and the dock pinned inside its lower wedge) extends all
          the way down — no home backdrop bleeding below the frame. Side padding stays
          for the IN/OUT rail breathing room. */}
      <div className="relative min-h-0 flex-1 px-2 pb-0 sm:px-3">
        <WorkSurface />
      </div>
    </main>
  )
}

export function ZeroShell() {
  return (
      <ZeroNavProvider>
      <ZeroShellInner />
      <ThemeToggle />
    </ZeroNavProvider>
  )
}
