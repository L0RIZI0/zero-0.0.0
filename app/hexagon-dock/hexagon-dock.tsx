"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { X, Check, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * HEXAGON SPACES — standalone exploration prototype.
 *
 * Goal: understand what it means to give a *Space* entity a hexagon silhouette
 * across the THREE regions it can occupy in Zero, per the agreed model:
 *
 *   1. DO-LIST ROW  → stays a RECTANGLE (like today). Only its glyph is a hex.
 *                     The row shape is kind-agnostic, so spaces look like
 *                     everything else in a list. (Cheapest, zero layout risk.)
 *   2. DOCK CARD    → a true HEXAGON, matching the Space glyph.
 *   3. WINDOW       → a true HEXAGON (the opened entity is shaped like its glyph).
 *
 * Both the dock card and the row open the SAME hexagon window, via motion's
 * shared-layout (`layoutId`). Opening from the dock is a hexagon→hexagon morph
 * (clean). Opening from a row is the row's hex GLYPH growing into the window —
 * also hexagon→hexagon, which is why keeping the row rectangular but its glyph
 * hexagonal pays off: the seed of the window is already on screen.
 *
 * The silhouette is a PERCENTAGE-based `clip-path`, so it stays hexagonal at
 * every size between a 22px glyph and a 560px window.
 */

// Regular pointy-top hexagon (points top & bottom) — same orientation as Zero's
// Space glyph. Percentage points keep it hexagonal at any width/height.
const HEX = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)"

type SpaceItem = { id: string; label: string; done?: boolean }
type Space = { id: string; name: string; blurb: string; items: SpaceItem[] }

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
    ],
  },
]

// One spring drives both the size morph and the position glide so the hexagon
// feels like a single physical object expanding, not a card cross-dissolving.
const MORPH = { type: "spring" as const, stiffness: 320, damping: 34, mass: 0.9 }

type OpenState = { id: string; from: "dock" | "row" } | null

export function HexagonDock() {
  const [open, setOpen] = useState<OpenState>(null)
  const openSpace = SPACES.find((s) => s.id === open?.id) ?? null

  // The window shares its layoutId with whichever region launched it, so the
  // morph originates from the exact hexagon the user tapped.
  const windowLayoutId =
    open?.from === "dock" ? `dock-${open.id}` : open ? `rowglyph-${open.id}` : undefined

  return (
    <main className="relative flex min-h-svh flex-col bg-background text-foreground">
      <header className="px-6 pt-10 pb-6 text-center sm:pt-14">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Prototype
        </p>
        <h1 className="mt-2 text-balance font-sans text-2xl font-semibold tracking-tight sm:text-3xl">
          Hexagon Spaces
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground">
          A Space across its three regions. Rows stay rectangular (hex glyph
          only); dock cards and the opened window are true hexagons. Tap a dock
          hexagon or a row to morph into the window.
        </p>
      </header>

      <div className="mx-auto grid w-full max-w-5xl flex-1 gap-10 px-5 pb-28 lg:grid-cols-[minmax(0,360px)_1fr] lg:gap-12">
        {/* REGION 1 — DO-LIST: rectangular rows, hex glyph only. */}
        <section className="flex flex-col">
          <RegionLabel index={1} title="In the do-list" note="Rectangular row · hex glyph" />
          <ul className="mt-4 flex flex-col gap-1.5">
            {SPACES.map((space) => (
              <li key={space.id}>
                <button
                  onClick={() => setOpen({ id: space.id, from: "row" })}
                  aria-label={`Open ${space.name}`}
                  className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:bg-secondary"
                >
                  {/* Hex GLYPH badge — the row's only hexagon. Doubles as the
                      shared element that grows into the window. */}
                  <motion.span
                    layoutId={open?.from === "row" ? undefined : `rowglyph-${space.id}`}
                    style={{ clipPath: HEX }}
                    transition={MORPH}
                    className="flex h-[26px] w-[24px] shrink-0 items-center justify-center bg-foreground/10"
                  >
                    <HexGlyph className="h-3.5 w-3.5 text-foreground/80" />
                  </motion.span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium tracking-tight">{space.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{space.blurb}</span>
                  </span>
                  <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                    {space.items.filter((i) => !i.done).length}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* REGION 2 — DOCK: hexagon cards. */}
        <section className="flex flex-col">
          <RegionLabel index={2} title="In the dock" note="True hexagon card" />
          <div className="mt-4 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/40 p-6">
            <ul className="flex flex-wrap items-center justify-center gap-6 sm:gap-7">
              {SPACES.map((space) => (
                <li key={space.id} className="flex flex-col items-center">
                  {/* Fixed cell holds the footprint so siblings never shift when
                      this hexagon lifts out into a window. */}
                  <div className="relative h-[124px] w-[112px]">
                    {open?.id === space.id && open.from === "dock" ? (
                      <div className="h-full w-full" aria-hidden />
                    ) : (
                      <motion.button
                        layoutId={`dock-${space.id}`}
                        onClick={() => setOpen({ id: space.id, from: "dock" })}
                        transition={MORPH}
                        style={{ clipPath: HEX }}
                        className="group block h-full w-full bg-border outline-none"
                        aria-label={`Open ${space.name}`}
                      >
                        {/* Inner hexagon inset fakes a crisp 1.5px hex ring
                            (clip-path can't carry a border). */}
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
          </div>
        </section>
      </div>

      {/* Findings — what hexagon-ifying a Space actually costs. */}
      <section className="mx-auto w-full max-w-5xl px-5 pb-16">
        <RegionLabel index={3} title="What this means" note="Observations" />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Finding title="Rows are free">
            Keeping rows rectangular with a hex glyph means lists stay scannable
            and aligned. Zero risk — the glyph already carries the &quot;space&quot;
            identity.
          </Finding>
          <Finding title="Windows cost usable area">
            A hexagon window wastes the four corners; content must live in a
            central band (~60% width at the waist). Fine for a glanceable space
            summary, tight for dense task lists or nested windows.
          </Finding>
          <Finding title="Chrome needs rethinking">
            Close, IN/OUT rails, scroll edges and the header divider all assume
            straight edges today. On a hexagon they must hug the slanted sides or
            sit in the safe band — a real refactor of the window frame.
          </Finding>
        </div>
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
            onClick={() => setOpen(null)}
          >
            <motion.div
              layoutId={windowLayoutId}
              transition={MORPH}
              style={{ clipPath: HEX, width: "min(92vw, 560px)", height: "min(86svh, 600px)" }}
              className="relative bg-border"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Inner hexagon — the window surface (same ring trick, wider). */}
              <div
                style={{ clipPath: HEX }}
                className="flex h-full w-full flex-col items-center bg-card p-[2px]"
              >
                {/* Content lives in the hexagon's safe central band. The pointy
                    top/bottom are intentionally breathing room: glyph in the
                    upper third, list dead-center. */}
                <motion.div
                  className="flex h-full w-full flex-col items-center px-[17%] pt-[13%] pb-[11%]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.25 } }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                >
                  <HexGlyph className="h-9 w-9 text-foreground/80" />
                  <h2 className="mt-3 text-center text-xl font-semibold tracking-tight">
                    {openSpace.name}
                  </h2>
                  <p className="mt-1 text-center text-xs text-muted-foreground">{openSpace.blurb}</p>

                  <ul className="mt-5 flex w-full max-w-[260px] flex-col gap-1.5 overflow-y-auto">
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

              {/* Close — nudged toward the upper region so it stays inside the
                  hexagon silhouette (a corner X would fall outside the clip). */}
              <motion.button
                onClick={() => setOpen(null)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.16 } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                className="absolute right-[27%] top-[9%] flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
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

function RegionLabel({ index, title, note }: { index: number; title: string; note: string }) {
  return (
    <div className="flex items-baseline gap-2.5 border-b border-border pb-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[11px] font-semibold tabular-nums">
        {index}
      </span>
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <span className="ml-auto text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {note}
      </span>
    </div>
  )
}

function Finding({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h4 className="text-[13px] font-semibold tracking-tight">{title}</h4>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
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
