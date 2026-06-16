"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { X, Check, ChevronRight, PanelLeft, PanelRight } from "lucide-react"
import gsap from "gsap"
import { CustomEase } from "gsap/CustomEase"
import { Flip } from "gsap/Flip"
import { cn } from "@/lib/utils"

/**
 * HEXAGON SPACES — standalone exploration prototype, driven by GSAP (the same
 * engine Zero uses in `lib/zero/flip-stage.ts`), no Framer Motion.
 *
 * THE MODEL:
 *   1. DO-LIST ROW → stays a RECTANGLE. Only its glyph is a hexagon.
 *   2. DOCK CARD   → a true regular pointy-top HEXAGON, matching the glyph.
 *   3. WINDOW      → the SAME regular hexagon, just grown.
 *
 * No rotation, no stretched / flat-top hexagon anywhere — one pure regular
 * hexagon (HEX) for both the dock card and the window, sized to the regular
 * hexagon aspect ratio (HEX_RATIO) so it never looks squashed.
 *
 * HOW THE MORPH RUNS (a hand-rolled GSAP FLIP, mirroring Zero):
 *   • On click we capture the launcher's rect (FIRST). React commits the open
 *     window; in a useLayoutEffect (pre-paint) we measure the window (LAST), set
 *     the hexagon BACKGROUND layer to the launcher's transform, then tween it to
 *     identity. Geometry (scaleX/scaleY + x/y) and — for a row launch — the
 *     clip-path reshape (RECT6 → HEX) ride that one tween.
 *   • DOCK launch → hexagon → hexagon: a pure scale/translate grow.
 *   • ROW launch  → rectangle → hexagon reshape, and the glyph FLIPs up from the
 *     row into the header.
 *   • Content rides a SEPARATE, never-transformed layer, so text never distorts.
 */

// ── Shape + timing ──────────────────────────────────────────────────────────

// THE one shape: a regular pointy-top hexagon (points top & bottom), used for the
// glyph, the dock card, AND the window. Percentage points stay a regular hexagon
// at any size AS LONG AS the container honors HEX_RATIO below.
const HEX = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)"

// A rectangle written with the SAME six vertices as HEX, in the same order
// (top-mid, top-right, bottom-right, bottom-mid, bottom-left, top-left), so a ROW
// launch can morph rectangle → hexagon point-for-point.
const RECT6 = "polygon(50% 0%, 100% 0%, 100% 100%, 50% 100%, 0% 100%, 0% 0%)"

// Regular pointy-top hexagon aspect ratio (width : height) = √3 / 2. The dock card
// and the window are both sized to this so the clip-path renders as a TRUE regular
// hexagon rather than a stretched one.
const HEX_RATIO = Math.sqrt(3) / 2 // ≈ 0.866

const DUR = 0.62
const EASE = "zeroLand"

let easeReady = false
function ensureEase() {
  if (easeReady || typeof window === "undefined") return
  gsap.registerPlugin(CustomEase, Flip)
  // Same curve as Zero's MORPH_EASE: a firm pull through the middle, soft settle.
  CustomEase.create("zeroLand", "M0,0 C0.62,0.02 0.07,0.99 1,1")
  easeReady = true
}

// Resting transform for a window at a given depth: deeper levels sit slightly
// smaller and lifted, so the parent's top shoulders + glyph peek above the child.
const scaleFor = (depth: number) => 1 - depth * 0.12
const shiftFor = (depth: number) => depth * -54

// ── Data ─────────────────────────────────────────────────────────────────────

type SpaceItem = { id: string; label: string; done?: boolean }
type Space = {
  id: string
  name: string
  blurb: string
  items: SpaceItem[]
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

// ── Flip identity ───────────────────────────────────────────────────────────

// THE load-bearing idea (lifted from Zero): there is ONE persistent hexagon per
// launcher, identified by a shared data-flip-id. The hexagon exists in the
// launcher (small — dock card or row glyph) and in the window (large). They are
// different DOM nodes, but because GSAP Flip matches by flip-id across a React
// commit, it treats them as the SAME object and tweens one into the other. So the
// hexagon literally grows out of the card and shrinks back into it — never an
// empty shell that pops.
//
// Each Space is shown in BOTH the row list and the dock, so the flip-id must
// encode the region too (otherwise two nodes share an id and Flip can't tell which
// to match). Every launcher carries its own id permanently; the open window's
// background carries the id of whichever launcher opened it. At any instant only
// one of {launcher, window} is mounted for a given id, so the match is exact.
const fidFor = (from: "dock" | "row", id: string) => `hex-${from}-${id}`

// ── Component ─────────────────────────────────────────────────────────────────

export function HexagonDock() {
  ensureEase()
  const [open, setOpen] = useState<{ id: string; from: "dock" | "row" } | null>(null)
  const [stack, setStack] = useState<Space[]>([])

  const stageRef = useRef<HTMLDivElement | null>(null)
  const backdropRef = useRef<HTMLDivElement | null>(null)
  // Flip.getState snapshot captured BEFORE a commit; replayed AFTER it.
  const flipState = useRef<Flip.FlipState | null>(null)
  const pendingRef = useRef<"open" | "close" | null>(null)
  const launchMeta = useRef<LaunchMeta | null>(null)

  const rootSpace = SPACES.find((s) => s.id === open?.id) ?? null

  // The persistent hexagon for the about-to-open Space currently lives in the
  // launcher (its data-glyph carries the flip-id). Snapshot it, then commit the
  // window — Flip will match the same flip-id in the window and grow it across.
  function launch(id: string, from: "dock" | "row") {
    const space = SPACES.find((s) => s.id === id)
    if (!space) return
    flipState.current = Flip.getState(`[data-flip-id="${FID}"]`, { props: "clipPath,borderRadius" })
    pendingRef.current = "open"
    launchMeta.current = { id, from }
    setOpen({ id, from })
    setStack([space])
  }

  function close() {
    if (!flipState.current) {
      // No snapshot to return to — capture the window now so it still animates.
      flipState.current = Flip.getState(`[data-flip-id="${FID}"]`, { props: "clipPath,borderRadius" })
    }
    pendingRef.current = "close"
    // Fade out the window body chrome up front; the hexagon itself will shrink.
    const stage = stageRef.current
    if (stage) {
      const fade = stage.querySelectorAll("[data-fade]")
      if (fade.length) gsap.to(fade, { autoAlpha: 0, duration: DUR * 0.32, ease: EASE })
      for (let d = 1; d < stack.length; d++) {
        const w = stage.querySelector<HTMLElement>(`[data-window-root][data-depth="${d}"]`)
        if (w) gsap.to(w, { autoAlpha: 0, duration: DUR * 0.4, ease: EASE })
      }
    }
    if (backdropRef.current) gsap.to(backdropRef.current, { autoAlpha: 0, duration: DUR, ease: EASE })
    // Commit the close; the layout effect replays the captured launcher state.
    setOpen(null)
    setStack([])
  }

  function openChild(child: Space) {
    setStack((s) => [...s, child])
  }

  function popChild() {
    const stage = stageRef.current
    const depth = stack.length - 1
    if (depth < 1) return
    const win = stage?.querySelector<HTMLElement>(`[data-window-root][data-depth="${depth}"]`)
    if (!win) {
      setStack((s) => s.slice(0, -1))
      return
    }
    gsap.to(win, {
      autoAlpha: 0,
      scale: scaleFor(depth) * 0.85,
      y: shiftFor(depth) + 30,
      duration: DUR * 0.7,
      ease: EASE,
      onComplete: () => setStack((s) => s.slice(0, -1)),
    })
  }

  // After every commit: if we have a captured Flip state, play it. This is the
  // single mechanism that drives BOTH open (small → large) and close (large →
  // small) — the same persistent hexagon node, matched by flip-id.
  useLayoutEffect(() => {
    const pending = pendingRef.current
    const state = flipState.current
    if (!pending || !state) return
    pendingRef.current = null
    flipState.current = null
    const meta = launchMeta.current

    Flip.from(state, {
      duration: DUR,
      ease: EASE,
      absolute: true,
      // A row launcher's glyph is a hexagon already, so no shape tween is needed;
      // the dock card is also a hexagon. The window hexagon is the same shape, so
      // Flip just scales/translates it — a clean grow/shrink.
      onEnter: (els) => gsap.fromTo(els, { autoAlpha: 0 }, { autoAlpha: 1, duration: DUR * 0.5, ease: EASE }),
      onLeave: (els) => gsap.to(els, { autoAlpha: 0, duration: DUR * 0.4, ease: EASE }),
    })

    if (pending === "open") {
      const stage = stageRef.current
      if (stage) {
        const fade = stage.querySelectorAll('[data-window-root][data-depth="0"] [data-fade]')
        if (fade.length)
          gsap.fromTo(fade, { autoAlpha: 0 }, { autoAlpha: 1, delay: DUR * 0.35, duration: DUR * 0.45, ease: EASE })
      }
      if (backdropRef.current)
        gsap.fromTo(backdropRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: DUR * 0.6, ease: EASE })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stack.length])

  // Child push/pop (depths ≥ 1) is a plain grow, not a flip.
  const prevLenRef = useRef(0)
  useLayoutEffect(() => {
    const len = stack.length
    const prev = prevLenRef.current
    prevLenRef.current = len
    if (len > prev && prev >= 1) enterChild(len - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack.length])

  function enterChild(depth: number) {
    const stage = stageRef.current
    if (!stage) return
    const win = stage.querySelector<HTMLElement>(`[data-window-root][data-depth="${depth}"]`)
    if (!win) return
    gsap.fromTo(
      win,
      { autoAlpha: 0, scale: scaleFor(depth) * 0.86, y: shiftFor(depth) + 44 },
      { autoAlpha: 1, scale: scaleFor(depth), y: shiftFor(depth), duration: DUR, ease: EASE },
    )
  }

  return (
    <main className="relative flex min-h-svh flex-col bg-background text-foreground">
      <header className="px-6 pt-10 pb-6 text-center sm:pt-14">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Prototype</p>
        <h1 className="mt-2 text-balance font-sans text-2xl font-semibold tracking-tight sm:text-3xl">Hexagon Spaces</h1>
        <p className="mx-auto mt-3 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground">
          A Space across its three regions, morphed with GSAP (Zero&apos;s engine). Rows stay rectangular (hex glyph only); the dock
          card and the window are the same pure regular hexagon. Open one, then use the IN rail to push into a nested child.
        </p>
      </header>

      <div className="mx-auto grid w-full max-w-5xl flex-1 gap-10 px-5 pb-28 lg:grid-cols-[minmax(0,360px)_1fr] lg:gap-12">
        {/* REGION 1 — DO-LIST: rectangular rows, hex glyph only. */}
        <section className="flex flex-col">
          <RegionLabel index={1} title="In the do-list" note="Rectangular row · hex glyph" />
          <ul className="mt-4 flex flex-col gap-1.5">
            {SPACES.map((space) => {
              const morphing = open?.id === space.id && open.from === "row"
              return (
                <li key={space.id}>
                  {morphing ? (
                    <div className="h-[60px]" aria-hidden />
                  ) : (
                    <button
                      onClick={(e) => launch(space.id, "row", e.currentTarget)}
                      aria-label={`Open ${space.name}`}
                      className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:bg-secondary"
                    >
                      <span
                        data-glyph
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
                    </button>
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
                  {/* Fixed cell holds the footprint; sized to HEX_RATIO. */}
                  <div className="relative h-[124px] w-[108px]">
                    {open?.id === space.id && open.from === "dock" ? (
                      <div className="h-full w-full" aria-hidden />
                    ) : (
                      <button
                        onClick={(e) => launch(space.id, "dock", e.currentTarget)}
                        style={{ clipPath: HEX }}
                        className="group block h-full w-full bg-border outline-none"
                        aria-label={`Open ${space.name}`}
                      >
                        <span
                          data-glyph
                          style={{ clipPath: HEX }}
                          className="flex h-full w-full flex-col items-center justify-center gap-2 bg-card p-[1.5px] transition-colors group-hover:bg-secondary"
                        >
                          <HexGlyph className="h-7 w-7 text-foreground/80" />
                          <span className="px-2 text-center text-[13px] font-medium leading-tight tracking-tight">
                            {space.name}
                          </span>
                          <OpenCount
                            n={space.items.filter((i) => !i.done).length}
                            className="text-[10px] text-muted-foreground"
                          />
                        </span>
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {/* Findings. */}
      <section className="mx-auto w-full max-w-5xl px-5 pb-16">
        <RegionLabel index={3} title="What this means" note="Observations" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Finding title="GSAP, like Zero">
            Driven by a hand-rolled GSAP FLIP + the shared &quot;zeroLand&quot; ease — the same engine as the real app, no Framer
            layout projection.
          </Finding>
          <Finding title="One pure hexagon">
            The dock card and the window are the exact same regular pointy-top hexagon, sized to the √3/2 aspect ratio so it never
            looks squashed.
          </Finding>
          <Finding title="Two entries, two motions">
            From the dock the card grows hexagon → hexagon (pure scale); from a row it reshapes rectangle → hexagon and the glyph
            FLIPs up from the row.
          </Finding>
          <Finding title="Content lives in the waist">
            A regular hexagon clips its top/bottom points, so content insets into the central band and the IN/OUT rails hug the
            vertical waist edges.
          </Finding>
        </div>
      </section>

      {/* WINDOW STACK. */}
      {rootSpace && stack.length > 0 && (
        <div
          ref={backdropRef}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "oklch(0.235 0.006 60 / 0.45)" }}
          onClick={close}
        >
          <div
            ref={stageRef}
            className="relative"
            style={{
              height: "min(86svh, 600px)",
              width: "min(94vw, calc(min(86svh, 600px) * var(--hex-ratio)))",
              ["--hex-ratio" as string]: HEX_RATIO,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {stack.map((space, depth) => {
              const isTop = depth === stack.length - 1
              return (
                <div
                  key={space.id}
                  data-window-root
                  data-depth={depth}
                  data-window={space.id}
                  className="absolute inset-0"
                  style={{ transform: `translateY(${shiftFor(depth)}px) scale(${scaleFor(depth)})`, transformOrigin: "center top" }}
                >
                  {/* RESHAPING BACKGROUND — owns the morph transform. */}
                  <div data-bg data-depth={depth} className="absolute inset-0 bg-border" style={{ clipPath: HEX }}>
                    <div
                      className={cn("absolute inset-[2px] bg-card", !isTop && "brightness-[0.97]")}
                      style={{ clipPath: HEX }}
                    />
                  </div>

                  {/* CONTENT — never transformed, so text/glyph stay crisp. */}
                  <div data-content data-depth={depth} className="absolute inset-0 flex flex-col items-center">
                    {isTop ? (
                      <SpaceWindowContent space={space} />
                    ) : (
                      <div className="flex w-full flex-col items-center pt-[14%]">
                        <HexGlyph className="h-5 w-5 text-foreground/60" />
                        <span className="mt-1 text-xs font-medium text-muted-foreground">{space.name}</span>
                      </div>
                    )}
                  </div>

                  {isTop && (
                    <>
                      <SideRail
                        side="in"
                        label={space.child ? `Open ${space.child.name}` : "No child space"}
                        disabled={!space.child}
                        onClick={() => space.child && openChild(space.child)}
                      />
                      <SideRail side="out" label="Outputs" disabled onClick={() => {}} />
                      <button
                        onClick={depth === 0 ? close : popChild}
                        data-fade
                        className="absolute right-[15%] top-[14%] z-10 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        aria-label={depth === 0 ? `Close ${space.name}` : `Back from ${space.name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </main>
  )
}

/** The frontmost hexagon window's content, kept inside the regular hexagon's safe
 *  central band (top/bottom points are clipped, so we inset vertically). The glyph
 *  carries data-glyph so a row launch can FLIP it up from the row. */
function SpaceWindowContent({ space }: { space: Space }) {
  return (
    <div className="flex h-full w-full flex-col items-center px-[18%] pt-[16%] pb-[14%]">
      {/* glyph + title travel together as the header — they FLIP between the
          launcher (dock card / row) and this position on open/close, so the
          window never collapses to an empty hexagon. */}
      <div data-header className="flex flex-col items-center">
        <div data-glyph className="flex items-center justify-center">
          <HexGlyph className="h-9 w-9 text-foreground/80" />
        </div>
        <h2 className="mt-3 text-center text-xl font-semibold tracking-tight">{space.name}</h2>
      </div>
      <p data-fade className="mt-1 text-center text-xs text-muted-foreground">
        {space.blurb}
      </p>

      <ul data-fade className="mt-5 flex w-full max-w-[300px] flex-col gap-1.5 overflow-y-auto">
        {space.items.map((item) => (
          <li key={item.id} className="flex items-center gap-2.5 rounded-md bg-secondary/60 px-3 py-2">
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                item.done ? "border-accent bg-accent text-accent-foreground" : "border-border",
              )}
            >
              {item.done && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className={cn("truncate text-sm", item.done && "text-muted-foreground line-through")}>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * IN / OUT side rail — sits on the regular hexagon's vertical edge at the waist
 * (mid-height), the one place a pointy-top hexagon offers a straight vertical run.
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
    <button
      onClick={onClick}
      disabled={disabled}
      data-fade
      aria-label={label}
      title={label}
      className={cn(
        "absolute top-1/2 z-10 flex h-14 w-7 -translate-y-1/2 flex-col items-center justify-center gap-1",
        side === "in" ? "left-[1.5%]" : "right-[1.5%]",
        disabled ? "cursor-default text-muted-foreground/30" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="text-[9px] font-semibold uppercase tracking-wider [writing-mode:vertical-rl]">{side}</span>
    </button>
  )
}

function RegionLabel({ index, title, note }: { index: number; title: string; note: string }) {
  return (
    <div className="flex items-baseline gap-2.5 border-b border-border pb-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[11px] font-semibold tabular-nums">
        {index}
      </span>
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <span className="ml-auto text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{note}</span>
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

/** Small square = a "task" mark, exactly like Zero's open-count stat on a dock card. */
function TaskSquareGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="4.5" y="4.5" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Open-task count + task-square glyph (the "3 □" stat used on dock cards / rows). */
function OpenCount({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("flex items-center gap-1 tabular-nums", className)}>
      <span className="font-medium">{n}</span>
      <span className="flex h-2.5 w-2.5 items-center justify-center">
        <TaskSquareGlyph className="h-2.5 w-2.5" />
      </span>
    </span>
  )
}
