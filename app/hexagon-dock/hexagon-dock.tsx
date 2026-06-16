"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import gsap from "gsap"
import { Flip } from "gsap/Flip"
import { CustomEase } from "gsap/CustomEase"
import { cn } from "@/lib/utils"

/**
 * HEXAGON SPACES — a faithful, trimmed port of Zero's single-node Flip morph
 * (lib/zero/flip-stage.ts + components/zero/entity-node.tsx).
 *
 * THE LOAD-BEARING IDEA (straight from Zero): every entity is ONE persistent
 * frame. A collapsed launcher (a do-list ROW or a dock CARD) and the WINDOW it
 * opens into are the SAME flip-id — the frame merely swaps between its collapsed
 * classes and its `fixed` window geometry. Nothing duplicates, so opening grows
 * the launcher into the window and closing shrinks the window back INTO the
 * launcher; the glyph + title glide between the two positions the whole time.
 *
 *   - frame → data-flip-role="frame"; Flip tweens its REAL width/height
 *             (absolute: "[data-flip-role='frame']"), so it grows edge-to-edge
 *             with zero text distortion — never a scale().
 *   - glyph + title → data-flip-role="inner"; they ride along on top, gliding /
 *             scaling between launcher and window header.
 *   - body + close button → data-fade; they only fade, never flip.
 *
 * To avoid the multi-instance bookkeeping that only this prototype would need,
 * each Space is shown exactly once: Day Job in the do-list, Health in the dock.
 */

// One regular pointy-top hexagon, used for the dock card AND the window.
const HEX = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)"
// A rectangle written with the SAME six vertices/order as HEX, so the do-list row
// frame can morph rectangle → hexagon point-for-point when Flip tweens clip-path.
const RECT6 = "polygon(50% 0%, 100% 0%, 100% 100%, 50% 100%, 0% 100%, 0% 0%)"
// Regular-hexagon aspect ratio (w : h). The dock card and window honor it so the
// clip-path renders as a TRUE regular hexagon rather than a stretched one.
const HEX_RATIO = Math.sqrt(3) / 2 // ≈ 0.866

const DUR = 0.6
const EASE = "zeroLand"

let ready = false
function ensureSetup() {
  if (ready || typeof window === "undefined") return
  gsap.registerPlugin(Flip, CustomEase)
  // Same curve as Zero's MORPH_EASE.
  CustomEase.create("zeroLand", "M0,0 C0.62,0.02 0.07,0.99 1,1")
  ready = true
}

type Item = { id: string; label: string; done?: boolean }
type Space = { id: string; name: string; blurb: string; items: Item[] }

const DAY_JOB: Space = {
  id: "dayjob",
  name: "Day Job",
  blurb: "Focused work, meetings, and the deep-work blocks that move projects forward.",
  items: [
    { id: "d1", label: "Review Q3 roadmap draft" },
    { id: "d2", label: "1:1 with Priya", done: true },
    { id: "d3", label: "Ship onboarding revamp" },
    { id: "d4", label: "Draft launch announcement" },
    { id: "d5", label: "Close out design review" },
  ],
}

const HEALTH: Space = {
  id: "health",
  name: "Health",
  blurb: "Training, recovery, and nutrition — the habits that keep everything else running.",
  items: [
    { id: "h1", label: "Morning mobility routine", done: true },
    { id: "h2", label: "5k easy run" },
    { id: "h3", label: "Meal prep for the week" },
    { id: "h4", label: "Sleep by 10:30" },
  ],
}

// ── Window geometry ─────────────────────────────────────────────────────────

function winRectFrom(vw: number, vh: number): React.CSSProperties {
  const height = Math.min(vh * 0.86, 600)
  const width = Math.min(vw * 0.94, height * HEX_RATIO)
  return {
    position: "fixed",
    top: (vh - height) / 2,
    left: (vw - width) / 2,
    width,
    height,
    zIndex: 50,
  }
}

// ── Glyphs ────────────────────────────────────────────────────────────────────

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

function TaskSquareGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect
        x="4.5"
        y="4.5"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** "3 □" — open-task count + task-square glyph, used on the card and the row. */
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

// ── The single persistent entity (launcher ⇄ window) ───────────────────────────

function SpaceEntity({
  space,
  variant,
  asWindow,
  isClosing,
  winStyle,
  onOpen,
  onClose,
}: {
  space: Space
  variant: "dock" | "row"
  asWindow: boolean
  isClosing: boolean
  winStyle: React.CSSProperties | null
  onOpen: () => void
  onClose: () => void
}) {
  const openLike = asWindow || isClosing
  const openCount = space.items.filter((i) => !i.done).length

  // Stable collapsed footprint so the layout never shifts when the frame lifts
  // out into a fixed window.
  const slotClass =
    variant === "dock" ? "relative h-[150px] w-[130px] shrink-0" : "relative h-12 w-full max-w-md"

  // Collapsed frames are clipped to their launcher shape; the window is always a
  // hexagon. The clip-path is keyed off asWindow (NOT openLike) so that DURING the
  // close the frame already targets its collapsed shape — Flip then tweens
  // HEX → RECT6 for the row as it shrinks, instead of staying hexagonal and only
  // snapping to a rectangle at the very end. The dock card is HEX in both states,
  // so its clip-path tween is a no-op and it purely grows/shrinks.
  const collapsedClip = variant === "dock" ? HEX : RECT6
  const clipPath = asWindow ? HEX : collapsedClip

  // The expanded window keeps the soft filled surface. While closing, the frame
  // keeps that fill as it shrinks back into the launcher. Collapsed launchers:
  // the dock CARD has a faint resting fill that brightens on hover; the do-list
  // ROW has no resting fill and only reveals the highlight on hover.
  const frameClass = asWindow
    ? "fixed flex flex-col items-center bg-secondary"
    : isClosing
      ? "absolute inset-0 bg-secondary z-40 outline-none"
      : cn(
          "absolute inset-0 cursor-pointer outline-none transition-colors duration-200 hover:bg-secondary",
          variant === "dock" ? "bg-secondary/40" : "bg-transparent",
        )

  // ONE persistent header (glyph + title) — exactly Zero's trick. It is NEVER
  // swapped between branches; only its layout classes and the title's inline
  // fontSize change. Because the SAME nodes persist, GSAP Flip can tween their
  // position AND size (fontSize is captured), so the glyph and title GLIDE and
  // scale smoothly between launcher and window instead of jumping.
  const headerClass = asWindow
    ? "relative z-10 flex w-full flex-col items-center gap-2.5 pt-[16%]"
    : variant === "dock"
      ? "relative flex h-full w-full flex-col items-center justify-center gap-1.5 px-4"
      : "relative flex h-full w-full items-center gap-2.5 px-4"

  const glyphSize = asWindow ? "h-9 w-9" : variant === "dock" ? "h-7 w-7" : "h-4 w-4"
  const titleSize = asWindow ? 20 : variant === "row" ? 14 : 15
  const titleClass = asWindow
    ? "text-center font-semibold tracking-tight"
    : variant === "row"
      ? "min-w-0 flex-1 truncate font-medium"
      : "font-medium tracking-tight"

  return (
    <div className={slotClass}>
      <div
        data-flip-id={`${space.id}-frame`}
        data-flip-role="frame"
        role="button"
        aria-label={openLike ? undefined : `Open ${space.name}`}
        tabIndex={openLike ? -1 : 0}
        onClick={openLike ? undefined : onOpen}
        style={{ clipPath, ...(asWindow ? winStyle ?? undefined : undefined) }}
        className={frameClass}
      >
        {/* Persistent header — glyph + title. Same DOM nodes in every state. */}
        <div className={headerClass}>
          <span
            data-flip-id={`${space.id}-glyph`}
            data-flip-role="inner"
            className="flex shrink-0 items-center justify-center text-foreground"
          >
            <HexGlyph className={glyphSize} />
          </span>
          <span
            data-flip-id={`${space.id}-title`}
            data-flip-role="inner"
            style={{ fontSize: titleSize }}
            className={titleClass}
          >
            {space.name}
          </span>
          {/* Count belongs to the collapsed launcher. Render it whenever the frame
              is NOT the open window — including the whole close shrink — so the
              collapsed DOM never changes shape at the end of the morph (otherwise
              the centered glyph + title jump up the instant the count appears). */}
          {!asWindow && (
            <OpenCount
              n={openCount}
              className={variant === "row" ? "text-[11px] text-muted-foreground/70" : "text-[10px] text-muted-foreground"}
            />
          )}
        </div>

        {/* Open-only chrome. Just fades; never a flip target. */}
        {openLike && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onClose()
              }}
              data-fade
              aria-label={`Close ${space.name}`}
              className="absolute right-[15%] top-[15%] z-10 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>

            <div data-fade className="relative flex w-full flex-1 flex-col items-center overflow-hidden px-[16%] pb-[14%]">
              <p className="mt-1 max-w-[260px] text-center text-xs leading-relaxed text-muted-foreground">
                {space.blurb}
              </p>
              <ul className="mt-5 flex w-full max-w-[300px] flex-col gap-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {space.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-background"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center border",
                        item.done ? "border-foreground/30 bg-foreground/10" : "border-foreground/40",
                      )}
                    >
                      {item.done && <span className="h-1.5 w-1.5 bg-foreground/50" />}
                    </span>
                    <span className={cn(item.done && "text-muted-foreground line-through")}>{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Stage ───────────────────────────────────────────────────────────────────

export function HexagonDock() {
  ensureSetup()
  const [openId, setOpenId] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [vp, setVp] = useState({ w: 0, h: 0 })

  const stageRef = useRef<HTMLDivElement | null>(null)
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const flipState = useRef<Flip.FlipState | null>(null)
  const pending = useRef<"open" | "close" | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    const upd = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    upd()
    window.addEventListener("resize", upd)
    return () => window.removeEventListener("resize", upd)
  }, [])

  // Snapshot every flip part in the stage BEFORE the commit; replay AFTER it.
  // Capturing fontSize lets Flip tween the title's size smoothly (no jump); the
  // glyph (an svg sized via h-/w- classes) scales via its frame transform.
  function capture() {
    const stage = stageRef.current
    if (!stage) return null
    const targets = stage.querySelectorAll("[data-flip-id]")
    if (!targets.length) return null
    return Flip.getState(targets, { props: "clipPath,fontSize" })
  }

  function openSpace(id: string) {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    flipState.current = capture()
    pending.current = "open"
    setClosingId(null)
    setOpenId(id)
  }

  function closeSpace() {
    const id = openId
    if (!id) return
    flipState.current = capture()
    pending.current = "close"
    setOpenId(null)
    setClosingId(id) // keep the frame mounted (collapsed) so Flip can shrink it
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setClosingId(null), DUR * 1000 + 80)
  }

  // The ONE place the morph runs — drives both open and close.
  useLayoutEffect(() => {
    const state = flipState.current
    const mode = pending.current
    if (!state || !mode) return
    flipState.current = null
    pending.current = null
    const stage = stageRef.current

    Flip.from(state, {
      duration: DUR,
      ease: EASE,
      absolute: "[data-flip-role='frame']",
      nested: true,
      props: "clipPath,fontSize",
      // Clear leftover sub-pixel transforms / will-change when the morph lands so
      // the glyph + title settle crisply instead of shaking at the very end.
      onComplete: () => {
        const inner = stage?.querySelectorAll("[data-flip-role='inner']")
        if (inner?.length) gsap.set(inner, { clearProps: "transform,willChange" })
      },
    })

    const chrome = stage?.querySelectorAll("[data-fade]")
    if (mode === "open") {
      if (chrome?.length) gsap.fromTo(chrome, { opacity: 0 }, { opacity: 1, delay: DUR * 0.3, duration: DUR * 0.45, ease: EASE })
      if (backdropRef.current) gsap.fromTo(backdropRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: DUR * 0.6, ease: EASE })
    } else {
      if (chrome?.length) gsap.to(chrome, { opacity: 0, duration: DUR * 0.35, ease: EASE })
      if (backdropRef.current) gsap.to(backdropRef.current, { autoAlpha: 0, duration: DUR, ease: EASE })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, closingId])

  const winStyle = vp.w ? winRectFrom(vp.w, vp.h) : null

  return (
    <main className="relative min-h-svh bg-background text-foreground">
      {/* Hide every scrollbar everywhere. A scrollbar that appears/disappears
          during the morph changes the layout width by a few px, which reads as a
          shake/jitter at the end of open and close. */}
      <style>{`
        html, body { overflow-x: hidden; }
        *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
        * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
      `}</style>
      <div ref={stageRef} className="mx-auto flex max-w-2xl flex-col gap-12 px-6 py-16">
        <header className="text-center">
          <h1 className="text-pretty text-2xl font-semibold tracking-tight">Hexagon Spaces</h1>
          <p className="mx-auto mt-3 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground">
            One persistent hexagon per Space, morphed with GSAP Flip — Zero&apos;s engine. The dock card and the do-list
            row each grow into the SAME window and shrink straight back, with the glyph and title gliding into place.
          </p>
        </header>

        {/* DO-LIST — one row. */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Do-list</h2>
          <div className="flex flex-col gap-1.5">
            <SpaceEntity
              space={DAY_JOB}
              variant="row"
              asWindow={openId === DAY_JOB.id}
              isClosing={closingId === DAY_JOB.id}
              winStyle={winStyle}
              onOpen={() => openSpace(DAY_JOB.id)}
              onClose={closeSpace}
            />
          </div>
        </section>

        {/* DOCK — one card. */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Dock</h2>
          <div className="flex flex-wrap gap-4">
            <SpaceEntity
              space={HEALTH}
              variant="dock"
              asWindow={openId === HEALTH.id}
              isClosing={closingId === HEALTH.id}
              winStyle={winStyle}
              onOpen={() => openSpace(HEALTH.id)}
              onClose={closeSpace}
            />
          </div>
        </section>
      </div>

      {/* Backdrop — fades with the morph; click to close. */}
      {(openId || closingId) && (
        <div
          ref={backdropRef}
          onClick={closeSpace}
          className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
          aria-hidden="true"
        />
      )}
    </main>
  )
}
