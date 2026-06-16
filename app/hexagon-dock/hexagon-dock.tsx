"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { X, Check, ChevronRight, PanelLeft, PanelRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * HEXAGON SPACES — standalone exploration prototype.
 *
 * Goal: understand what it means to give a *Space* entity a hexagon silhouette
 * across the THREE regions it can occupy in Zero, per the agreed model:
 *
 *   1. DO-LIST ROW  → stays a RECTANGLE (like today). Only its glyph is a hex.
 *   2. DOCK CARD    → a true HEXAGON, matching the Space glyph.
 *   3. WINDOW       → a true HEXAGON (the opened entity is shaped like its glyph).
 *
 * This pass pushes on the HARD cases that decide feasibility:
 *   • ROW → WINDOW morph, shown deliberately: the row's hex glyph is the seed
 *     that grows into the full hexagon window (hexagon→hexagon throughout).
 *   • IN / OUT rails — Zero's signature side shortcuts — hugging the hexagon's
 *     two VERTICAL edges at the waist (the only straight edges a hexagon has).
 *   • NESTED CHILD — opening a sub-space stacks a second hexagon on top, with
 *     the parent peeking behind. Tests whether Zero's deep-stack model reads
 *     when every frame is a hexagon.
 *
 * The silhouette is a PERCENTAGE-based `clip-path`, so it stays hexagonal at
 * every size between a 24px glyph and a 560px window.
 */

// Regular pointy-top hexagon (points top & bottom) — same orientation as Zero's
// Space glyph. Used for the dock cards + glyph identity. Percentage points keep
// it hexagonal at any width/height.
const HEX = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)"

// FLATTENED hexagon for the WINDOW: a near-rectangle with only shallow chamfers,
// so the top/bottom edges run almost flat and the usable rectangular area is
// maximized. Crucially it keeps the SAME SIX VERTICES IN THE SAME ORDER as HEX
// (top-mid, top-right, bottom-right, bottom-mid, bottom-left, top-left), so the
// RECT6→window clip-path morph still interpolates point-for-point. The "peak" at
// 50% 0% / 50% 100% is pulled to the edges (y 0/100) and the side vertices are
// brought to 6%/94%, turning the steep hexagon into a wide, hexagon-flavored
// rectangle that still reads as a hex at the four angled corners.
const HEX_WIN = "polygon(50% 0%, 100% 6%, 100% 94%, 50% 100%, 0% 94%, 0% 6%)"

// A full-bounds RECTANGLE expressed with the SAME SIX vertices as HEX, in the
// same order, so motion can interpolate clip-path rect→hex point-for-point. Each
// vertex maps to its hex counterpart (top-mid, top-right, bottom-right,
// bottom-mid, bottom-left, top-left). This lets the WHOLE row card visibly
// reshape into the hexagon during the morph, instead of just resizing.
const RECT6 = "polygon(50% 0%, 100% 0%, 100% 100%, 50% 100%, 0% 100%, 0% 0%)"

type SpaceItem = { id: string; label: string; done?: boolean }
type Space = {
  id: string
  name: string
  blurb: string
  items: SpaceItem[]
  // A nested sub-space, to exercise the hexagon stacking model.
  child?: Space
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
    child: {
      id: "dayjob-strategy",
      name: "Strategy",
      blurb: "Nested sub-space",
      items: [
        { id: "s1", label: "Positioning memo" },
        { id: "s2", label: "Competitor teardown", done: true },
        { id: "s3", label: "Pricing model" },
      ],
    },
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
    child: {
      id: "health-nutrition",
      name: "Nutrition",
      blurb: "Nested sub-space",
      items: [
        { id: "n1", label: "Meal prep Sunday" },
        { id: "n2", label: "Log macros", done: true },
      ],
    },
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
// feels like a single physical object expanding. Slightly softer than a snap so
// the row→window expansion stays legible.
const MORPH = { type: "spring" as const, stiffness: 260, damping: 32, mass: 1 }

type OpenState = { id: string; from: "dock" | "row" } | null

export function HexagonDock() {
  // The window stack: index 0 is the root space, each push is a nested child.
  const [open, setOpen] = useState<OpenState>(null)
  const [stack, setStack] = useState<Space[]>([])

  const rootSpace = SPACES.find((s) => s.id === open?.id) ?? null

  function launch(id: string, from: "dock" | "row") {
    const space = SPACES.find((s) => s.id === id)
    if (!space) return
    setOpen({ id, from })
    setStack([space])
  }
  function close() {
    setOpen(null)
    setStack([])
  }
  function openChild(child: Space) {
    setStack((s) => [...s, child])
  }
  function popChild() {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  }

  // The window shares its layoutId with whichever region launched it, so the
  // morph originates from the exact hexagon the user tapped.
  const windowLayoutId =
    open?.from === "dock" ? `dock-${open.id}` : open ? `row-${open.id}` : undefined

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
          only); dock cards and the opened window are true hexagons. Open one,
          then use the IN rail to push into a nested child hexagon.
        </p>
      </header>

      <div className="mx-auto grid w-full max-w-5xl flex-1 gap-10 px-5 pb-28 lg:grid-cols-[minmax(0,360px)_1fr] lg:gap-12">
        {/* REGION 1 — DO-LIST: rectangular rows, hex glyph only. */}
        <section className="flex flex-col">
          <RegionLabel index={1} title="In the do-list" note="Rectangular row · hex glyph" />
          <ul className="mt-4 flex flex-col gap-1.5">
            {SPACES.map((space) => {
              // While THIS row is the open window, unmount it (a duplicate
              // layoutId would break the projection) and hold its footprint with
              // a spacer so the list doesn't reflow.
              const morphing = open?.id === space.id && open.from === "row"
              return (
                <li key={space.id}>
                  {morphing ? (
                    <div className="h-[60px]" aria-hidden />
                  ) : (
                    // The WHOLE row card is the shared element. Its layoutId is
                    // matched by the window, so the entire rectangle projects into
                    // the hexagon — not just the glyph. At rest it's an ordinary
                    // rounded rectangle row, exactly like today.
                    <motion.button
                      layoutId={`row-${space.id}`}
                      onClick={() => launch(space.id, "row")}
                      aria-label={`Open ${space.name}`}
                      transition={MORPH}
                      className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:bg-secondary"
                    >
                      {/* The row's only hexagon is its glyph badge. */}
                      <span
                        style={{ clipPath: HEX }}
                        className="flex h-[26px] w-[24px] shrink-0 items-center justify-center bg-foreground/10"
                      >
                        <HexGlyph className="h-3.5 w-3.5 text-foreground/80" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium tracking-tight">{space.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{space.blurb}</span>
                      </span>
                      <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                        {space.items.filter((i) => !i.done).length}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                    </motion.button>
                  )}
                </li>
              )
            })}
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
                        onClick={() => launch(space.id, "dock")}
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
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Finding title="Rows are free">
            Rectangular rows with a hex glyph keep lists scannable and aligned.
            Zero risk — the glyph already carries the &quot;space&quot; identity.
          </Finding>
          <Finding title="Windows cost usable area">
            A hexagon wastes the four corners; content lives in a central band
            (~66% width at the waist). Fine for a glanceable summary, tight for
            dense lists.
          </Finding>
          <Finding title="Rails fit the waist">
            IN/OUT shortcuts land naturally on the two vertical edges at the
            waist — the only straight sides a hexagon has. Above/below the waist
            there is no vertical edge to hug.
          </Finding>
          <Finding title="Stacking gets loose">
            Nested hexagons can&apos;t tile flush like rounded rectangles; a child
            sits inset with the parent&apos;s shoulders peeking. Depth reads, but
            the tidy left-edge spine of today is lost.
          </Finding>
        </div>
      </section>

      {/* WINDOW STACK — the same hexagon, grown, plus any nested children. */}
      <AnimatePresence>
        {rootSpace && stack.length > 0 && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ backgroundColor: "oklch(0.235 0.006 60 / 0)" }}
            animate={{ backgroundColor: "oklch(0.235 0.006 60 / 0.45)" }}
            exit={{ backgroundColor: "oklch(0.235 0.006 60 / 0)" }}
            transition={{ duration: 0.3 }}
            onClick={close}
          >
            {/* Stage holds the window footprint; children stack within it. */}
            <div
              className="relative"
              style={{ width: "min(92vw, 560px)", height: "min(86svh, 600px)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {stack.map((space, depth) => {
                const isTop = depth === stack.length - 1
                // Each nested level insets and shifts up so the parent's top
                // shoulders + glyph peek above the child — a hexagon-native peek.
                const scale = 1 - depth * 0.12
                const shiftY = depth * -54
                // The ROOT launched from a ROW starts as a rectangle (matching the
                // row card silhouette) and reshapes into the hexagon as it grows,
                // so the entire card morphs — not just its size. Launched from the
                // dock it's already a hexagon, so it stays hex throughout.
                const reshapeFromRect = depth === 0 && open?.from === "row"
                return (
                  <motion.div
                    key={space.id}
                    // Only the ROOT shares layout with the launcher (row/dock).
                    layoutId={depth === 0 ? windowLayoutId : undefined}
                    initial={
                      depth === 0
                        ? reshapeFromRect
                          ? { clipPath: RECT6 }
                          : { clipPath: HEX_WIN }
                        : { opacity: 0, scale: scale * 0.8, y: shiftY + 40, clipPath: HEX_WIN }
                    }
                    animate={{ opacity: 1, scale, y: shiftY, clipPath: HEX_WIN }}
                    exit={
                      depth === 0 && reshapeFromRect
                        ? { clipPath: RECT6, opacity: 0 }
                        : { opacity: 0, scale: scale * 0.85, y: shiftY + 30, clipPath: HEX_WIN }
                    }
                    transition={MORPH}
                    style={{ transformOrigin: "center top" }}
                    className="absolute inset-0 bg-border"
                  >
                    {/* Inner hexagon — the window surface. Reshapes in lockstep. */}
                    <motion.div
                      initial={{ clipPath: reshapeFromRect ? RECT6 : HEX_WIN }}
                      animate={{ clipPath: HEX_WIN }}
                      exit={{ clipPath: reshapeFromRect ? RECT6 : HEX_WIN }}
                      transition={MORPH}
                      className={cn(
                        "flex h-full w-full flex-col items-center bg-card p-[2px]",
                        !isTop && "brightness-[0.97]",
                      )}
                    >
                      {isTop ? (
                        <SpaceWindowContent space={space} />
                      ) : (
                        // Ancestor peek — just the glyph + name near the top point.
                        <div className="flex w-full flex-col items-center pt-[7%]">
                          <HexGlyph className="h-5 w-5 text-foreground/60" />
                          <span className="mt-1 text-xs font-medium text-muted-foreground">
                            {space.name}
                          </span>
                        </div>
                      )}
                    </motion.div>

                    {isTop && (
                      <>
                        {/* IN / OUT rails — hug the two vertical edges at the
                            waist (the hexagon's only straight sides). */}
                        <SideRail
                          side="in"
                          label={space.child ? `Open ${space.child.name}` : "No child space"}
                          disabled={!space.child}
                          onClick={() => space.child && openChild(space.child)}
                        />
                        <SideRail side="out" label="Outputs" disabled onClick={() => {}} />

                        {/* Close (or back, when nested) — kept inside the
                            silhouette near the top region. */}
                        <motion.button
                          onClick={depth === 0 ? close : popChild}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1, transition: { delay: 0.16 } }}
                          exit={{ opacity: 0, transition: { duration: 0.1 } }}
                          className="absolute right-[6%] top-[7%] flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                          aria-label={depth === 0 ? `Close ${space.name}` : `Back from ${space.name}`}
                        >
                          <X className="h-4 w-4" />
                        </motion.button>
                      </>
                    )}
                  </motion.div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  )
}

/** The frontmost hexagon window's content. The flattened window only clips
 *  shallow corners, so content can run close to the edges like a real window —
 *  just keep the left/right rail gutters clear and ease the top/bottom slightly. */
function SpaceWindowContent({ space }: { space: Space }) {
  return (
    <motion.div
      className="flex h-full w-full flex-col items-center px-[12%] pt-[7%] pb-[6%]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.25 } }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
    >
      <HexGlyph className="h-9 w-9 text-foreground/80" />
      <h2 className="mt-3 text-center text-xl font-semibold tracking-tight">{space.name}</h2>
      <p className="mt-1 text-center text-xs text-muted-foreground">{space.blurb}</p>

      <ul className="mt-5 flex w-full max-w-[360px] flex-col gap-1.5 overflow-y-auto">
        {space.items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-2.5 rounded-md bg-secondary/60 px-3 py-2"
          >
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                item.done ? "border-accent bg-accent text-accent-foreground" : "border-border",
              )}
            >
              {item.done && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className={cn("truncate text-sm", item.done && "text-muted-foreground line-through")}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}

/**
 * IN / OUT side rail — hugs the window's long vertical edge. With the FLATTENED
 * window the straight vertical run spans nearly the full height (side vertices at
 * y6%/94%), so the rail no longer has to crowd a narrow waist — it sits centered
 * on an almost-full-height straight edge, just like a real window.
 */
function SideRail({
  side,
  label,
  disabled,
  onClick,
}: {
  side: "in" | "out"
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  const Icon = side === "in" ? PanelLeft : PanelRight
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: 0.18 } }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      aria-label={label}
      title={label}
      className={cn(
        "absolute top-1/2 z-10 flex h-14 w-7 -translate-y-1/2 flex-col items-center justify-center gap-1",
        side === "in" ? "left-[1.5%]" : "right-[1.5%]",
        disabled ? "cursor-default text-muted-foreground/30" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="text-[9px] font-semibold uppercase tracking-wider [writing-mode:vertical-rl]">
        {side}
      </span>
    </motion.button>
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
