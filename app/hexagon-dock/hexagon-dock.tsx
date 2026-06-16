"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { X, Check, ChevronRight, PanelLeft, PanelRight } from "lucide-react"
import gsap from "gsap"
import { Flip } from "gsap/Flip"
import { CustomEase } from "gsap/CustomEase"
import { cn } from "@/lib/utils"

/**
 * HEXAGON SPACES — standalone exploration prototype, driven by GSAP (the same
 * engine Zero uses in `lib/zero/flip-stage.ts`) instead of Framer Motion.
 *
 * THE MODEL:
 *   1. DO-LIST ROW → RECTANGLE, hex glyph only.
 *   2. DOCK CARD   → true regular HEXAGON (pointy-top, matches the glyph).
 *   3. WINDOW      → the SAME regular HEXAGON, just larger.
 *
 * No rotation, no stretched / flat-top hexagon anywhere — one pure regular
 * hexagon shape (HEX) for both the dock card and the window, sized to the regular
 * hexagon aspect ratio (HEX_RATIO) so it never looks squashed.
 *
 * HOW THE MORPH RUNS (mirrors Zero):
 *   • On click we capture the launcher's rect (FIRST). React commits the open
 *     window (LAST). In a useLayoutEffect (pre-paint) we set the window's hexagon
 *     BACKGROUND layer to the launcher's transform, then tween it to identity —
 *     a hand-rolled FLIP. Geometry (scaleX/scaleY + x/y) and, for a row launch,
 *     the clip-path reshape (RECT6 → HEX) ride the one tween.
 *   • DOCK launch → hexagon → hexagon, so it is a pure scale/translate grow; no
 *     clip-path change needed.
 *   • ROW launch → the background reshapes RECT6 → HEX, and the glyph + title do
 *     their own little FLIP from the row up into the header.
 *   • Content sits on a SEPARATE, non-transformed layer, so it never distorts.
 */

if (typeof window !== "undefined") {
  gsap.registerPlugin(Flip, CustomEase)
  // "zeroLand" — identical curve to Zero's flip-stage, so this prototype lands on
  // the same beat as the real app.
  if (!CustomEase.get?.("zeroLand")) {
    CustomEase.create("zeroLand", "M0,0 C0.62,0.02 0.07,0.99 1,1")
  }
}

// Morph timing.
const DUR = 0.62
const EASE = "zeroLand"

// THE one shape: a regular pointy-top hexagon, used identically for the Space
// glyph, the dock card, AND the window. Percentage points keep it a regular
// hexagon at any size, AS LONG AS its container honors the regular-hexagon aspect
// ratio (width / height = √3 / 2 ≈ 0.866 — see HEX_RATIO + the window sizing).
const HEX = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)"

// Regular pointy-top hexagon aspect ratio (width : height). The dock card and the
// window are both sized to this so the clip-path renders as a TRUE regular hexagon
// rather than a stretched one.
const HEX_RATIO = Math.sqrt(3) / 2 // ≈ 0.866

// A rectangle written with the SAME six vertices as HEX, in the same order
// (top-mid, top-right, bottom-right, bottom-mid, bottom-left, top-left), so a ROW
// launch can morph rectangle → hexagon point-for-point with GSAP.
const RECT6 = "polygon(50% 0%, 100% 0%, 100% 100%, 50% 100%, 0% 100%, 0% 0%)"

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

type From = "dock" | "row"
type OpenState = { id: string; from: From } | null
type Rect = { top: number; left: number; width: number; height: number }
type Launch = {
  from: From
  rect: Rect
  glyph?: Rect
  title?: { rect: Rect; fontSize: number }
}

const centerDelta = (from: Rect, to: Rect) => ({
  dx: from.left + from.width / 2 - (to.left + to.width / 2),
  dy: from.top + from.height / 2 - (to.top + to.height / 2),
})

// Stack offset for a window at `depth` given the current `top` index: deeper
// ancestors sit further back (smaller) and higher up (shoulders peek).
const offsetFor = (depth: number, top: number) => {
  const below = top - depth
  return { scale: 1 - below * 0.12, y: below * -54 }
}

export function HexagonDock() {
  const [open, setOpen] = useState<OpenState>(null)
  const [stack, setStack] = useState<Space[]>([])

  const rootSpace = SPACES.find((s) => s.id === open?.id) ?? null

  // Imperative handles for the GSAP morph.
  const backdropRef = useRef<HTMLDivElement>(null)
  const groupRefs = useRef<HTMLDivElement[]>([])
  const bgRefs = useRef<HTMLDivElement[]>([])
  const contentRefs = useRef<HTMLDivElement[]>([])
  const launchRef = useRef<Launch | null>(null)
  const prevLenRef = useRef(0)
  // While a close/pop tween is running we hold off the enter effect.
  const animatingOutRef = useRef(false)

  function launch(id: string, from: From, e: React.MouseEvent<HTMLButtonElement>) {
    const space = SPACES.find((s) => s.id === id)
    if (!space) return
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    const data: Launch = { from, rect: toRect(rect) }
    if (from === "row") {
      const g = el.querySelector("[data-row-glyph]")?.getBoundingClientRect()
      const t = el.querySelector("[data-row-title]") as HTMLElement | null
      if (g) data.glyph = toRect(g)
      if (t) data.title = { rect: toRect(t.getBoundingClientRect()), fontSize: parseFloat(getComputedStyle(t).fontSize) }
    }
    launchRef.current = data
    setOpen({ id, from })
    setStack([space])
  }

  function openChild(child: Space) {
    setStack((s) => [...s, child])
  }

  function close() {
    const launch = launchRef.current
    const bg = bgRefs.current[0]
    if (!launch || !bg) {
      setOpen(null)
      setStack([])
      return
    }
    animatingOutRef.current = true
    const top = stack.length - 1

    // Telescope deeper levels inward.
    for (let d = 1; d <= top; d++) {
      const g = groupRefs.current[d]
      if (g) gsap.to(g, { scale: 0.2, autoAlpha: 0, y: "-=40", duration: DUR * 0.6, ease: EASE })
    }
    // Fade the root content out fast.
    const content = contentRefs.current[0]
    if (content) gsap.to(content, { autoAlpha: 0, duration: DUR * 0.3, ease: EASE })

    // Shrink + (for a row) un-reshape the background back into the launcher.
    const W = toRect(bg.getBoundingClientRect())
    const { dx, dy } = centerDelta(launch.rect, W)
    const toClip = launch.from === "dock" ? HEX : RECT6
    gsap.to(bg, {
      x: dx,
      y: dy,
      scaleX: launch.rect.width / W.width,
      scaleY: launch.rect.height / W.height,
      clipPath: toClip,
      duration: DUR,
      ease: EASE,
    })
    const inner = bg.firstElementChild
    if (inner) gsap.to(inner, { clipPath: toClip, duration: DUR, ease: EASE })

    if (backdropRef.current) gsap.to(backdropRef.current, { autoAlpha: 0, duration: DUR * 0.7, ease: EASE })

    gsap.delayedCall(DUR, () => {
      animatingOutRef.current = false
      setOpen(null)
      setStack([])
    })
  }

  function popChild() {
    const top = stack.length - 1
    if (top < 1) return
    animatingOutRef.current = true
    const g = groupRefs.current[top]
    if (g) gsap.to(g, { scale: 0.6, autoAlpha: 0, y: "+=30", duration: DUR * 0.55, ease: EASE })
    // Bring the remaining ancestors forward one level.
    for (let d = 0; d < top; d++) {
      const o = offsetFor(d, top - 1)
      const anc = groupRefs.current[d]
      if (anc) gsap.to(anc, { scale: o.scale, y: o.y, duration: DUR, ease: EASE })
    }
    gsap.delayedCall(DUR * 0.55, () => {
      animatingOutRef.current = false
      setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
    })
  }

  // The enter morph — runs pre-paint after each open/push so there is no flash.
  useLayoutEffect(() => {
    const len = stack.length
    const prev = prevLenRef.current
    prevLenRef.current = len
    if (len === 0 || animatingOutRef.current) return
    const top = len - 1

    if (prev === 0 && len === 1) {
      // INITIAL OPEN — backdrop + root morph from the launcher.
      if (backdropRef.current) gsap.fromTo(backdropRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: DUR * 0.45, ease: EASE })
      enterRoot()
    } else if (len > prev) {
      // PUSH — the new top hexagon appears; ancestors slide back.
      const g = groupRefs.current[top]
      const o = offsetFor(top, top)
      if (g) gsap.fromTo(g, { scale: o.scale * 0.82, autoAlpha: 0, y: o.y + 44 }, { scale: o.scale, autoAlpha: 1, y: o.y, duration: DUR, ease: EASE })
      for (let d = 0; d < top; d++) {
        const anc = groupRefs.current[d]
        const ao = offsetFor(d, top)
        if (anc) gsap.to(anc, { scale: ao.scale, y: ao.y, duration: DUR, ease: EASE })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack.length])

  function enterRoot() {
    const launch = launchRef.current
    const bg = bgRefs.current[0]
    const content = contentRefs.current[0]
    if (!launch || !bg) return

    // FIRST = launcher rect; LAST = the window's natural rect (measured now,
    // pre-transform). Set the background to FIRST, then tween to LAST.
    const W = toRect(bg.getBoundingClientRect())
    const { dx, dy } = centerDelta(launch.rect, W)
    // Dock launch: hexagon → hexagon (no clip change). Row launch: rect → hexagon.
    const fromClip = launch.from === "dock" ? HEX : RECT6
    const inner = bg.firstElementChild

    gsap.set(bg, { transformOrigin: "center center" })
    gsap.fromTo(
      bg,
      { x: dx, y: dy, scaleX: launch.rect.width / W.width, scaleY: launch.rect.height / W.height, clipPath: fromClip },
      { x: 0, y: 0, scaleX: 1, scaleY: 1, clipPath: HEX, duration: DUR, ease: EASE },
    )
    if (inner) gsap.fromTo(inner, { clipPath: fromClip }, { clipPath: HEX, duration: DUR, ease: EASE })

    if (!content) return

    if (launch.from === "dock") {
      // Dock → window is a pure grow; fade content in as it settles.
      gsap.fromTo(content, { autoAlpha: 0 }, { autoAlpha: 1, delay: DUR * 0.35, duration: DUR * 0.4, ease: EASE })
    } else {
      // Row launch: glyph + title FLIP up from the row; everything else fades.
      gsap.set(content, { autoAlpha: 1 })
      const fades = content.querySelectorAll("[data-fade]")
      gsap.fromTo(fades, { autoAlpha: 0 }, { autoAlpha: 1, delay: DUR * 0.25, duration: DUR * 0.3, ease: EASE })

      const winGlyph = content.querySelector("[data-win-glyph]") as HTMLElement | null
      if (launch.glyph && winGlyph) {
        const last = toRect(winGlyph.getBoundingClientRect())
        const { dx: gx, dy: gy } = centerDelta(launch.glyph, last)
        gsap.fromTo(
          winGlyph,
          { x: gx, y: gy, scale: launch.glyph.width / last.width },
          { x: 0, y: 0, scale: 1, duration: DUR, ease: EASE },
        )
      }
      const winTitle = content.querySelector("[data-win-title]") as HTMLElement | null
      if (launch.title && winTitle) {
        const targetFont = parseFloat(getComputedStyle(winTitle).fontSize)
        const last = toRect(winTitle.getBoundingClientRect())
        gsap.fromTo(
          winTitle,
          { x: launch.title.rect.left - last.left, y: launch.title.rect.top - last.top, fontSize: launch.title.fontSize },
          { x: 0, y: 0, fontSize: targetFont, duration: DUR, ease: EASE, transformOrigin: "left top" },
        )
      }
    }
  }

  return (
    <main className="relative flex min-h-svh flex-col bg-background text-foreground">
      <header className="px-6 pt-10 pb-6 text-center sm:pt-14">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Prototype · GSAP</p>
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
          <ul className="mt-4 flex max-w-[180px] flex-col gap-1.5">
            {SPACES.map((space) => {
              const morphing = open?.id === space.id && open.from === "row"
              return (
                <li key={space.id}>
                  {morphing ? (
                    <div className="h-[60px]" aria-hidden />
                  ) : (
                    <button
                      onClick={(e) => launch(space.id, "row", e)}
                      aria-label={`Open ${space.name}`}
                      className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:bg-secondary"
                    >
                      <span
                        data-row-glyph
                        style={{ clipPath: HEX }}
                        className="flex h-[26px] w-[24px] shrink-0 items-center justify-center bg-foreground/10"
                      >
                        <HexGlyph className="h-3.5 w-3.5 text-foreground/80" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span data-row-title className="truncate text-sm font-medium tracking-tight">
                          {space.name}
                        </span>
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
                  <div className="relative h-[124px] w-[112px]">
                    {open?.id === space.id && open.from === "dock" ? (
                      <div className="h-full w-full" aria-hidden />
                    ) : (
                      <button
                        onClick={(e) => launch(space.id, "dock", e)}
                        style={{ clipPath: HEX }}
                        className="group block h-full w-full bg-border outline-none"
                        aria-label={`Open ${space.name}`}
                      >
                        <span
                          style={{ clipPath: HEX }}
                          className="flex h-full w-full flex-col items-center justify-center gap-2 bg-card p-[1.5px] transition-colors group-hover:bg-secondary"
                        >
                          <HexGlyph className="h-7 w-7 text-foreground/80" />
                          <span className="px-2 text-center text-[13px] font-medium leading-tight tracking-tight">{space.name}</span>
                          <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                            {space.items.filter((i) => !i.done).length} open
                          </span>
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
            From the dock the card grows hexagon → hexagon (pure scale); from a row it reshapes rectangle → hexagon. Same window,
            two arrivals.
          </Finding>
          <Finding title="Content lives in the waist">
            A regular hexagon clips its top/bottom points, so content insets into the central band and the IN/OUT rails hug the
            vertical waist edges.
          </Finding>
        </div>
      </section>

      {/* WINDOW STACK. */}
      {rootSpace && stack.length > 0 && (
        <div ref={backdropRef} className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" onClick={close}>
          <div
            className="relative"
            style={{ height: "min(86svh, 600px)", width: "min(94vw, calc(min(86svh, 600px) * var(--hex-ratio)))", ["--hex-ratio" as string]: HEX_RATIO }}
            onClick={(e) => e.stopPropagation()}
          >
            {stack.map((space, depth) => {
              const isTop = depth === stack.length - 1
              return (
                <div
                  key={space.id}
                  ref={(el) => {
                    if (el) groupRefs.current[depth] = el
                  }}
                  className="absolute inset-0"
                  style={{ transformOrigin: "center center" }}
                >
                  {/* RESHAPING BACKGROUND — owns the morph transform. */}
                  <div
                    ref={(el) => {
                      if (el) bgRefs.current[depth] = el
                    }}
                    className="absolute inset-0 bg-border"
                    style={{ clipPath: HEX }}
                  >
                    <div
                      className={cn("absolute inset-[2px] bg-card", !isTop && "brightness-[0.97]")}
                      style={{ clipPath: HEX }}
                    />
                  </div>

                  {/* CONTENT — separate, never transformed by the morph. */}
                  <div
                    ref={(el) => {
                      if (el) contentRefs.current[depth] = el
                    }}
                    className="absolute inset-0 flex flex-col items-center"
                  >
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
                        className="absolute right-[15%] top-[14%] z-10 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        aria-label={depth === 0 ? `Close ${space.name}` : `Back from ${space.name}`}
                        data-fade
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

const toRect = (r: { top: number; left: number; width: number; height: number }): Rect => ({
  top: r.top,
  left: r.left,
  width: r.width,
  height: r.height,
})

/** The frontmost hexagon window's content, kept inside the regular hexagon's safe
 *  central band (top/bottom points are clipped, so we inset vertically). The glyph
 *  + title carry data hooks so a row launch can FLIP them up from the row; the
 *  blurb / list / close just fade. */
function SpaceWindowContent({ space }: { space: Space }) {
  return (
    <div className="flex h-full w-full flex-col items-center px-[18%] pt-[16%] pb-[14%]">
      <div data-win-glyph className="flex items-center justify-center" style={{ transformOrigin: "center center" }}>
        <HexGlyph className="h-9 w-9 text-foreground/80" />
      </div>
      <h2 data-win-title className="mt-3 text-center text-xl font-semibold tracking-tight">
        {space.name}
      </h2>
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
      aria-label={label}
      title={label}
      data-fade
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
