"use client"

import { useState } from "react"
import { Check, X } from "lucide-react"
import { getEntity, getOpenTaskCount, getSpace } from "@/lib/zero/data"
import type { TaskPriority } from "@/lib/zero/types"
import { useZeroNav, useRowSelection, HIGHLIGHT_SHADOW, HIGHLIGHT_SHADOW_NONE } from "@/lib/zero/nav-store"
import { HEADER_H } from "@/lib/zero/motion"
import { DURATION_S } from "@/lib/zero/flip-stage"
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
  variant,
  onContextMenu,
}: {
  entityId: string
  variant: "row" | "dock"
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const nav = useZeroNav()
  const entity = getEntity(entityId)
  const region = variant === "dock" ? "dock" : "list"
  const { showHighlight, hoverProps, ref } = useRowSelection(region, entityId)
  const [done, setDone] = useState(!!entity?.completed)

  if (!entity) return null

  const kind = entity.kind
  const isTask = kind === "task"
  const isSpace = kind === "space"

  const open = nav.stack.includes(entityId)
  const isClosing = nav.closing?.id === entityId
  const fadingEntry = nav.fading.find((f) => f.id === entityId)
  const fadingWindow = !!fadingEntry
  // Render as a window when open OR while telescoping out during a multi-level
  // close (so it keeps covering its parent's do-list as it retracts).
  const asWindow = open || fadingWindow
  const spine = nav.isSpine(entityId)
  const isTop = nav.activeId === entityId
  const animating = nav.animating
  const showBody = asWindow || isClosing

  const depth = open
    ? nav.stack.indexOf(entityId)
    : fadingWindow
      ? fadingEntry!.depth
      : isClosing
        ? nav.closing!.depth
        : 0

  const parentId = entity.parentId ?? "s_root"
  // Accent tint: a space uses its own; everything else inherits its home space's.
  const homeSpaceId = isSpace ? entityId : parentId
  const accent = isSpace ? entity.accent ?? "var(--muted-foreground)" : getSpace(homeSpaceId)?.accent ?? null
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
  const hoverCls = interactive ? "transition-colors hover:bg-foreground/5" : ""

  const frameClass = asWindow
    ? cn(
        "flex cursor-default flex-col overflow-hidden border border-border bg-card-solid shadow-2xl",
        fadingWindow && "pointer-events-none",
      )
    : cn(
        "absolute inset-0 flex cursor-pointer flex-col overflow-hidden border border-border bg-card-solid",
        cancelled && "opacity-50",
        hoverCls,
      )

  const headerClass = spine
    ? "absolute inset-y-0 left-[3px] z-10 flex w-14 flex-col items-center gap-7 pt-4"
    : asWindow
      ? "relative z-10 flex shrink-0 items-center gap-3 pl-5 pr-12"
      : variant === "dock"
        ? "flex flex-1 flex-col gap-1.5 px-2.5 py-2 pr-7"
        : "flex h-full items-center gap-2 px-2.5 pr-2.5"

  const titleSize = spine ? 15 : asWindow ? 18 : variant === "dock" ? 12 : 13

  return (
    <div className={slotClass}>
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        data-window={entityId}
        data-depth={depth}
        data-flip-id={`${entityId}-frame`}
        data-flip-role="frame"
        role="button"
        aria-label={asWindow ? undefined : `Open ${entity.title}`}
        onClick={onFrameClick}
        onContextMenu={onContextMenu}
        {...(interactive ? hoverProps : {})}
        style={
          asWindow
            ? fadingWindow
              ? nav.fadingStyleFor(depth)
              : nav.styleFor(depth)
            : {
                borderRadius: 4,
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
        {/* Accent strip — full-height, tracks the frame for free. */}
        {accent && (
          <span className="absolute left-0 top-0 z-10 h-full w-[3px]" style={{ backgroundColor: accent }} />
        )}

        {/* Spine background — a fixed-geometry opaque left rail that fades in when
            this space becomes a spine and out when it un-spines, independent of
            the header's layout box (prevents the close-time cover-up bug). */}
        {asWindow && (
          <span
            aria-hidden
            style={{ transitionDuration: DURATION_S }}
            className={cn(
              "pointer-events-none absolute inset-y-0 left-[3px] z-[8] w-14 bg-card-solid transition-opacity ease-out",
              spine ? "opacity-100" : "opacity-0",
            )}
          />
        )}

        {/* Close button — fades only, never a flip target; tucks tighter when
            this space is a spine so the child window never crops it. */}
        {asWindow && (
          <button
            type="button"
            data-fade
            onClick={(e) => {
              e.stopPropagation()
              nav.closeWindow(depth)
            }}
            aria-label={`Close ${entity.title}`}
            style={{ transitionDuration: DURATION_S }}
            className={cn(
              "absolute z-20 flex size-6 items-center justify-center rounded-[4px] text-muted-foreground transition-all ease-out hover:bg-foreground/5 hover:text-foreground",
              spine ? "right-1 top-1" : "right-3 top-3",
            )}
          >
            <X size={16} />
          </button>
        )}

        {/* Persistent header. NOT a flip target: it stays in the frame's flow and
            switches layout between collapsed row/card, window header, and spine.
            The glyph + title (which ARE flipped) glide on top. */}
        <div className={headerClass} style={asWindow && !spine ? { height: HEADER_H } : undefined}>
          {/* Glyph — for a collapsed task it doubles as the completion toggle. */}
          <span
            data-flip-id={`${entityId}-glyph`}
            data-flip-role="inner"
            onClick={
              interactive && isTask
                ? (e) => {
                    e.stopPropagation()
                    setDone((d) => !d)
                  }
                : undefined
            }
            className={cn(
              "relative flex shrink-0 items-center justify-center text-foreground",
              asWindow ? "h-5 w-5" : "h-4 w-4",
            )}
          >
            <NodeGlyph kind={kind} filled={isTask && done} strokeWidth={asWindow ? 1.75 : isTask ? 2 : 1.75} />
            {!asWindow && isTask && done && (
              <Check className="absolute h-2.5 w-2.5 text-background" strokeWidth={3.5} />
            )}
          </span>

          <h3
            data-flip-id={`${entityId}-title`}
            data-flip-role="inner"
            style={{
              fontSize: titleSize,
              transform: spine ? "rotate(-90deg)" : undefined,
              transformOrigin: "center",
            }}
            className={cn(
              "relative tracking-tight",
              spine
                ? "whitespace-nowrap font-semibold"
                : asWindow
                  ? "whitespace-nowrap font-semibold"
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
            fades between window header and spine instead of jumping, and fades
            out as the window collapses to a row. */}
        {(asWindow || isClosing) && (
          <span
            aria-hidden
            style={{ top: HEADER_H, transitionDuration: DURATION_S }}
            className={cn(
              "pointer-events-none absolute left-0 right-0 z-[5] h-px bg-border transition-opacity ease-out",
              spine || isClosing ? "opacity-0" : "opacity-100",
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
                : spine
                  ? "min-h-0 flex-1 pl-10"
                  : "min-h-0 flex-1",
            )}
          >
            <EntityBody entityId={entityId} active={isTop && !isClosing} />
          </div>
        )}
      </div>
    </div>
  )
}
