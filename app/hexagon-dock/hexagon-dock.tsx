"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { X, Check } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * HEXAGON DOCK — standalone prototype.
 *
 * Spaces render as hexagonal dock cards. Clicking one morphs that very hexagon
 * IN PLACE into a large hexagon "window" (the bonus): instead of two separate
 * shapes, motion's shared-layout (`layoutId`) glides a single hexagon from the
 * dock footprint up to the centered window and back.
 *
 * Why it stays a hexagon the whole way: the silhouette is a PERCENTAGE-based
 * `clip-path` polygon (a regular pointy-top hexagon, matching Zero's Space
 * glyph). Because the points are percentages, the same clip scales with the
 * element at every frame of the size/position morph — so the shape reads as a
 * hexagon when it's a 120px card, a 560px window, and everything between.
 */

// Regular pointy-top hexagon (points top & bottom, flat left/right sides) — the
// same orientation as the Space glyph elsewhere in Zero. Percentage points keep
// it hexagonal at any width/height as the element morphs.
const HEX =
  "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)"

type SpaceItem = { id: string; label: string; done?: boolean }
type Space = {
  id: string
  name: string
  blurb: string
  items: SpaceItem[]
}

const SPACES: Space[] = [
  {
    id: "dayjob",
    name: "Day Job",
    blurb: "Product strategy & delivery",
    items: [
      { id: "a1", label: "Finalize investor narrative", done: true },
      { id: "a2", label: "Review Q3 roadmap" },
      { id: "a3", label: "Follow up with Romain" },
      { id: "a4", label: "Draft launch brief" },
    ],
  },
  {
    id: "health",
    name: "Health",
    blurb: "Training & recovery",
    items: [
      { id: "b1", label: "Morning run — 6km", done: true },
      { id: "b2", label: "Mobility session" },
      { id: "b3", label: "Book physio" },
    ],
  },
  {
    id: "journal",
    name: "Journal",
    blurb: "Notes & reflection",
    items: [
      { id: "c1", label: "Weekly review" },
      { id: "c2", label: "Idea: hexagon docks" },
      { id: "c3", label: "Gratitude — 3 things", done: true },
    ],
  },
  {
    id: "admin",
    name: "Admin",
    blurb: "Operations & paperwork",
    items: [
      { id: "d1", label: "File expenses" },
      { id: "d2", label: "Renew domain" },
      { id: "d3", label: "Sign contract", done: true },
      { id: "d4", label: "Update banking details" },
    ],
  },
  {
    id: "research",
    name: "Research",
    blurb: "Reading & exploration",
    items: [
      { id: "e1", label: "Read motion layout docs", done: true },
      { id: "e2", label: "Survey clip-path tricks" },
      { id: "e3", label: "Collect references" },
    ],
  },
]

// One spring drives both the size morph and the position glide so the hexagon
// feels like a single physical object expanding, not a card cross-dissolving.
const MORPH = { type: "spring" as const, stiffness: 320, damping: 34, mass: 0.9 }

export function HexagonDock() {
  const [openId, setOpenId] = useState<string | null>(null)
  const openSpace = SPACES.find((s) => s.id === openId) ?? null

  return (
    <main className="relative flex min-h-svh flex-col bg-background text-foreground">
      <header className="px-6 pt-10 pb-6 text-center sm:pt-16">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Prototype
        </p>
        <h1 className="mt-2 text-balance font-sans text-2xl font-semibold tracking-tight sm:text-3xl">
          Hexagon Dock
        </h1>
        <p className="mx-auto mt-3 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
          Spaces live as hexagons. Tap one — the hexagon itself grows into its
          window, and shrinks right back into the dock when you close it.
        </p>
      </header>

      {/* DOCK — the row of hexagonal space cards. */}
      <section className="flex flex-1 items-center justify-center px-4 pb-24">
        <ul className="flex flex-wrap items-center justify-center gap-6 sm:gap-8">
          {SPACES.map((space) => (
            <li key={space.id} className="flex flex-col items-center gap-3">
              {/* Fixed-size cell holds the dock footprint so siblings never
                  shift when this hexagon lifts out into a window. */}
              <div className="relative h-[124px] w-[112px]">
                {openId === space.id ? (
                  // Invisible placeholder keeps the row layout stable while the
                  // real hexagon is "lifted" into the centered overlay below.
                  <div className="h-full w-full" aria-hidden />
                ) : (
                  <motion.button
                    layoutId={`hex-${space.id}`}
                    onClick={() => setOpenId(space.id)}
                    transition={MORPH}
                    style={{ clipPath: HEX }}
                    className="group block h-full w-full bg-border outline-none"
                    aria-label={`Open ${space.name}`}
                  >
                    {/* Inner hexagon inset by the wrapper's padding fakes a crisp
                        1.5px hex ring (clip-path can't take a border). */}
                    <span
                      style={{ clipPath: HEX }}
                      className="flex h-full w-full flex-col items-center justify-center gap-2 bg-card p-[1.5px] transition-colors group-hover:bg-secondary"
                    >
                      <HexGlyph className="h-7 w-7 text-foreground/80" />
                      <span className="px-2 text-center text-[13px] font-medium leading-tight tracking-tight">
                        {space.name}
                      </span>
                      <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                        {space.items.filter((i) => !i.done).length} open
                      </span>
                    </span>
                  </motion.button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* WINDOW — the same hexagon, grown. */}
      <AnimatePresence>
        {openSpace && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ backgroundColor: "oklch(0.235 0.006 60 / 0)" }}
            animate={{ backgroundColor: "oklch(0.235 0.006 60 / 0.45)" }}
            exit={{ backgroundColor: "oklch(0.235 0.006 60 / 0)" }}
            transition={{ duration: 0.3 }}
            onClick={() => setOpenId(null)}
          >
            <motion.div
              layoutId={`hex-${openSpace.id}`}
              transition={MORPH}
              style={{ clipPath: HEX, width: "min(92vw, 560px)", height: "min(88svh, 620px)" }}
              className="relative bg-border"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Inner hexagon — the window surface (same ring trick, wider). */}
              <div
                style={{ clipPath: HEX }}
                className="flex h-full w-full flex-col items-center bg-card p-[2px]"
              >
                {/* Content lives in the hexagon's safe central band. The pointy
                    top/bottom are intentionally left as breathing room, with the
                    glyph in the upper third and the list dead-center. */}
                <motion.div
                  className="flex h-full w-full flex-col items-center px-[16%] pt-[14%] pb-[12%]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.25 } }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                >
                  <HexGlyph className="h-9 w-9 text-foreground/80" />
                  <h2 className="mt-3 text-center text-xl font-semibold tracking-tight">
                    {openSpace.name}
                  </h2>
                  <p className="mt-1 text-center text-xs text-muted-foreground">
                    {openSpace.blurb}
                  </p>

                  <ul className="mt-6 flex w-full max-w-[260px] flex-col gap-1.5 overflow-y-auto">
                    {openSpace.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center gap-2.5 rounded-md bg-secondary/60 px-3 py-2"
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                            item.done
                              ? "border-accent bg-accent text-accent-foreground"
                              : "border-border",
                          )}
                        >
                          {item.done && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span
                          className={cn(
                            "truncate text-sm",
                            item.done && "text-muted-foreground line-through",
                          )}
                        >
                          {item.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </div>

              {/* Close — nudged toward the upper-right flat-ish region so it
                  stays inside the hexagon silhouette. */}
              <motion.button
                onClick={() => setOpenId(null)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.16 } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                className="absolute right-[26%] top-[10%] flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label={`Close ${openSpace.name}`}
              >
                <X className="h-4 w-4" />
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  )
}

/** Pointy-top hexagon glyph, matching the clip-path silhouette. */
function HexGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <polygon
        points="12,2.3 20.6,7.1 20.6,16.9 12,21.7 3.4,16.9 3.4,7.1"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="miter"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
