import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useDebugView } from "@/lib/zero/debug-view"

/**
 * [v0] DEBUG — ultra-minimalist label for the debug-border frames.
 *
 * Pure colored text, no background, pinned to a corner of the frame it annotates
 * (green = entity0 frame, purple = the View, red = each region). Line 1 = the frame's
 * short name; line 2 (optional) = its layout properties (e.g. "h:fill v:hug").
 *
 * The text color is inherited from a `text-*` class passed via `className` so it
 * matches its border. `pointer-events-none` so it never intercepts clicks/hover.
 *
 * Z-INDEX (`z-[15]`): a label must float above its own frame's content (all ≤ z-10)
 * but stay BELOW any covering child window. A child window is `position: fixed` with
 * `zIndex = 20 + windowDepth*10` (nav-store styleFor), so the shallowest covering
 * window is z-30. Critically, an in-place child window morphs from a do-list ROW, so it
 * lives in the DOM INSIDE region 1 — a z-EQUAL label rendered LATER in the DOM (e.g. the
 * region-2 DOCK labels) would win the tie and bleed through the window. Sitting at
 * z-[15] (between content ≤10 and windows ≥20) keeps every label below every window
 * regardless of DOM order, while a child window's OWN labels still paint above its
 * content. Defaults to the top-left corner; pass positioning utilities in `className`
 * to move it to another corner.
 *
 * Remove this component together with the debug borders (all tagged `// [v0] DEBUG`).
 */
export function DebugFrameLabel({
  name,
  info,
  className,
}: {
  name: string
  info?: string
  className?: string
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-0.5 top-0.5 z-[15] select-none font-mono text-[9px] uppercase leading-[1.15] tracking-tight",
        className,
      )}
    >
      <div className="font-semibold">{name}</div>
      {info ? <div className="font-normal opacity-80">{info}</div> : null}
    </div>
  )
}

/**
 * [v0] DEBUG — skyblue frame + label around a COMPONENT (the innermost layer of the
 * View/Region/Component model: lifelane, do-list, dock…). A component lives INSIDE a
 * region, so its label is pinned to the TOP-RIGHT corner to avoid colliding with the
 * region's red TOP-LEFT label.
 *
 * Self-contained: reads the shared `§ 2` toggle itself. When the toggle is OFF this
 * renders as a plain pass-through `<div>` carrying only `className` — no `relative`, no
 * border — so it never alters layout. Remove together with the other debug frames.
 */
export function DebugComponentFrame({
  name,
  info,
  className,
  children,
}: {
  name: string
  info?: string
  className?: string
  children: ReactNode
}) {
  const { frames: showFrames } = useDebugView()
  return (
    <div className={cn(className, showFrames && "relative border border-sky-400")}>
      {showFrames ? (
        <DebugFrameLabel name={name} info={info} className="left-auto right-0.5 text-right text-sky-400" />
      ) : null}
      {children}
    </div>
  )
}
