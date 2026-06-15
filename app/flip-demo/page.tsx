"use client"

import { useLayoutEffect, useRef, useState } from "react"
import gsap from "gsap"
import { Flip } from "gsap/Flip"
import { X } from "lucide-react"
import { NodeGlyph, type NodeKind } from "@/components/zero/node-glyph"

gsap.registerPlugin(Flip)

/**
 * ISOLATED GSAP Flip prototype — NOT wired into the Zero app.
 *
 * Goal: prove (or disprove) that GSAP's Flip plugin can morph a dock card into
 * a window WITHOUT the Framer Motion artifacts we kept hitting:
 *   - no clone / crossfade ghost (it animates the ONE real element)
 *   - no text distortion (children reflow individually via `nested: true`, and
 *     the title's font-size is tweened as a real property, not scaled)
 *   - the element stays interactive the entire time (no blocking overlay)
 *   - single smooth open (no measure-then-grow two-step)
 *
 * Technique: capture Flip state synchronously on click, toggle layout via React
 * state, then run Flip.from in a layout effect once the new DOM has committed.
 * Elements carry a stable `data-flip-id` so Flip matches them across the
 * re-render even though the collapsed/expanded markup differs.
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
  // Flip state captured at click time, consumed by the layout effect below.
  const pendingState = useRef<Flip.FlipState | null>(null)

  function flipTo(nextOpenId: string | null) {
    if (!stageRef.current) return
    // Capture the CURRENT geometry + tweenable props of every flip element
    // before React swaps the markup.
    pendingState.current = Flip.getState(stageRef.current.querySelectorAll("[data-flip-id]"), {
      props: "fontSize,borderRadius,padding",
    })
    setOpenId(nextOpenId)
  }

  useLayoutEffect(() => {
    const state = pendingState.current
    if (!state) return
    pendingState.current = null

    Flip.from(state, {
      duration: 0.55,
      ease: "power3.inOut",
      absolute: true, // take elements out of flow during the tween for clean motion
      nested: true, // animate nested flip elements (glyph + title) independently
      // Body content / close button only exist while expanded — fade them in/out
      // around the geometry morph rather than letting them pop.
      onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.3, delay: 0.12 }),
      onLeave: (els) => gsap.to(els, { opacity: 0, duration: 0.15 }),
    })
  }, [openId])

  return (
    <main className="relative flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-balance text-lg font-semibold tracking-tight">GSAP Flip morph — isolated prototype</h1>
        <p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">
          Click a card to morph it into a window. The same element grows — no ghost copy, the title reflows from beneath
          the glyph to beside it, and everything stays clickable mid-animation.
        </p>
      </header>

      {/* Stage: holds both the dock (collapsed cards) and the expanded window. */}
      <div ref={stageRef} className="relative flex flex-1 flex-col">
        {/* Expanded window (only the open card renders here). */}
        {CARDS.filter((c) => c.id === openId).map((c) => (
          <Card key={c.id} card={c} expanded onClose={() => flipTo(null)} onOpen={() => {}} />
        ))}

        {/* Dock — collapsed cards. The open card is hidden here while expanded. */}
        <div className="mt-auto flex items-end gap-3 border-t border-border px-6 py-6">
          {CARDS.map((c) => (
            <div key={c.id} className={c.id === openId ? "invisible" : ""}>
              {c.id !== openId && <Card card={c} expanded={false} onOpen={() => flipTo(c.id)} onClose={() => {}} />}
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}

function Card({
  card,
  expanded,
  onOpen,
  onClose,
}: {
  card: Demo
  expanded: boolean
  onOpen: () => void
  onClose: () => void
}) {
  const fid = (part: string) => `${card.id}-${part}`

  if (expanded) {
    return (
      <div
        data-flip-id={fid("frame")}
        style={{ borderRadius: 8, borderColor: "var(--border)" }}
        className="absolute inset-4 z-20 flex flex-col overflow-hidden border bg-card-solid shadow-2xl"
      >
        <span
          data-flip-id={fid("accent")}
          className="absolute left-0 top-0 z-10 h-full w-[3px]"
          style={{ backgroundColor: card.accent }}
        />
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span data-flip-id={fid("glyph")} className="flex h-5 w-5 shrink-0 items-center justify-center text-foreground">
            <NodeGlyph kind={card.kind} strokeWidth={1.75} />
          </span>
          <h3 data-flip-id={fid("title")} style={{ fontSize: 18 }} className="flex-1 font-semibold tracking-tight">
            {card.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${card.title}`}
            className="flex size-6 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            data-flip-fade
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 px-5 py-4" data-flip-fade>
          <p className="mb-3 text-sm text-muted-foreground">These buttons are clickable during and after the morph:</p>
          <ul className="flex flex-col gap-2">
            {card.tasks.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => alert(`Clicked: ${t}`)}
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
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      data-flip-id={fid("frame")}
      style={{ borderRadius: 4 }}
      className="group relative flex h-[64px] w-[112px] flex-col justify-between overflow-hidden border border-border bg-card-solid px-2.5 py-2 text-left transition-transform hover:scale-[1.03]"
    >
      <span
        data-flip-id={fid("accent")}
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ backgroundColor: card.accent }}
      />
      <div className="flex items-start justify-between gap-1.5">
        <span data-flip-id={fid("glyph")} className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-foreground">
          <NodeGlyph kind={card.kind} strokeWidth={card.kind === "task" ? 2 : 1.75} />
        </span>
        <div className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground/70">
          <span className="font-medium tabular-nums">{card.tasks.length}</span>
          <span className="flex h-2.5 w-2.5 items-center justify-center">
            <NodeGlyph kind="task" strokeWidth={1.5} />
          </span>
        </div>
      </div>
      <h3 data-flip-id={fid("title")} style={{ fontSize: 12 }} className="truncate font-medium leading-tight tracking-tight text-foreground">
        {card.title}
      </h3>
    </button>
  )
}
