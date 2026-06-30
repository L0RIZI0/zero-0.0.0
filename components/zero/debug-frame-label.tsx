import { cn } from "@/lib/utils"

/**
 * [v0] DEBUG — ultra-minimalist label for the debug-border frames.
 *
 * Pure colored text, no background, pinned to a corner of the frame it annotates
 * (green = entity0 frame, purple = the View, red = each region). Line 1 = the frame's
 * short name; line 2 (optional) = its layout properties (e.g. "h:fill v:hug").
 *
 * The text color is inherited from a `text-*` class passed via `className` so it
 * matches its border. `pointer-events-none` so it never intercepts clicks/hover, and
 * `z-50` so it floats above the frame's content. Defaults to the top-left corner; pass
 * positioning utilities in `className` to move it to another corner.
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
        "pointer-events-none absolute left-0.5 top-0.5 z-50 select-none font-mono text-[9px] uppercase leading-[1.15] tracking-tight",
        className,
      )}
    >
      <div className="font-semibold">{name}</div>
      {info ? <div className="font-normal opacity-80">{info}</div> : null}
    </div>
  )
}
