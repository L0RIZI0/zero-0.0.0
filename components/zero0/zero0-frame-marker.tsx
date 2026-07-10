"use client"

import { toggleZero0Flag, FLAG_DIGIT, type Zero0Flag } from "@/lib/zero/zero0-chord"

/**
 * A discreet "§x" affordance pinned to the bottom-right corner of a hideable frame. The
 * digit mirrors the frame's § chord (§0 entity header, §1 zero header, §2 activity, §3
 * agenda), read from {@link FLAG_DIGIT} so the label can never drift from the keybinding.
 * Clicking it hides the frame (re-show via the chord, or — for AGENDA/ACTIVITY — the
 * footer link). The parent frame must be `relative` for the absolute placement to anchor.
 */
export function Zero0FrameMarker({ flag, label }: { flag: Zero0Flag; label: string }) {
  const digit = FLAG_DIGIT[flag]
  if (digit == null) return null
  return (
    <button
      type="button"
      onClick={() => toggleZero0Flag(flag)}
      className="absolute bottom-1 right-2 z-10 text-[10px] leading-none text-muted-foreground/40 transition-colors hover:text-foreground"
      aria-label={`Hide ${label} (§${digit})`}
      title={`Hide ${label} (§${digit})`}
    >
      {`§${digit}`}
    </button>
  )
}
