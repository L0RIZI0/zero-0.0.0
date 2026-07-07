"use client"

import { BRAT_STEPS, cycleBrat, useMorphTime } from "@/lib/zero/motion"

/**
 * Tiny dev-only overlay (bottom-right) signalling the current BRAT — the global
 * "Big Referential Animation Time" that scales the whole morph language. Shows the
 * active duration big, with the full `§ 5` cycle set below and the current step
 * highlighted, so it's always clear which animation setting is in place. Clicking the
 * card advances BRAT (same as the `§ 5` chord). Never renders in production.
 */
export function BratMeter() {
  const brat = useMorphTime()

  if (process.env.NODE_ENV === "production") return null

  const fmt = (s: number) => (s === 0 ? "0" : `${s}`)

  return (
    <button
      type="button"
      onClick={() => cycleBrat()}
      className="fixed bottom-3 right-3 z-[9999] cursor-pointer select-none rounded-md border border-border bg-card/90 px-3 py-2 text-left font-mono text-xs text-card-foreground shadow-lg backdrop-blur transition-colors hover:bg-card"
      aria-label={`Animation morph time ${fmt(brat)} seconds. Click or press section-5 to cycle.`}
      title="§ 5 — cycle animation time (BRAT)"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums leading-none">{fmt(brat)}</span>
        <span className="text-muted-foreground">s morph</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1 tabular-nums">
        {BRAT_STEPS.map((s) => {
          const active = Math.abs(s - brat) < 1e-6
          return (
            <span
              key={s}
              className={
                active
                  ? "rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background"
                  : "rounded px-1.5 py-0.5 text-[10px] text-muted-foreground"
              }
            >
              {fmt(s)}
            </span>
          )
        })}
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        <kbd className="font-sans">§ 5</kbd> to cycle
      </div>
    </button>
  )
}
