"use client"

import { useLayoutEffect, useRef } from "react"
import gsap from "gsap"
import { cn } from "@/lib/utils"

/** The node kinds Zero can create, each with its own silhouette. */
export type NodeKind = "task" | "space" | "event" | "instant" | "resource" | "community"

export const NODE_KIND_META: Record<
  NodeKind,
  { label: string; description: string }
> = {
  task: { label: "Task", description: "A single thing to do" },
  space: { label: "Space", description: "A context that holds things" },
  resource: { label: "Resource", description: "A reference, tool, or material to draw on" },
  event: { label: "Event", description: "Something over a span of time" },
  instant: { label: "Instant", description: "Something at a precise moment" },
  community: { label: "Community", description: "A place to gather people and discussions" },
}

type Pt = [number, number]

/**
 * The CORNER vertices of each kind's silhouette, in a 24×24 box (matching the
 * crisp shapes the glyph used to draw as separate SVG primitives):
 *  - task      → square
 *  - space     → hexagon (scaled up ~8%, reads optically equal to the others)
 *  - resource  → diamond (the task square rotated 45°)
 *  - event     → triangle pointing up (a span)
 *  - instant   → triangle pointing down (a single point in time)
 *  - community → regular pentagon (a gathering)
 */
const KIND_CORNERS: Record<NodeKind, Pt[]> = {
  task: [
    [4.5, 4.5],
    [19.5, 4.5],
    [19.5, 19.5],
    [4.5, 19.5],
  ],
  space: [
    [12, 2.3],
    [20.6, 7.1],
    [20.6, 16.9],
    [12, 21.7],
    [3.4, 16.9],
    [3.4, 7.1],
  ],
  resource: [
    [12, 3.4],
    [20.6, 12],
    [12, 20.6],
    [3.4, 12],
  ],
  event: [
    [12, 4],
    [20.5, 19],
    [3.5, 19],
  ],
  instant: [
    [3.5, 5],
    [20.5, 5],
    [12, 20],
  ],
  community: [
    [12, 2],
    [21.5, 8.9],
    [17.9, 20.1],
    [6.1, 20.1],
    [2.5, 8.9],
  ],
}

// --- Equal-vertex resampling (the morph engine) ----------------------------
//
// Two polygons morph smoothly only when they have the SAME number of vertices in
// the SAME order, so each point can be lerped against its counterpart. We give
// every kind a canonical N-point representation by RADIAL sampling: from a shared
// center we cast N evenly-spaced rays and record where each one crosses the
// silhouette. Because all kinds are convex and share the center, point `i` sits at
// the same angle in every shape — so a square's top-EDGE midpoint maps to the
// hexagon's top APEX, and morphing task→space simply pushes that point up into the
// apex (and the corners slide in), which is exactly the elegant "square unfolds
// into a hexagon" motion. N=120 (3° steps) keeps every kind's corners effectively
// on a sample, so the resampled shapes stay crisp.
const GLYPH_CENTER: Pt = [12, 12]
const SAMPLES = 120

/** Ray/segment intersection: distance `t≥0` along ray (C + t·D) where it crosses
 *  segment A→B (param `u∈[0,1]`), or null. */
function rayHitT(cx: number, cy: number, dx: number, dy: number, a: Pt, b: Pt): number | null {
  const ex = b[0] - a[0]
  const ey = b[1] - a[1]
  const det = ex * dy - dx * ey
  if (Math.abs(det) < 1e-9) return null
  const t = (ex * (a[1] - cy) - ey * (a[0] - cx)) / det
  const u = (dx * (a[1] - cy) - dy * (a[0] - cx)) / det
  if (t >= -1e-6 && u >= -1e-6 && u <= 1 + 1e-6) return t
  return null
}

function resample(corners: Pt[]): Pt[] {
  const [cx, cy] = GLYPH_CENTER
  const out: Pt[] = []
  for (let i = 0; i < SAMPLES; i++) {
    const theta = (i / SAMPLES) * Math.PI * 2
    const dx = Math.cos(theta)
    const dy = Math.sin(theta)
    let best = Number.POSITIVE_INFINITY
    for (let j = 0; j < corners.length; j++) {
      const t = rayHitT(cx, cy, dx, dy, corners[j], corners[(j + 1) % corners.length])
      if (t != null && t > 1e-6 && t < best) best = t
    }
    if (!Number.isFinite(best)) best = 0
    out.push([cx + best * dx, cy + best * dy])
  }
  return out
}

/** Canonical equal-count polygon for each kind (precomputed once). */
const KIND_POLYGON: Record<NodeKind, Pt[]> = Object.fromEntries(
  (Object.keys(KIND_CORNERS) as NodeKind[]).map((k) => [k, resample(KIND_CORNERS[k])]),
) as Record<NodeKind, Pt[]>

const ptsToString = (pts: Pt[]) => pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ")

function lerpPolygons(a: Pt[], b: Pt[], t: number): Pt[] {
  return a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t] as Pt)
}

/** Glyph kind-morph timing — short and crisp (the window morph is far slower). */
const GLYPH_MORPH_SECONDS = 0.5
const GLYPH_MORPH_EASE = "power3.inOut"

// --- "Sent as request" edge ------------------------------------------------
//
// A task sent to someone ("Can you do this?") keeps its square but sprouts an
// extra edge of the SAME length as a square side, hinged at the square's
// bottom-right corner. At rest it overlaps the square's bottom edge; when sent it
// swings DOWN about the corner into a tilt — reading like an acute accent ´
// touching the corner. Un-sending is the exact reverse.
//
// CRUCIALLY it is NOT a standalone line: two separately-stroked edges meeting at a
// point can't fill the angular wedge between their caps, which left a notch/nub at
// the corner. Instead the accent is a single <path> that starts with a short STUB
// overlapping the square's RIGHT edge, turns AT the corner, then runs out to the
// swinging tip. That turn is a real stroke-linejoin (so the corner fills cleanly),
// and routing the stub along the right edge keeps the join angle gentle (45–90°),
// so the miter stays tiny instead of spiking. The stub sits exactly on the square's
// own right-edge stroke, so it is invisible.
const REQUEST_PIVOT: Pt = [19.5, 19.5] // square bottom-right corner (the hinge)
const REQUEST_STUB: Pt = [19.5, 13.5] // start of the incoming stub, on the right edge
const REQUEST_LEN = 15 // accent length = one square side
// Downward swing from the bottom edge when sent; the glyph SVG is overflow-visible
// so the lowered tip isn't clipped by the 24-box.
const REQUEST_ANGLE_DEG = 45

/** Path for the request accent at a given downward swing angle (deg, 0 = folded
 *  onto the bottom edge). Right-edge stub → corner → tip, so the corner is a clean
 *  linejoin. At angle 0 the whole path overlaps the square and is invisible. */
function requestAccentPath(angleDeg: number): string {
  const rad = (angleDeg * Math.PI) / 180
  const tipX = REQUEST_PIVOT[0] - REQUEST_LEN * Math.cos(rad)
  const tipY = REQUEST_PIVOT[1] + REQUEST_LEN * Math.sin(rad)
  return `M ${REQUEST_STUB[0]} ${REQUEST_STUB[1]} L ${REQUEST_PIVOT[0]} ${REQUEST_PIVOT[1]} L ${tipX.toFixed(3)} ${tipY.toFixed(3)}`
}

/**
 * A crisp geometric silhouette for a node kind, drawn as a single SVG `<polygon>`
 * whose vertices are the kind's canonical equal-count sampling. When `kind`
 * changes the polygon TWEENS its points to the new kind's shape, so e.g. a task
 * (square) elegantly unfolds into a space (hexagon) in place — used by the
 * "Change into…" action. Inherits color via `currentColor`; `filled` toggles
 * fill vs. outline.
 */
export function NodeGlyph({
  kind,
  className,
  filled = false,
  strokeWidth = 1.75,
  request = false,
}: {
  kind: NodeKind
  className?: string
  filled?: boolean
  strokeWidth?: number
  /** When true, draw the tilted "sent as request" edge off the square's
   *  bottom-right corner; animates in/out when this flips. */
  request?: boolean
}) {
  const polyRef = useRef<SVGPolygonElement | null>(null)
  const reqRef = useRef<SVGPathElement | null>(null)
  const prevReqRef = useRef<boolean>(request)
  // Current swing angle actually painted (so an interrupted swing resumes smoothly).
  const reqAngleRef = useRef<number>(request ? REQUEST_ANGLE_DEG : 0)
  const reqTweenRef = useRef<gsap.core.Tween | null>(null)
  // The points currently PAINTED (kept in sync each tween frame). Starting value
  // is the mount kind's shape, so the first render is correct with no animation.
  const dispRef = useRef<Pt[]>(KIND_POLYGON[kind])
  const prevKindRef = useRef<NodeKind>(kind)
  const tweenRef = useRef<gsap.core.Tween | null>(null)

  useLayoutEffect(() => {
    if (prevKindRef.current === kind) return
    // Morph from whatever is CURRENTLY painted (so interrupting a morph mid-way
    // continues smoothly from the live shape) to the new kind's polygon.
    const from = dispRef.current
    const to = KIND_POLYGON[kind]
    prevKindRef.current = kind
    tweenRef.current?.kill()
    const proxy = { t: 0 }
    tweenRef.current = gsap.to(proxy, {
      t: 1,
      duration: GLYPH_MORPH_SECONDS,
      ease: GLYPH_MORPH_EASE,
      onUpdate: () => {
        const cur = lerpPolygons(from, to, proxy.t)
        dispRef.current = cur
        polyRef.current?.setAttribute("points", ptsToString(cur))
      },
      onComplete: () => {
        dispRef.current = to
        polyRef.current?.setAttribute("points", ptsToString(to))
      },
    })
    return () => {
      tweenRef.current?.kill()
    }
  }, [kind])

  // Swing the "sent" edge in/out when `request` flips by tweening its angle and
  // rewriting the path `d` each frame (same pattern as the kind morph above). At
  // angle 0 the path folds onto the square and is invisible; the target is the full
  // downward swing. On the first render (no change) the resting state is set
  // instantly — useLayoutEffect runs before paint, so there is no flash.
  useLayoutEffect(() => {
    const path = reqRef.current
    if (!path) return
    const target = request ? REQUEST_ANGLE_DEG : 0
    const changed = prevReqRef.current !== request
    prevReqRef.current = request
    if (!changed) {
      reqAngleRef.current = target
      path.setAttribute("d", requestAccentPath(target))
      return
    }
    reqTweenRef.current?.kill()
    // Pin `d` to the CURRENT angle synchronously before the tween. React just
    // re-rendered the path's `d` at the DESTINATION angle, and gsap.to() doesn't
    // fire its first onUpdate until the next tick — so without this the destination
    // shape would paint for one frame (accent flashing already-swung on send, or the
    // bare square flashing on unsend). useLayoutEffect runs pre-paint, so this wins.
    path.setAttribute("d", requestAccentPath(reqAngleRef.current))
    const proxy = { a: reqAngleRef.current }
    reqTweenRef.current = gsap.to(proxy, {
      a: target,
      duration: GLYPH_MORPH_SECONDS,
      ease: GLYPH_MORPH_EASE,
      onUpdate: () => {
        reqAngleRef.current = proxy.a
        path.setAttribute("d", requestAccentPath(proxy.a))
      },
      onComplete: () => {
        reqAngleRef.current = target
        path.setAttribute("d", requestAccentPath(target))
      },
    })
    return () => {
      reqTweenRef.current?.kill()
    }
  }, [request])

  return (
    // overflow visible so the "sent" edge can sit just below the square's bottom
    // edge without the root SVG's default `overflow:hidden` clipping it. Every kind
    // silhouette stays inside the 24-box, so only the request edge uses it.
    <svg
      viewBox="0 0 24 24"
      className={cn("h-full w-full overflow-visible", className)}
      aria-hidden="true"
    >
      <polygon
        ref={polyRef}
        points={ptsToString(dispRef.current)}
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="miter"
        vectorEffect="non-scaling-stroke"
      />
      {/* "Sent as request" accent — a single path (right-edge stub → corner → tip)
          so the corner is a clean linejoin, not two clashing caps. `d` is driven by
          the effect above; at rest it folds onto the square and is invisible.
          fill="none" because open SVG paths default to a black fill. */}
      <path
        ref={reqRef}
        d={requestAccentPath(request ? REQUEST_ANGLE_DEG : 0)}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="miter"
        strokeLinecap="butt"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
