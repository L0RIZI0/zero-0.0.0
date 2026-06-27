"use client"

import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { MORPH_S, MORPH_EASE_OUT, type MorphPair, type MorphRect } from "@/lib/zero/timeline-morph"

/**
 * PLANE MORPH overlay. Rendered (only during the brief `morphing` window) on top of
 * both real planes inside the Atlas layer. Each element flies from its Lifelane rect
 * to its Atlas rect — or back — so a day's horizontal span visibly rotates into its
 * vertical column (graduation lines + boundary + title included) and event chips
 * slide from their linear slot into the day/time grid. Fully opaque: there is no
 * cross-fade between two ghosted trees, so the motion reads as real movement.
 *
 * `atlas` is the TARGET state (already flipped when this mounts), so:
 *   entering Atlas  → start = lane rect,  end = atlas rect
 *   leaving  Atlas  → start = atlas rect, end = lane rect
 * Because the layer mounts at the start of the morph, `initial` = start and
 * `animate` = end gives a single clean flight in the right direction.
 */
export function TimelineMorphLayer({ pairs, atlas }: { pairs: MorphPair[]; atlas: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden>
      {pairs.map((p) => {
        const start = atlas ? p.lane : p.atlas
        const end = atlas ? p.atlas : p.lane
        return (
          <motion.div
            key={p.key}
            className="absolute left-0 top-0"
            initial={rectStyle(start)}
            animate={rectStyle(end)}
            transition={{ duration: MORPH_S, ease: MORPH_EASE_OUT }}
            style={{ borderRadius: p.kind === "chip" ? 4 : 0 }}
          >
            <Visual pair={p} />
          </motion.div>
        )
      })}
    </div>
  )
}

function rectStyle(r: MorphRect) {
  return { x: r.x, y: r.y, width: Math.max(0, r.w), height: Math.max(0, r.h) }
}

/** The painted content of a morph element, by kind. The wrapper sizes it; these
 *  fill it (`h-full w-full`) so they stretch/rotate with the flying rect. */
function Visual({ pair }: { pair: MorphPair }) {
  switch (pair.kind) {
    case "cell":
      return <div className="h-full w-full border-l border-border/30 bg-foreground/[0.02]" />
    case "hour":
      return <div className="h-full w-full bg-border/40" />
    case "title":
      return (
        <div className="flex h-full w-full items-center justify-center">
          <span className="truncate rounded px-1 text-[9.5px] font-semibold tabular-nums tracking-wide text-muted-foreground/70">
            {pair.title}
          </span>
        </div>
      )
    case "chip":
      return (
        <div
          className="flex h-full w-full items-center gap-1 overflow-hidden rounded-[4px] border px-1.5 text-[10px] leading-tight tracking-tight text-foreground/85 shadow-sm"
          style={{
            borderColor: pair.color ? `${pair.color}59` : "var(--border)",
            backgroundColor: pair.color ? `${pair.color}26` : "var(--secondary)",
          }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-[2px]" style={{ backgroundColor: pair.color }} />
          <span className={cn("truncate", pair.cancelled && "line-through")}>{pair.title}</span>
        </div>
      )
  }
}
