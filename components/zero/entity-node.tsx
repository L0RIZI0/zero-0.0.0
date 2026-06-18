"use client"

import { useState, useLayoutEffect } from "react"
import { useTheme } from "next-themes"
import { Check, X } from "lucide-react"
import { getEntity, getOpenTaskCount } from "@/lib/zero/data"
import type { TaskPriority } from "@/lib/zero/types"
import { useZeroNav, useRowSelection, HIGHLIGHT_SHADOW, HIGHLIGHT_SHADOW_NONE } from "@/lib/zero/nav-store"
import {
  HEADER_H,
  ANCESTOR_HEADER_H,
  VERTICAL_BEHIND,
  SPACE_CLIP_HEX,
  SPACE_CLIP_RECT,
  SPACE_HEX_POINTS,
  surfaceAt,
  telescopicLevel,
  telescopicSurface,
} from "@/lib/zero/motion"
import { DURATION_S, MORPH_CSS_EASE } from "@/lib/zero/flip-stage"
import { NodeGlyph } from "./node-glyph"
import { EntityBody } from "./entity-body"
import { cn } from "@/lib/utils"

// Space windows (leaf hexagon AND expanded-ancestor rectangle) are clip-path
// shaped, and a clip-path clips away box-shadow — so they carry NO drop shadow.
// Their boundary against an identically-colored parent is supplied entirely by a
// crisp SVG outline (see the overlay in the frame below), which reads cleanly in
// both themes and — unlike a `filter: drop-shadow` — never forces a layer
// re-rasterization or re-anchors fixed children during the Flip morph.

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
  // (√3/2). 96 × 83 honours that ratio (96 × 0.866 ≈ 83) so the clip renders as a
  // regular hexagon — slightly larger than before for a more substantial card.
  const slotClass = variant === "dock" ? "relative h-[96px] w-[83px] shrink-0" : "relative h-9 w-full"

  // Hover tint must NOT be live while the frame is a window or shrinking closed:
  // its translucent background would let parent content bleed through the moving
  // frame. Only a settled, collapsed node is interactive.
  const interactive = !asWindow && !isClosing

  // A Space is always shaped by a 6-point clip-path, but the shape depends on
  // whether it is the frontmost LEAF or an EXPANDED ancestor:
  //   - LEAF window (isTop) + collapsed DOCK CARD → a true regular HEXAGON.
  //   - EXPANDED ancestor (a child is open over it) → the same six points
  //     flattened into a RECTANGLE (SPACE_CLIP_RECT). Opening a child grows the
  //     Space from the capped hexagon to the full box, and the clip tweens
  //     hex → rect point-for-point in the same Flip pass, so the hexagon edges
  //     visibly flatten out as it "expands" into a rectangle window. A settled
  //     ancestor is then a static, cheap rectangle (no clip morph, no filter).
  // Tasks/events never clip.
  const spaceWindow = isSpace && asWindow
  const spaceLeafWindow = spaceWindow && isTop
  // An EXPANDED ancestor Space window: a Space with a child open over it. Its clip
  // is a square full-box rectangle (identical to any other square window), but the
  // clip strips the normal shadow-2xl, so its boundary is supplied by an inset ring.
  const spaceAncestorWindow = spaceWindow && !isTop
  const clipPath = !isSpace
    ? undefined
    : asWindow
      ? isTop
        ? SPACE_CLIP_HEX
        : SPACE_CLIP_RECT
      : variant === "dock"
        ? SPACE_CLIP_HEX
        : // A collapsed DO-LIST row Space is clipped to SPACE_CLIP_RECT — a full-box
          // rectangle traced by the SAME six vertices as the hexagon. Visually it is
          // identical to an unclipped box, but it gives Flip a 6-point "from" state so
          // opening morphs rect → hex point-for-point (just like the dock card morphs
          // hex → hex). Without it the captured clip was `none`, which Flip can't
          // interpolate into a polygon, so the hexagon snapped in and expanded — the
          // bug. Rows of other kinds (task/event) stay unclipped.
          SPACE_CLIP_RECT
  // Only the LEAF hexagon needs the SVG outline (a clip-path can't carry a border
  // or shadow, and a straight-edged ring can't trace a hexagon). The square
  // rectangle (ancestor/parent) uses a simple inset ring instead, so it gets no
  // outline. In DARK mode the leaf hexagon drops its outline entirely (the dark
  // surface reads cleanly without it); light mode keeps the hairline for contrast.
  const spaceOutlinePoints = spaceLeafWindow && !isDark ? SPACE_HEX_POINTS : null

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

  // SPINE: a stacked ancestor sitting ≥ VERTICAL_BEHIND levels behind the leaf
  // collapses its horizontal header into a vertical left strip — glyph pinned to
  // the top, title rotated 90° CCW to read up the strip. These ancestors reserve
  // no top peek (see stackTargetRect), so they fan out as nested LEFT strips
  // instead of pushing the leaf down the screen. Never the leaf, never a hexagon
  // leaf; closing un-spines it (leafDepth shrinks → condition flips → rotates back).
  const isSpine = asWindow && !isTop && leafDepth - depth >= VERTICAL_BEHIND

  // Header layout:
  //   - SPINE ancestor → a narrow full-height strip pinned to the LEFT edge; glyph
  //     at the top, the rotated title reading up beneath it. Width matches the
  //     window's visible left peek so it sits exactly over that exposed sliver, and
  //     the glyph lines up with the collapsed IN rail in the same strip.
  //   - LEAF Space window (hexagon) → header CENTERED at the top, pushed below the
  //     hexagon's tapering top point (matching the dock card's centered glyph +
  //     title so the morph is a straight scale).
  //   - ancestor Space window OR any non-space window → left-aligned horizontal
  //     header so the glyph + title sit near the top-LEFT corner and dominate the
  //     children peeking below.
  //   - dock card → centered column (glyph, title, then the open-task counter).
  const headerClass = asWindow
    ? isSpine
      ? "absolute inset-y-0 left-0 z-10 flex w-[26px] flex-col items-center gap-2 pt-3"
      : spaceLeafWindow
        ? "relative z-10 flex shrink-0 flex-col items-center gap-1.5 px-4 pt-9"
        : cn("relative z-10 flex shrink-0 items-center gap-3 pr-12 pl-4")
    : variant === "dock"
      ? "flex flex-1 flex-col items-center justify-center gap-1 px-2 text-center"
      : "flex h-full items-center gap-2 px-2.5 pr-2.5"

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

  // Compact ancestor: 13px + dimmer (see className) so it recedes behind the
  // leaf. Leaf window: full 18px.
  const titleSize = asWindow ? (ancestorHeader ? 13 : 18) : variant === "dock" ? 13 : 13

  // The window's resting fixed geometry (top/left/width/height in viewport px).
  // Used both for the frame and to place the close-hover title just OUTSIDE the
  // frame's right edge (the frame is overflow-hidden, so an in-frame title there
  // would be clipped; a `fixed` title positioned from these numbers escapes it).
  const winStyle = asWindow ? (fadingWindow ? nav.fadingStyleFor(depth) : nav.styleFor(depth)) : null
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
                  // The hexagon overflows the region top/bottom; pad the content
                  // (header + body) inward by that overflow so it lands in the
                  // shape's visible, full-width middle band. Padding is inside the
                  // border-box, so the clip + background still fill the whole
                  // (bleeding) hexagon.
                  paddingTop: "var(--hex-inset-y)",
                  paddingBottom: "var(--hex-inset-y)",
                  // Telescoped, theme-aware capped surface. A background-color
                  // transition lets ancestors recede smoothly as the stack
                  // deepens/retracts.
                  backgroundColor: telescopicSurface(depth, leafDepth, isDark),
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
                  backgroundColor: telescopicSurface(depth, leafDepth, isDark),
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
                        boxShadow: `inset 0 0 0 1px ${isDark ? "rgb(255 255 255 / 0.30)" : "rgb(0 0 0 / 0.22)"}`,
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
                backgroundColor: hovered || showHighlight || isClosing ? highlightColor : collapsedRest,
                boxShadow: showHighlight ? HIGHLIGHT_SHADOW : HIGHLIGHT_SHADOW_NONE,
                transition: "box-shadow 0.18s ease-out, background-color 0.18s ease-out",
              })
        }
        className={frameClass}
      >
        {/* Leaf-hexagon boundary. A clip-path can't carry a border or box-shadow, so
            this SVG traces the EXACT same rounded points as the hexagon clip
            (percentage coords map identically), giving a crisp hairline that
            separates the Space from an identically-colored parent behind it. The
            frame clips its children to the hexagon, so the stroke's outer half is
            clipped away and a clean ~1px inner rim remains. `non-scaling-stroke`
            keeps it a uniform hairline despite the viewBox stretching to the window's
            size. (The expanded rectangle uses border-radius + an inset ring instead
            — see the ancestor style branch above.) */}
        {spaceOutlinePoints && (
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <polygon
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
            data-fade
            // For a leaf Space the X sits just inside the hexagon's top-RIGHT
            // vertex. That vertex is at 25% of the frame HEIGHT — the only height at
            // which the hexagon reaches the frame's full width (above it the shape
            // slopes inward, so anchoring to --hex-inset-y, ~20%, would drop the X
            // out in the clipped-away corner). So we anchor to 25% and nudge down+in
            // a few px to clear the rounded corner. Other windows: true top-right.
            style={{
              transitionDuration: DURATION_S,
              ...(spaceLeafWindow ? { top: "calc(25% + 6px)", right: "16px" } : null),
            }}
            // z-[35]: must stay BELOW the child window. Frames are position:fixed
            // but nested in the DOM, so a child window resolves at z-40 INSIDE this
            // ancestor's stacking context. A higher value (e.g. z-[60]) would escape
            // above the child and paint this ancestor's X over the leaf header; 35
            // keeps the X confined to this ancestor's own exposed top-right corner.
            className={cn(
              "absolute z-[35] flex flex-col items-center gap-1",
              spaceLeafWindow ? "" : "right-1.5 top-3",
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
          style={asWindow && !isSpine ? { height: headerH } : undefined}
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
              // Leaf window keeps the full 20px glyph; compact ancestors use 16px.
              // A collapsed DOCK CARD uses 18px (slightly larger than a do-list
              // row's 16px) so the enlarged card stays harmonious. The size change
              // is animated by GSAP Flip (this glyph is a flip target captured in
              // captureStage), so no CSS transition here — that would double-animate
              // against Flip.
              asWindow && !ancestorHeader
                ? "h-5 w-5"
                : !asWindow && variant === "dock"
                  ? "h-[18px] w-[18px]"
                  : "h-4 w-4",
            )}
          >
            <NodeGlyph kind={kind} filled={isTask && done} strokeWidth={asWindow ? 1.75 : isTask ? 2 : 1.75} />
            {!asWindow && isTask && done && (
              <Check className="absolute h-2.5 w-2.5 text-background" strokeWidth={3.5} />
            )}
          </span>

          <h3
            data-flip-id={`${flip}-title`}
            data-flip-role="inner"
            style={{
              fontSize: titleSize,
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
                  cn(
                    "whitespace-nowrap",
                    ancestorHeader ? "font-medium text-foreground/75" : "font-semibold",
                  )
                : variant === "dock"
                  ? "w-full truncate font-medium leading-tight"
                  : "min-w-0 flex-1 truncate font-medium",
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
              directly below the title (not pinned to a corner). */}
          {!asWindow && !isClosing && variant === "dock" && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
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
        {(asWindow || isClosing) && !spaceLeafWindow && (
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
            (its Dock + Inputs · Tasks · Outputs). Tagged data-body so close can
            scale it down with the frame. Only the frontmost window's body is
            "active" for keyboard / selection. */}
        {showBody && (
          <div
            data-fade
            data-body
            style={isClosing ? { top: HEADER_H } : undefined}
            className={cn(
              isClosing
                ? "pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden"
                : // `flex flex-col` so EntityBody (a flex-1 child) actually fills a
                  // tall window. Without it the body was a plain block, EntityBody
                  // sized to its content (~min-h), and the vertically-centered
                  // Inputs/Outputs rails centered on that short content near the top
                  // — so on tall screens they floated well above the window center.
                  "flex min-h-0 flex-1 flex-col",
              // Only the LEAF Space hexagon insets its content horizontally into the
              // shape's safe band. Kept small (px-[4%]) so the vertically centered
              // IN/OUT rails — which live at the hexagon's full-width mid-section —
              // sit close to its left/right edges. Expanded ancestor Spaces are
              // rectangles and fill normally.
              spaceLeafWindow && "px-[4%]",
            )}
          >
            <EntityBody
              entityId={entityId}
              active={isTop && !isClosing}
            />
          </div>
        )}
      </div>
    </div>
  )
}
