"use client"

import { useState, useLayoutEffect } from "react"
import { useTheme } from "next-themes"
import { Check, X } from "lucide-react"
import { getEntity, getOpenTaskCount } from "@/lib/zero/data"
import type { TaskPriority } from "@/lib/zero/types"
import { useZeroNav, useRowSelection } from "@/lib/zero/nav-store"
import {
  HEADER_H,
  ANCESTOR_HEADER_H,
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
  surfaceAt,
  telescopicLevel,
  telescopicSurface,
  type SpaceKind,
} from "@/lib/zero/motion"
import { DURATION_S, MORPH_CSS_EASE } from "@/lib/zero/flip-stage"
import { NodeGlyph } from "./node-glyph"
import { ResourceGlyph } from "./resource-glyph"
import { EntityBody } from "./entity-body"
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

function fmtTime(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h >= 12 ? "pm" : "am"
  const hr = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`
}

function fmtMoment(min: number, seconds: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h >= 12 ? "pm" : "am"
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${ampm}`
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
  onContextMenu,
}: {
  entityId: string
  /** The id of the context (space) whose Dock/DO-list renders this node. This is
   *  what makes the SAME entity, referenced in multiple contexts, resolve to a
   *  single owning window instead of one window per rendered copy. */
  contextId: string
  variant: "row" | "dock"
  onContextMenu?: (e: React.MouseEvent) => void
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
  const entity = getEntity(entityId)
  const region = variant === "dock" ? "dock" : "list"
  const { showHighlight, hoverProps, ref } = useRowSelection(region, entityId)
  const [done, setDone] = useState(!!entity?.completed)
  const [closeHover, setCloseHover] = useState(false)
  // Mouse-hover state for the collapsed row/card. Driven in JS (not a Tailwind
  // `hover:` class) so the background can be the dynamic per-depth `surfaceAt`
  // color — the same value the node's window adopts when opened.
  const [hovered, setHovered] = useState(false)

  // Clear close-hover whenever a morph is running. When a window expands, its X
  // mounts/moves under a stationary cursor and fires `onPointerEnter`, leaving
  // `closeHover` stale-true once the morph ends — which flashed the close title
  // even though the user never actually hovered. Resetting here means the title
  // only reappears on a genuine pointer-enter (i.e. the cursor actually moving
  // onto the X), not as a side effect of the window growing under the pointer.
  useLayoutEffect(() => {
    if (nav.animating) setCloseHover(false)
  }, [nav.animating])

  if (!entity) return null

  const kind = entity.kind
  const isTask = kind === "task"
  const isSpace = kind === "space"
  // A RESOURCE TASK is a task bound to a web surface (Zero as a contextual browser).
  // When open it renders that surface (live embed or illustrative stand-in) in place
  // of the do-list. The glyph+title header, IN/OUT rails and close all stay identical
  // to a normal Task window — only the central working surface differs.
  const isResource = isTask && !!entity.webUrl

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
  const isTop = ownsOpen && nav.activeId === entityId
  const animating = nav.animating
  const showBody = asWindow || isClosing

  const depth = ownsOpen
    ? stackDepth
    : fadingWindow
      ? fadingEntry!.depth
      : closingEntry
        ? closingEntry.depth
        : 0

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
  // leaf is capped and ancestors recede relative to it.
  const leafDepth = Math.max(0, nav.stack.length - 1)
  // Resting surface = parent window's (telescoped) background, so the collapsed
  // node is invisible at rest. Highlight = ONE ramp step further toward foreground
  // than that — a clear hover lift (brighter in dark mode, a subtle darken in
  // light mode). It no longer necessarily equals the opened window's background
  // (the cap + telescoping decouple them); that intentional mismatch is accepted.
  const restSurface = telescopicSurface(contextDepth, leafDepth, isDark)
  const highlightColor = surfaceAt(telescopicLevel(contextDepth, leafDepth, isDark) + 1)

  // Dock cards carry a faint-but-noticeable resting fill — a slight lift toward
  // the hover colour — so they read as tappable chips even before hover. Do-list
  // rows stay fully invisible at rest. BOTH share the identical hover highlight
  // (`highlightColor`), so a card and a same-parent row light up the same way.
  const collapsedRest =
    variant === "dock" ? `color-mix(in oklab, ${restSurface}, ${highlightColor} 45%)` : restSurface

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

  const frameSurface = asWindow
    ? telescopicSurface(depth, leafDepth, isDark)
    : hovered || showHighlight || isClosing || held
      ? highlightColor
      : collapsedRest

  void nav.dataVersion // re-read counts when data mutates
  const openCount = getOpenTaskCount(entityId)

  const hasRange = typeof entity.start === "number" && typeof entity.end === "number"
  const hasMoment = typeof entity.at === "number"
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

  // Stable collapsed footprint so siblings never shift when this lifts out.
  // Dock card footprint is a PERFECT pointy-top hexagon: width = height × 0.866
  // (√3/2). The size is CONTEXT-DEPENDENT:
  //   • Home view (contextDepth === 0): the original 150 × 130 (150 × 0.866 ≈ 130).
  //   • Everywhere else (Space leaf/ancestor, non-Space windows): the smaller
  //     116 × 100 (116 × 0.866 ≈ 100), so the dock fits inside the hexagon leaf's
  //     bottom triangle on short viewports without cropping.
  // Both honour the √3/2 ratio so the clip stays a regular hexagon, and the glyph +
  // title + open-counter keep their sizes in either case — only the surrounding
  // breathing room changes.
  const dockSlot = contextDepth === 0 ? "h-[150px] w-[130px]" : "h-[116px] w-[100px]"
  // Row slot height: h-11 (44px) gives the airier, more padded look — its inner
  // content uses `h-full`, so this fixed height is what governs a row's vertical
  // padding. Kept in sync with the CreateRow's vertical padding below so the draft
  // input row is the same height as a real row.
  const slotDims = variant === "dock" ? `${dockSlot} shrink-0` : "h-11 w-full"
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
  const winStyle = asWindow ? (fadingWindow ? nav.fadingStyleFor(depth) : nav.styleFor(depth)) : null

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
  const spaceLeafWindow = spaceWindow && isTop
  const spaceAncestorWindow = spaceWindow && !isTop
  // Leaf octagon insets (%), read from the window style: ax = flat top/bottom inset,
  // ay = corner-bracket height. Fall back to the regular hexagon (50, LEAF_HY) if
  // absent so a Space never renders unclipped.
  const leafAx = winStyle ? Number((winStyle as Record<string, unknown>)["--space-ax"]) : NaN
  const leafAyRaw = winStyle ? Number((winStyle as Record<string, unknown>)["--space-ay"]) : NaN
  const leafAy = Number.isFinite(leafAyRaw) ? leafAyRaw : LEAF_HY
  const leafClip = Number.isFinite(leafAx) ? spaceClip(leafAx, leafAy) : SPACE_CLIP_HEX
  const clipPath = !isSpace
    ? undefined
    : asWindow
      ? isTop
        ? leafClip
        : SPACE_CLIP_RECT
      : variant === "dock"
        ? SPACE_CLIP_HEX
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
  const spaceKind: SpaceKind | undefined = !isSpace
    ? undefined
    : asWindow
      ? isTop
        ? "leaf"
        : "ancestor"
      : variant === "dock"
        ? "card"
        : "row"
  // LIGHT-mode Space boundary. A clip-path can't carry a border, so an SVG polygon
  // traces the SAME live points as the clip — octagon for a leaf, rectangle for an
  // ancestor — and is kept MOUNTED across states, fading only its opacity. Because
  // it tracks the live shape, leaf → ancestor now morphs ONE continuous rim
  // (octagon flattening to rectangle) instead of a hexagon rim fading out while a
  // separate rectangle ring faded in — the awkward light-mode "swap" we're fixing.
  // DARK mode renders no SVG (the dark surface reads cleanly; the ancestor's inset
  // ring in the style branch supplies its boundary there), so dark is unchanged.
  const spaceOutlinePoints =
    mounted && !isDark && isSpace
      ? asWindow
        ? spaceLeafWindow
          ? spaceClipPoints(leafAx, leafAy)
          : spaceClipPoints(0, 0)
        : variant === "dock"
          ? SPACE_HEX_POINTS
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
  const frameClass = asWindow
    ? cn(
        "flex cursor-default flex-col overflow-hidden shadow-2xl",
        fadingWindow && "pointer-events-none",
      )
    : cn(
        // Background is set inline (JS-driven hover) so it can use the dynamic
        // per-depth `surfaceAt` color. One effect for do-list rows AND dock cards.
        "absolute inset-0 flex cursor-pointer flex-col overflow-hidden",
        cancelled && "opacity-50",
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
  const isSpine = asWindow && !isTop && isSpace

  // FLOATING HEADER (Space windows only). A Space window renders its glyph + title
  // as an ABSOLUTELY-POSITIONED overlay instead of an in-flow header band, so the
  // header reserves no vertical height and the body fills the whole frame. This is
  // what stops the parent do-list from re-centering when a child opens: with no
  // in-flow header, the do-list centers on the FRAME CENTER identically whether the
  // Space is the leaf (tall hexagon) or an ancestor (short rectangle), so the
  // leaf→ancestor flip no longer shifts it. The spine (its own full-height left
  // strip) and task/event windows (left-aligned in-flow header) are unaffected.
  // Closing Spaces also fall through to the old path (spaceWindow is false once
  // asWindow flips false at close), leaving the tuned close morph untouched.
  const floatingHeader = spaceWindow && !isSpine

  // Header layout:
  //   - SPINE ancestor → a narrow full-height strip pinned to the LEFT edge; glyph
  //     at the top, the rotated title reading up beneath it. Width matches the
  //     window's visible left peek so it sits exactly over that exposed sliver, and
  //     the glyph lines up with the collapsed IN rail in the same strip.
  //   - LEAF Space window (hexagon) → glyph+title FLOAT (absolute) centered near the
  //     top, below the hexagon's tapering top point (matching the dock card's
  //     centered glyph + title so the morph is a straight scale).
  //   - ancestor Space window → glyph+title FLOAT (absolute) top-left in a compact
  //     35px band — visually identical to the old in-flow compact header.
  //   - non-space window → in-flow left-aligned header so the glyph + title sit near
  //     the top-LEFT corner and dominate the children peeking below.
  //   - dock card → centered column (glyph, title, then the open-task counter).
  const headerClass = asWindow
      ? isSpine
        ? // pt-[9px] (= pt-3's 12px − 3px) lifts the glyph+title column up the strip
          // by 3px for tighter alignment with the spine's top.
          "absolute inset-y-0 left-0 z-10 flex w-[26px] flex-col items-center gap-2 pt-[9px]"
      : spaceLeafWindow
        ? // TOP-LEFT, like every other window header — glyph + title in a horizontal
          // row near the top-left, dominating the do-list beneath. The leaf is an
          // OCTAGON, so its top-left corner is cut by a diagonal (from the flat-top
          // start at --space-ax% across, down to the left edge at --space-ay%). A flush
          // pl-4 would let the glyph collide with / clip behind that diagonal, so the
          // row is left-padded by the flat-top inset (--space-ax%, set via style) to
          // sit just inside the diagonal. It occupies the top wedge band (height set
          // via style) and is items-center, so it rides the vertical middle of that
          // band where the octagon is already comfortably wide.
          "absolute inset-x-0 top-0 z-10 flex items-center gap-3 pr-12"
        : spaceAncestorWindow
          ? // FLOATING compact top-left band. Absolute; fixed band height via style so
            // the glyph/title stay vertically centered exactly as the old in-flow header.
            "absolute inset-x-0 top-0 z-10 flex items-center gap-3 pr-12 pl-4"
          : // Task / event window: in-flow left-aligned header (unchanged).
            cn("relative z-10 flex shrink-0 items-center gap-3 pr-12 pl-4")
    : variant === "dock"
      ? "flex flex-1 flex-col items-center justify-center gap-1 px-2 text-center"
      : "flex h-full items-center gap-2 px-4"

  // ANCESTORS (open windows that are not the frontmost leaf) wear a more compact
  // header than the frontmost leaf: a shorter band plus a smaller glyph + title,
  // so depth reads as recession. This now INCLUDES an expanded ancestor Space —
  // once a child opens it reads as a plain rectangle window, so it gets the same
  // left-aligned compact header as every other ancestor. Only the frontmost LEAF
  // Space keeps the tall centered hexagon header.
  const ancestorHeader = asWindow && !isTop && !isClosing
  // Only the LEAF Space hexagon reserves a tall top band so its CENTERED header
  // clears the hexagon's top point; an expanded ancestor Space uses the compact
  // ancestor band like any other stacked window.
  const headerH = spaceLeafWindow ? 96 : ancestorHeader ? ANCESTOR_HEADER_H : HEADER_H

  // Vertical offset that re-centers the IN/OUT panel rails on the FRAME center.
  // EntityBody anchors the overlay at the body's vertical center and ANIMATES a
  // translateY of this value, so the rails land on the true middle of the window's
  // edges and SLIDE (never jump) when a window's role changes. The body's center
  // equals the frame center only when its top and bottom insets match; the shift
  // is exactly (bottomInset − topInset) / 2 — no magic constants:
  //   • body FILLS the frame (header is absolute, reserves no in-flow height) → 0.
  //     This is every Space window (floating header) AND every SPINE ancestor
  //     (its header is an absolute left strip) — the previously-missing spine case
  //     that made the rails jump up ~headerH/2 the moment an ancestor spined.
  //   • in-flow header (task/event/non-spine ancestor): body starts headerH down
  //     → −headerH/2.
  //   • closing: the body re-anchors (space fills from top:0 → 0; task → −HEADER_H/2).
  const bodyFillsFrame = floatingHeader || isSpine
  const railCenterShift = isClosing
    ? isSpace
      ? 0
      : -HEADER_H / 2
    : bodyFillsFrame
      ? 0
      : -headerH / 2

  // Visible BLEED strip beside this window — how much of it shows on each side
  // once a child covers it (so the collapsed IN/OUT rail can size+center itself to
  // sit in the middle of that sliver instead of being clipped at the frame edge).
  // The frontmost leaf (and home root) isn't covered, so its rail keeps the full
  // width (undefined → EntityBody's PANEL_RAIL_W default). A covered ancestor only
  // exposes its accumulated side peek: TASK_SIDE on the left, RIGHT_PEEK right
  // (matches stackTargetRect). Animating these widths also smooths the leaf↔
  // ancestor transition.
  const covered = asWindow && !isTop && !isClosing
  const railBleedLeft = covered ? TASK_SIDE : undefined
  const railBleedRight = covered ? RIGHT_PEEK : undefined

  // Compact ancestor: 13px + dimmer (see className) so it recedes behind the leaf.
  // Leaf window: only SPACES enlarge to 18px — a non-space (task/event) leaf keeps
  // the 13px it had as a row/dock button, so its title doesn't pop bigger on open.
  // Collapsed row and dock are both 13px.
  const titleSize = asWindow ? (ancestorHeader ? 13 : isSpace ? 18 : 13) : 13

  // `winStyle` (the window's resting fixed geometry: top/left/width/height in
  // viewport px) is computed once near the top of the component — it also feeds the
  // clip + outline. Used here to place the close-hover title just OUTSIDE the
  // frame's right edge (the frame is overflow-hidden, so an in-frame title there
  // would be clipped; a `fixed` title positioned from these numbers escapes it).
  // Close-button affordance: instead of showing the window's title next to the X,
  // hovering an ANCESTOR's close button outlines that whole window so it's obvious
  // which one the button belongs to. Restricted to ancestors (`!isTop`), which are
  // always rectangles here — the frontmost LEAF needs no hint (it's the obvious
  // target) and skipping it avoids bordering the clipped hexagon. Gated on
  // `!animating` so the morph never flashes it.
  const showCloseBorder = asWindow && !isTop && closeHover && !animating

  return (
    <div className={slotClass}>
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
        onContextMenu={onContextMenu}
        onPointerEnter={() => {
          // Moves the keyboard selection cursor here (existing behavior) AND sets
          // the local mouse-hover flag that paints the unified highlight.
          if (interactive) hoverProps.onPointerEnter()
          if (!asWindow) setHovered(true)
        }}
        onPointerLeave={() => {
          if (!asWindow) setHovered(false)
        }}
        style={
          asWindow
            ?               // The LEAF Space is a hexagon: it overflows the box, pads its content
              // into the visible band, and carries the drop-shadow filter.
              spaceLeafWindow
              ? {
                  ...(winStyle ?? {}),
                  borderRadius: 0,
                  clipPath,
                  // The hexagon overflows the region top/bottom; the content (header +
                  // body) is inset into the shape's visible, full-width middle band by
                  // a `margin` on those children (header marginTop, body marginBottom —
                  // both `var(--hex-inset-y)`), NOT by padding here. Padding is part of
                  // the border-box, so with `box-sizing: border-box` the frame's height
                  // could never shrink below paddingTop + paddingBottom (~282px). While
                  // GSAP Flip animates the frame's height down to the dock-card/row size
                  // (~96px) that floor made it freeze tall → the card flashed a
                  // vertically STRETCHED hexagon at the morph's start. Child margins do
                  // not inflate a fixed-height flex container, so the frame's height now
                  // animates freely while the content keeps the exact same resting
                  // offset (overflow-hidden clips it harmlessly while collapsed).
                  // Telescoped, theme-aware capped surface. A background-color
                  // transition lets ancestors recede smoothly as the stack
                  // deepens/retracts.
                  backgroundColor: frameSurface,
                  // Background recede + the hover-peek width shrink. Width is only
                  // transitioned at rest (`!animating`); during a morph Flip drives
                  // width directly, so transitioning it too would double-animate.
                  transition: `background-color ${DURATION_S} ${MORPH_CSS_EASE}${animating ? "" : `, width ${DURATION_S} ${MORPH_CSS_EASE}`}`,
                  // No `filter: drop-shadow` here: a CSS filter forces the layer to
                  // re-rasterize on every Flip transform (the flicker) and would
                  // establish a containing block for fixed descendants. The hexagon
                  // boundary is drawn by the SVG outline overlay below instead.
                }
              : {
                  ...(winStyle ?? {}),
                  // Tasks/events AND expanded ancestor Spaces: the telescoped,
                  // capped surface. The background-color transition makes ancestors
                  // recede smoothly each time the stack deepens or retracts. An
                  // expanded ancestor Space also adds its rectangle clip-path
                  // (SPACE_CLIP_RECT) — the same six points the hexagon morphs to.
                  backgroundColor: frameSurface,
                  // Background recede + the hover-peek width shrink (rest only; Flip
                  // owns width during morphs — see the leaf-space branch above).
                  transition: `background-color ${DURATION_S} ${MORPH_CSS_EASE}${animating ? "" : `, width ${DURATION_S} ${MORPH_CSS_EASE}`}`,
                  // An expanded ancestor Space keeps its rectangle clip-path AT ALL
                  // TIMES (a square full-box rect — the same six points the hexagon
                  // morphs to). Pinning it is what kills the old flicker: previously
                  // the clip was swapped for a plain radius whenever the stack
                  // settled, so every open/close made the Space pop at the morph's
                  // start and end. Now Flip just interpolates the points rect → hex
                  // with nothing to snap. Since every window is square, this full-box
                  // rect is visually identical to any other window — but the clip
                  // strips the outer shadow-2xl, so its boundary is a 1px INSET ring.
                  // Only for ancestor Spaces — task/event windows have no clip and
                  // keep their real shadow-2xl.
                  ...(clipPath
                    ? {
                        clipPath,
                        // DARK only: light mode's boundary is the morphing SVG outline.
                        ...(isDark ? { boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.30)" } : null),
                      }
                    : null),
                }
            : ({
                // Collapsed: Space dock cards are hexagons (clipPath), everything
                // else a SQUARE rectangle (matching the square windows they morph
                // into — every entity surface is square).
                ...(clipPath ? { clipPath } : { borderRadius: 0 }),
                // While shrinking closed it is a row again, but Flip animates it
                // at full window size; lift it above sibling rows so parent
                // content can't bleed through until it lands in its slot.
                ...(isClosing ? { zIndex: 40 } : null),
                // ONE unified hover for do-list rows AND dock cards: rest at the
                // parent surface `restSurface` (invisible), lift to `highlightColor`
                // — the next ramp step, i.e. the EXACT color this node's window
                // adopts when opened — on mouse hover OR keyboard selection. While
                // shrinking closed, hold the highlight so it matches the window it
                // retracts from (both opaque → no bleed-through, no early fade).
                // Keyboard selection shares the SAME cue as mouse hover: the filled
                // `highlightColor` background (the exact color this node's window adopts
                // when opened). A separate inset-ring "rectangle" for keyboard selection
                // was redundant — the full-surface highlight already reads as a clear
                // single-item cursor, and the design language uses that filled state
                // everywhere — so it's been dropped.
                backgroundColor: frameSurface,
                transition: "background-color 0.18s ease-out",
              })
        }
        className={frameClass}
      >
        {/* LIGHT-mode Space boundary (dark renders none — see spaceOutlinePoints). A
            clip-path can't carry a border, so this SVG traces the EXACT same points as
            the live clip (percentage coords map identically): the leaf OCTAGON, the
            ancestor RECTANGLE, or the collapsed dock HEXAGON. Because the points track
            the clip, a leaf→ancestor change morphs ONE continuous rim instead of
            swapping a hexagon rim for a rectangle ring. The frame clips its children to
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
            className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
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

        {/* Close button — fades only, never a flip target. On a LEAF Space hexagon
            it is pulled in to sit just inside the top-RIGHT vertex (the corner is
            clipped, so it rides the safe band near it). Ancestor Spaces and all
            other windows are rectangles, so the X sits in the true top-right
            corner — which, for an ancestor Space, is the top of its right peek. */}
        {asWindow && (
          <div
            // data-fade-late (NOT data-fade): the close button fades in over the BACK
            // half of the open morph instead of with the body at the start, so it
            // doesn't pop in early before the window has taken shape. Closing still
            // just unmounts it (asWindow flips false), so this only affects opening.
            data-fade-late
            // For a leaf Space the X sits just inside the octagon's upper-right
            // corner — the TOP of the right VERTICAL edge, which the settled octagon
            // reaches at ~9.2% of the frame height. It shares the OUT rail's horizontal
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
              ...(spaceLeafWindow
                ? // Top of the octagon's right vertical edge (~9.2%), nudged down a few
                  // px to clear the chamfer; right: 12px centers the 24px-wide X on the
                  // OUT rail's 24px-from-edge axis so they align as a right-edge column.
                  { top: "calc(9.2% + 4px)", right: "12px" }
                : isSpine
                  ? // SPINE ancestor: mirror the left spine strip's glyph. The right
                    // BLEED is RIGHT_PEEK (24px) wide; the button is size-6 (24px), so
                    // `right: 0` makes it fill and center the X exactly on that peek
                    // (instead of `right-1.5`, which crowded it toward the children).
                    // `top: 5px` lifts the X so its center (~17px) lines up with the
                    // spine glyph's center (pt-[9px] + half a 16px glyph), so the X
                    // reads as the right-side twin of the glyph.
                    { top: "5px", right: "0px" }
                  : null),
            }}
            // z-[35]: must stay BELOW the child window. Frames are position:fixed
            // but nested in the DOM, so a child window resolves at z-40 INSIDE this
            // ancestor's stacking context. A higher value (e.g. z-[60]) would escape
            // above the child and paint this ancestor's X over the leaf header; 35
            // keeps the X confined to this ancestor's own exposed top-right corner.
            className={cn(
              "absolute z-[35] flex flex-col items-center gap-1",
              // Leaf hexagon + spine use inline top/right (above); everyone else uses
              // the static top-right corner.
              spaceLeafWindow || isSpine ? "" : "right-1.5 top-3",
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
          className={headerClass}
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
            floatingHeader
              ? spaceLeafWindow
                ? // Occupy the octagon's TOP WEDGE: top:0 (from the class) with height
                  // equal to the corner inset — the distance from the flat top down to
                  // the upper side corners (top of the central rectangle). The header is
                  // items-center, so glyph+title ride the vertical middle of that wedge,
                  // sitting right above the do-list beneath. paddingLeft = the flat-top
                  // inset (--space-ax %, measured against the full-width header) tucks
                  // the row just inside the top-left DIAGONAL so the glyph clears the
                  // octagon's cut corner instead of colliding with / hiding behind it.
                  { height: "var(--hex-corner-inset-y, 0px)", paddingLeft: "calc(var(--space-ax, 0) * 1%)" }
                : { height: headerH }
              : asWindow && !isSpine
                ? { height: headerH, marginTop: "var(--hex-inset-y, 0px)" }
                : undefined
          }
        >
          {/* Glyph — for a collapsed task it doubles as the completion toggle. */}
          <span
            data-flip-id={`${flip}-glyph`}
            data-flip-role="inner"
            // Color-only CSS transition (independent of Flip's transform/fontSize
            // tween) so the glyph's ink fades smoothly to/from the dimmed ancestor
            // grey instead of jumping. Only on windows; rows stay snappy.
            style={
              asWindow
                ? { transitionProperty: "color", transitionDuration: DURATION_S, transitionTimingFunction: MORPH_CSS_EASE }
                : undefined
            }
            onClick={
              interactive && isTask
                ? (e) => {
                    e.stopPropagation()
                    setDone((d) => !d)
                  }
                : undefined
            }
            className={cn(
              "relative flex shrink-0 items-center justify-center",
              // Glyph ink matches the title: compact ancestors are dimmed to
              // foreground/75 (like their title), everything else stays full ink.
              ancestorHeader ? "text-foreground/75" : "text-foreground",
              // Only a SPACE leaf keeps the enlarged 20px glyph. A non-space
              // (task/event) leaf keeps its collapsed size — 18px if it opened from a
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
            )}
          >
            {isResource ? (
              // Favicon-as-icon: a resource task shows its resource/site mark in every
              // state (row, dock card, window header) so it reads as "the Figma tab",
              // "the Photopea tab", etc. — Zero's contextual-browser identity.
              <ResourceGlyph resourceId={entity.webResourceId} url={entity.webUrl} />
            ) : (
              <>
                <NodeGlyph kind={kind} filled={isTask && done} strokeWidth={asWindow ? 1.75 : isTask ? 2 : 1.75} />
                {!asWindow && isTask && done && (
                  <Check className="absolute h-2.5 w-2.5 text-background" strokeWidth={3.5} />
                )}
              </>
            )}
          </span>

          <h3
            data-flip-id={`${flip}-title`}
            data-flip-role="inner"
            style={{
              fontSize: titleSize,
              // FIXED line-box height (px), constant across every title state.
              // The header is `items-center`, so the title is vertically centred
              // against the glyph. GSAP Flip tweens this title's `fontSize` between
              // the row/dock size (13px) and the leaf-window size (18px); with the
              // default (font-relative) line-height the title's BOX height tweened
              // too (~20px → ~26px → ~20px), and `items-center` turned half of that
              // delta into a vertical shift that SNAPPED ~4px the instant Flip's
              // clearProps fired at completion — the "title jumps down 3-4px at the
              // end of every open" glitch. Pinning the line-box to a constant 20px
              // (comfortably fits the 18px max font) keeps the box height identical
              // in Flip's captured AND final states, so the font tween no longer
              // moves the centre line and there is nothing left to snap.
              lineHeight: "20px",
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
                    // Weight ladder: rows, dock cards and ancestor headers are font-medium.
                    // A LEAF header steps one weight heavier than its collapsed button:
                    //   • SPACE leaf → font-semibold
                    //   • non-space (task/event) leaf → font-semibold too (one step above
                    //     the font-medium it has as a row/card; only the open leaf is
                    //     heavier, the button itself stays medium).
                    ancestorHeader
                      ? "font-medium text-foreground/75"
                      : isSpace
                        ? "font-semibold"
                        : asWindow
                          ? "font-semibold"
                          : "font-medium",
                  )
                : variant === "dock"
                  ? // Hug content (centered by the dock header's items-center) so the
                    // box model matches the leaf hexagon title it morphs into — see the
                    // window-title note above. `max-w-full` keeps long names truncating
                    // within the card instead of overflowing. `text-center` keeps the
                    // text on the box centre line during the morph for the same reason as
                    // the window titles (Flip's interpolating explicit width).
                    "max-w-full truncate text-center font-medium leading-tight"
                  : // DO-LIST ROW. The title must HUG its content here too — it is the
                    // "from" state of a row→window open morph, and every window title is a
                    // content-hugging box. Previously this was `flex-1` (a WIDE box that
                    // spanned the row). GSAP Flip captured that wide width and tweened it
                    // down to the window's hug width; the window title's `text-center`
                    // then parked the text in the MIDDLE of that wide box at the start
                    // (the "title jumps to the middle of the row" glitch) and let it drift
                    // as the width shrank. Hugging the content makes the captured box ≈ the
                    // text, so the title simply SLIDES from its row slot to the window slot.
                    // `mr-auto` absorbs the free space the old `flex-1` used to occupy, so
                    // trailing meta (counts / time / due) still sits flush right; `max-w-full
                    // truncate` preserves ellipsis for long names.
                    "min-w-0 max-w-full truncate mr-auto font-medium",
              !asWindow && (isTask && done ? "text-muted-foreground/60 line-through" : cancelled ? "line-through" : ""),
            )}
          >
            {/* SPINE rotation lives on this INNER span, NOT the <h3>. The <h3> is a
                GSAP Flip target (Flip slides it below the glyph and CLEARS its
                transform on completion, which would wipe any rotation we put there;
                React also drops the standalone CSS `rotate` property). The span is
                NOT a Flip target, so its `transform` is untouched by Flip and
                animates purely via its own CSS transition — the title rotates AND
                slides at once.

                Geometry (why `translateX(-50%) rotate(-90deg)` about `100% 50%`):
                the span is centered in the 26px strip, so its box center sits at
                the strip center. Rotating -90° (CCW, reads bottom-to-top) about the
                span's RIGHT-center anchors the resulting column's TOP at a CONSTANT
                offset below the glyph — independent of title length. That kills both
                bugs: long titles can no longer grow UP into the glyph (they hang
                straight down), and every title shares the same glyph→title gap
                (previously a center pivot made the top float with text length, so
                longer words crept closer to the glyph). The right-center pivot
                leaves the column offset right by half the title width; the outer
                `translateX(-50%)` (half the span's OWN width) exactly cancels that,
                re-centering the narrow column in the strip for any length. Both
                transform parts interpolate, so the morph still rotates AND slides. */}
            <span
              className="inline-block whitespace-nowrap"
              style={
                asWindow
                  ? {
                      transform: isSpine ? "translateX(-50%) rotate(-90deg)" : "translateX(0) rotate(0deg)",
                      transformOrigin: "100% 50%",
                      transitionProperty: "transform",
                      transitionDuration: DURATION_S,
                      transitionTimingFunction: MORPH_CSS_EASE,
                    }
                  : undefined
              }
            >
              {entity.title}
            </span>
          </h3>

          {/* Collapsed trailing meta — counts / time / due / priority. Hidden in
              every window/spine/closing state so the header reads cleanly. */}
          {!asWindow && !isClosing && variant === "row" && (
            <>
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
                  {fmtTime(entity.start!)}
                  {"\u2013"}
                  {fmtTime(entity.end!)}
                </span>
              )}
              {kind === "instant" && hasMoment && (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                  {fmtMoment(entity.at!, entity.seconds ?? 0)}
                </span>
              )}
              {isTask && entity.dueDate && (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">{entity.dueDate}</span>
              )}
              {isTask && (
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", priorityDot[entity.priority ?? "medium"])} />
              )}
            </>
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
            <span className="flex animate-in items-center gap-1 fade-in fill-mode-both text-[10px] text-muted-foreground/70 delay-700 duration-700">
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
            // leaves --hex-corner-inset-y unset (→ 0px), so it also centers on the frame
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
                : floatingHeader
                  ? {
                      marginTop: "var(--hex-corner-inset-y, 0px)",
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
              // The crop line must be the parent FRAME top (= the parent WINDOW top),
              // NOT the parent body top. Those coincide for a Space ancestor (floating
              // header → body fills the frame), but a Task/Event ancestor has an in-flow
              // header, so its body starts `headerH` BELOW the frame top — clipping at
              // body-top there would crop the child below the parent's title header
              // instead of at the window edge. So pull the top inset up by `headerH` in
              // that case (0 when the header floats) to land on the frame top either way.
              // Top-only inset (huge negative on the other three sides) so the child's
              // sides, bottom point and drop shadow stay exactly as before. Only
              // ancestors need it (a leaf has no open child) and never while closing.
              ...(asWindow && !isTop && !isClosing
                ? { clipPath: `inset(${floatingHeader ? 0 : -headerH}px -9999px -9999px -9999px)` }
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
                  "pointer-events-none absolute inset-x-0 bottom-0 flex min-h-0 flex-col overflow-hidden"
                : // `flex flex-col` so EntityBody (a flex-1 child) actually fills a
                  // tall window. Without it the body was a plain block, EntityBody
                  // sized to its content (~min-h), and the vertically-centered
                  // Inputs/Outputs rails centered on that short content near the top
                  // — so on tall screens they floated well above the window center.
                  "flex min-h-0 flex-1 flex-col",
              // NOTE: no horizontal padding here, on purpose. The IN/OUT rails are an
              // absolute overlay anchored to this body's left/right edges, so any padding
              // would push them inward — and worse, a LEAF-only inset (the old `px-[4%]`)
              // was REMOVED the instant the Space spined to an ancestor, snapping both
              // rails outward by that padding in one frame (the "jump into place" on
              // peek/bleed). With the body always flush to the frame, the rails sit close
              // to the edges like a Task window AND keep a stable anchor across the
              // leaf→spine flip, so only their width tweens (smoothly). The do-list/Dock
              // stay safely inset via their own centered `max-w` + `w-2/3` column.
            )}
          >
            <EntityBody
              entityId={entityId}
              active={isTop && !isClosing}
              closing={isClosing}
              railShift={railCenterShift}
              railBleedLeft={railBleedLeft}
              railBleedRight={railBleedRight}
              // Float the dock OUT of the do-list's flex flow for EVERY Space body —
              // leaf AND ancestor, AND while CLOSING. This is what preserves the
              // no-jump invariant: the do-list then fills the full body and centers on
              // the frame center IDENTICALLY whether Zero is the leaf (tall hexagon,
              // corner inset > 0, dock dropped into the bottom triangle) or an ancestor
              // (rectangle, corner inset 0, dock pinned to the body bottom). If only the
              // leaf floated, the ancestor's in-flow dock would steal flex height and
              // shove its list up, re-centering the parent list when a child opens.
              // Including the CLOSE morph matters too: `spaceWindow` goes false the
              // instant the window leaves the stack, so without this the dock would snap
              // from floated to in-flow (and the list re-center upward) at the very start
              // of the close — the visible jump. Tasks/events and the home root keep the
              // in-flow dock. */
              floatDock={spaceWindow || (isSpace && isClosing)}
              resource={isResource ? { url: entity.webUrl!, resourceId: entity.webResourceId } : undefined}
            />
          </div>
        )}
      </div>
    </div>
  )
}
