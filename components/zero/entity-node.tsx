"use client"

import { useState, useLayoutEffect, useEffect, useRef } from "react"
import { useTheme } from "next-themes"
import { Check, X, Maximize2, Minimize2 } from "lucide-react"
  import { getEntity, getOpenTaskCount, setEntityCompleted } from "@/lib/zero/data"
import type { TaskPriority } from "@/lib/zero/types"
import { KIND_META, isTerminal, isClosed } from "@/lib/zero/kinds"
import { useZeroNav, useRowSelection } from "@/lib/zero/nav-store"
import {
  HEADER_H,
  TASK_SIDE,
  RIGHT_PEEK,
  SPACE_CLIP_HEX,
  SPACE_CLIP_RECT,
  SPACE_HEX_POINTS,
  ROW_RECT_CLIP,
  ROW_RECT_POINTS,
  LEAF_HY,
  spaceClip,
  spaceClipPoints,
  regularHexPoints,
  regularHexClip,
  surfaceAt,
  telescopicLevel,
  telescopicSurface,
  PANEL_SLIDE_SEC,
  PANEL_SLIDE_CSS_EASE,
  type SpaceKind,
} from "@/lib/zero/motion"
import { DAYLINE_ROW_H } from "@/lib/zero/layout"
import gsap from "gsap"
import { Flip } from "gsap/Flip"
import { DURATION_S, MORPH_CSS_EASE, SEND_EASE } from "@/lib/zero/flip-stage"
import { NodeGlyph, GLYPH_FILL_SECONDS, GLYPH_MORPH_SECONDS } from "./node-glyph"
import { ResourceGlyph } from "./resource-glyph"
import { EntityBody } from "./entity-body"
import { DebugFrameLabel } from "./debug-frame-label"
import { useDebugView } from "@/lib/zero/debug-view"
import { cn } from "@/lib/utils"

// Space windows (leaf hexagon AND expanded-ancestor rectangle) are clip-path
// shaped, and a clip-path clips away box-shadow — so they carry NO drop shadow.
// Their boundary against an identically-colored parent is supplied entirely by a
// crisp SVG outline (see the overlay in the frame below), which reads cleanly in
// both themes and — unlike a `filter: drop-shadow` — never forces a layer
// re-rasterization or re-anchors fixed children during the Flip morph.

// Header divider (the hairline under a window's header) is hidden everywhere for
// now. When an ancestor window has an open child, its divider painted ON TOP of the
// child window's hexagon: at rest the child is `position: fixed` with no transformed
// ancestor, so it escapes the parent frame's stacking context (the child only wins
// the z-order DURING the morph, while Flip has the parent transformed). Reliably
// making the child paint over the divider at rest means reworking that fixed-position
// stacking escape, which is fragile. Until that rework, suppress the divider globally.
// Flip to `true` to bring it back (e.g. once the child no longer escapes).
const SHOW_HEADER_DIVIDER = false

const priorityDot: Record<TaskPriority, string> = {
  high: "bg-accent",
  medium: "bg-foreground/40",
  low: "bg-foreground/20",
}

// --- "Sent as request" row reflow -----------------------------------------
//
// When a task is sent, its collapsed do-list row flips from the normal
//   [glyph] [title] ……… [meta]
// arrangement to a mirrored one where the glyph sits hard against the row's RIGHT
// edge, the title is right-aligned just to its left, and the trailing meta moves
// to the far LEFT:
//   [meta] ……… [title →][glyph]
// It's achieved purely with flex `order` + one `auto` margin (the spacer hops from
// the title to the meta). The slide between the two arrangements is animated by a
// GSAP Flip in the component. These token sets are shared by the JSX (resting
// state) and the imperative Flip invert so the two can never drift apart.
const REQ_REST = { glyph: "order-1", title: "order-2 mr-auto", meta: "order-3" }
const REQ_SENT = { glyph: "order-3", title: "order-2 text-right", meta: "order-1 mr-auto" }

/** Imperatively force the row's three flip parts into the rest- or sent-layout by
 *  swapping the token sets above. Used only to re-create the PRE-toggle layout for
 *  Flip.getState (React has already painted the post-toggle one), so the captured
 *  "from" state is the old arrangement and Flip can slide into the new. */
function setReqLayout(
  glyph: Element | null,
  title: Element | null,
  meta: Element | null,
  sent: boolean,
) {
  const swap = (el: Element | null, on: string, off: string) => {
    if (!el) return
    el.classList.remove(...off.split(" "))
    el.classList.add(...on.split(" "))
  }
  swap(glyph, sent ? REQ_SENT.glyph : REQ_REST.glyph, sent ? REQ_REST.glyph : REQ_SENT.glyph)
  swap(title, sent ? REQ_SENT.title : REQ_REST.title, sent ? REQ_REST.title : REQ_SENT.title)
  swap(meta, sent ? REQ_SENT.meta : REQ_REST.meta, sent ? REQ_REST.meta : REQ_SENT.meta)
}

// Time is absolute epoch ms now (see Schedule). These formatters take a
// timestamp and render the time-of-day; `fmtDue` renders a relative day label.
function fmtTime(epoch: number) {
  const d = new Date(epoch)
  const h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? "pm" : "am"
  const hr = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`
}

function fmtMoment(epoch: number) {
  const d = new Date(epoch)
  const h = d.getHours()
  const m = d.getMinutes()
  const s = d.getSeconds()
  const ampm = h >= 12 ? "pm" : "am"
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${ampm}`
}

/** Relative day label for a deadline: "Today" / "Tomorrow" / weekday within a
 *  week / "Mon D" further out. Replaces the old free-text `dueDate`.
 *
 *  HYDRATION SAFETY: the relative wording ("Today"…) depends on the CURRENT day,
 *  but Zero ships as a STATIC EXPORT — the server HTML is generated once at BUILD
 *  time. If the client runs on a later day, "Today" baked at build becomes
 *  "Yesterday" on the client → a text hydration mismatch that tears down the tree
 *  (this is what was blanking the web preview). So `relative` is passed as the
 *  component's `mounted` flag: during SSR + the first (hydration) render it is
 *  FALSE and we emit only the absolute `Mon D` form, which is derived purely from
 *  the task's own epoch and is therefore identical on server and client. After
 *  mount the flag flips true and the friendly relative wording takes over. */
function fmtDue(epoch: number, relative: boolean) {
  const due = new Date(epoch)
  const abs = () => due.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  if (!relative) return abs()
  const startOfDay = (d: Date) => {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x.getTime()
  }
  const days = Math.round((startOfDay(due) - startOfDay(new Date())) / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  if (days === -1) return "Yesterday"
  if (days > 1 && days < 7) return due.toLocaleDateString(undefined, { weekday: "short" })
  return abs()
}

/**
 * THE single recursive entity element — Zero's faithful port of the `flip-demo`
 * prototype's nested-doll technique. There are no separate row / dock-card /
 * window components anymore: ONE persistent node per entity renders as a
 * collapsed do-list row or dock card, and when that entity enters the nav stack
 * it morphs IN PLACE into a fixed focus window whose body recursively renders
 * the same EntityNode for its children.
 *
 * Because a row and the window it opens are the SAME DOM node (matched by
 * `data-flip-id`), opening grows it out of its row and closing shrinks it back
 * INTO that exact row — no duplicate button, no captured-rect drift, no sudden
 * unmount. The collapsed footprint is held by a stable SLOT so siblings never
 * shift when this entity lifts out into a window.
 *
 *   - frame  → `data-flip-role="frame"`; Flip tweens its real width/height.
 *   - glyph + title → `data-flip-role="inner"`; they ride along on top,
 *                     gliding/scaling/rotating between row, header, and spine.
 *   - chrome that only exists while open (close button, divider, body) is tagged
 *     `data-fade` / `data-body` and fades or scales — never a flip target.
 */
export function EntityNode({
  entityId,
  contextId,
  variant,
  detached = false,
  dockMetrics,
}: {
  entityId: string
  /** The id of the context (space) whose Dock/DO-list renders this node. This is
   *  what makes the SAME entity, referenced in multiple contexts, resolve to a
   *  single owning window instead of one window per rendered copy. */
  contextId: string
  variant: "row" | "dock"
  /** Responsive dock-card sizing from the dock's layout engine (see dock-layout.ts).
   *  Present only for dock cards; when absent the historical constants are used, so
   *  do-list rows and any un-metered dock render exactly as before. `contentScale`
   *  shrinks glyph/title/meta once the frame crowds them (never below the floor). */
  dockMetrics?: { cardW: number; cardH: number; contentScale: number }
  /** Mounted as a standalone DETACHED window (no in-place row exists for it; see
   *  work-surface). Only affects the CLOSING (fading) frame: a detached window has
   *  no row to telescope back into, so when it is popped from the stack and shrinks
   *  toward its launch point it must keep rendering as its own LEAF (octagon, opaque
   *  surface, floating header) instead of momentarily flipping to an ancestor
   *  spine/transparent rect. */
  detached?: boolean
}) {
  const nav = useZeroNav()
  // Theme drives the telescopic surface direction. Default to dark when unresolved
  // (the app's defaultTheme is "dark") so first paint matches and never flashes.
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== "light"
  // `resolvedTheme` is undefined during SSR / first client render, so we default
  // `isDark` to dark there. That's flash-free for COLORS (a light user just sees
  // colors settle), but the light-only hexagon rim is a STRUCTURAL branch (an
  // <svg> that exists only when `!isDark`) — rendering it on the client's first
  // paint while the server omitted it is a hydration mismatch. Gate that one
  // branch behind `mounted` so first client paint matches the server, then the
  // rim fades in after the theme has resolved.
  const [mounted, setMounted] = useState(false)
  useLayoutEffect(() => setMounted(true), [])
  // [v0] DEBUG: colored frames + labels gated on the shared `§ 2` toggle. Read here
  // (before the early `return null`) to keep the hook order stable.
  const { frames: showFrames } = useDebugView()
  const entity = getEntity(entityId)
  const region = variant === "dock" ? "dock" : "list"
  const { showHighlight, ref } = useRowSelection(region, entityId)
  const [done, setDone] = useState(!!entity?.completed)
  // Keep the local completion mirror honest with the store. The toggle sets `done`
  // optimistically AND persists, but a node that stays mounted (e.g. a do-list row)
  // must also reflect completion changed elsewhere; reading the persisted value here
  // makes both paths converge (the optimistic set becomes a no-op once persisted).
  useLayoutEffect(() => {
    setDone(!!entity?.completed)
  }, [entity?.completed])
  // CLOSED mirror — drives the glyph FILL, which is now DISTINCT from `done`. Closed
  // = the manual `closed` flag OR `cancelled` OR a DERIVED case (a done task past its
  // first following midnight; an event/instant past its end); see `isClosed`. It is
  // recomputed each render so it tracks store edits and reloads, with a state mirror
  // so the fill wipe animates on the open⇄closed transition.
  const closedNow = entity ? isClosed(entity) : false
  const [closed, setClosed] = useState(closedNow)
  useLayoutEffect(() => {
    setClosed(closedNow)
  }, [closedNow])
  // Inner-checkmark color phase. The check is painted OVER the glyph; the glyph FILL
  // wipes its silhouette with ink left→right over GLYPH_FILL_SECONDS when the entity
  // CLOSES (no longer merely when done). So a done-but-still-open task shows an INK
  // check on the EMPTY glyph; once it CLOSES the check fades to `background` (white) in
  // lockstep with the fill inking the silhouette behind it. `checkWhite` true = white,
  // false = ink. A node ALREADY closed at mount starts white, no fade.
  const [checkWhite, setCheckWhite] = useState(closedNow)
  const prevClosedForCheck = useRef(closedNow)
  useLayoutEffect(() => {
    if (closed === prevClosedForCheck.current) return
    prevClosedForCheck.current = closed
    if (closed) {
      // Just closed: paint ink THIS frame (pre-paint), then flip to white next frame
      // so the CSS color transition runs alongside the glyph's fill wipe.
      setCheckWhite(false)
      const id = requestAnimationFrame(() => setCheckWhite(true))
      return () => cancelAnimationFrame(id)
    }
    // Just reopened: reset so the next close animates from ink again.
    setCheckWhite(false)
  }, [closed])
  // Inner-checkmark morph gate. The check is a SEPARATE layer painted OVER the glyph
  // (the glyph draws the task SQUARE; the check is the tick inside it — the two stacked
  // marks that together read as a "checkbox"). When an entity's KIND changes, `kind`
  // and `done` flip synchronously, but the glyph silhouette MORPHS into the square over
  // GLYPH_MORPH_SECONDS — so revealing the check the instant the kind flips pops it onto
  // a shape that is still mid-morph (the reported "checkbox shows too soon"). This gate
  // holds the check hidden while morphing INTO task and only reveals it once the square
  // has settled. A plain done-toggle (kind unchanged) leaves it true, so completing a
  // task still shows the check promptly alongside the fill wipe.
  const entityKind = entity?.kind
  // Any kind whose glyph carries a checkmark when done (task/event/instant). The gate
  // was task-only; events/instants now complete via their glyph too, so it keys off
  // KIND_META rather than a hard-coded "task".
  const kindChecks = (k: typeof entityKind) => !!k && KIND_META[k].checkmarkWhenDone
  const [glyphSettledTask, setGlyphSettledTask] = useState(kindChecks(entityKind))
  const prevKindForCheck = useRef(entityKind)
  useLayoutEffect(() => {
    if (prevKindForCheck.current === entityKind) return
    prevKindForCheck.current = entityKind
    if (kindChecks(entityKind)) {
      // Morphing INTO a checkmark kind: hide the check now, reveal it once the
      // silhouette settles into its final shape.
      setGlyphSettledTask(false)
      const id = setTimeout(() => setGlyphSettledTask(true), GLYPH_MORPH_SECONDS * 1000)
      return () => clearTimeout(id)
    }
    // Morphing OUT to a non-checkmark kind: the check isn't applicable.
    setGlyphSettledTask(false)
  }, [entityKind])
  const [closeHover, setCloseHover] = useState(false)
  const [expandHover, setExpandHover] = useState(false)
  // Mouse-hover state for the collapsed row/card. Driven in JS (not a Tailwind
  // `hover:` class) so the background can be the dynamic per-depth `surfaceAt`
  // color — the same value the node's window adopts when opened.
  const [hovered, setHovered] = useState(false)
  // Mirror of `asWindow` (computed below, after the early return) so the settle
  // effect — which must run before that return to satisfy the rules of hooks —
  // can read the latest value without re-deriving it.
  const asWindowRef = useRef(false)

  // Keep hover state honest across morphs. `hovered`/`closeHover` are driven by
  // pointer enter/leave on the frame, but a morph moves the frame UNDER a
  // stationary cursor, so those events don't fire for the geometry change:
  //  - While animating: clear `closeHover` (the X mounts under the cursor on open,
  //    which would otherwise leave it stale-true and flash the close title).
  //  - When the morph SETTLES into a collapsed row/card: a window that shrank shut
  //    out from under the pointer never fired `onPointerEnter`, so `hovered` would
  //    be stale-false (highlight dead until the user wiggles the mouse). Re-derive
  //    it from the element's real `:hover` so it lights up (or clears) immediately.
  useLayoutEffect(() => {
    if (nav.animating) {
      setCloseHover(false)
      return
    }
    const el = ref.current
    setHovered(!asWindowRef.current && !!el && el.matches(":hover"))
  }, [nav.animating, ref])

  // "Sent as request" row reflow. `sentRef` mirrors the fully-derived `sent` flag
  // (set during render below, after `asWindow`/`isTask` exist) so this effect — which
  // must run BEFORE the early return to satisfy the rules of hooks — can read it.
  const reqHeaderRef = useRef<HTMLDivElement | null>(null)
  const sentRef = useRef(false)
  const prevSentRef = useRef(false)
  // Lit highlight that does NOT depend on the pointer, held for the whole reflow so
  // the row keeps its hover surface while the glyph morphs and slides (the menu has
  // closed by then, so there's no real hover to rely on).
  const [reqAnimating, setReqAnimating] = useState(false)

  // FULLSCREEN geometry re-assertion. When a child opens OVER a fullscreen window,
  // the open Flip runs in `absolute` mode and leaves the covered target frame with a
  // GSAP-written inline `transform` (+ top/left) from the morph. Toggling/entering
  // fullscreen is NOT a stack change, so no later Flip clears it — and React won't
  // re-apply its committed geometry because its own virtual style value never changed
  // (classic React↔GSAP inline conflict). The stale transform shoves the frame up by
  // one hexagon wedge, pushing a covered Space ancestor's spine TITLE off-screen (the
  // "ancestors lose their title" bug). Once the morph settles, imperatively clear the
  // transform and re-assert the committed fullscreen box so the title lands in view.
  // Mirrors are set during render below (after `fullscreen`/`winStyle` exist).
  const fullscreenRef = useRef(false)
  const winStyleRef = useRef<React.CSSProperties | null>(null)
  useLayoutEffect(() => {
    if (nav.animating) return
    const el = ref.current
    const ws = winStyleRef.current
    if (!fullscreenRef.current || !el || !ws) return
    el.style.transform = "none"
    if (ws.top != null) el.style.top = typeof ws.top === "number" ? `${ws.top}px` : String(ws.top)
    if (ws.left != null) el.style.left = typeof ws.left === "number" ? `${ws.left}px` : String(ws.left)
    if (ws.width != null) el.style.width = typeof ws.width === "number" ? `${ws.width}px` : String(ws.width)
    if (ws.height != null)
      el.style.height = typeof ws.height === "number" ? `${ws.height}px` : String(ws.height)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.animating, nav.fullscreenId, nav.stack, ref])

  useLayoutEffect(() => {
    const sent = sentRef.current
    // While the node is (un)morphing between row and window — or rendered AS a window
    // — the big open/close Flip owns the glyph/title and the meta isn't mounted, so a
    // request reflow here would fight it. Just keep the tracker in sync.
    if (asWindowRef.current || nav.animating) {
      prevSentRef.current = sent
      return
    }
    if (prevSentRef.current === sent) return
    const wasSent = prevSentRef.current
    prevSentRef.current = sent
    const root = reqHeaderRef.current
    if (!root) return
    const glyph = root.querySelector<HTMLElement>('[data-req-flip="glyph"]')
    const title = root.querySelector<HTMLElement>('[data-req-flip="title"]')
    const meta = root.querySelector<HTMLElement>('[data-req-flip="meta"]')
    const targets = [glyph, title, meta].filter(Boolean) as HTMLElement[]
    if (targets.length < 2) return
    // React already painted the NEW layout; re-apply the OLD one, snapshot it as the
    // Flip "from", then restore the NEW layout (matching React) and slide into it.
    setReqLayout(glyph, title, meta, wasSent)
    const state = Flip.getState(targets)
    setReqLayout(glyph, title, meta, sent)
    setReqAnimating(true)
    Flip.from(state, {
      // zeroSend = cubic-bezier(.66,-0.27,.17,1.18): a slight anticipation dip then an
      // overshoot past the target before settling, giving the glyph/title slide a
      // springy snap rather than a flat glide.
      duration: 0.55,
      ease: SEND_EASE,
      absolute: true,
      onComplete: () => setReqAnimating(false),
    })
  }, [nav.dataVersion, nav.animating])

  // ── Deferred body mount (open-morph perf) ─────────────────────────────────
  // The heavy EntityBody subtree (do-list + resource panels + dock) is the bulk of
  // the open commit's cost. When a window opens DURING a morph, hold that subtree
  // back by ONE animation frame: the frame/glyph/title/header (the Flip anchors, all
  // OUTSIDE EntityBody) still mount synchronously, so the morph's first frame paints
  // on time. The body then mounts INTO the already-running [data-body] grow+fade
  // tween (flip-stage scales [data-body] from 0.15→1 / 0→1 opacity), so the do-list +
  // panels fade+grow in DURING the morph with no pop. When it's NOT a morph (initial
  // deep mount, reduced motion, an already-open ancestor re-rendering) the body
  // mounts immediately, so a window never flashes empty. `showBodyRef` mirrors the
  // post-early-return `showBody` (rules of hooks: this effect must precede the return).
  const showBodyRef = useRef(false)
  const [bodyReady, setBodyReady] = useState(false)
  useEffect(() => {
    if (!showBodyRef.current) {
      if (bodyReady) setBodyReady(false)
      return
    }
    if (bodyReady) return
    // Only defer during a pure OPEN morph. On a CLOSE/telescope-out (`nav.closing`
    // set) or a multi-level FADE, the DESTINATION window re-expands from an ancestor
    // spine and its do-list must be present IMMEDIATELY so the retracting child has a
    // row to recede into — deferring it there flashes a one-frame ghost do-list as the
    // reveal races the reverse morph. So: not animating, or a close/fade in flight →
    // mount now (no empty frame, matches pre-deferral behaviour).
    if (!nav.animating || nav.closing || nav.fading.length > 0) {
      setBodyReady(true)
      return
    }
    // Open morph in flight → let the frame's first paint land, then mount the body one
    // frame later so it joins the [data-body] grow tween already underway.
    const raf = requestAnimationFrame(() => setBodyReady(true))
    return () => cancelAnimationFrame(raf)
  }, [nav.stack, nav.animating, nav.closing, nav.fading, bodyReady])

  if (!entity) return null

  const kind = entity.kind
  const isTask = kind === "task"
  const isSpace = kind === "space"
  // A RESOURCE TASK is a task bound to a web surface (Zero as a contextual browser).
  // When open it renders that surface (live embed or illustrative stand-in) in place
  // of the do-list. The glyph+title header, IN/OUT spines and close all stay identical
  // to a normal Task window — only the central working surface differs.
  const isResource = isTask && !!entity.webUrl
  // GLYPH SEMANTICS (driven by KIND_META, single source of truth):
  //  - FILL now means CLOSED (archived / lifecycle-ended), not merely "done": any
  //    completable kind fills its silhouette (event triangle, space hexagon, etc.)
  //    once it is closed — manually, cancelled, or derived (done task past midnight,
  //    event/instant past its end);
  //  - a DONE task shows the inner checkmark — with NO fill until it also closes, so
  //    a freshly-checked task reads as a square + tick on an empty glyph, and a
  //    done+closed task reads as a FILLED square + tick;
  //  - terminal kinds (community→retired, organism/individual→dead) never fill; they
  //    instead carry a terminal cross (inert today — nothing sets retiredOn/diedOn
  //    yet — and its exact styling is deferred).
  const meta = KIND_META[kind]
  const terminal = isTerminal(entity)
  // A terminal glyph is NOT filled — it stays an outline and carries the terminal
  // cross instead. Only completable kinds fill, and only once CLOSED.
  const glyphFilled = meta.fillGlyphWhenDone && closed
  const showCheckmark = meta.checkmarkWhenDone && done

  // OWNERSHIP. The same entity can be referenced in several contexts, so it can
  // be rendered by several do-lists/docks at once. Exactly ONE of those instances
  // should morph into the focus window: the one whose parent context is the
  // actual parent in the nav stack. Otherwise every copy turns into a window
  // (the "duplicate window lower on screen" bug).
  const stackDepth = nav.stack.indexOf(entityId)
  const ownsOpen = stackDepth >= 1 && nav.stack[stackDepth - 1] === contextId
  const closingEntry =
    nav.closing && nav.closing.id === entityId && nav.closing.parent === contextId ? nav.closing : null
  const fadingEntry = nav.fading.find((f) => f.id === entityId && f.parent === contextId) ?? null
  const isClosing = !!closingEntry
  const fadingWindow = !!fadingEntry
  // `open` here means "this instance owns the open window" — used for the click
  // behaviour and the window/header/spine rendering below.
  const open = ownsOpen
  // Render as a window when this instance owns the open window OR while
  // telescoping out during a multi-level close (so it keeps covering its
  // parent's do-list as it retracts).
  const asWindow = ownsOpen || fadingWindow
  // Expose the latest value to the settle effect above (declared before the early
  // return, so it can't read `asWindow` directly).
  asWindowRef.current = asWindow

  // A collapsed TASK row that has been sent as a request. `rowReq` gates the request
  // layout tokens so they're only ever applied to a real collapsed row (never a
  // window/dock header, where flex `order` would scramble the layout). `sent` drives
  // both the resting layout and the Flip reflow effect above (via `sentRef`).
  const rowReq = !asWindow && variant === "row"
  const sent = rowReq && isTask && !!entity.requested
  sentRef.current = sent
  // A DETACHED window that has been popped and is now shrinking closed. It has no
  // row/ancestor to recede into, so it must keep its own LEAF identity for the
  // whole shrink (see `detached` prop). Only the fading phase needs this: while
  // OPEN it is a normal stack leaf, and drilling a child into it still telescopes
  // it to an ancestor spine through the usual stack logic.
  const detachedFading = detached && fadingWindow && !ownsOpen
  const isTop = (ownsOpen && nav.activeId === entityId) || detachedFading
  const animating = nav.animating
  const showBody = asWindow || isClosing
  // Expose to the deferred-body effect above (declared before the early return, so it
  // can't read `showBody` directly). See that effect for the one-frame open deferral.
  showBodyRef.current = showBody

  const depth = ownsOpen
    ? stackDepth
    : fadingWindow
      ? fadingEntry!.depth
      : closingEntry
        ? closingEntry.depth
        : 0

  // FULLSCREEN: the user clicked a window's expand button. That window (fullscreenId)
  // AND every strict ancestor above the root form the "fullscreen chain" — stack
  // depths 1..fsDepth — and each fills the viewport. Root (depth 0 / home) never
  // joins. A fading/closing window opts out so the close morph keeps its own geometry.
  const fsDepth = nav.fullscreenId ? nav.stack.indexOf(nav.fullscreenId) : -1
  const fullscreen =
    asWindow && !fadingWindow && !isClosing && depth >= 1 && fsDepth >= 1 && depth <= fsDepth

  // Per-instance flip-id prefix. Two references to the same entity (different
  // contexts) must NOT share a flip-id, or GSAP Flip mismatches their before/
  // after states. Scoping by context keeps each instance's morph self-consistent
  // (stable across its own open/close) while distinct from the other copy.
  const flip = `${contextId}:${entityId}`

  // Depth of THIS node's CONTEXT — the parent window it is rendered inside (home
  // == 0, the first opened window == 1, and so on). The collapsed node's resting
  // fill matches that parent surface so it reads as INVISIBLE at rest, while
  // staying fully OPAQUE (important for the close morph: a closing window reuses
  // this collapsed background as GSAP Flip shrinks it back, so it must not turn
  // transparent and let parent content bleed through).
  const contextDepth = Math.max(0, nav.stack.indexOf(contextId))
  // The frontmost open window's depth. It drives the telescopic mapping so the
  // leaf is capped and ancestors recede relative to it. A detached window that is
  // shrinking closed has already been popped, so the live stack's leaf sits BELOW
  // it; treat the detached window as its own leaf so its surface stays the opaque
  // foreground fill (not a receded/transparent ancestor tone) for the whole shrink.
  const leafDepth = detachedFading ? depth : Math.max(0, nav.stack.length - 1)
  // Resting surface = parent window's (telescoped) background, so the collapsed
  // node is invisible at rest. Highlight = ONE ramp step further toward foreground
  // than that — a clear hover lift (brighter in dark mode, a subtle darken in
  // light mode). It no longer necessarily equals the opened window's background
  // (the cap + telescoping decouple them); that intentional mismatch is accepted.
  const restSurface = telescopicSurface(contextDepth, leafDepth, isDark)
  const highlightColor = surfaceAt(telescopicLevel(contextDepth, leafDepth, isDark) + 1)

  // Dock cards carry a clearly-visible resting fill — a deliberate lift toward
  // the hover colour — so the hexagon reads as a real, tappable chip even before
  // hover (the previous 45% mix was too faint to look intentional in either
  // theme). Do-list rows stay fully invisible at rest. BOTH still share the
  // identical hover highlight (`highlightColor`), so a card and a same-parent row
  // light up the same way; the card just starts most of the way there.
  const collapsedRest =
    variant === "dock" ? `color-mix(in oklab, ${restSurface}, ${highlightColor} 70%)` : restSurface

  // The frame's intended background as a THEME-REACTIVE expression (var()/color-mix
  // over --background/--foreground), matching whichever style branch is active below.
  // Exposed on the frame as `data-surface` so the morph's manual colour FLIP can end
  // its tween on this EXPRESSION rather than a getComputedStyle()-resolved concrete
  // rgb. Ending on the expression keeps the inline colour theme-reactive after the
  // morph, so toggling dark↔light recolours every frame even when React's style string
  // is unchanged across themes (e.g. level-0 windows that read `var(--background)` in
  // both) — that stale concrete colour was why some entities stayed dark after a switch.
  // "Held" lit state that does NOT depend on the pointer being over the node:
  // true while THIS entity's right-click menu is open (`menuKey`) or while it is
  // flying between the do-list and the dock (`morphKey`). Keyed by the shared
  // flip-id, so the highlight survives the row→card swap and the node lands lit.
  const held = nav.menuKey === flip || (animating && nav.morphKey === flip)

  // Whether the collapsed row/card is in its lit "hover/held" state. Also drives the
  // asymmetric hover transition below: highlight fades IN fast, but OUT slower so the
  // hover lingers a beat after the pointer leaves (feels less twitchy).
  const frameActive = hovered || showHighlight || isClosing || held || reqAnimating

  const frameSurface = asWindow
    ? telescopicSurface(depth, leafDepth, isDark)
    : frameActive
      ? highlightColor
      : collapsedRest

  void nav.dataVersion // re-read counts when data mutates
  const openCount = getOpenTaskCount(entityId)

  const sched = entity.schedule
  const hasRange = typeof sched?.startAt === "number" && typeof sched?.endAt === "number"
  const hasMoment = typeof sched?.at === "number"
  const cancelled = !!entity.cancelled

  function onFrameClick(e: React.MouseEvent) {
    e.stopPropagation()
    // Every entity — spaces, tasks, AND events/instants — opens into its own
    // window by morphing in place. (Events used to redirect to their parent
    // space, which made them feel unclickable: their parent was usually already
    // the open context, so the redirect was a no-op.)
    if (!open) nav.open(entityId)
    // A peeking ancestor (open but not frontmost): clicking it collapses every
    // window above it, bringing this one back to the front.
    else if (!isTop) nav.closeWindow(depth + 1)
  }

  // Right-click → the SINGLE app-wide entity menu. The node owns this for EVERY
  // surface (collapsed row, dock card, window header) so there is no per-component
  // menu: the menu is specific to the entity + its context, not to where it renders.
  // `stopPropagation` keeps a right-click on a child row from also firing an ancestor
  // window's header handler. On a window, this is wired ONLY to the header glyph+title
  // area (see headerClass div) — right-clicking blank window chrome does nothing.
  function onCtxMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    nav.openEntityMenu(entityId, contextId, e.clientX, e.clientY)
  }

  // Stable collapsed footprint so siblings never shift when this lifts out.
  // Dock card footprint is a PERFECT pointy-top hexagon: width = height × 0.866
  // (√3/2). The size is CONTEXT-DEPENDENT:
  //   • Home view (contextDepth === 0): the original 150 × 130 (150 × 0.866 ≈ 130).
  //   • Everywhere else (Space leaf/ancestor, non-Space windows): the smaller
  //     116 ���� 100 (116 × 0.866 ≈ 100), so the dock fits inside the hexagon leaf's
  //     bottom triangle on short viewports without cropping.
  // Both honour the √3/2 ratio so the clip stays a regular hexagon, and the glyph +
  // title + open-counter keep their sizes in either case — only the surrounding
  // breathing room changes.
  // Dock card footprint. Prefer the responsive `dockMetrics` (from dock-layout.ts,
  // which shrinks the card as an open panel squeezes REG2 and picks honeycomb sizes);
  // fall back to the historical constants (150×130 home / 116×100 else) when unmetered
  // so nothing regresses. Applied as an INLINE size (not a class) since it's dynamic.
  const dockSlotClass = contextDepth === 0 ? "h-[150px] w-[130px]" : "h-[116px] w-[100px]"
  const dockSlotStyle = dockMetrics ? { width: dockMetrics.cardW, height: dockMetrics.cardH } : undefined
  // Row slot height: h-11 (44px) gives the airier, more padded look — its inner
  // content uses `h-full`, so this fixed height is what governs a row's vertical
  // padding. Kept in sync with the CreateRow's vertical padding below so the draft
  // input row is the same height as a real row.
  const slotDims = variant === "dock" ? cn("shrink-0", !dockMetrics && dockSlotClass) : "h-11 w-full"
  // Content scale for COLLAPSED dock cards — glyph/title/meta multiply by this (1 until
  // the frame crowds the content, then down to the floor baked into the layout engine).
  // Never applied while this card owns the open window (`asWindow`): the window sizes
  // its own header, and scaling it would fight the Flip morph.
  const dockScale = variant === "dock" && dockMetrics && !asWindow ? dockMetrics.contentScale : 1
  // The slot is `relative` ONLY in row/dock state. The frame's inner content anchors
  // to the FRAME (which is `relative` as a row, `fixed` as a window), never to this
  // slot, so the slot's `relative` is otherwise unused as a containing block.
  //
  // It MUST drop to `static` while OPENING into / sitting as a window: a window frame
  // is `position: fixed` (viewport-relative), but during the morph GSAP Flip switches
  // it to `position: absolute`. With a `relative` slot, that absolute resolves against
  // THIS slot — which, for a nested open, lives in the parent window's do-list and
  // slides/telescopes as the parent recedes. The frame then tracked the moving slot
  // and landed ~8px off its true fixed position, so `clearProps` snapped it at the end
  // (the open "end jump"). With `static`, Flip's absolute resolves against the stable
  // document/viewport — matching the frame's resting `fixed` box — so it lands exactly.
  //
  // Closing keeps `relative`: that morph is separately tuned and the frame collapses
  // back into this very slot, so it should stay anchored to it.
  const slotPosition = asWindow && !isClosing ? "static" : "relative"
  const slotClass = `${slotPosition} ${slotDims}`

  // Hover tint must NOT be live while the frame is a window or shrinking closed:
  // its translucent background would let parent content bleed through the moving
  // frame. Only a settled, collapsed node is interactive.
  const interactive = !asWindow && !isClosing

  // Resting window geometry (also carries the leaf's `--space-ax`). Computed here
  // (not just before the return) because the clip + outline below derive from it.
  // A detached window shrinking closed keeps its LEAF geometry (forceLeaf) rather
  // than the telescoping `fadingStyleFor` box — it has no row to retract into and
  // is morphed toward its launch point by `morphDetached` instead. `selfKind` is
  // passed because it has been popped from the stack and can't be read back.
  const winStyleBase = asWindow
    ? detachedFading
      ? nav.styleFor(depth, { forceLeaf: true, selfKind: kind })
      : fadingWindow
        ? nav.fadingStyleFor(depth)
        : nav.styleFor(depth)
    : null
  // Fullscreen override: fill the viewport BELOW the dayline and drop the Space
  // hexagon CSS vars (the clip-path is forced off below so the shape becomes a full
  // box reaching the left/right/bottom edges). A fullscreen entity is never TRULY
  // full-viewport: it reserves DAYLINE_ROW_H at the very top so the Dayline (planned
  // entities + activity band) stays visible — the WorkSurface hides the app header
  // bar and pulls the Dayline up to y=0 during fullscreen. The window touches the
  // dayline's bottom. Its own header (glyph/title/shrink/close) rides just inside the
  // top of this box, so for a resource (web) task the shrink/close stay visible above
  // the native web view (which fills the body edge-to-edge) — that's the exit path.
  const winStyle: React.CSSProperties | null =
    fullscreen && winStyleBase
      ? {
          position: "fixed",
          top: DAYLINE_ROW_H,
          left: 0,
          width: "100vw",
          height: `calc(100vh - ${DAYLINE_ROW_H}px)`,
          zIndex: (winStyleBase.zIndex as number | undefined) ?? 20 + depth * 10,
          borderRadius: "0",
        }
      : winStyleBase
  // Mirror fullscreen + committed geometry for the post-morph re-assertion effect above
  // (which clears GSAP's leftover transform on a covered fullscreen frame).
  fullscreenRef.current = fullscreen
  winStyleRef.current = winStyle

  // A Space is always shaped by the SAME 8-point clip-path; only its two insets
  // change between states:
  //   - LEAF window (isTop) → a wide OCTAGON: full-box width with true-120° corner
  //     brackets (ax from `--space-ax`, computed in nav-store for the frame size).
  //   - EXPANDED ancestor (a child is open over it) → the same eight points
  //     flattened into a RECTANGLE (SPACE_CLIP_RECT). Opening a child grows the Space
  //     to the full box and the clip tweens octagon → rect point-for-point in the
  //     same Flip pass, so the corner brackets ride out to the corners as it expands.
  //   - collapsed DOCK CARD → a regular HEXAGON (ax=50, top/bottom points coincide);
  //     a DO-LIST row → the rectangle (a Flip-interpolable polygon "from" state).
  // Tasks/events never clip.
  const spaceWindow = isSpace && asWindow
  // A Space window is EITHER the focused leaf OR a covered ancestor (a "spine" strip);
  // spaceLeafWindow and isSpine (defined below with its full rule) partition spaceWindow.
  const spaceLeafWindow = spaceWindow && isTop
  // Leaf octagon insets (%), read from the window style: ax = flat top/bottom inset,
  // ay = corner-bracket height. Fall back to the regular hexagon (50, LEAF_HY) if
  // absent so a Space never renders unclipped.
  const leafAx = winStyle ? Number((winStyle as Record<string, unknown>)["--space-ax"]) : NaN
  const leafAyRaw = winStyle ? Number((winStyle as Record<string, unknown>)["--space-ay"]) : NaN
  const leafAy = Number.isFinite(leafAyRaw) ? leafAyRaw : LEAF_HY
  const leafClip = Number.isFinite(leafAx) ? spaceClip(leafAx, leafAy) : SPACE_CLIP_HEX
  const clipPath = fullscreen || !isSpace
    ? // A fullscreen Space drops its hexagon so the fill reaches all four viewport
      // corners (a plain full box); non-Spaces never clip.
      undefined
    : asWindow
      ? // Leaf AND ancestor windows are the SAME grown hexagon — opening a child no
        // longer flattens the Space to a rectangle; it keeps this exact clip and only
        // spines its header. (SPACE_CLIP_RECT is now used only as a row "from" state.)
        leafClip
      : variant === "dock"
        ? // Rest as the CENTERED regular hexagon at the card's live pixel size — the
          // exact shape the card→leaf morph driver paints at p=0. Using the static,
          // aspect-STRETCHED SPACE_CLIP_HEX made the hexagon snap on the morph's first
          // frame whenever the dock was squeezed (cardW < cardH·√3/2). Falls back to the
          // static hex only when metrics are absent (un-metered dock render).
          dockMetrics
          ? regularHexClip(dockMetrics.cardW, dockMetrics.cardH)
          : SPACE_CLIP_HEX
        : // A collapsed DO-LIST row Space is clipped to ROW_RECT_CLIP — a full-box
          // rectangle whose doubled vertices sit at the MIDDLE of the top/bottom edges
          // (not the corners). Visually identical to an unclipped box, but it gives the
          // morph driver a clean "from" state so opening morphs row → hexagon with the
          // mid-edge points sliding straight to the apex (no diamond). Without a polygon
          // "from" the clip was `none` and the shape snapped in. Task/event rows stay
          // unclipped.
          ROW_RECT_CLIP
  // Shape role of this Space, recorded on the frame as `data-space-kind` so the morph
  // driver (flip-stage) knows the source↔target shapes and can hold a true 120° corner
  // per frame, splitting the hexagon late. Undefined for non-Spaces (never clipped).
  // A leaf and an ancestor Space window are now the IDENTICAL grown hexagon, so both
  // report "leaf" — the flip-stage clip driver then sees source===target across a
  // leaf↔ancestor flip and skips it entirely (no hexagon⇄rectangle morph). Only
  // card/row sources still morph into "leaf". ("ancestor" as a shape role is retired.)
  const spaceKind: SpaceKind | undefined = !isSpace
    ? undefined
    : asWindow
      ? "leaf"
      : variant === "dock"
        ? "card"
        : "row"
  // LIGHT-mode Space boundary. A clip-path can't carry a border, so an SVG polygon
  // traces the SAME live hexagon points as the clip for BOTH leaf and ancestor
  // windows (they are the same shape now), kept MOUNTED across states and fading
  // only its opacity. Since leaf and ancestor share the exact rim, the leaf↔ancestor
  // flip no longer swaps rims at all — the hexagon boundary simply stays put.
  // DARK mode renders no SVG (the dark surface reads cleanly), so dark is unchanged.
  const spaceOutlinePoints =
    mounted && !isDark && isSpace && !fullscreen
      ? asWindow
        ? spaceClipPoints(leafAx, leafAy)
        : variant === "dock"
          ? // Same regular-hex points as the clip above, so the SVG rim tracks the
            // fill exactly at every squeezed card size (matches the morph's p=0).
            dockMetrics
            ? regularHexPoints(dockMetrics.cardW, dockMetrics.cardH)
            : SPACE_HEX_POINTS
          : ROW_RECT_POINTS
      : null
  // Visible (opacity 1) for both leaf and ancestor WINDOWS; the collapsed
  // dock/row sources keep it mounted but transparent so it eases in as the shape
  // forms on open and out as it collapses on close.
  const spaceOutlineVisible = asWindow

  // Borderless design. Backgrounds are driven by the inline `surfaceAt` ramp
  // (see the style prop below), NOT utility classes, so every level shares one
  // hover effect and windows match their hover-preview color:
  //   - leaf / ancestor Space / closing / task window → surfaceAt(depth).
  //   - dock card AND do-list row → identical: rest at the parent surface
  //     (invisible), lift to surfaceAt(parentDepth + 1) on hover.
  // SHAPE / FILL SPLIT (uncrops the glyph + title during every morph).
  // The visible surface — background colour, the Space `clip-path` (hexagon / octagon
  // / rect), the dark-mode inset ring — lives on a dedicated `[data-shape]` child that
  // sits at `inset-0 z-0` BEHIND the content. The frame itself carries NO clip and is
  // `overflow-visible`, so the glyph + title (flip targets that travel their own arc
  // between header slots) are never clipped against the resizing/odd-shaped frame box
  // mid-flight — the cropping we're fixing. Content (header, body, divider, close
  // chrome) is lifted to `z-10` so it paints ABOVE the fill. The flip-stage drivers
  // (clip morph + colour FLIP + bg/shadow capture) now read/write this `[data-shape]`
  // child instead of the frame — see flip-stage.ts.
  const shapeStyle: React.CSSProperties = {
    backgroundColor: frameSurface,
    ...(clipPath ? { clipPath } : { borderRadius: 0 }),
    // DARK ancestor/leaf-less Space windows draw their boundary as an inset ring
    // (light mode uses the SVG outline). Same condition as before, just relocated
    // onto the clipped fill so the ring still rides the shape edge.
    ...(asWindow && !spaceLeafWindow && clipPath && isDark
      ? { boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.30)" }
      : null),
    // Background recede transition (ancestors darkening as the stack deepens). Window
    // uses the morph duration; collapsed rows/cards keep the snappy hover fade. Width
    // is NOT transitioned here — that stays on the frame (Flip owns it during morphs).
    // ASYMMETRIC hover: fade IN fairly quick (0.2s) when the frame lights, fade OUT
    // more slowly (0.5s) so the highlight lingers after the pointer leaves.
    transition: asWindow
      ? `background-color ${DURATION_S} ${MORPH_CSS_EASE}`
      : `background-color ${frameActive ? "0.2s" : "0.5s"} ease-out`,
  }
  const frameClass = asWindow
    ? cn(
        // [v0] DEBUG: bright green border = an OPENED entity's frame (window) footprint.
        // Gated on the shared `§ 2` toggle.
        showFrames && "border border-green-500",
        // overflow-visible (was hidden): the clip now lives on [data-shape], so the
        // frame no longer needs to clip — and must not, or it would re-crop the glyph.
        "flex cursor-default flex-col overflow-visible",
        // shadow-2xl ONLY for unclipped (task/event) windows. A Space window is clipped
        // (hexagon/octagon/rect) on its fill child; previously the clip lived on the
        // FRAME and swallowed its drop shadow, so Spaces never showed one (their
        // boundary is the inset ring / SVG outline). With the frame now unclipped, a
        // shadow-2xl here would paint a RECTANGULAR shadow behind the hexagon — so it's
        // gated off whenever the Space carries a clip-path.
        !clipPath && "shadow-2xl",
        fadingWindow && "pointer-events-none",
      )
    : cn(
          "absolute inset-0 flex cursor-pointer flex-col overflow-visible",
          // CLOSED rows (which includes cancelled) always fade — opacity-40. This is the
          // archived/resolved dim, applied everywhere a closed node is collapsed (do-list,
          // dock). When OPEN the frame carries no fade; instead the header glyph + title
          // each fade individually (so it isn't compounded by a frame fade).
          closed && "opacity-40",
      )

  // SPINE: an ancestor window collapses its horizontal header into a vertical left
  // strip — glyph pinned to the top, title rotated 90° CCW to read up the strip.
  // These ancestors reserve no top peek (see stackTargetRect), so they fan out as
  // nested LEFT strips instead of pushing the leaf down the screen.
  // ONLY Spaces ever spine, and they do so IMMEDIATELY — the moment a child opens
  // inside them they stop being a "rectangle with a horizontal title": a Space only
  // ever shows as a hexagon/octagon leaf or a spine strip, never the in-between
  // rectangle. Non-Space ancestors (task/event/instant) NEVER spine — they keep the
  // nested-doll rectangle at every depth, no matter how far behind the leaf they sit.
  // Never the leaf, never a hexagon leaf; closing un-spines (the window becomes the
  // leaf again → condition flips → strip rotates back). Keep this rule identical to
  // nav-store's `ancestorVertical`.
  const isSpine = spaceWindow && !isTop
  // SPINE-EXPANDED: this covered Space ancestor has had its left Resources panel bloomed
  // open (nav-store `spineExpandedIds`, toggled by clicking its spine band). When true we
  // simply REVEAL the ancestor's existing horizontal header title (it's already pinned at
  // the leaf slot, `left-[48px] top-3`, and normally faded to opacity-0 for a spine) — no
  // duplicate title is drawn. Its rotated spine twin collapses away in collapsible-column.
  const spineExpanded = isSpine && nav.isSpineExpanded(entityId)

  // Every Space window renders its glyph + title as an ABSOLUTELY-POSITIONED overlay
  // instead of an in-flow header band, so the header reserves no vertical height and
  // the body fills the whole frame. This is what stops the parent do-list from
  // re-centering when a child opens: with no in-flow header, the do-list centers on
  // the FRAME CENTER identically whether the Space is the leaf (tall hexagon) or a
  // spine ancestor (short rectangle), so the leaf→spine flip no longer shifts it.
  // Task/event windows keep the in-flow left-aligned header. Closing Spaces fall
  // through to the old path (spaceWindow is false once asWindow flips false at close),
  // leaving the tuned close morph untouched. The leaf vs spine split is drawn directly
  // from `spaceLeafWindow` / `isSpine` below — no separate `floatingHeader` flag needed
  // (it was exactly `spaceLeafWindow`).

  // Header layout:
  //   - SPINE ancestor → a narrow full-height strip pinned to the LEFT edge; glyph
  //     at the top, the rotated title reading up beneath it. Width matches the
  //     window's visible left peek so it sits exactly over that exposed sliver, and
  //     the glyph lines up with the collapsed IN spine in the same strip.
  //   - LEAF Space window (hexagon) → glyph+title FLOAT (absolute) centered near the
  //     top, below the hexagon's tapering top point (matching the dock card's
  //     centered glyph + title so the morph is a straight scale).
  //   - non-space window → in-flow left-aligned header so the glyph + title sit near
  //     the top-LEFT corner and dominate the children peeking below.
  //   - dock card → centered column (glyph, title, then the open-task counter).
  const headerClass = asWindow
      ? isSpine
        ? // pt-[14px] drops the glyph to the SAME vertical offset a leaf/child window
          // gives its header glyph: a child centers its 16px glyph in the HEADER_H(43)
          // band ⇒ (43−16)/2 ≈ 14px from the top. Since a spine child now shares the
          // spine's top edge (SPACE_CHILD_TOP_PEEK=0), matching this 14px makes the
          // spine's hexagon line up horizontally with the child's glyph. Width unified
          // to 48px (= PANEL_SPINE_W / TASK_SIDE) so an ancestor space's spine is the same
          // width as a focused spine at every depth. The excerpt counters slot in below
          // the rotated title via the spine overlay (see collapsible-column), lined up on
          // this same 48px column. Top/bottom are pinned to the CENTRAL RECTANGLE (the
          // wedge inset, via style) rather than the grown frame edges, so the glyph +
          // rotated title sit in the visible region, not up in the off-screen top wedge.
          "absolute left-0 z-10 flex w-[48px] flex-col items-center gap-2 pt-[14px]"
      : spaceLeafWindow
        ? // TASK-LIKE header: glyph + title in a horizontal row flush to the top-left,
          // dominating the do-list beneath. The leaf hexagon's central rectangle is
          // full-width (vertical sides), so there is NO cut corner to tuck around — a
          // plain pl-4 like every other window. It is positioned at the TOP OF THE
          // CENTRAL RECTANGLE via style (top = --hex-corner-inset-y, the top wedge
          // height) with a fixed HEADER_H band, so nothing renders in the top wedge.
          "absolute inset-x-0 z-10 flex items-center gap-3 pr-12 pl-4"
        : // Task / event window: in-flow left-aligned header (unchanged). A covered Space
          // ancestor never reaches here — it is caught by the `isSpine` branch above.
          cn("relative z-10 flex shrink-0 items-center gap-3 pr-12 pl-4")
    : variant === "dock"
      ? // relative z-10: sit above the [data-shape] fill layer (z-0) so the glyph/title
        // paint over the hexagon surface (collapsed headers had no positioning before
        // the fill split, when the frame's own background was the backmost layer).
        "relative z-10 flex flex-1 flex-col items-center justify-center gap-1 px-2 text-center"
      : "relative z-10 flex h-full items-center gap-2 px-4"

  // ANCESTORS (open windows that are not the frontmost leaf) wear a more compact
  // header than the frontmost leaf: a shorter band plus a smaller glyph + title,
  // so depth reads as recession. This now INCLUDES an expanded ancestor Space —
  // once a child opens it reads as a plain rectangle window, so it gets the same
  // left-aligned compact header as every other ancestor. Only the frontmost LEAF
  // Space keeps the tall centered hexagon header.
  const ancestorHeader = asWindow && !isTop && !isClosing
  // The glyph doubles as a completion toggle. It works on a collapsed node (row/dock
  // card) AND on the FRONT open window header — so a task can be un/filled (undone)
  // while it's open. Ancestor/spine headers and closing frames stay inert.
  const canToggleComplete = meta.completable && !isClosing && (interactive || (asWindow && isTop && !ancestorHeader))
  // Every Space window reserves the SAME HEADER_H top band, leaf AND spine, so opening
  // a child never re-lays-out the body/spines (the frame no longer morphs on a leaf↔
  // spine flip — it stays the identical grown hexagon — so any body/spine value that
  // differed would snap with nothing to carry it). The leaf shows a task-like top-row
  // header in that band; the spine leaves it empty (its header is the left strip) but
  // still reserves it, keeping the do-list + spines pinned in place. Non-space windows
  // keep HEADER_H too. (ANCESTOR_HEADER_H — the old compact top-header band — is retired
  // now that covered Spaces spine to a left strip instead of a shorter top header.)
  const headerH = HEADER_H

  // Vertical offset that re-centers the IN/OUT panel spines on the body center.
  // EntityBody anchors the overlay at the body's vertical center and translateY's this
  // value. Every open window now reserves a headerH top band (leaf top-row header, spine
  // empty band, task/event in-flow header), so its body starts headerH below its top and
  // the shift is uniformly −headerH/2 — identical for leaf and spine, so the spines DON'T
  // move when a child opens (there's no frame morph to carry them anymore). Closing a
  // Space re-anchors its body to top:0 (fills the frame) → 0.
  const spineCenterShift = isClosing ? (isSpace ? 0 : -HEADER_H / 2) : -headerH / 2

  // Visible BLEED strip beside this window — how much of it shows on each side
  // once a child covers it (so the collapsed IN/OUT spine can size+center itself to
  // sit in the middle of that sliver instead of being clipped at the frame edge).
  // The frontmost leaf (and home root) isn't covered, so its spine keeps the full
  // width (undefined → EntityBody's PANEL_SPINE_W default). A covered ancestor only
  // exposes its accumulated side peek: TASK_SIDE on the left, RIGHT_PEEK right
  // (matches stackTargetRect). Animating these widths also smooths the leaf↔
  // ancestor transition.
  const covered = asWindow && !isTop && !isClosing
  const spineBleedLeft = covered ? TASK_SIDE : undefined
  const spineBleedRight = covered ? RIGHT_PEEK : undefined

  // Compact ancestor: 13px + dimmer (see className) so it recedes behind the leaf.
  // Leaf window: only SPACES enlarge to 18px — a non-space (task/event) leaf keeps
  // the 13px it had as a row/dock button, so its title doesn't pop bigger on open.
  // Collapsed row and dock are both 13px.
  // Collapsed size is 13px; a crowded dock card scales it by `dockScale` (floored by
  // the layout engine so it never gets illegibly small). `dockScale` is 1 for rows and
  // for windows, so those are unchanged. The title stays a UNIFORM regular 13px in every
  // window state — a focused Space leaf no longer bumps to 18px (per user: keep it a
  // regular size, matching its rotated spine twin, which is likewise 13px).
  const titleSize = asWindow ? 13 : 13 * dockScale

  // NOTE: the covered-Space-ancestor ("spine") title is no longer measured/offset here.
  // It now lives INSIDE the left spine (EntityBody → CollapsibleColumn): rendered rotated
  // with real vertical layout height, so the excerpt flows naturally below it. entity-node
  // just tells the spine WHICH title to show via the `spineTitle` prop on <EntityBody>.

  // `winStyle` (the window's resting fixed geometry: top/left/width/height in
  // viewport px) is computed once near the top of the component — it also feeds the
  // clip + outline. Used here to place the close-hover title just OUTSIDE the
  // frame's right edge (the frame is overflow-hidden, so an in-frame title there
  // would be clipped; a `fixed` title positioned from these numbers escapes it).
  // Close-button affordance: instead of showing the window's title next to the X,
  // hovering an ANCESTOR's close button outlines that whole window so it's obvious
  // which one the button belongs to. Restricted to ancestors (`!isTop`), which are
  // always rectangles here �� the frontmost LEAF needs no hint (it's the obvious
  // target) and skipping it avoids bordering the clipped hexagon. Gated on
  // `!animating` so the morph never flashes it.
  const showCloseBorder = asWindow && !isTop && closeHover && !animating

  return (
    <div className={slotClass} style={dockSlotStyle}>
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        data-window={entityId}
        data-depth={depth}
        data-flip-id={`${flip}-frame`}
        data-flip-role="frame"
        data-space-kind={spaceKind}
        // Theme-reactive surface expression for the morph's colour FLIP to settle on
        // (keeps the post-morph inline colour responsive to dark↔light toggles).
        data-surface={frameSurface}
        role="button"
        aria-label={asWindow ? undefined : `Open ${entity.title}`}
        onClick={onFrameClick}
        // Collapsed row/dock card: the whole frame is the entity, so the menu opens
        // anywhere on it. A window instead scopes the trigger to its header glyph+title
        // (below), leaving the body's own rows to open their own menus.
        onContextMenu={asWindow ? undefined : onCtxMenu}
        onPointerEnter={() => {
          // Highlight is painted PURELY from local `hovered` state so it lights up the
          // instant the pointer enters — no shared-store write, no app-wide re-render.
          // (We intentionally do NOT sync mouse hover into the global selection cursor
          // anymore: that `select(...,"mouse")` fired on every row enter and re-rendered
          // every EntityNode, which made do-list hover feel laggy. Arrow-key nav still
          // drives selection independently; see hoverProps in useRowSelection.)
          if (!asWindow) setHovered(true)
        }}
        onPointerLeave={() => {
          if (!asWindow) setHovered(false)
        }}
        style={
          // Frame carries GEOMETRY ONLY now — position/size (winStyle), squared
          // corners, the rest-only width transition, and the closing z-lift. The
          // surface colour, clip-path and ring all moved to the [data-shape] fill
          // child below (so the frame can be overflow-visible and never crop the
          // glyph/title). Width is transitioned only at rest; during a morph GSAP
          // Flip drives width directly, so transitioning it too would double-animate.
          asWindow
            ? {
                ...(winStyle ?? {}),
                borderRadius: 0,
                // Rest-only geometry transition. Both `left` and `width` change at rest ONLY
                // when a covered ANCESTOR is spine-expanded/collapsed (nav-store adds/removes
                // PANEL_OPEN_W of left-inset, sliding this window right + narrowing it) or on
                // a viewport resize. Locked to the shared panel-slide beat
                // (PANEL_SLIDE_SEC + PANEL_SLIDE_CSS_EASE, same as `panelSlideTransition`) so
                // the window "butter slides" / narrows IN STEP with the ancestor panel blooming
                // open. During a dive/close morph GSAP Flip drives geometry directly, so this is
                // gated off by `!animating` to avoid double-animation.
                ...(animating
                  ? null
                  : {
                      transition: `left ${PANEL_SLIDE_SEC}s ${PANEL_SLIDE_CSS_EASE}, width ${PANEL_SLIDE_SEC}s ${PANEL_SLIDE_CSS_EASE}`,
                    }),
              }
            : {
                // While shrinking closed it is a row again, but Flip animates it at full
                // window size; lift it above sibling rows so parent content can't bleed
                // through until it lands in its slot.
                ...(isClosing ? { zIndex: 40 } : null),
              }
        }
        className={frameClass}
      >
        {/* [v0] DEBUG: green-frame label for an OPENED entity (window) — e.g. Day Job.
            The home (entity0) frame is labelled separately in work-surface; this covers
            every other space/task/event that opens as a window. Shows id + kind, whether
            it's the top window or a spined ancestor strip. Remove with the debug borders. */}
        {asWindow && showFrames && (
          <DebugFrameLabel
            name={`${entity.id}·frame`}
            info={`${kind}${isSpine ? " · spine" : isTop ? " · top" : " · ancestor"} · h:fill v:fill`}
            className="text-green-500"
          />
        )}
        {/* SHAPE / FILL layer — the visible surface. Carries the background colour, the
            Space clip-path and the dark inset ring (all via shapeStyle), and hosts the
            light-mode outline SVG. `inset-0 z-0` so it fills the frame and paints BEHIND
            the z-10 content; because the clip lives HERE (not on the frame) the frame
            stays overflow-visible and the glyph/title are never cropped mid-morph. The
            flip-stage drivers target this element (`[data-shape]`) for the clip + colour
            tweens. pointer-events-none so it never intercepts the frame's click/hover. */}
        <div data-shape aria-hidden className="pointer-events-none absolute inset-0 z-0" style={shapeStyle}>
          {/* LIGHT-mode Space boundary (dark renders none — see spaceOutlinePoints). A
              clip-path can't carry a border, so this SVG traces the EXACT same points as
              the live clip (percentage coords map identically): the leaf OCTAGON, the
              ancestor RECTANGLE, or the collapsed dock HEXAGON. Because the points track
              the clip, a leaf→ancestor change morphs ONE continuous rim instead of
              swapping a hexagon rim for a rectangle ring. The fill clips its children to
              the shape, so the stroke's outer half is clipped away and a clean ~1px inner
              rim remains. `non-scaling-stroke` keeps it a uniform hairline despite the
              viewBox stretching to the window's size. */}
          {spaceOutlinePoints && (
            <svg
              aria-hidden
              // Fade the rim in/out with the morph rather than mounting/unmounting it,
              // so opening a Space eases the hairline in as the hexagon forms and
              // closing eases it out as the hexagon collapses (see spaceOutlineVisible).
              style={{ opacity: spaceOutlineVisible ? 1 : 0, transition: `opacity ${DURATION_S} ${MORPH_CSS_EASE}` }}
              className="absolute inset-0 z-[1] h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <polygon
                data-space-outline
                points={spaceOutlinePoints.map(([x, y]) => `${x},${y}`).join(" ")}
                fill="none"
                stroke={isDark ? "rgb(255 255 255 / 0.45)" : "rgb(0 0 0 / 0.32)"}
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
        </div>

        {/* Close button — fades only, never a flip target. On a LEAF Space hexagon
            it is pulled in to sit just inside the top-RIGHT vertex (the corner is
            clipped, so it rides the safe band near it). Ancestor Spaces and all
            other windows are rectangles, so the X sits in the true top-right
            corner — which, for an ancestor Space, is the top of its right peek. */}
        {/* Chrome visibility during a fullscreen session is DEPTH-based (stale-safe):
            hide it only on the covered ancestors BELOW the fullscreen target in the
            chain (depth 1..fsDepth-1) — those are painted over, so their chrome would
            bleed through. The target (depth===fsDepth) and any window OPENED ON TOP of
            it (depth>fsDepth) keep their chrome. If fullscreenId is unset or its target
            is no longer in the stack, fsDepth is -1 and this whole clause is inert, so
            every window shows chrome normally (no dependence on a possibly-stale id). */}
        {asWindow && !(fsDepth >= 1 && depth < fsDepth) && (
          <div
            // data-fade-late (NOT data-fade): the close button fades in over the BACK
            // half of the open morph instead of with the body at the start, so it
            // doesn't pop in early before the window has taken shape. Closing still
            // just unmounts it (asWindow flips false), so this only affects opening.
            data-fade-late
            // For a leaf Space the X sits just inside the octagon's upper-right
            // corner — the TOP of the right VERTICAL edge, which the settled octagon
            // reaches at ~9.2% of the frame height. It shares the OUT spine's horizontal
            // center (24px in from the right edge) so the two read as a vertical column
            // hugging the right edge: X at the top corner, OUT below it at mid-height.
            // A few px of down-nudge clears the angled chamfer above the corner.
            style={{
              transitionDuration: DURATION_S,
              // Scope the CSS transition to POSITION only. With the default
              // (transition-property: all), the inline duration also animated opacity,
              // which fought the GSAP fade-in tween and produced an erratic flicker.
              // Restricting it to top/right/left lets GSAP cleanly own the opacity fade.
              // Because these are inline values that flip when the window SPINES, the X
              // SLIDES from the normal top-right corner into the centered-on-peek spot.
              transitionProperty: "top, right, left",
              // Fullscreen wins over every hexagon/spine anchor: the frame is a plain
              // viewport rectangle, so the chrome belongs in the true top-right corner
              // (matches the non-Space window case). Leaving top/right unset lets the
              // `right-1.5 top-3` class below take over.
              ...(fullscreen
                ? null
                : spaceLeafWindow
                ? // The Space leaf is a grown hexagon whose top-right SHOULDER vertex sits
                  // at (100%, leafAy%) — leafAy is the live corner-bracket inset (from
                  // `--space-ay`, ~25% of the frame). Anchor the X at that shoulder + a few
                  // px down to clear the diagonal, so it lands in the visible top-right
                  // corner. (Was a hardcoded 9.2%, stale since the octagon→grown-hexagon
                  // simplification — 9.2% of the top-bleeding frame fell ABOVE the viewport,
                  // which is why the leaf's close button was invisible.) right: 12px centers
                  // the 24px X on the OUT spine's 24px-from-edge axis (a right-edge column).
                  // VERTICAL: match the spine formula below — glyph center = leafAy% + 22px,
                  // so the 24px button's top = leafAy% + 10px lands its center on the glyph
                  // row. (Was +6px, which put the center at +18px = 4px ABOVE the glyph, the
                  // "close button too high" look on an opened leaf Space header.)
                  { top: `calc(${leafAy}% + 10px)`, right: "12px" }
                : isSpine
                  ? // SPINE ancestor: the X is the right-edge twin of the left glyph, so
                    // it must sit CENTERED on the right peek and vertically aligned with
                    // the glyph. The right peek is RIGHT_PEEK (48px) wide and the button
                    // is size-6 (24px): center it with `right = (48 − 24)/2 = 12px` (the
                    // old `right: 0` predated RIGHT_PEEK growing 24→48 and left the X in
                    // the OUTER half of the peek — the "too far right" drift, worse per
                    // deeper ancestor). VERTICAL: the header (glyph row) is pushed down to
                    // the shoulder line at leafAy% of the frame via marginTop, and the
                    // frame itself top-bleeds off-screen — so a frame-relative `top: 10px`
                    // landed the X ABOVE the viewport (why the spine's X was invisible).
                    // Anchor it at leafAy% too: glyph center = leafAy% + 22px (pt-[14px] 14
                    // + half a 16px glyph 8), so the 24px button's top = leafAy% + 10px
                    // lands its center on the glyph row.
                    { top: `calc(${leafAy}% + 10px)`, right: "12px" }
                  : null),
            }}
            // z-[35]: must stay BELOW the child window. Frames are position:fixed
            // but nested in the DOM, so a child window resolves at z-40 INSIDE this
            // ancestor's stacking context. A higher value (e.g. z-[60]) would escape
            // above the child and paint this ancestor's X over the leaf header; 35
            // keeps the X confined to this ancestor's own exposed top-right corner.
            className={cn(
              "absolute z-[35] flex items-center gap-1",
              // Layout + anchor split by shape:
              //  • Hexagon shoulder (leaf Space) + narrow spine peek → flex-COL: the two
              //    buttons stack vertically INSIDE the 24px-wide right-edge column so the
              //    cluster never widens past the ancestor's exposed 48px peek and bleeds
              //    over the covering child (the image-3 poke-out). Keeps inline top/right.
              //  • Corner case (plain windows) + fullscreen LEAF (not yet covered) →
              //    flex-ROW-REVERSE at the true top-right corner: DOM order [close, expand]
              //    renders as [expand | close] so the X keeps the corner and expand sits LEFT.
              //  • Fullscreen SPACE ANCESTOR (covered by a child) → flex-COL at the corner:
              //    a covered Space never peeks its header above the leaf, so an expand button
              //    to the LEFT of the X pokes over the child window. Stacking [close, expand]
              //    vertically drops the restore button BELOW the X, inside the Space's own
              //    exposed right-edge peek, clear of the covering child.
              !fullscreen && (spaceLeafWindow || isSpine)
                ? "flex-col"
                : fullscreen && isSpine
                  ? // right-3 (12px) centers the 24px-wide cluster in the covered Space's
                    // 48px right-edge peek: (48 − 24)/2 = 12px. (Was right-1.5 = 6px, which
                    // left the buttons in the OUTER half of the peek — the "too far right"
                    // drift.) A covered fullscreen Space is edge-to-edge, so top-3 is fine.
                    "flex-col right-3 top-3"
                  : "flex-row-reverse right-1.5 top-3",
            )}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                nav.closeWindow(depth)
              }}
              onPointerEnter={() => setCloseHover(true)}
              onPointerLeave={() => setCloseHover(false)}
              aria-label={`Close ${entity.title}`}
              // No hover square — the cross itself is faint + thin at rest and
              // brightens + thickens on hover for the affordance.
              className={cn(
                "flex size-6 items-center justify-center transition-all ease-out",
                closeHover ? "text-foreground opacity-100" : "text-muted-foreground opacity-40",
              )}
            >
              <X size={14} strokeWidth={closeHover ? 2.25 : 1.5} />
            </button>
            {/* Expand / restore — toggles this window's fullscreen. Sits just LEFT of
                the X in the same right-edge chrome cluster (leaf, ancestor, spine —
                never root, which isn't rendered through this window header). */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                nav.toggleFullscreen(entityId)
              }}
              onPointerEnter={() => setExpandHover(true)}
              onPointerLeave={() => setExpandHover(false)}
              aria-label={`${fullscreen ? "Restore" : "Expand"} ${entity.title}`}
              className={cn(
                "flex size-6 items-center justify-center transition-all ease-out",
                expandHover ? "text-foreground opacity-100" : "text-muted-foreground opacity-40",
              )}
            >
              {fullscreen ? (
                <Minimize2 size={13} strokeWidth={expandHover ? 2.25 : 1.5} />
              ) : (
                <Maximize2 size={13} strokeWidth={expandHover ? 2.25 : 1.5} />
              )}
            </button>
          </div>
        )}

        {/* Close-hover highlight: an inset outline that fades in over the whole
            ANCESTOR window while its close button is hovered, identifying which
            window the X will close. Inset by 2px (NOT inset-0): ancestor Spaces are
            always clip-path'd to their exact box, and a border sitting on that edge
            gets its outer half clipped away to a near-invisible hairline — which is
            why deeper ancestors appeared to lose the highlight entirely. Pulling the
            ring 2px inward keeps its full 2px stroke inside the clip boundary so it
            renders identically on clipped (Space) and unclipped (task/event)
            ancestors. z-50 keeps it above all nested descendant windows;
            `pointer-events-none` keeps it inert. */}
        {asWindow && !isTop && (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-[2px] z-50 border-2 border-foreground/60 transition-opacity duration-200 ease-out",
              showCloseBorder ? "opacity-100" : "opacity-0",
            )}
          />
        )}


        {/* Persistent header. NOT a flip target: it stays in the frame's flow and
            switches layout between collapsed row/card and window header. The glyph
            + title (which ARE flipped) glide on top. */}
        <div
          ref={reqHeaderRef}
          className={headerClass}
          // Window right-click surface: the glyph+title header (horizontal for a leaf/
          // task window, vertical for a spine ancestor) opens the same shared entity
          // menu. Collapsed rows/cards use the frame handler instead, so this is
          // window-only to avoid double-binding.
          onContextMenu={asWindow ? onCtxMenu : undefined}
          // Header height SNAPS to its target (no CSS transition): GSAP Flip owns
          // the glyph/title motion during a morph, and the divider slides via its
          // own transition-[top]. A CSS height tween here would animate the
          // flex-centered glyph along an extra path that compounds with Flip's
          // transform — the "down-then-up" hop seen when opening a window. A SPINE
          // is full-height (absolute inset-y-0), so it takes no fixed height.
          //
          // marginTop carries the leaf hexagon's TOP inset — `var(--hex-inset-y)`,
          // set only on a Space-leaf window, 0 elsewhere. It was previously the
          // frame's paddingTop, but padding floored the frame's border-box height and
          // froze the open morph as a stretched hexagon (see the frame style note). As
          // a margin it offsets the header identically at rest without inflating the
          // frame, letting Flip shrink the frame to dock-card/row size.
          //
          // FLOATING (Space windows): the header is absolute, so it reserves no flow
          // height. The leaf sits below the hexagon top point via top:hex-inset (pt-9
          // in the class adds the rest); the ancestor uses a fixed 35px band so the
          // glyph/title stay vertically centered exactly where the in-flow header had
          // them. Non-space windows keep the old in-flow height + top margin.
          style={
            spaceLeafWindow
              ? // Sit at the TOP OF THE CENTRAL RECTANGLE: top = the top wedge height
                // (--hex-corner-inset-y), with a normal HEADER_H band — so the header
                // reads exactly like a Task's, and the top wedge above it stays empty
                // (and hidden behind the parent header / off the top edge).
                { top: "var(--hex-corner-inset-y, 0px)", height: headerH }
              : isSpine
                ? // Pin the left strip to the CENTRAL RECTANGLE (top/bottom = the wedge
                  // inset) instead of the grown frame edges, so the glyph + rotated
                  // title live in the visible region, not the off-screen top wedge.
                  { top: "var(--hex-corner-inset-y, 0px)", bottom: "var(--hex-corner-inset-y, 0px)" }
                : asWindow && !isSpine
                  ? { height: headerH, marginTop: "var(--hex-inset-y, 0px)" }
                  : undefined
          }
        >
          {/* Glyph — for a collapsed COMPLETABLE entity it doubles as the completion
              toggle (task square, event triangle, instant, space, resource…). Clicking
              the glyph completes/uncompletes; clicking the rest of the row still opens
              it. Non-completable kinds (community/organism/individual/soul) keep the
              glyph inert so the click falls through to open. */}
          <span
            data-flip-id={`${flip}-glyph`}
            data-flip-role="inner"
            data-req-flip="glyph"
            // Color-only CSS transition (independent of Flip's transform/fontSize
            // tween) so the glyph's ink fades smoothly to/from the dimmed ancestor
            // grey instead of jumping. Only on windows; rows stay snappy.
            style={
              asWindow
                ? { transitionProperty: "color", transitionDuration: DURATION_S, transitionTimingFunction: MORPH_CSS_EASE }
                : // Collapsed dock glyph: scale the 18px base by the card's contentScale
                  // (regime 2) so it shrinks with the crowded card but never below the
                  // floor baked into the layout engine. Inline size overrides the class.
                  dockScale !== 1
                  ? { width: Math.round(18 * dockScale), height: Math.round(18 * dockScale) }
                  : undefined
            }
            onClick={
              canToggleComplete
                ? (e) => {
                    e.stopPropagation()
                    const next = !done
                    setDone(next)
                    // Persist completion to the store (not just local state) so the
                    // filled glyph / checkmark survives the row/window unmounting — the
                    // bug where a checked occurrence subtask reverted on reopen.
                    // notifyDataChanged lets other views (do-list filter, open-task
                    // counts) react immediately.
                    setEntityCompleted(entityId, next)
                    nav.notifyDataChanged()
                  }
                : undefined
            }
            className={cn(
              "relative flex shrink-0 items-center justify-center",
              // A glyph that acts as a completion toggle gets a pointer cursor.
              canToggleComplete && "cursor-pointer",
              // Glyph ink matches the title: compact ancestors are dimmed to
              // foreground/75 (like their title), everything else stays full ink.
              ancestorHeader ? "text-foreground/75" : "text-foreground",
              // Only a SPACE leaf keeps the enlarged 20px glyph. A non-space
              // (task/event) leaf keeps its collapsed size �� 18px if it opened from a
              // dock card, 16px from a do-list row — so the glyph doesn't pop bigger on
              // open. Compact ancestors use 16px; collapsed dock card 18px / row 16px.
              // The size change is animated by GSAP Flip (this glyph is a flip target
              // captured in captureStage), so no CSS transition here — that would
              // double-animate against Flip.
              asWindow && !ancestorHeader && isSpace
                ? "h-5 w-5"
                : !ancestorHeader && variant === "dock"
                  ? "h-[18px] w-[18px]"
                  : "h-4 w-4",
              // Sent-as-request reflow: hop the glyph to the row's right edge.
              rowReq && (sent ? REQ_SENT.glyph : REQ_REST.glyph),
              // Closed + OPEN: fade the header glyph to match its title (the row's
              // frame-level fade doesn't apply once open, so scope it here).
              asWindow && closed && "opacity-40",
            )}
          >
            {isResource ? (
              // Favicon-as-icon: a resource task shows its resource/site mark in every
              // state (row, dock card, window header) so it reads as "the Figma tab",
              // "the Photopea tab", etc. — Zero's contextual-browser identity.
              <ResourceGlyph resourceId={entity.webResourceId} url={entity.webUrl} />
            ) : (
              <>
                <NodeGlyph
                  kind={kind}
                  filled={glyphFilled}
                  strokeWidth={asWindow ? 1.75 : isTask ? 2 : 1.75}
                  request={isTask && !!entity.requested}
                  struck={cancelled}
                />
                {showCheckmark && (
                  // Always shown for a done Task — in the row, the dock card AND the
                  // open window (it used to be `!asWindow`, which made it vanish on
                  // open). Sized as a fraction of the glyph so it scales with every
                  // state, and centered via inset/auto-margins (it's absolute, so flex
                  // centering wouldn't apply). Color fades ink→white with the fill.
                  // `glyphSettledTask` fades it in only once the silhouette has morphed
                  // into the task square (so it doesn't pop onto a mid-morph shape); a
                  // plain completion keeps it at opacity-100 with just the color fade.
                  <Check
                    className={cn(
                      "absolute inset-0 m-auto h-[60%] w-[60%] transition-[color,opacity]",
                      checkWhite ? "text-background" : "text-foreground",
                      glyphSettledTask ? "opacity-100" : "opacity-0",
                    )}
                    style={{ transitionDuration: `${GLYPH_FILL_SECONDS}s` }}
                    strokeWidth={3.5}
                  />
                )}
                {!asWindow && terminal && (
                  // Terminal mark for a retired community / dead organism|individual.
                  // Placeholder styling — see KIND_META.terminal; refined later.
                  <X className="absolute h-2.5 w-2.5 text-background" strokeWidth={3.5} />
                )}
              </>
            )}
          </span>

          <h3
            // Flip target ONLY when NOT a spine. A covered Space ancestor's horizontal
            // title is fully hidden (the rotated spine title represents it), so it must
            // be REMOVED from Flip tracking — otherwise Flip position-tweens it between
            // the leaf-header slot and the spine slot, which is the residual title
            // "animation" the user objected to. Dropping the flip-id (+ hiding the whole
            // h3 below) means: leaf→spine it's simply gone (Flip finds no live match, so
            // no tween); spine→leaf it re-appears at its final header position. The
            // row↔window open morph (both non-spine) keeps the id, so that slide is intact.
            data-flip-id={asWindow && isSpine ? undefined : `${flip}-title`}
            data-flip-role="inner"
            data-req-flip="title"
            style={{
              fontSize: titleSize,
              // Line-box height (px). For WINDOWS this is a constant 20px across every
              // title state: the header is `items-center`, so the title is vertically
              // centred against the glyph, and GSAP Flip tweens this title's `fontSize`
              // between the row/dock size (13px) and the leaf-window size (18px). With a
              // default (font-relative) line-height the title's BOX height tweened too
              // (~20px → ~26px → ~20px), and `items-center` turned half of that delta into
              // a vertical shift that SNAPPED ~4px when Flip's clearProps fired — the
              // "title jumps down 3-4px at the end of every open" glitch. Pinning the box
              // to a constant 20px keeps it identical in Flip's captured AND final states.
              //
              // For a CROWDED DOCK CARD (not a window) the line-box instead scales WITH the
              // shrunk content (`dockScale`), so the title's vertical rhythm tracks the
              // smaller font + card frame instead of keeping a fixed 20px box that leaves
              // the shrunk text floating in too-tall a line. At rest (dockScale 1) this is
              // still exactly 20px, so uncrowded cards + the open morph are unchanged.
              lineHeight: variant === "dock" && !asWindow && dockScale !== 1 ? `${20 * dockScale}px` : "20px",
              // Color-only CSS transition (ancestor dimming). GSAP Flip owns this
              // element's position + fontSize (it SLIDES the title between the
              // horizontal header slot and the spine strip), so we must not also
              // declare a transform transition here or the two would fight.
              ...(asWindow
                ? { transitionProperty: "color", transitionDuration: DURATION_S, transitionTimingFunction: MORPH_CSS_EASE }
                : null),
            }}
            className={cn(
              "relative tracking-tight",
              asWindow
                ? // Compact ancestors pop slightly less than the leaf: dimmer ink
                  // and one step lighter weight (semibold → medium).
                  //
                  // The title is a Flip target that SLIDES between header slots (leaf
                  // hexagon centre ↔ ancestor/spine left ↔ dock-card centre). For that
                  // slide to be smooth in EVERY direction the box must HUG its content
                  // (`whitespace-nowrap`, auto width) at every endpoint, with horizontal
                  // placement owned by the flex parent (items-center for the leaf column,
                  // left for the ancestor row).
                  //
                  // Text alignment must match the HEADER's alignment, because during the
                  // morph GSAP Flip pins an explicit, interpolating WIDTH on the box that
                  // doesn't equal the text's natural width at the in-between font size — so
                  // the text rides whichever edge `text-align` picks:
                  //   • SPACE windows have a CENTRED anchor (leaf = centred hexagon column;
                  //     ancestor hugs-left but morphs to/from that centred leaf and from the
                  //     centred dock card). They need `text-center` so the text stays on the
                  //     box's centre line through the width tween. Applied to BOTH leaf and
                  //     ancestor so a Space leaf↔ancestor morph has no text-align change to
                  //     snap on.
                  //   • TASK / EVENT windows have a LEFT anchor (left-aligned horizontal
                  //     header) and open from a left-aligned do-list ROW. They must stay
                  //     left-aligned; `text-center` here parked the text in the middle of
                  //     Flip's wide interpolating box and let it drift sideways during the
                  //     expansion (the "title jumps to the middle of the row then slides"
                  //     glitch). Left alignment keeps the text glued to the box's left edge,
                  //     which Flip translates smoothly from the row slot.
                  cn(
                    "whitespace-nowrap",
                    isSpace && "text-center",
                    // Weight is UNIFORM: rows, dock cards, and every header (leaf or
                    // ancestor) stay font-medium. Opening/focusing an entity no longer
                    // bumps the title heavier (the old leaf → font-semibold step was
                    // removed per user — the header keeps the same weight it had as a
                    // collapsed row/card). Ancestor headers keep their dimmed tone.
                    ancestorHeader ? "font-medium text-foreground/75" : "font-medium",
                  )
                : variant === "dock"
                  ? // Hug content (centered by the dock header's items-center) so the
                    // box model matches the leaf hexagon title it morphs into — see the
                    // window-title note above. `max-w-full` keeps long names truncating
                    // within the card instead of overflowing. `text-center` keeps the
                    // text on the box centre line during the morph for the same reason as
                    // the window titles (Flip's interpolating explicit width).
                    "max-w-full truncate text-center font-medium leading-tight"
                  : // DO-LIST ROW. The title must HUG its content here too �� it is the
                    // "from" state of a row→window open morph, and every window title is a
                    // content-hugging box. Previously this was `flex-1` (a WIDE box that
                    // spanned the row). GSAP Flip captured that wide width and tweened it
                    // down to the window's hug width; the window title's `text-center`
                    // then parked the text in the MIDDLE of that wide box at the start
                    // (the "title jumps to the middle of the row" glitch) and let it drift
                    // as the width shrank. Hugging the content makes the captured box ≈ the
                    // text, so the title simply SLIDES from its row slot to the window slot.
                    // The `mr-auto` that absorbs the free space (so trailing meta sits
                    // flush right) is applied via the request tokens below — REQ_REST keeps
                    // it for normal rows, REQ_SENT drops it and right-aligns when sent.
                    // `max-w-full truncate` preserves ellipsis for long names.
                    "min-w-0 max-w-full truncate font-medium",
              // Completing a task changes ONLY its glyph (fills + checkmark, above) —
              // the title is intentionally left unstyled so the row stays visually put
              // in the do-list. The CANCELLED strikethrough lives on the inner text span
              // below (an inline-block that a parent's text-decoration can't reach).
            // A closed entity's title also FADES to opacity-40 when open (asWindow),
            // mirroring the row's frame-level fade — see the fade class further down.
            asWindow && closed && "opacity-40",
              // Sent-as-request reflow: right-align the title against the moved glyph
              // (sent) or keep the normal left layout with mr-auto spacer (rest).
              rowReq && (sent ? REQ_SENT.title : REQ_REST.title),
              // Covered Space ancestor: the horizontal title just FADES OUT IN PLACE (its
              // rotated twin in the spine represents it; the fade lives on the inner span).
              // The spine header switches to a NARROW VERTICAL COLUMN (`flex-col w-[48px]`),
              // which would restack this title BELOW the glyph — the "title jumps below the
              // glyph" glitch. Pull it OUT of that column flow with `absolute` and pin it to
              // the SAME spot the leaf's horizontal title occupied — left-[48px] (leaf pl-4
              // 16 + glyph 20 + gap-3 12) and top-3 (≈ leaf title center in the HEADER_H 43
              // band) — so there is zero position change: it fades exactly where it was.
              // pointer-events-none since it's inert while fading. flip-id is dropped above
              // so GSAP Flip doesn't move it either.
              asWindow && isSpine && "pointer-events-none absolute left-[48px] top-3",
            )}
          >
            {/* The HORIZONTAL open-window title. When this Space becomes a covered
                ancestor (spine) it simply FADES OUT IN PLACE — a pure opacity transition,
                no transform/slide (the <h3> above is absolutely pinned to the leaf spot so
                the box never moves). Its rotated twin slides in from the top of the spine
                (collapsible-column). On reverse it fades back in. Independent of GSAP Flip
                (whose title id is dropped for the spine), eased on the shared morph curve. */}
            <span
              className={cn(
                "inline-block whitespace-nowrap",
                // Strikethrough for a CANCELLED entity. It MUST live on this inner text
                // span, not the <h3>: the span is `inline-block`, and CSS text-decoration
                // does not propagate from a parent into an inline-block descendant — so a
                // `line-through` on the <h3> never actually drew over the text. Applied in
                // BOTH row and window states so the cancelled treatment persists on open.
                cancelled && "line-through",
                asWindow && "transition-opacity",
                // A covered Space ancestor normally fades this horizontal title out (its
                // rotated spine twin represents it). But when the ancestor is SPINE-EXPANDED
                // we bring THIS existing, correctly-positioned title back (opacity-1) instead
                // of drawing a duplicate — the rotated twin collapses away in parallel.
                asWindow && isSpine && !spineExpanded && "opacity-0",
              )}
              style={
                asWindow
                  ? { transitionDuration: DURATION_S, transitionTimingFunction: MORPH_CSS_EASE }
                  : undefined
              }
            >
              {entity.title}
            </span>
            {/* OCCURRENCE DATE (Phase 2): a materialized recurrence occurrence
                (recurrenceId set) shares the mother's title ("Workout"), so when its
                window is open we append the specific day it stands for. Gated to the
                open, non-spine window state so it never interferes with the row/spine
                title morph (it simply isn't rendered there). */}
            {asWindow && !isSpine && entity.recurrenceId != null && (
              <span className="ml-2 shrink-0 whitespace-nowrap text-[11px] font-normal text-muted-foreground/70 tabular-nums">
                {new Date(entity.recurrenceId).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </h3>

          {/* Collapsed trailing meta ��� counts / time / due / priority. Hidden in
              every window/spine/closing state so the header reads cleanly. Wrapped in
              a single flex box (`data-req-flip="meta"`) so it moves as ONE Flip target
              during the sent-as-request reflow — where it hops to the row's far LEFT
              (REQ_SENT) instead of sitting flush right (REQ_REST). gap-2 mirrors the
              header's own gap so the items keep their spacing inside the wrapper. */}
          {!asWindow && !isClosing && variant === "row" && (
            <div
              data-req-flip="meta"
              className={cn("flex shrink-0 items-center gap-2", sent ? REQ_SENT.meta : REQ_REST.meta)}
            >
              {!isTask && openCount > 0 && (
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/70">
                  <span className="font-medium tabular-nums">{openCount}</span>
                  <span className="flex h-2.5 w-2.5 items-center justify-center">
                    <NodeGlyph kind="task" strokeWidth={1.5} />
                  </span>
                </span>
              )}
              {hasRange && (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                  {fmtTime(sched!.startAt!)}
                  {"\u2013"}
                  {fmtTime(sched!.endAt!)}
                </span>
              )}
              {kind === "instant" && hasMoment && (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                  {fmtMoment(sched!.at!)}
                </span>
              )}
              {isTask && typeof sched?.dueAt === "number" && (
                <span
                  suppressHydrationWarning
                  className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70"
                >
                  {fmtDue(sched.dueAt, mounted)}
                </span>
              )}
              {isTask && (
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", priorityDot[entity.priority ?? "medium"])} />
              )}
            </div>
          )}

          {/* Collapsed dock-card open-task counter — centered in the column flow,
              directly below the title (not pinned to a corner).
              Rendered all through the CLOSE morph (not gated by !isClosing) so it
              always occupies its space: the counter lives in the vertically-centred
              column, so if it only MOUNTED after the close finished it would add
              height to that centred column and shove glyph+title upward — the abrupt
              "jump up" at the very end. With it mounted the whole time the column
              height is constant and GSAP Flip's captured final layout already
              accounts for it, so glyph+title settle smoothly.
              For the appearance itself we use a keyframe fade (`animate-in fade-in`)
              rather than an opacity TRANSITION. The counter only mounts at the START
              of the close (the instant `asWindow` flips false), so the keyframe plays
              on mount and runs CONCURRENTLY with the morph. The previous transition
              was keyed on `isClosing` flipping false, which only happens once the
              morph has already FINISHED, so the fade ran late and felt like it was
              waiting for the close to complete. `fade-in` is opacity-only (no
              slide/zoom) so it never nudges glyph+title.
              `delay-700` holds it invisible through the first part of the ~2s close
              morph, then `duration-700` finishes the fade in the latter part of the
              morph, so the counter resolves as the card settles rather than appearing
              early. `fill-mode-both` pins it at opacity 0 during the delay so it does
              not flash in before the keyframe starts. */}
          {!asWindow && variant === "dock" && (
            <span
              className="flex animate-in items-center gap-1 fade-in fill-mode-both text-[10px] text-muted-foreground/70 delay-700 duration-700"
              // Scale the 10px counter with the crowded card (floored by the layout engine).
              style={dockScale !== 1 ? { fontSize: 10 * dockScale } : undefined}
            >
              <span className="font-medium tabular-nums">{openCount}</span>
              <span className="flex h-2.5 w-2.5 items-center justify-center">
                <NodeGlyph kind="task" strokeWidth={1.5} />
              </span>
            </span>
          )}
        </div>

        {/* Header divider — a dedicated fading element (not a CSS border) so it
            fades cleanly and slides as the header compacts, and fades out as the
            window collapses to a row. Hidden for the LEAF Space hexagon (a hard
            rule across the hexagon's narrowing top reads as a stray clipped line);
            expanded ancestor Spaces are rectangles, so they show it like everything
            else. */}
        {SHOW_HEADER_DIVIDER && (asWindow || isClosing) && !spaceLeafWindow && (
          <span
            aria-hidden
            style={{ top: headerH, transitionDuration: DURATION_S, transitionTimingFunction: MORPH_CSS_EASE }}
            className={cn(
              // Fainter than full border (opacity-50) so the header separator is a
              // subtle hairline rather than a hard rule. `top` animates too so it
              // glides as a leaf's header compacts into an ancestor's shorter one.
              "pointer-events-none absolute left-0 right-0 z-[5] h-px bg-border transition-[top,opacity]",
              // A SPINE has no horizontal header band for the rule to underline, so
              // it fades out, and fades back in when the window un-spines to a
              // horizontal header. Closing also fades it out.
              isClosing || isSpine ? "opacity-0" : "opacity-50",
            )}
          />
        )}

        {/* Window body — recursively renders this entity's own working surface
            (Tasks do-list + Dock, with the Inputs/Outputs panels overlaid on the
            side edges). Tagged data-body so close can scale it down with the frame.
            Only the frontmost window's body is "active" for keyboard / selection. */}
        {showBody && (
          <div
            data-fade
            data-body
            // marginBottom carries the leaf hexagon's BOTTOM inset — `var(--hex-inset-y)`,
            // set only on a Space-leaf window, 0 elsewhere. Was the frame's paddingBottom;
            // moved to a margin so it no longer floors the frame's height during the morph
            // (see the frame style note). Skipped while closing (the body is absolute then).
            //
            // FLOATING (Space windows): the header is out of flow, so the body fills the
            // frame. We inset it SYMMETRICALLY by the CORNER line (top AND bottom) so the
            // leaf's content is confined to the central rectangle (between the four side
            // corners) — the do-list lives there, beneath the glyph+title in the top
            // wedge — while its center still coincides with the FRAME CENTER. An ancestor
            // leaves --hex-corner-inset-y unset (��� 0px), so it also centers on the frame
            // center; that shared center is what keeps the do-list from re-centering when
            // a child opens and the Space flips leaf→ancestor.
            style={{
              ...(isClosing
                ? // A closing SPACE was the leaf, whose resting body FILLS the frame
                  // (the header floats over it) and centers the do-list on the frame
                  // center. So fill the frame symmetrically here (top:0 + the class's
                  // bottom-0) — anchoring at `top: HEADER_H` like other windows would
                  // shift that center down ~HEADER_H/2 and make the do-list/CREATE-INPUT
                  // visibly jump at the start of the close. A closing TASK/EVENT had an
                  // in-flow header at rest, so its body already started at HEADER_H —
                  // keep that so it likewise doesn't move.
                  isSpace
                  ? { top: 0 }
                  : { top: HEADER_H }
                : spaceWindow
                  ? {
                      // EVERY Space window (leaf AND spine) insets its body IDENTICALLY:
                      // top = the top wedge (--hex-corner-inset-y) PLUS the HEADER_H band,
                      // bottom = the bottom wedge. The leaf fills that band with its task-
                      // like top-row header and the do-list below it; the spine leaves the
                      // band empty (its header is the left strip) but STILL reserves it, so
                      // the do-list + spines don't shift when a child opens and this Space
                      // flips leaf→spine. Identical insets = no jump (the frame no longer
                      // morphs on that flip, so nothing would carry a difference).
                      marginTop: `calc(var(--hex-corner-inset-y, 0px) + ${headerH}px)`,
                      marginBottom: "var(--hex-corner-inset-y, 0px)",
                    }
                  : { marginBottom: "var(--hex-inset-y, 0px)" }),
              // Crop the OPEN CHILD WINDOW to this (the parent's) WINDOW box. The child
              // window grew from one of this body's do-list rows / dock cards, so at rest
              // it is a `position: fixed` DOM descendant of THIS [data-body]. A clip-path
              // clips its whole subtree — fixed descendants included (the same mechanism
              // the work-surface region uses) — so this trims the child (e.g. a leaf
              // Space hexagon whose top point bleeds upward) at the parent's top edge.
              // Without it the fixed child escaped this body entirely and was only
              // clipped by the outermost region, so a deep leaf hexagon appeared cropped
              // by the OLDEST ancestor instead of its direct parent. The morph already
              // looked right because the child is `position: absolute` mid-flight and
              // clipped by the parent frame's overflow-hidden; this makes the RESTING
              // state match.
              //
              // The crop line must be the parent's VISIBLE TOP EDGE (the region top the
              // child shares). EVERY ancestor now reserves a `headerH` top band, so its
              // body border-box starts `headerH` below the region top — pull the crop's
              // top inset UP by `headerH` to land on the region top (a Space ancestor's
              // region top is the central-rectangle top; a Task/Event's is the frame top).
              // Top-only inset (huge negative on the other three sides) so the child's
              // sides, bottom point and drop shadow stay exactly as before. Only ancestors
              // need it (a leaf has no open child) and never while closing.
              ...(asWindow && !isTop && !isClosing
                ? { clipPath: `inset(${-headerH}px -9999px -9999px -9999px)` }
                : null),
            }}
            className={cn(
              isClosing
                ? // While closing, the body is taken out of flow as an absolute overlay
                  // so it can be scaled+faded down as one unit. It is anchored at BOTH
                  // top (via the style block above — 0 for a Space, HEADER_H otherwise)
                  // and bottom-0, so it has a DEFINITE height; that lets it stay a
                  // `flex flex-col` whose `flex-1 min-h-0` children (EntityBody → the
                  // do-list) fill and CENTER exactly as they did at rest. Keeping the
                  // flex centering is what stops the do-list/CREATE-INPUT from snapping
                  // from centered to top-aligned at the start of the close — the visible
                  // jump. (A plain block here top-aligned the content, causing that
                  // jump; the definite height means the flex column no longer collapses
                  // the list to zero as the old comment warned.)
                  "pointer-events-none absolute inset-x-0 bottom-0 z-10 flex min-h-0 flex-col overflow-hidden"
                : // `flex flex-col` so EntityBody (a flex-1 child) actually fills a
                  // tall window. Without it the body was a plain block, EntityBody
                  // sized to its content (~min-h), and the vertically-centered
                  // Inputs/Outputs spines centered on that short content near the top
                  // — so on tall screens they floated well above the window center.
                  // relative z-10: paint above the [data-shape] fill layer (z-0) so the
                  // window's working surface sits over the clipped background, not under it.
                  "relative z-10 flex min-h-0 flex-1 flex-col",
              // NOTE: no horizontal padding here, on purpose. The IN/OUT spines are an
              // absolute overlay anchored to this body's left/right edges, so any padding
              // would push them inward — and worse, a LEAF-only inset (the old `px-[4%]`)
              // was REMOVED the instant the Space spined to an ancestor, snapping both
              // spines outward by that padding in one frame (the "jump into place" on
              // peek/bleed). With the body always flush to the frame, the spines sit close
              // to the edges like a Task window AND keep a stable anchor across the
              // leaf→spine flip, so only their width tweens (smoothly). The do-list/Dock
              // stay safely inset via their own centered `max-w` + `w-2/3` column.
            )}
          >
            {/* The [data-body] wrapper above mounts synchronously (flip-stage runs the
                grow+fade tween on IT), but its heavy contents are held back one frame
                on an open morph — see the deferred-body effect near the top. */}
            {bodyReady && (
            <EntityBody
              entityId={entityId}
              active={isTop && !isClosing}
              closing={isClosing}
              spineShift={spineCenterShift}
              spineBleedLeft={spineBleedLeft}
              spineBleedRight={spineBleedRight}
              // A covered Space ancestor folds its title INTO the left spine (rendered
              // rotated below the glyph, above the excerpt). Undefined otherwise, so a
              // leaf / non-space shows only its excerpt. This replaces the old cross-
              // component titleLen-measure + excerptOffsetTop offset coordination.
              spineTitle={isSpine ? entity.title : undefined}
              surface={frameSurface}
              // 0 for EVERY window. `[data-body]` now clears the header in ALL cases —
              // a non-space window's in-flow header pushes the body down by headerH, and a
              // space window's body has `marginTop = wedge + headerH` — so the spine box
              // always starts exactly at the header bottom with no extra push. (The old
              // `headerH` here dated from when space bodies filled from the window top and
              // the floating header overlapped them; that's no longer the case, and the
              // stale push is what dropped the leaf's excerpt into a gap below its glyph.)
              // A spine's rotated title is a flow element ABOVE the excerpt in the left
              // spine (via spineTitle), so it needs no panel offset either.
              panelTopOffset={0}
              resource={isResource ? { url: entity.webUrl!, resourceId: entity.webResourceId } : undefined}
              // Edge-to-edge web view for the fullscreen TARGET (depth === fsDepth) AND
              // any window opened ON TOP of it (depth > fsDepth) — recursive fullscreen
              // re-nests those descendants inside the target's expanded View, and each
              // web child should fill its (inset) window body edge-to-edge below its own
              // header, just like the target does. Excludes covered ANCESTORS below the
              // target (depth < fsDepth), which are painted over anyway.
              fullscreen={fsDepth >= 1 && depth >= fsDepth}
            />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
