"use client"

import { useTheme } from "next-themes"
import { ShellHeader } from "./shell-header"
import { Dayline } from "./dayline"
import { WorkSurface } from "./work-surface"
import { ThemeToggle } from "./theme-toggle"
import { FpsMeter } from "./fps-meter"
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
      className="relative flex h-dvh w-full flex-col overflow-hidden"
      style={{ backgroundColor: homeSurface, transition: `background-color ${DURATION_S} ${MORPH_CSS_EASE}` }}
    >
      {/* HEADER OVERLAY — entity0 (the Individual's homeview) is full-bleed and touches
          all 4 screen edges; its chrome is a z-overlay floating ON TOP of the frame's
          top strip. Two stacked CONSTANT-height rows:
            row 1 — the top bar (avatar+handle = the Individual's title, date+time,
                    version switcher + search + zero logo, theme/window controls).
            row 2 — the DAYLINE, the Individual's at-a-glance day insight.
          `pointer-events-none` so the gaps fall through to the work surface beneath;
          each interactive cluster re-enables pointer events for itself. The work area
          below is inset (in WorkSurface) by this overlay's height so windows open under
          it — the overlay never participates in flow, so the frame can reach the top. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex flex-col">
        <ShellHeader />
        <Dayline />
      </div>
      {/* Full-bleed work area: no side/bottom gutter, starts at the screen top (the
          header floats over it). entity0's frame fills this entirely, edge to edge. */}
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
    </ZeroNavProvider>
  )
}
