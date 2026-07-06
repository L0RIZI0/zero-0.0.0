"use client"

import { useId, useLayoutEffect, useRef } from "react"
import gsap from "gsap"
import { cn } from "@/lib/utils"
import type { EntityKind } from "@/lib/zero/types"
import { KIND_META } from "@/lib/zero/kinds"

/**
 * The node kinds Zero can draw — identical to the domain {@link EntityKind} union
 * (every entity is a Space, and each kind has its own silhouette). Kept as an
 * alias so glyph callers don't all need to import from the domain types.
 */
export type NodeKind = EntityKind

/**
 * Label + description per kind. DERIVED from the single source of truth
 * {@link KIND_META} (`lib/zero/kinds.ts`) so the glyph, do-list, and Zero Entities
 * page never drift. Kept as a named export for existing consumers.
 */
export const NODE_KIND_META: Record<NodeKind, { label: string; description: string }> =
  Object.fromEntries(
    (Object.keys(KIND_META) as NodeKind[]).map((k) => [
      k,
      { label: KIND_META[k].label, description: KIND_META[k].description },
    ]),
  ) as Record<NodeKind, { label: string; description: string }>

type Pt = [number, number]

/** A regular N-gon centered in the 24-box. High N approximates a circle; a small
 *  radius makes a dot. Phase −90° puts the first vertex at top (cosmetic only,
 *  since the morph engine radially resamples every shape anyway). */
function regularPolygon(n: number, r: number, cx = 12, cy = 12, phase = -Math.PI / 2): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

/**
 * The CORNER vertices of each kind's silhouette, in a 24×24 box (matching the
 * crisp shapes the glyph used to draw as separate SVG primitives):
 *  - task         → square
 *  - space        → hexagon (scaled up ~8%, reads optically equal to the others)
 *  - resource     → diamond (the task square rotated 45°)
 *  - event        → triangle pointing up (a span)
 *  - instant      → triangle pointing down (a single point in time)
 *  - community    → regular pentagon (a gathering)
 *  - organism     → circle (a 48-gon — a living entity in Society; entity0 is one)
 *  - individual   → a "Z" rotated 45° anticlockwise. The Z is a non-convex stroke
 *      letterform the radial morph engine can't represent, so it is drawn as a
 *      separate <path> (see INDIVIDUAL_Z_PATH) and CROSSFADED over the polygon.
 *      Its polygon slot here is a circle so morphs into/out of `individual` are
 *      graceful (the disc fades out as the Z fades in, and vice-versa).
 *  - soul         → a dot (a small filled disc — the irreducible core self)
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
  // Circle — a living entity in Society (a body, a company, …).
  organism: regularPolygon(48, 9.7),
  // Morph fallback for the Z (the visible Z is a stroke path, see below). Same
  // disc as organism so individual↔other morphs read as a circle crossfading
  // under the Z.
  individual: regularPolygon(48, 9.7),
  // Small disc → reads as a filled dot.
  soul: regularPolygon(32, 3.4),
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

/** Glyph kind-morph timing — short and crisp (the window morph is far slower).
 *  Exported so EntityNode can reveal the inner checkmark (drawn OVER the glyph) only
 *  once the silhouette has finished morphing INTO the task square, rather than
 *  popping it in the instant `kind` flips. */
export const GLYPH_MORPH_SECONDS = 0.5
const GLYPH_MORPH_EASE = "power3.inOut"

/** Completion FILL timing — a subtle wipe that slides in from the left. Exported so
 *  the inner checkmark (drawn by EntityNode, OVER the glyph) can fade its color from
 *  ink→background in lockstep with this wipe. */
export const GLYPH_FILL_SECONDS = 0.4
const GLYPH_FILL_EASE = "power2.inOut"
// The 24-box width the reveal rect sweeps across (plus a hair of slack so the
// right edge's stroke is fully covered at 100%).
const GLYPH_FILL_W = 24

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

// --- Individual "Z" glyph ---------------------------------------------------
//
// The Individual's mark is a capital Z rotated 45° ANTICLOCKWISE. A Z is a
// non-convex stroke letterform, so — unlike the convex silhouettes — it cannot be
// radially resampled into the polygon morph engine. Instead it is a fixed <path>
// that CROSSFADES (opacity) against the polygon disc whenever the kind is, or is
// becoming, `individual`. Authored upright in the 24-box (top bar → diagonal →
// bottom bar) and rotated −45° about the center at render time; in SVG's y-down
// space a negative rotation reads as anticlockwise.
const INDIVIDUAL_Z_PATH = "M 6 6.5 L 18 6.5 L 6 17.5 L 18 17.5"
const INDIVIDUAL_Z_ROTATE = "rotate(-45 12 12)"

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
  showCheck = false,
  struck = false,
}: {
  kind: NodeKind
  className?: string
  filled?: boolean
  strokeWidth?: number
  /** When true, draw the tilted "sent as request" edge off the square's
   *  bottom-right corner; animates in/out when this flips. */
  request?: boolean
  /** When true, draw a static done CHECK tick inside the glyph (used by the
   *  read-only spine excerpt to distinguish done-but-not-closed tasks). This is a
   *  simple non-animated overlay — the animated checkmark on live rows/windows
   *  lives in entity-node. */
  showCheck?: boolean
  /** When true, draw a static horizontal STRIKETHROUGH bar across the glyph's
   *  middle — the excerpt's mark for a CANCELLED tally, echoing the line-through
   *  used on cancelled titles elsewhere. Non-animated, like showCheck. */
  struck?: boolean
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
  // The Individual's "Z" stroke and the disc crossfade against each other: the Z
  // is opaque only when the kind is `individual`, the polygon disc only when it
  // isn't. These refs hold the CURRENTLY painted opacity so an interrupted morph
  // resumes smoothly (same pattern as dispRef for points).
  const zRef = useRef<SVGPathElement | null>(null)
  const polyOpacityRef = useRef<number>(kind === "individual" ? 0 : 1)
  const zOpacityRef = useRef<number>(kind === "individual" ? 1 : 0)

  // --- Completion fill (left→right wipe) ------------------------------------
  // The fill is a SECOND polygon (identical points to the outline) painted solid
  // and revealed through a clip-rect that grows from the left. When `filled` flips
  // we tween the rect's width 0↔24 so the ink slides in/out horizontally. Soul is
  // always solid, so its rect stays full. A per-instance clip id avoids collisions.
  const clipId = useId().replace(/:/g, "")
  const fillRef = useRef<SVGPolygonElement | null>(null)
  const clipRectRef = useRef<SVGRectElement | null>(null)
  const fillWidthRef = useRef<number>(filled || kind === "soul" ? GLYPH_FILL_W : 0)
  const prevFilledRef = useRef<boolean>(filled)
  const fillTweenRef = useRef<gsap.core.Tween | null>(null)

  useLayoutEffect(() => {
    if (prevKindRef.current === kind) return
    // Morph from whatever is CURRENTLY painted (so interrupting a morph mid-way
    // continues smoothly from the live shape) to the new kind's polygon.
    const from = dispRef.current
    const to = KIND_POLYGON[kind]
    prevKindRef.current = kind
    tweenRef.current?.kill()
    // Crossfade endpoints: the Z owns the frame only for `individual`.
    const fromPolyOp = polyOpacityRef.current
    const toPolyOp = kind === "individual" ? 0 : 1
    const fromZOp = zOpacityRef.current
    const toZOp = kind === "individual" ? 1 : 0
    const proxy = { t: 0 }
    tweenRef.current = gsap.to(proxy, {
      t: 1,
      duration: GLYPH_MORPH_SECONDS,
      ease: GLYPH_MORPH_EASE,
      onUpdate: () => {
        const cur = lerpPolygons(from, to, proxy.t)
        dispRef.current = cur
        const s = ptsToString(cur)
        polyRef.current?.setAttribute("points", s)
        // The fill layer tracks the same morphing silhouette.
        fillRef.current?.setAttribute("points", s)
        const po = fromPolyOp + (toPolyOp - fromPolyOp) * proxy.t
        polyOpacityRef.current = po
        polyRef.current?.setAttribute("opacity", String(po))
        fillRef.current?.setAttribute("opacity", String(po))
        const zo = fromZOp + (toZOp - fromZOp) * proxy.t
        zOpacityRef.current = zo
        zRef.current?.setAttribute("opacity", String(zo))
      },
      onComplete: () => {
        dispRef.current = to
        const s = ptsToString(to)
        polyRef.current?.setAttribute("points", s)
        fillRef.current?.setAttribute("points", s)
        polyOpacityRef.current = toPolyOp
        polyRef.current?.setAttribute("opacity", String(toPolyOp))
        fillRef.current?.setAttribute("opacity", String(toPolyOp))
        zOpacityRef.current = toZOp
        zRef.current?.setAttribute("opacity", String(toZOp))
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
      // Folded onto the edges (angle 0) ⇒ hide, so the double-stroke can't show.
      path.setAttribute("opacity", request ? "1" : "0")
      return
    }
    reqTweenRef.current?.kill()
    // Opaque for the whole swing (whether sending or un-sending) so the edge is
    // visible as it travels; the onComplete below re-hides it if it folded back.
    path.setAttribute("opacity", "1")
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
        // Settle: an un-sent accent folds back onto the edges → hide it again.
        path.setAttribute("opacity", request ? "1" : "0")
      },
    })
    return () => {
      reqTweenRef.current?.kill()
    }
  }, [request])

  // Slide the completion fill in/out when `filled` flips by tweening the clip-rect
  // width (0 = empty, 24 = full), so the ink wipes left→right. Same interrupt-safe
  // pattern as the morph/request effects: pin the current width synchronously
  // pre-paint, then tween. Soul is always solid (rect pinned full, never animates).
  useLayoutEffect(() => {
    const rect = clipRectRef.current
    if (!rect) return
    if (kind === "soul") {
      fillWidthRef.current = GLYPH_FILL_W
      rect.setAttribute("width", String(GLYPH_FILL_W))
      return
    }
    const target = filled ? GLYPH_FILL_W : 0
    const changed = prevFilledRef.current !== filled
    prevFilledRef.current = filled
    if (!changed) {
      // No flip (mount, or a re-render for another reason): set instantly, no wipe.
      fillWidthRef.current = target
      rect.setAttribute("width", String(target))
      return
    }
    fillTweenRef.current?.kill()
    // Pin to the CURRENTLY painted width before the tween's first tick.
    rect.setAttribute("width", String(fillWidthRef.current))
    const proxy = { w: fillWidthRef.current }
    fillTweenRef.current = gsap.to(proxy, {
      w: target,
      duration: GLYPH_FILL_SECONDS,
      ease: GLYPH_FILL_EASE,
      onUpdate: () => {
        fillWidthRef.current = proxy.w
        rect.setAttribute("width", String(proxy.w))
      },
      onComplete: () => {
        fillWidthRef.current = target
        rect.setAttribute("width", String(target))
      },
    })
    return () => {
      fillTweenRef.current?.kill()
    }
  }, [filled, kind])

  return (
    // overflow visible so the "sent" edge can sit just below the square's bottom
    // edge without the root SVG's default `overflow:hidden` clipping it. Every kind
    // silhouette stays inside the 24-box, so only the request edge uses it.
    <svg
      viewBox="0 0 24 24"
      className={cn("h-full w-full overflow-visible", className)}
      aria-hidden="true"
    >
      {/* Left→right reveal mask for the completion fill. The rect's width is driven
          by the fill effect above (0 = empty, 24 = full). */}
      <defs>
        <clipPath id={clipId}>
          <rect
            ref={clipRectRef}
            x="0"
            y="0"
            height="24"
            width={filled || kind === "soul" ? GLYPH_FILL_W : 0}
          />
        </clipPath>
      </defs>
      {/* FILL layer — solid silhouette, revealed through the wipe clip. Tracks the
          outline's points/opacity during a kind morph (synced in the effect). */}
      <polygon
        ref={fillRef}
        points={ptsToString(dispRef.current)}
        fill="currentColor"
        stroke="none"
        clipPath={`url(#${clipId})`}
        opacity={kind === "individual" ? 0 : 1}
      />
      {/* OUTLINE layer — always the bare silhouette stroke (never self-fills, so the
          wipe above is the only thing that paints the interior). */}
      <polygon
        ref={polyRef}
        points={ptsToString(dispRef.current)}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="miter"
        vectorEffect="non-scaling-stroke"
        // Initial crossfade state (mount): the disc is hidden only for `individual`.
        opacity={kind === "individual" ? 0 : 1}
      />
      {/* Individual "Z" — a non-morphing stroke letterform rotated 45° anticlockwise,
          crossfaded against the disc above (opacity driven by the morph effect). It
          is always present in the DOM so a morph into/out of `individual` can fade it;
          at rest on other kinds its opacity is 0. */}
      <path
        ref={zRef}
        d={INDIVIDUAL_Z_PATH}
        transform={INDIVIDUAL_Z_ROTATE}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        opacity={kind === "individual" ? 1 : 0}
      />
      {/* "Sent as request" accent — a single path (right-edge stub → corner → tip)
          so the corner is a clean linejoin, not two clashing caps. `d` is driven by
          the effect above; at rest it folds onto the square and is invisible.
          fill="none" because open SVG paths default to a black fill.

          ONLY rendered for the square (task) kind: the accent's resting geometry lies
          on the square's right/bottom edges, so on any other silhouette (hexagon,
          diamond, triangle…) it would show as a stray stroke. Requests are task-only
          anyway, so gating here is both the bug fix and the correct semantics.

          OPACITY GATE: at rest-and-unsent the accent folds exactly onto the square's
          lower-right + bottom edges. Two coincident strokes DON'T cancel — they render
          darker/thicker, which showed as a stray bold "L" on the square's bottom+right
          (visible on every task glyph, e.g. the counter square). So the accent is only
          opaque while it has swung OFF the edges: opacity 0 when folded (request=false
          at rest), 1 while sent or mid-swing. Driven by the effect below. */}
      {kind === "task" && (
        <path
          ref={reqRef}
          d={requestAccentPath(request ? REQUEST_ANGLE_DEG : 0)}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinejoin="miter"
          strokeLinecap="butt"
          vectorEffect="non-scaling-stroke"
          opacity={request ? 1 : 0}
        />
      )}
      {/* Static done CHECK — a plain tick centered in the 24×24 box. Non-animated;
          used by the spine excerpt's "done" counter (see showCheck doc above). */}
      {showCheck && (
        <polyline
          points="7,12.5 10.5,16 17,8"
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {/* Static STRIKETHROUGH — a horizontal bar across the glyph's middle for a
          cancelled entity (mirrors the cancelled-title line-through). The tips
          overshoot the square (which spans x 4.5–19.5) to x 1.5 / 22.5 so they
          stay visible on either side even when the glyph is FILLED (the bar and
          fill share currentColor, so the interior stretch would otherwise vanish).
          Non-animated, like the check above. */}
      {struck && (
        <line
          x1="1.5"
          y1="12"
          x2="22.5"
          y2="12"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}
