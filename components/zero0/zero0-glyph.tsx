import type { EntityKind } from "@/lib/zero/types"

// Self-contained, static SVG glyph per entity kind — the ontology's geometry drawn
// with plain SVG primitives so it renders identically on every platform/font (unlike
// Unicode shape chars, half of which JetBrains Mono lacks and silently font-swaps,
// breaking the mono grid). Deliberately NOT the orphaned `components/zero` GSAP
// `NodeGlyph`: zero0 owns no heavy UI deps and reads as raw, motionless DATA.
//
// All shapes live in a 24×24 box centred on (12,12), radius ~9, and paint with
// `currentColor` — OUTLINE (stroke, no fill) when open, FILLED when closed. A
// done-but-open completable gets a small check stroked over the outline.

// Polygon vertex strings (precomputed on a 24-unit box, pointy-top where relevant).
const HEXAGON = "12,3 19.8,7.5 19.8,16.5 12,21 4.2,16.5 4.2,7.5"
const PENTAGON = "12,3 20.6,9.2 17.3,19.3 6.7,19.3 3.4,9.2"
const DIAMOND = "12,3 21,12 12,21 3,12"
const TRIANGLE_UP = "12,4 20,19 4,19"
const TRIANGLE_DOWN = "12,20 20,5 4,5"

/** Draw the kind's outline shape. Fill/stroke are set by the caller via props. */
function KindShape({ kind }: { kind: EntityKind }) {
  switch (kind) {
    case "task":
      return <rect x="4.5" y="4.5" width="15" height="15" />
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
  filled,
  done,
  requested,
  className,
}: {
  kind: EntityKind
  /** Closed / lifecycle-ended ⇒ shape fills solid. */
  filled?: boolean
  /**
   * Completion mark — overlay a check on the shape. Drawn whether the shape is
   * open (outline) or closed (filled): on a filled shape the check is stroked in
   * the BACKGROUND colour so it stays legible against the solid silhouette. This
   * keeps the two ontology axes independent in the glyph — a done entity reads as
   * done even after it has also closed.
   */
  done?: boolean
  /** Task only: "sent as request" ⇒ a tilted flap swung off the bottom edge. */
  requested?: boolean
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <KindShape kind={kind} />
      {done && (
        <path
          d="M7.5 12.5 L10.5 15.5 L16.5 8.5"
          fill="none"
          stroke={filled ? "var(--background)" : "currentColor"}
          strokeWidth="1.8"
        />
      )}
      {requested && kind === "task" && (
        // The "sent" flap: a short edge swung DOWN off the square's bottom-right
        // corner — the request dispatched outward/below (mirror of the top version).
        <path d="M13 19.5 L20 22.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      )}
    </svg>
  )
}
