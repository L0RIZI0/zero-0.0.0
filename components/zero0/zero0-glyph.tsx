import type { EntityKind } from "@/lib/zero/types"

// Self-contained, static SVG glyph per entity kind — the ontology's geometry drawn
// with plain SVG primitives so it renders identically on every platform/font (unlike
// Unicode shape chars, half of which JetBrains Mono lacks and silently font-swaps,
// breaking the mono grid). Deliberately NOT the orphaned `components/zero` GSAP
// `NodeGlyph`: zero0 owns no heavy UI deps and reads as raw, motionless DATA.
//
// All shapes live in a 24×24 box centred on (12,12), radius ~9, and paint with
// `currentColor` — OUTLINE (stroke, no fill) by default, FILLED only when COMPLETE
// (the success verdict). A DONE entity gets a check overlay; a CANCELLED one gets a
// bar laid over whatever state it had. Plain "closed" does NOT change the glyph (the
// row fades instead) — fill is reserved for complete.

// Polygon vertex strings (precomputed on a 24-unit box, pointy-top where relevant).
const HEXAGON = "12,3 19.8,7.5 19.8,16.5 12,21 4.2,16.5 4.2,7.5"
const PENTAGON = "12,3 20.6,9.2 17.3,19.3 6.7,19.3 3.4,9.2"
const DIAMOND = "12,3 21,12 12,21 3,12"
const TRIANGLE_UP = "12,4 20,19 4,19"
const TRIANGLE_DOWN = "12,20 20,5 4,5"

/** Draw the kind's outline shape. Fill/stroke are set by the caller via props. */
function KindShape({ kind, requested }: { kind: EntityKind; requested?: boolean }) {
  switch (kind) {
    case "task":
      // A "sent as request" task hangs a diagonal flag/leg off its bottom-right
      // CORNER, pointing DOWN-LEFT to a tip (like a "9" descender). The right + left
      // edges stay put; the bottom edge runs from the left corner to where the flag
      // attaches, the flag dips below to the tip, then climbs back to the corner. ONE
      // continuous silhouette (so it fills solid when complete), not a detached stroke.
      return requested ? (
        <path d="M4.5,4.5 L19.5,4.5 L19.5,19.5 L11,23 L14,19.5 L4.5,19.5 Z" />
      ) : (
        <rect x="4.5" y="4.5" width="15" height="15" />
      )
    case "space":
      return <polygon points={HEXAGON} />
    case "resource":
      return <polygon points={DIAMOND} />
    case "moment":
      return <polygon points={TRIANGLE_UP} />
    case "instant":
      return <polygon points={TRIANGLE_DOWN} />
    case "community":
      return <polygon points={PENTAGON} />
    case "organism":
      return <circle cx="12" cy="12" r="9" />
    case "individual":
      // Diamond with a centre dot — the animating "citizen" mark.
      return (
        <>
          <polygon points={DIAMOND} />
          <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
        </>
      )
    case "soul":
      // A bare dot — always solid, the smallest essence.
      return <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
    default:
      return null
  }
}

export function Zero0Glyph({
  kind,
  complete,
  done,
  cancelled,
  requested,
  className,
}: {
  kind: EntityKind
  /**
   * COMPLETE (the success verdict) ⇒ the shape FILLS solid. This is the ONLY thing
   * that fills — a plain "closed" entity keeps its outline (the row fades instead).
   */
  complete?: boolean
  /**
   * DONE mark — overlay a check on the shape. Drawn whether the shape is outline or
   * filled: on a filled (complete) shape the check strokes in the BACKGROUND colour
   * so it stays legible. Independent of complete — a done entity reads as done.
   */
  done?: boolean
  /**
   * CANCELLED ⇒ a horizontal BAR laid over the glyph's prior state (outline OR
   * filled). Drawn with a background-coloured casing beneath so it reads on both a
   * filled silhouette and an outline. The shape underneath is whatever it was before
   * cancel, so a completed-then-cancelled glyph stays filled + barred.
   */
  cancelled?: boolean
  /** Task only: "sent as request" ⇒ the square's bottom-right corner is drawn as a
   *  pennant/tail (an integral part of the silhouette, so it fills when complete). */
  requested?: boolean
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={complete ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={complete ? 0 : 1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <KindShape kind={kind} requested={requested && kind === "task"} />
      {done && (
        <path
          d="M7.5 12.5 L10.5 15.5 L16.5 8.5"
          fill="none"
          stroke={complete ? "var(--background)" : "currentColor"}
          strokeWidth="1.8"
        />
      )}
      {cancelled && (
        // The "called-off" bar, laid across the whole box (extends past the shape so
        // its ends read even on a filled silhouette). Background casing first, then
        // the bar on top.
        <>
          <line x1="3" y1="12" x2="21" y2="12" stroke="var(--background)" strokeWidth="3.4" />
          <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.8" />
        </>
      )}
    </svg>
  )
}
