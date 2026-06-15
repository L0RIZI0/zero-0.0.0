"use client"

import { createContext, useContext, useRef, useState } from "react"
import { flushSync } from "react-dom"
import gsap from "gsap"
import { Flip } from "gsap/Flip"
import { X } from "lucide-react"
import { NodeGlyph, type NodeKind } from "@/components/zero/node-glyph"

gsap.registerPlugin(Flip)

/**
 * ISOLATED GSAP Flip prototype — NOT wired into the Zero app.
 *
 * Validates the morph technique we plan to bring to Zero, now with the
 * NESTED-DOLL stack: opening an entity inside an open window spawns a deeper
 * window ON TOP of it, while the parent's header (and its close button) keep
 * peeking above. Closing morphs the window back into the row/card it came from.
 *
 * THREE load-bearing rules (each one was a bug we hit and fixed):
 *
 *  1. NEVER unmount a flip element. Every entity is ONE persistent DOM node that
 *     merely swaps classes between its collapsed (dock card / list row) state and
 *     its expanded (window) state. If React destroyed the collapsed node and
 *     mounted a separate window node, Flip would animate dead nodes and nothing
 *     would move.
 *
 *  2. The FRAME and its INNER content flip with DIFFERENT strategies:
 *       - frame  → `absolute: true` so Flip tweens REAL width/height (no scale),
 *                  giving edge-to-edge growth with zero text distortion.
 *       - glyph + title → transform mode (no absolute), so they stay in the
 *                  header's flex flow; the header keeps its true height and the
 *                  body never jumps. The title size rides the `fontSize` prop, a
 *                  real font-size tween, so it stays crisp.
 *
 *  3. Chrome that only exists while open (body, close button) is NOT a flip
 *     target — it just fades. The close button is pinned absolutely so it can
 *     never squeeze the title onto two lines, and never slides during the morph.
 */

type Entity = { id: string; kind: NodeKind; title: string; accent: string; children: Entity[] }

const BLUE = "oklch(0.62 0.17 250)"
const MAGENTA = "oklch(0.62 0.2 350)"
const GREEN = "oklch(0.7 0.15 150)"

const SPACES: Entity[] = [
  {
    id: "day-job",
    kind: "space",
    title: "Day Job",
    accent: BLUE,
    children: [
      {
        id: "dj-review",
        kind: "task",
        title: "Draft Q3 admin review",
        accent: BLUE,
        children: [
          { id: "dj-review-1", kind: "task", title: "Pull last quarter metrics", accent: BLUE, children: [] },
          { id: "dj-review-2", kind: "task", title: "Write the summary", accent: BLUE, children: [] },
        ],
      },
      {
        id: "dj-team",
        kind: "task",
        title: "Sync with Team",
        accent: BLUE,
        children: [{ id: "dj-team-1", kind: "task", title: "Prep the agenda", accent: BLUE, children: [] }],
      },
      { id: "dj-pricing", kind: "task", title: "Ship pricing page", accent: BLUE, children: [] },
    ],
  },
  {
    id: "investor-prep",
    kind: "event",
    title: "Investor prep",
    accent: MAGENTA,
    children: [
      { id: "ip-deck", kind: "task", title: "Finalize the deck", accent: MAGENTA, children: [] },
      { id: "ip-rehearse", kind: "task", title: "Rehearse the narrative", accent: MAGENTA, children: [] },
    ],
  },
  {
    id: "family",
    kind: "space",
    title: "Family",
    accent: GREEN,
    children: [
      { id: "fam-trip", kind: "task", title: "Plan the weekend trip", accent: GREEN, children: [] },
      { id: "fam-call", kind: "task", title: "Call parents", accent: GREEN, children: [] },
    ],
  },
]

const DURATION = 4
const EASE = "power3.inOut"

// Nested-doll geometry. A window at depth d sits below its parent's peeking
// header (TOP_PEEK px) and inset SIDE px more on each side, so every ancestor
// stays visible behind it.
const BASE = 16
const TOP_PEEK = 56
const SIDE = 10
function windowStyle(depth: number): React.CSSProperties {
  return {
    position: "fixed",
    top: BASE + depth * TOP_PEEK,
    left: BASE + depth * SIDE,
    right: BASE + depth * SIDE,
    bottom: BASE,
    zIndex: 20 + depth * 10,
    borderRadius: 8,
  }
}

type Nav = {
  isOpen: (id: string) => boolean
  isTop: (id: string) => boolean
  isClosing: (id: string) => boolean
  depthOf: (id: string) => number
  open: (id: string) => void
  closeAbove: (id: string) => void // collapse everything above this open entity (keep it)
  closeSelf: (id: string) => void // close this entity and everything above it
}
const NavContext = createContext<Nav>(null!)

export default function FlipDemoPage() {
  // Ordered ids of the open windows, shallow → deep. [] means only the dock.
  const [stack, setStack] = useState<string[]>([])
  // The entity whose window is currently shrinking closed; its body stays
  // mounted through the morph so it can scale down WITH the frame.
  const [closingId, setClosingId] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // Single entry point for every open/close. Captures Flip state, commits the
  // new stack synchronously, then animates the same persistent nodes.
  function transition(nextStack: string[]) {
    const stage = stageRef.current
    if (!stage) return
    const prev = stack
    const opening = nextStack.length > prev.length
    // When closing, the shallowest removed level is the one the user watches
    // morph back into a row/card; deeper levels just vanish.
    const closingEntity = nextStack.length < prev.length ? prev[nextStack.length] : null

    // ONE capture of every flip element (frames + their glyph/title), and ONE
    // Flip.from. Doing it in a single pass is what keeps the parent frame and
    // its nested glyph/title measured against the SAME before/after snapshot —
    // so their deltas stay consistent and the glyph neither jumps on open nor
    // lands misaligned on close. (Two separate Flip.from calls used to corrupt
    // this: the frame call mutated layout before the inner call measured it.)
    //
    // `absolute` is a SELECTOR, not `true`: only the FRAMES are taken out of
    // flow (so they grow edge-to-edge via real width/height, no scale/distortion).
    // The glyph + title deliberately stay in the header's flex flow and animate
    // with transforms, so the header keeps its true height and the body never
    // jumps. `nested: true` lets the in-flow children compensate for their
    // absolutely-flipping ancestor.
    const state = Flip.getState(stage.querySelectorAll("[data-flip-id]"), { props: "fontSize,borderRadius" })

    flushSync(() => {
      setStack(nextStack)
      setClosingId(closingEntity)
    })

    Flip.from(state, {
      duration: DURATION,
      ease: EASE,
      absolute: "[data-flip-role='frame']",
      nested: true,
    })

    if (opening) {
      const top = nextStack[nextStack.length - 1]
      const chrome = stage.querySelectorAll(`[data-window="${top}"] [data-fade]`)
      gsap.fromTo(chrome, { opacity: 0 }, { opacity: 1, duration: 0.3, delay: 0.15 })
    } else if (closingEntity) {
      const body = stage.querySelector<HTMLElement>(`[data-window="${closingEntity}"] [data-body]`)
      if (body) {
        gsap.fromTo(
          body,
          { opacity: 1, scale: 1 },
          { opacity: 0, scale: 0.15, transformOrigin: "top left", duration: DURATION * 0.7, ease: EASE },
        )
      }
      gsap.delayedCall(DURATION, () => setClosingId((c) => (c === closingEntity ? null : c)))
    }
  }

  const nav: Nav = {
    isOpen: (id) => stack.includes(id),
    isTop: (id) => stack[stack.length - 1] === id,
    isClosing: (id) => closingId === id,
    depthOf: (id) => stack.indexOf(id),
    open: (id) => transition([...stack, id]),
    closeAbove: (id) => {
      const d = stack.indexOf(id)
      if (d >= 0) transition(stack.slice(0, d + 1))
    },
    closeSelf: (id) => {
      const d = stack.indexOf(id)
      if (d >= 0) transition(stack.slice(0, d))
    },
  }

  return (
    <NavContext.Provider value={nav}>
      <main className="relative flex min-h-svh flex-col bg-background text-foreground">
        <header className="border-b border-border px-6 py-4">
          <h1 className="text-balance text-lg font-semibold tracking-tight">GSAP Flip morph — nested-doll prototype</h1>
          <p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">
            Click a dock card to open a space, then click a task inside it to dive deeper. Each level morphs from its
            row, and parent headers keep peeking above — click a peeking header (or its X) to come back up.
          </p>
        </header>

        {/* Stage holds every entity permanently. Open ones become fixed windows
            via classes; nothing ever leaves the React tree. */}
        <div ref={stageRef} className="relative flex flex-1 flex-col">
          {/* Scrim dims only the dock behind the shallowest window; stacked
              windows are not dimmed, so ancestors peek clearly. Click to pop one
              level. */}
          <div
            onClick={() => transition(stack.slice(0, -1))}
            className={`absolute inset-0 z-10 bg-background/60 transition-opacity duration-300 ${
              stack.length ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            aria-hidden
          />

          <div className="mt-auto flex items-end gap-3 border-t border-border px-6 py-6">
            {SPACES.map((e) => (
              <EntityView key={e.id} entity={e} variant="dock" />
            ))}
          </div>
        </div>
      </main>
    </NavContext.Provider>
  )
}

function EntityView({ entity, variant }: { entity: Entity; variant: "dock" | "row" }) {
  const nav = useContext(NavContext)
  const open = nav.isOpen(entity.id)
  const closing = nav.isClosing(entity.id)
  const showBody = open || closing
  const depth = open ? nav.depthOf(entity.id) : 0
  const fid = (part: string) => `${entity.id}-${part}`

  function onFrameClick(e: React.MouseEvent) {
    // Keep clicks from bubbling to an ancestor window's frame handler.
    e.stopPropagation()
    if (!open) nav.open(entity.id)
    else if (!nav.isTop(entity.id)) nav.closeAbove(entity.id) // peeking ancestor → collapse back to it
  }

  // The collapsed footprint is reserved by a stable SLOT so siblings never shift
  // when this entity expands into a fixed window.
  const slotClass = variant === "dock" ? "relative h-[64px] w-[112px] shrink-0" : "relative h-9 w-full"

  // The hover affordance uses `hover:bg-foreground/5`, which is a TRANSLUCENT
  // background (~5% opaque). That's fine on a genuinely interactive collapsed
  // card/row, but it must NOT be active while a window is animating closed: the
  // shrinking frame still sits under the cursor, so :hover would make its
  // background 95% transparent and the parent/home content would show straight
  // through it (the "background disappears early, then reappears" bug). Gate the
  // hover so it only applies to a settled, collapsed, interactive entity.
  const interactive = !open && !closing
  const hoverCls = interactive ? "transition-colors hover:bg-foreground/5" : ""
  const frameClass = open
    ? "flex cursor-default flex-col overflow-hidden border border-border bg-card-solid shadow-2xl"
    : variant === "dock"
      ? `absolute inset-0 flex cursor-pointer flex-col overflow-hidden border border-border bg-card-solid ${hoverCls}`
      : `absolute inset-0 flex cursor-pointer flex-col overflow-hidden rounded border border-border bg-card-solid ${hoverCls}`

  const headerClass = open
    ? "flex items-center gap-3 border-b border-border py-4 pl-5 pr-12"
    : variant === "dock"
      ? "flex flex-col gap-1.5 px-2.5 py-2 pr-7"
      : "flex h-full items-center gap-2 px-2.5 pr-7"

  return (
    <div className={slotClass}>
      <div
        data-window={entity.id}
        data-flip-id={fid("frame")}
        data-flip-role="frame"
        onClick={onFrameClick}
        style={
          open
            ? windowStyle(depth)
            : {
                borderRadius: variant === "dock" ? 4 : 6,
                // While shrinking closed, this frame is once again a row inside
                // its parent's do-list, but Flip animates it back at full window
                // size. Without a raised z-index, later-DOM sibling rows paint on
                // top of it and the parent content bleeds through (it reads as a
                // transparent window). Lifting it keeps it floating opaquely above
                // its siblings until it lands in its row slot.
                ...(closing ? { zIndex: 40 } : null),
              }
        }
        className={frameClass}
      >
        {/* Accent strip — full-height absolute, tracks the frame size for free. */}
        <span className="absolute left-0 top-0 z-10 h-full w-[3px]" style={{ backgroundColor: entity.accent }} />

        {/* Child-count badge, collapsed only. Absolute so it stays out of the
            header flow (and never fights the title for space). */}
        {!open && entity.children.length > 0 && (
          <span className="absolute right-2 top-2 z-10 flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
            <span className="font-medium tabular-nums">{entity.children.length}</span>
            <span className="flex h-2.5 w-2.5 items-center justify-center">
              <NodeGlyph kind="task" strokeWidth={1.5} />
            </span>
          </span>
        )}

        {/* Close button — pinned to the corner, fades only, never a flip target. */}
        {open && (
          <button
            type="button"
            data-fade
            onClick={(e) => {
              e.stopPropagation()
              nav.closeSelf(entity.id)
            }}
            aria-label={`Close ${entity.title}`}
            className="absolute right-3 top-3 z-20 flex size-6 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <X size={16} />
          </button>
        )}

        {/* Persistent header. NOT a flip target: it stays in the frame's flow and
            just switches column→row layout, so the body always sits below it. The
            glyph + title (which ARE flipped, in transform mode) glide on top from
            their collapsed positions to their header positions. */}
        <div className={headerClass}>
          <span
            data-flip-id={fid("glyph")}
            data-flip-role="inner"
            className="flex h-5 w-5 shrink-0 items-center justify-center text-foreground"
          >
            <NodeGlyph kind={entity.kind} strokeWidth={1.75} />
          </span>

          <h3
            data-flip-id={fid("title")}
            data-flip-role="inner"
            style={{ fontSize: open ? 18 : variant === "dock" ? 12 : 13 }}
            className={
              open
                ? "flex-1 whitespace-nowrap font-semibold tracking-tight"
                : variant === "dock"
                  ? "w-full truncate font-medium leading-tight tracking-tight"
                  : "flex-1 truncate font-medium tracking-tight"
            }
          >
            {entity.title}
          </h3>
        </div>

        {/* Window body — children become openable rows; leaves show a note. Tagged
            data-body so the close handler can scale it down with the frame. */}
        {showBody && (
          <div data-fade data-body className="flex-1 overflow-auto px-5 py-4">
            {entity.children.length > 0 ? (
              <>
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                  {entity.children.length} {entity.children.length === 1 ? "item" : "items"}
                </p>
                <div className="flex flex-col gap-1.5">
                  {entity.children.map((child) => (
                    <EntityView key={child.id} entity={child} variant="row" />
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">
                Leaf entity — no children yet. The morph still works at any depth; this window opened from its row just
                like every level above it.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
