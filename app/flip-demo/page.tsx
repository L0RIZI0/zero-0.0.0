"use client"

import { useRef, useState } from "react"
import { flushSync } from "react-dom"
import gsap from "gsap"
import { Flip } from "gsap/Flip"
import { X } from "lucide-react"
import { NodeGlyph, type NodeKind } from "@/components/zero/node-glyph"

gsap.registerPlugin(Flip)

/**
 * ISOLATED GSAP Flip prototype — NOT wired into the Zero app.
 *
 * KEY LESSON from the first attempt: if React unmounts the collapsed card and
 * mounts a separate expanded window, Flip captures references to nodes that get
 * destroyed, so it animates dead nodes and nothing visibly moves. The fix is to
 * NEVER unmount the flip elements. Each card here is ONE persistent element that
 * merely swaps classes between its dock-slot state and its fixed-window state.
 * Because the frame / accent / glyph / title are the very same DOM nodes in both
 * states, Flip animates the real elements — no ghost, no distortion, and the
 * title genuinely reflows from beneath the glyph (card) to beside it (window)
 * because they share one persistent flex container that flips column → row.
 */

type Demo = { id: string; kind: NodeKind; title: string; accent: string; tasks: string[] }

const CARDS: Demo[] = [
  {
    id: "day-job",
    kind: "space",
    title: "Day Job",
    accent: "oklch(0.62 0.17 250)",
    tasks: ["Draft Q3 admin review", "Sync with Team", "Ship pricing page"],
  },
  {
    id: "investor-prep",
    kind: "event",
    title: "Investor prep",
    accent: "oklch(0.62 0.2 350)",
    tasks: ["Finalize deck", "Rehearse narrative", "Send pre-read"],
  },
  {
    id: "family",
    kind: "space",
    title: "Family",
    accent: "oklch(0.7 0.15 150)",
    tasks: ["Plan weekend trip", "Call parents"],
  },
]

export default function FlipDemoPage() {
  const [openId, setOpenId] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const DURATION = 0.55
  const EASE = "power3.inOut"

  function flipTo(nextOpenId: string | null) {
    if (!stageRef.current) return
    const stage = stageRef.current

    // TWO separate captures, because the frame and its inner content need
    // DIFFERENT Flip strategies (mixing them in one call is what caused the
    // header to detach and the body to snap):
    //
    //  - frame  → animated with `absolute: true`, which tweens REAL width/height
    //             (not scale), so the box grows edge-to-edge with zero content
    //             distortion. Being absolute is fine here: the frame is the only
    //             thing leaving flow, and its dock slot holds its place.
    //  - glyph/title → animated in TRANSFORM mode (no `absolute`), so they stay
    //             in the header's flex flow. That keeps the header at its true
    //             height throughout, so the body sits correctly below it the
    //             whole time and never jumps. The title's size change rides on
    //             the `fontSize` prop (a real font-size tween — stays crisp).
    const frameState = Flip.getState(stage.querySelectorAll("[data-flip-role='frame']"), {
      props: "borderRadius",
    })
    const innerState = Flip.getState(stage.querySelectorAll("[data-flip-role='inner']"), {
      props: "fontSize",
    })

    // Commit the class swap synchronously so the new layout is live before we
    // start the tweens. The elements themselves are NOT recreated.
    flushSync(() => setOpenId(nextOpenId))

    Flip.from(frameState, { duration: DURATION, ease: EASE, absolute: true })
    Flip.from(innerState, { duration: DURATION, ease: EASE, nested: true })

    // The body + close button mount/unmount with the open state. Because the
    // body holds its correct position throughout the morph, a simple fade
    // (no positional movement) is enough to keep it from popping.
    if (nextOpenId) {
      const chrome = stage.querySelectorAll(`[data-window="${nextOpenId}"] [data-fade]`)
      gsap.fromTo(chrome, { opacity: 0 }, { opacity: 1, duration: 0.3, delay: 0.15 })
    }
  }

  return (
    <main className="relative flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-balance text-lg font-semibold tracking-tight">GSAP Flip morph — isolated prototype</h1>
        <p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">
          Click a card to morph it into a window. The same element grows — no ghost copy, the title reflows from beneath
          the glyph to beside it, and everything stays clickable mid-animation.
        </p>
      </header>

      {/* Stage holds every card permanently. An open card becomes a fixed window
          via classes; it never leaves the React tree. */}
      <div ref={stageRef} className="relative flex flex-1 flex-col">
        {/* Scrim behind an open window. */}
        <div
          onClick={() => flipTo(null)}
          className={`absolute inset-0 z-10 bg-background/60 transition-opacity duration-300 ${
            openId ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-hidden
        />

        <div className="mt-auto flex items-end gap-3 border-t border-border px-6 py-6">
          {CARDS.map((c) => (
            <Card key={c.id} card={c} open={c.id === openId} onOpen={() => flipTo(c.id)} onClose={() => flipTo(null)} />
          ))}
        </div>
      </div>
    </main>
  )
}

function Card({
  card,
  open,
  onOpen,
  onClose,
}: {
  card: Demo
  open: boolean
  onOpen: () => void
  onClose: () => void
}) {
  const fid = (part: string) => `${card.id}-${part}`

  // Stable dock slot: this wrapper ALWAYS holds the card's 112x64 footprint in
  // the dock flex row, whether the card is collapsed or expanded into a window.
  // Because the slot never disappears, the sibling cards never shift — which is
  // what previously caused the whole dock to flicker / "rejoin" on close.
  return (
    <div className="relative h-[64px] w-[112px] shrink-0">
      <div
        data-window={card.id}
        data-flip-id={fid("frame")}
        data-flip-role="frame"
        onClick={open ? undefined : onOpen}
        style={{ borderRadius: open ? 8 : 4 }}
        className={
          open
            ? "fixed inset-4 z-20 flex cursor-default flex-col overflow-hidden border border-border bg-card-solid shadow-2xl"
            : "absolute inset-0 flex cursor-pointer flex-col overflow-hidden border border-border bg-card-solid transition-transform hover:scale-[1.03]"
        }
      >
      {/* Accent strip is full-height-absolute inside the frame, so it tracks the
          frame's size automatically — no flip needed. */}
      <span
        className="absolute left-0 top-0 z-10 h-full w-[3px]"
        style={{ backgroundColor: card.accent }}
      />

      {/* Persistent header container. It is NOT a flip target — it stays in the
          frame's flex flow and simply switches column→row layout, so the body
          always sits correctly below it. The glyph + title (which ARE flipped,
          in transform mode) glide from their card positions to their header
          positions on top of this instantly-relaid-out container. */}
      <div
        className={
          open
            ? "flex items-center gap-3 border-b border-border px-5 py-4"
            : "flex flex-col gap-1.5 px-2.5 py-2"
        }
      >
        <div className={open ? "contents" : "flex w-full items-start justify-between"}>
          <span
            data-flip-id={fid("glyph")}
            data-flip-role="inner"
            className="flex h-5 w-5 shrink-0 items-center justify-center text-foreground"
          >
            <NodeGlyph kind={card.kind} strokeWidth={1.75} />
          </span>
          {!open && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <span className="font-medium tabular-nums">{card.tasks.length}</span>
              <span className="flex h-2.5 w-2.5 items-center justify-center">
                <NodeGlyph kind="task" strokeWidth={1.5} />
              </span>
            </div>
          )}
        </div>

        <h3
          data-flip-id={fid("title")}
          data-flip-role="inner"
          style={{ fontSize: open ? 18 : 12 }}
          className={
            open
              ? "flex-1 font-semibold tracking-tight"
              : "truncate font-medium leading-tight tracking-tight text-foreground"
          }
        >
          {card.title}
        </h3>

        {open && (
          <button
            type="button"
            data-fade
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            aria-label={`Close ${card.title}`}
            className="flex size-6 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {open && (
        <div data-fade className="flex-1 px-5 py-4">
          <p className="mb-3 text-sm text-muted-foreground">These buttons are clickable during and after the morph:</p>
          <ul className="flex flex-col gap-2">
            {card.tasks.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    alert(`Clicked: ${t}`)
                  }}
                  className="flex w-full items-center gap-3 rounded-[4px] border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-foreground/5"
                >
                  <span className="flex h-3.5 w-3.5 items-center justify-center text-foreground">
                    <NodeGlyph kind="task" strokeWidth={2} />
                  </span>
                  {t}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </div>
  )
}
