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

const DURATION = 2
const EASE = "power3.inOut"

// Flat index of every entity by id, so geometry can inspect an ancestor's KIND
// (a space peeks differently than a task — see openWindowStyle).
const ENTITY_BY_ID = new Map<string, Entity>()
;(function index(list: Entity[]) {
  for (const e of list) {
    ENTITY_BY_ID.set(e.id, e)
    index(e.children)
  }
})(SPACES)

// Nested-doll geometry. A window at depth d sits below its parent's peeking
// header (TOP_PEEK px) and inset SIDE px more on each side, so every ancestor
// stays visible behind it.
const BASE = 16
const TOP_PEEK = 56
const SIDE = 10
// Width of the vertical "spine" a SPACE collapses its header into when it has a
// child window open. Its child insets from the LEFT by this much (instead of
// from the top) so the space's glyph + rotated title stay visible down the side
// — the seed of a future breadcrumb rail.
const SPINE = 56
// A space's child also drops a little from the top — about half a header height
// — so the space's own X close button keeps its corner and proportions instead
// of being flush against the child window.
const SPACE_TOP_PEEK = 28
// …and insets a little from the RIGHT too, so the parent space's right edge
// peeks instead of the two windows sharing the exact same right border.
const SPACE_RIGHT_PEEK = 14
// …and from the BOTTOM, matching the right peek, so the parent's bottom edge
// peeks symmetrically instead of the two windows sharing the same bottom border.
const SPACE_BOTTOM_PEEK = 14

// Depth-only style, used for windows that are FADING out during a multi-level
// close (their exact resting geometry no longer matters as they retract).
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

// Stack-aware style for an OPEN window: walk its ancestors and let each one
// reserve space according to its kind — a SPACE peels off a left spine, anything
// else peeks from the top (the original nested-doll inset). This is what makes a
// task open to the RIGHT of its parent space's spine rather than below it.
function openWindowStyle(stack: string[], id: string): React.CSSProperties {
  const idx = stack.indexOf(id)
  let top = BASE
  let left = BASE
  let right = BASE
  let bottom = BASE
  for (let j = 0; j < idx; j++) {
    if (ENTITY_BY_ID.get(stack[j])?.kind === "space") {
      left += SPINE
      top += SPACE_TOP_PEEK
      right += SPACE_RIGHT_PEEK
      bottom += SPACE_BOTTOM_PEEK
    } else {
      top += TOP_PEEK
      left += SIDE
      right += SIDE
    }
  }
  return { position: "fixed", top, left, right, bottom, zIndex: 20 + idx * 10, borderRadius: 8 }
}

type Nav = {
  isOpen: (id: string) => boolean
  isTop: (id: string) => boolean
  isClosing: (id: string) => boolean
  isFadingWindow: (id: string) => boolean
  isAnimating: () => boolean
  // A SPACE that is open but not the top window collapses its header into a
  // vertical left spine (glyph stays put, title rotates anti-clockwise).
  isSpine: (id: string) => boolean
  depthOf: (id: string) => number
  fadingDepth: (id: string) => number
  styleFor: (id: string) => React.CSSProperties
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
  // When several levels close at once (e.g. closing a root while its children
  // are open), the levels DEEPER than the one morphing back stay mounted as
  // windows and just fade out in place — otherwise they'd vanish instantly and
  // briefly expose the parent's do-list before the morph. Each entry keeps the
  // id and the window depth it should render at while fading.
  const [fading, setFading] = useState<{ id: string; depth: number }[]>([])
  // True for the duration of any morph. Used to suppress body scrolling while
  // frames are mid-resize (otherwise the still-tiny window's overflowing content
  // flashes a scrollbar).
  const [animating, setAnimating] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  // Single entry point for every open/close. Captures Flip state, commits the
  // new stack synchronously, then animates the same persistent nodes.
  function transition(nextStack: string[]) {
    const stage = stageRef.current
    if (!stage) return
    const prev = stack
    const opening = nextStack.length > prev.length
    // When closing, the shallowest removed level is the one the user watches
    // morph back into a row/card; the levels DEEPER than it stay mounted as
    // windows and fade out (rather than vanishing and exposing the parent list).
    const closingEntity = nextStack.length < prev.length ? prev[nextStack.length] : null
    const fadingList: { id: string; depth: number }[] =
      nextStack.length < prev.length
        ? prev.slice(nextStack.length + 1).map((id, i) => ({ id, depth: nextStack.length + 1 + i }))
        : []

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
      setFading(fadingList)
      setAnimating(true)
    })

    Flip.from(state, {
      duration: DURATION,
      ease: EASE,
      absolute: "[data-flip-role='frame']",
      nested: true,
    })

    // Re-enable scrolling only once the morph has fully settled.
    gsap.delayedCall(DURATION, () => setAnimating(false))

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

      // Deeper levels removed in the same gesture stay on top and TELESCOPE
      // inward: they scale down toward the same top-left origin the parent's
      // body collapses toward, while fading. That reads as the nested windows
      // retracting back into their parent rather than just dissolving — and it
      // keeps covering the parent's do-list until they're gone. The deepest
      // window is furthest in, so we shrink it slightly more (depth-scaled) for
      // a subtle stacked-telescope feel. Pure transform/opacity, so it's GPU
      // cheap — no layout, no extra paint cost.
      fadingList.forEach(({ id, depth }) => {
        const win = stage.querySelector<HTMLElement>(`[data-window="${id}"][data-flip-role="frame"]`)
        if (!win) return
        gsap.fromTo(
          win,
          { opacity: 1, scale: 1 },
          {
            opacity: 0,
            scale: Math.max(0.1, 0.4 - depth * 0.08),
            transformOrigin: "top left",
            duration: DURATION * 0.7,
            ease: EASE,
          },
        )
      })

      gsap.delayedCall(DURATION, () => {
        // Clear the inline props we tweened, so these persistent nodes are clean
        // if they're ever shown again.
        fadingList.forEach(({ id }) => {
          const win = stage.querySelector<HTMLElement>(`[data-window="${id}"][data-flip-role="frame"]`)
          if (win) gsap.set(win, { clearProps: "opacity,scale,transform" })
        })
        setFading([])
        setClosingId((c) => (c === closingEntity ? null : c))
      })
    }
  }

  const nav: Nav = {
    isOpen: (id) => stack.includes(id),
    isTop: (id) => stack[stack.length - 1] === id,
    isClosing: (id) => closingId === id,
    isFadingWindow: (id) => fading.some((f) => f.id === id),
    isAnimating: () => animating,
    isSpine: (id) =>
      stack.includes(id) && stack[stack.length - 1] !== id && ENTITY_BY_ID.get(id)?.kind === "space",
    depthOf: (id) => stack.indexOf(id),
    fadingDepth: (id) => fading.find((f) => f.id === id)?.depth ?? 0,
    styleFor: (id) => openWindowStyle(stack, id),
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
  const fadingWindow = nav.isFadingWindow(entity.id)
  // Render as a window whenever it's open OR it's a deeper level fading out
  // during a multi-level close (so it keeps covering its parent's do-list).
  const asWindow = open || fadingWindow
  // A space that is open but has a child window on top collapses its header into
  // a vertical left spine (glyph stays put, title rotates anti-clockwise).
  const spine = nav.isSpine(entity.id)
  // True during any morph. Used to drop body clipping so a descendant window
  // (temporarily position:absolute under Flip) isn't cropped mid-animation.
  const animating = nav.isAnimating()
  const showBody = asWindow || closing
  const depth = open ? nav.depthOf(entity.id) : fadingWindow ? nav.fadingDepth(entity.id) : 0
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
  const interactive = !asWindow && !closing
  const hoverCls = interactive ? "transition-colors hover:bg-foreground/5" : ""
  const frameClass = asWindow
    ? // A fading window is mid-animation: disable its clicks so a stray click
      // can't re-open it (it isn't in the live stack).
      `flex cursor-default flex-col overflow-hidden border border-border bg-card-solid shadow-2xl ${fadingWindow ? "pointer-events-none" : ""}`
    : variant === "dock"
      ? `absolute inset-0 flex cursor-pointer flex-col overflow-hidden border border-border bg-card-solid ${hoverCls}`
      : `absolute inset-0 flex cursor-pointer flex-col overflow-hidden rounded border border-border bg-card-solid ${hoverCls}`

  const headerClass = spine
    ? // Spine: an opaque full-height bar pinned to the left edge (covers the
      // do-list underneath in that strip). Glyph sits at top; the title rotates
      // to read up the bar. z-10 keeps it above the body; the child window
      // (higher stacking context) covers everything to the right of it. No
      // border here — the separating line is a dedicated fading element (below),
      // so it never "jumps" from horizontal to vertical. The opaque background is
      // a separate fading layer (data-spine-bg) so it can fade in/out rather than
      // popping over the content while the body slides aside.
      "absolute inset-y-0 left-[3px] z-10 flex w-14 flex-col items-center gap-7 pt-4"
    : asWindow
      ? // z-10 keeps the glyph/title above the frame-level spine strip (z-8) so
        // they stay readable while that strip fades out during a close.
        "relative z-10 flex items-center gap-3 py-4 pl-5 pr-12"
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
          asWindow
            ? // Open windows use the stack-aware geometry (so a space's child
              // insets from the LEFT for the spine); fading windows are leaving,
              // so their exact resting spot no longer matters — depth is enough.
              fadingWindow
              ? windowStyle(depth)
              : nav.styleFor(entity.id)
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
        {/* Accent strip — full-height absolute, tracks the frame size for free.
            The spine header is inset 3px from the left (below) so it never paints
            over this strip; that keeps the entity's colored border visible without
            raising the strip's z-index (which would make it bleed past windows). */}
        <span className="absolute left-0 top-0 z-10 h-full w-[3px]" style={{ backgroundColor: entity.accent }} />

        {/* Spine background — a FRAME-LEVEL opaque strip with FIXED geometry (the
            narrow left rail), independent of the header's layout box. It fades in
            when this space becomes a spine and fades out when it un-spines. Keeping
            its geometry fixed (rather than `inset-0` inside the header) is what
            prevents the old bug where, on close, the header box snapped from the
            narrow bar to the full-width header and this still-opaque layer briefly
            covered the closing child's top. As a narrow strip it never overlaps the
            child window (which insets further right). z-[8] sits above the body
            do-list (so it hides those rows under the rail) but below the glyph and
            title (z-10) so they stay readable. */}
        {asWindow && (
          <span
            aria-hidden
            style={{ transitionDuration: `${DURATION}s` }}
            className={`pointer-events-none absolute inset-y-0 left-[3px] z-[8] w-14 bg-card-solid transition-opacity ${
              spine ? "opacity-100" : "opacity-0"
            }`}
          />
        )}

        {/* Child-count badge, collapsed only. Absolute so it stays out of the
            header flow (and never fights the title for space). */}
        {!asWindow && entity.children.length > 0 && (
          <span className="absolute right-2 top-2 z-10 flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
            <span className="font-medium tabular-nums">{entity.children.length}</span>
            <span className="flex h-2.5 w-2.5 items-center justify-center">
              <NodeGlyph kind="task" strokeWidth={1.5} />
            </span>
          </span>
        )}

        {/* Close button — pinned to the corner, fades only, never a flip target.
            When this space becomes a spine, it slides tighter into the very corner
            (higher + more right) so it tucks into the slim top peek and is never
            cropped by the child window. transition-all (synced to the morph
            duration) makes that reposition glide rather than snap. */}
        {asWindow && (
          <button
            type="button"
            data-fade
            onClick={(e) => {
              e.stopPropagation()
              nav.closeSelf(entity.id)
            }}
            aria-label={`Close ${entity.title}`}
            style={{ transitionDuration: `${DURATION}s` }}
            className={`absolute z-20 flex size-6 items-center justify-center rounded-[4px] text-muted-foreground transition-all hover:bg-foreground/5 hover:text-foreground ${
              spine ? "right-1 top-1" : "right-3 top-3"
            }`}
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
            className="relative flex h-5 w-5 shrink-0 items-center justify-center text-foreground"
          >
            <NodeGlyph kind={entity.kind} strokeWidth={1.75} />
          </span>

          <h3
            data-flip-id={fid("title")}
            data-flip-role="inner"
            style={{
              fontSize: spine ? 15 : asWindow ? 18 : variant === "dock" ? 12 : 13,
              // Rotation is applied via the `transform` channel (NOT Tailwind's
              // `-rotate-90`, which uses the independent CSS `rotate` property).
              // GSAP Flip captures/animates rotation through the transform matrix,
              // so keeping it in `transform` lets Flip smoothly rotate the title
              // between the horizontal header and the vertical spine — and cleanly
              // clear it afterwards. Mixing the two channels left a stuck rotation.
              transform: spine ? "rotate(-90deg)" : undefined,
              transformOrigin: "center",
            }}
            className={
              spine
                ? "relative whitespace-nowrap font-semibold tracking-tight"
                : asWindow
                  ? // Natural width (NOT flex-1): the box hugs the text so its
                    // center — the rotation pivot Flip animates — stays next to the
                    // glyph. A stretched box would put the pivot far right and make
                    // the title sweep a long arc into the spine.
                    "relative whitespace-nowrap font-semibold tracking-tight"
                  : variant === "dock"
                    ? "w-full truncate font-medium leading-tight tracking-tight"
                    : "flex-1 truncate font-medium tracking-tight"
            }
          >
            {entity.title}
          </h3>
        </div>

        {/* Header divider. A dedicated element (not a CSS border) so it can FADE
            between states with a CSS opacity transition instead of the border
            visually jumping from the header's bottom (horizontal window) to its
            side (vertical spine). It's pinned to the frame at the window header's
            bottom; when the space collapses to a spine it simply fades to 0 (and
            fades back in on the way out). Tasks never spine, so theirs stays. */}
        {asWindow && (
          <span
            aria-hidden
            style={{ transitionDuration: `${DURATION}s` }}
            className={`pointer-events-none absolute left-0 right-0 top-[57px] z-[5] h-px bg-border transition-opacity ${
              spine ? "opacity-0" : "opacity-100"
            }`}
          />
        )}

        {/* Window body — children become openable rows; leaves show a note. Tagged
            data-body so the close handler can scale it down with the frame. */}
        {showBody && (
          <div
            data-fade
            data-body
            className={
              // The scrollbar is hidden visually everywhere ([scrollbar-width:none]
              // + the webkit pseudo) while scrolling stays functional. This avoids
              // a whole class of timing races: a window mid-morph is briefly too
              // short for its content, and the shared `animating` flag can't be
              // perfectly synced to every frame's settle moment — so an auto
              // scrollbar would intermittently flash. Hiding it sidesteps that
              // entirely. When closing, pin the body absolutely so it is OUT of the
              // frame's flex flow: that way the collapsed header/title lands in the
              // same spot whether the body is still mounted or already gone, which
              // removes the end-of-close title "snap down".
              // While a morph is in progress, an open parent must NOT clip its
              // body. A descendant window is normally `position: fixed` (which
              // escapes ancestor overflow), but Flip switches it to `absolute`
              // for the duration of the tween — and an `absolute` child IS
              // clipped by this body's `overflow`. Since the body starts below
              // the 57px header, that clipped away the child's overlapping top
              // strip and revealed the parent behind it (the reported bug). Using
              // `overflow-visible` during the morph lets the child render
              // unclipped; once settled the descendant is `fixed` again, so we can
              // safely resume `overflow-auto` for scrolling. The frame's own
              // `overflow-hidden` still bounds everything at the window edge.
              closing
                ? "pointer-events-none absolute inset-x-0 bottom-0 top-[57px] overflow-hidden px-5 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                : spine
                  ? // Push content clear of the left spine so the "ITEMS" label and
                    // do-list rows never sit underneath the vertical header.
                    `flex-1 py-4 pl-16 pr-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${animating ? "overflow-visible" : "overflow-auto"}`
                  : `flex-1 px-5 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${animating ? "overflow-visible" : "overflow-auto"}`
            }
          >
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
