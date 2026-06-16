"use client"

import { useState, useLayoutEffect } from "react"
import { Check, X } from "lucide-react"
import { getEntity, getOpenTaskCount } from "@/lib/zero/data"
import type { TaskPriority } from "@/lib/zero/types"
import { useZeroNav, useRowSelection, HIGHLIGHT_SHADOW, HIGHLIGHT_SHADOW_NONE } from "@/lib/zero/nav-store"
import { HEADER_H, ANCESTOR_HEADER_H, clipFor } from "@/lib/zero/motion"
import { DURATION_S, MORPH_CSS_EASE } from "@/lib/zero/flip-stage"
import { NodeGlyph } from "./node-glyph"
import { EntityBody } from "./entity-body"
import { cn } from "@/lib/utils"

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
  const entity = getEntity(entityId)
  const region = variant === "dock" ? "dock" : "list"
  const { showHighlight, hoverProps, ref } = useRowSelection(region, entityId)
  const [done, setDone] = useState(!!entity?.completed)
  const [closeHover, setCloseHover] = useState(false)

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
  const slotClass = variant === "dock" ? "relative h-[64px] w-[112px] shrink-0" : "relative h-9 w-full"

  // Hover tint must NOT be live while the frame is a window or shrinking closed:
  // its translucent background would let parent content bleed through the moving
  // frame. Only a settled, collapsed node is interactive.
  const interactive = !asWindow && !isClosing

  // Clip-path shape. ONLY Spaces use clip-path (so they can morph hexagon ⇄
  // rectangle); tasks/events keep their rounded-rectangle `borderRadius` instead,
  // so their designed asymmetric corners are preserved. `clipPath` is undefined
  // for non-spaces, in which case the collapsed/window borderRadius applies.
  const clipPath = isSpace ? clipFor(kind, variant, asWindow) : undefined

  // Borderless design. No frames anywhere:
  //   - window / closing → solid surface (so parent content can't bleed through).
  //   - dock card        → faint resting fill that brightens on hover.
  //   - row              → no resting fill, hover highlight only.
  const frameClass = asWindow
    ? cn(
        "flex cursor-default flex-col overflow-hidden bg-card-solid shadow-2xl",
        fadingWindow && "pointer-events-none",
      )
    : cn(
        "absolute inset-0 flex cursor-pointer flex-col overflow-hidden transition-colors",
        variant === "dock" ? "bg-secondary/40 hover:bg-secondary" : "hover:bg-foreground/5",
        cancelled && "opacity-50",
      )

  // Space windows are hexagons: the header is CENTERED at the top (matching the
  // dock card's centered glyph+title, so the morph is a straight scale), pushed
  // DOWN below the hexagon's tapering top point into the safe band. Non-space
  // windows keep the left-aligned header.
  const headerClass = asWindow
    ? isSpace
      ? "relative z-10 flex shrink-0 flex-col items-center gap-1.5 px-4 pt-9"
      : cn("relative z-10 flex shrink-0 items-center gap-3 pr-12 pl-4")
    : variant === "dock"
      ? "flex flex-1 flex-col gap-1.5 px-2.5 py-2 pr-7"
      : "flex h-full items-center gap-2 px-2.5 pr-2.5"

  // ANCESTORS (open windows that are not the frontmost leaf — i.e. a dimmed Space
  // hexagon sitting behind an open child) wear a more compact header than the
  // frontmost leaf: a shorter band plus a smaller glyph + title, so depth reads
  // as recession. The leaf keeps the full treatment.
  const ancestorHeader = asWindow && !isTop && !isClosing
  // A Space hexagon reserves a tall top band so its centered header clears the
  // top point and the work-surface starts within the full-width mid-section.
  const headerH = isSpace
    ? ancestorHeader
      ? 64
      : 96
    : ancestorHeader
      ? ANCESTOR_HEADER_H
      : HEADER_H

  // Compact ancestor: 13px + dimmer (see className) so it recedes behind the
  // leaf. Leaf window: full 18px.
  const titleSize = asWindow ? (ancestorHeader ? 13 : 18) : variant === "dock" ? 12 : 13

  // The window's resting fixed geometry (top/left/width/height in viewport px).
  // Used both for the frame and to place the close-hover title just OUTSIDE the
  // frame's right edge (the frame is overflow-hidden, so an in-frame title there
  // would be clipped; a `fixed` title positioned from these numbers escapes it).
  const winStyle = asWindow ? (fadingWindow ? nav.fadingStyleFor(depth) : nav.styleFor(depth)) : null
  // Sit the title just past the X. The X is inset 6px (right-1.5) from the
  // window's right edge, so starting at edge − 2 places it ~4px right of the X's
  // right side — snug instead of floating off in the peek margin.
  const closeTitleLeft =
    winStyle && typeof winStyle.left === "number" && typeof winStyle.width === "number"
      ? winStyle.left + winStyle.width - 2
      : 0
  // Vertically center the title on the X. The cluster sits at top-3 (12px); the X
  // is size-6 (24px) tall.
  const closeTitleTop = winStyle && typeof winStyle.top === "number" ? winStyle.top + 12 + 12 : 0

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
        {...(interactive ? hoverProps : {})}
        style={
          asWindow
            ? // Spaces clip to a hexagon (no border radius); tasks/events keep the
              // asymmetric borderRadius supplied by winStyle.
              isSpace
              ? { ...(winStyle ?? {}), borderRadius: 0, clipPath }
              : (winStyle ?? undefined)
            : {
                // Collapsed: Space dock cards are hexagons (clipPath), everything
                // else a rounded rectangle.
                ...(clipPath ? { clipPath } : { borderRadius: 4 }),
                // While shrinking closed it is a row again, but Flip animates it
                // at full window size; lift it above sibling rows so parent
                // content can't bleed through until it lands in its slot.
                ...(isClosing ? { zIndex: 40 } : null),
                boxShadow: showHighlight ? HIGHLIGHT_SHADOW : HIGHLIGHT_SHADOW_NONE,
                transition: "box-shadow 0.18s ease-out",
              }
        }
        className={frameClass}
      >
        {/* Close button — fades only, never a flip target. On a Space hexagon it
            is pulled IN from the clipped top-right corner into the shape's safe
            band (matching the prototype's top-[14%] right-[14%]). */}
        {asWindow && (
          <div
            data-fade
            style={{ transitionDuration: DURATION_S }}
            className={cn(
              "absolute z-20 flex flex-col items-center gap-1",
              isSpace ? "right-[14%] top-[14%]" : "right-1.5 top-3",
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
            {/* Discreet entity title that fades in on close-button hover, so the
                user knows which entity they're about to close. Rendered HORIZONTAL
                and positioned to the RIGHT of the X (absolute, so it never shifts
                the button), cropped with an ellipsis if too long. Kept subtle: a
                lighter weight + dimmer color so it whispers rather than competes.
                Gated on `!animating`: when a window opens, the X mounts right under
                the cursor and `onPointerEnter` fires, which used to flash the title
                during the expansion. Suppressing it until the morph finishes means
                it only appears once the window has settled (and the pointer is
                genuinely resting on the X). */}
            <span
              style={{ left: closeTitleLeft, top: closeTitleTop, transform: "translateY(-50%)" }}
              className={cn(
                "pointer-events-none fixed z-[60] max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-normal text-muted-foreground/50 transition-opacity duration-200",
                closeHover && !animating ? "opacity-100" : "opacity-0",
              )}
            >
              {entity.title}
            </span>
          </div>
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
          // transform — the "down-then-up" hop seen when opening a window.
          style={asWindow ? { height: headerH } : undefined}
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
              // Leaf window keeps the full 20px glyph; compact ancestors (and
              // collapsed rows) use 16px. The size change is animated by GSAP
              // Flip (this glyph is a flip target captured in captureStage), so no
              // CSS transition here — that would double-animate against Flip.
              asWindow && !ancestorHeader ? "h-5 w-5" : "h-4 w-4",
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
              // Color-only transition (see glyph) so the title ink fades smoothly
              // to/from the dimmed ancestor grey rather than snapping. Flip handles
              // position + fontSize; this only animates color, so they don't fight.
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
            {entity.title}
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

          {/* Collapsed dock-card top-right stat. */}
          {!asWindow && !isClosing && variant === "dock" && (
            <span className="absolute right-2 top-2 flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <span className="font-medium tabular-nums">{openCount}</span>
              <span className="flex h-2.5 w-2.5 items-center justify-center">
                <NodeGlyph kind="task" strokeWidth={1.5} />
              </span>
            </span>
          )}
        </div>

        {/* Header divider — a dedicated fading element (not a CSS border) so it
            fades cleanly and slides as the header compacts, and fades out as the
            window collapses to a row. Hidden for Space hexagons (a hard rule
            across a hexagon's narrowing top reads as a stray clipped line). */}
        {(asWindow || isClosing) && !isSpace && (
          <span
            aria-hidden
            style={{ top: headerH, transitionDuration: DURATION_S, transitionTimingFunction: MORPH_CSS_EASE }}
            className={cn(
              // Fainter than full border (opacity-50) so the header separator is a
              // subtle hairline rather than a hard rule. `top` animates too so it
              // glides as a leaf's header compacts into an ancestor's shorter one.
              "pointer-events-none absolute left-0 right-0 z-[5] h-px bg-border transition-[top,opacity]",
              isClosing ? "opacity-0" : "opacity-50",
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
              // A Space window is hexagon-clipped, so its content is inset
              // horizontally into the shape's safe band (the left/right edges are
              // only full-width between 25%–75% height; padding keeps the columns
              // and IN/OUT rails clear of the angled top/bottom points).
              isSpace && !isClosing && "px-[8%]",
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
