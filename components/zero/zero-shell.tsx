"use client"

import { useTheme } from "next-themes"
import { WorkSurface } from "./work-surface"
import { ThemeToggle } from "./theme-toggle"
import { FpsMeter } from "./fps-meter"
import { ActivityInspector } from "./activity-inspector"
import { HierarchyInspector } from "./hierarchy-inspector"
import { ZeroNavProvider, useZeroNav } from "@/lib/zero/nav-store"
import { telescopicSurface, useMorphTime } from "@/lib/zero/motion"
import { DURATION_S, MORPH_CSS_EASE } from "@/lib/zero/flip-stage"

// Inner shell — runs inside ZeroNavProvider so it can read the stack. The whole
// home chrome (top header + timeline + work area) is window 0 of the telescopic
// surface model: in DARK mode it stays on pure --background (no-op); in LIGHT mode
// it darkens (capped) as the stack deepens, so the top header recedes in step with
// the work-surface card and there is no seam between them.
function ZeroShellInner() {
  const { stack } = useZeroNav()
  // Subscribe the whole Zero tree to BRAT so a `§ 5` change re-renders everything,
  // and every component re-reads the live, BRAT-derived transitions immediately
  // (rather than only on the next interaction-driven render).
  useMorphTime()
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== "light"
  const homeSurface = telescopicSurface(0, Math.max(0, stack.length - 1), isDark)

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden"
      style={{ backgroundColor: homeSurface, transition: `background-color ${DURATION_S} ${MORPH_CSS_EASE}` }}
    >
      {/* Full-bleed work area — entity0's frame fills it edge to edge. entity0's
          KIND-SPECIFIC header (avatar/name, time+date, search + zero logo, Dayline) is
          now rendered IN FLOW as entity0's own first child inside WorkSurface (see
          IndividualHeader), not as a decoupled overlay here — so the chrome is genuinely
          the Individual's header, and the window-region starts at its bottom by flow. */}
      <div className="relative min-h-0 flex-1">
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
      <FpsMeter />
      <ActivityInspector />
      <HierarchyInspector />
    </ZeroNavProvider>
  )
}
