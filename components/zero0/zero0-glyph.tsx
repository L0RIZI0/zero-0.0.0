"use client"

import { useEffect, useRef, useState } from "react"
import type { EntityKind } from "@/lib/zero/types"

// ONGOING spin cadence. SPIN_MS = one full turn (calm, ambient). EASE_MS = how long the
// angular velocity takes to ramp IN at start and to settle OUT (decelerate to upright) at
// stop, so the motion never snaps on or off.
const SPIN_MS = 2345
const EASE_MS = 650
/** Standalone fill-flash duration (no rotation) — a brief "state just switched" pulse where the
 *  glyph fills to 100% then relaxes back to outline. Used by the §4 notification chip on entry. */
const FLASH_MS = 720
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3)

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
// HEXAGON is drawn LARGER than its bounding-box-equal peers (circumradius ~10.4 vs the
// square's 7.5 half-width): a regular hexagon reads optically SMALLER than a square of the
// same width because its corners are cut, so it's scaled up ~15% to appear at least as big
// as the Task square in the ENTITY CONTENT row grid.
const HEXAGON = "12,1.6 21.01,6.8 21.01,17.2 12,22.4 2.99,17.2 2.99,6.8"
const PENTAGON = "12,3 20.6,9.2 17.3,19.3 6.7,19.3 3.4,9.2"
const DIAMOND = "12,3 21,12 12,21 3,12"
const TRIANGLE_UP = "12,4 20,19 4,19"
const TRIANGLE_DOWN = "12,20 20,5 4,5"
const SQUARE = "4.5,4.5 19.5,4.5 19.5,19.5 4.5,19.5"

// ── GLYPH MORPHING (dep-free) ────────────────────────────────────────────────────────────────
// We morph one convex kind-shape into another WITHOUT a tweening lib by sampling each silhouette
// as a RADIAL signature: for N equally-spaced angles (from 12-o'clock, clockwise) we cast a ray
// from the box centre (12,12) and record the distance to the boundary. Morphing is then a plain
// element-wise lerp of two radius arrays — always TOP-ALIGNED (index 0 = straight up for every
// shape) so a hexagon melts into a square without spinning to realign. Corners are approximated
// (a vertex between two angular samples is slightly cut), so this sampled polygon is used ONLY
// while a morph is ACTIVE — the static glyph still renders the crisp `KindShape`, pixel-identical.
const MORPH_N = 48
const CX = 12
const CY = 12

// Distance from (CX,CY) along unit dir (dx,dy) to the first edge of a convex vertex loop.
function rayHit(verts: number[][], dx: number, dy: number): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < verts.length; i++) {
    const [x1, y1] = verts[i]
    const [x2, y2] = verts[(i + 1) % verts.length]
    const ex = x2 - x1
    const ey = y2 - y1
    const det = dx * -ey - -ex * dy // = ex*dy - ey*dx
    if (Math.abs(det) < 1e-9) continue
    const rx = x1 - CX
    const ry = y1 - CY
    const t = (rx * -ey - -ex * ry) / det // ray distance
    const s = (dx * ry - dy * rx) / det // segment param
    if (t > 1e-6 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, t)
  }
  return best === Number.POSITIVE_INFINITY ? 0 : best
}

function radiiFromVerts(verts: number[][]): number[] {
  const out: number[] = []
  for (let i = 0; i < MORPH_N; i++) {
    const th = (i / MORPH_N) * Math.PI * 2
    out.push(rayHit(verts, Math.sin(th), -Math.cos(th)))
  }
  return out
}

const parseVerts = (pts: string): number[][] => pts.trim().split(/\s+/).map((p) => p.split(",").map(Number))

// The MORPHABLE kinds map to a radial signature; others (individual "Z" open stroke, soul dot,
// requested-task pennant) have no clean radial form and simply SWAP without a morph.
const RADII: Partial<Record<EntityKind, number[]>> = {
  task: radiiFromVerts(parseVerts(SQUARE)),
  space: radiiFromVerts(parseVerts(HEXAGON)),
  resource: radiiFromVerts(parseVerts(DIAMOND)),
  moment: radiiFromVerts(parseVerts(TRIANGLE_UP)),
  instant: radiiFromVerts(parseVerts(TRIANGLE_DOWN)),
  community: radiiFromVerts(parseVerts(PENTAGON)),
  organism: Array.from({ length: MORPH_N }, () => 9), // circle ⇒ constant radius
}
const SQUARE_RADII = RADII.task as number[]

function buildPoints(radii: number[]): string {
  let s = ""
  for (let i = 0; i < radii.length; i++) {
    const th = (i / radii.length) * Math.PI * 2
    const x = CX + Math.sin(th) * radii[i]
    const y = CY - Math.cos(th) * radii[i]
    s += `${x.toFixed(2)},${y.toFixed(2)} `
  }
  return s.trim()
}

const lerpRadii = (a: number[], b: number[], f: number): number[] => a.map((v, i) => v + (b[i] - v) * f)
const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2)

// One full morph turn for the SPACE periodic hexagon→square→hexagon flourish, and how long a turn.
const MORPH_MS = 380 // one-shot kind-change morph duration
const SPACE_MORPH_PERIOD_MS = 1345 // gap between space flourishes (v0.6.6: one flourish every 1.345s)
// Fraction of the period in the there-and-back dip. The dip is a symmetric `sin(x·π)` pulse, so
// hex→square and square→hex take EXACTLY equal time (each half the dip). Tuned so the dip duration
// holds ~steady (~915ms) despite the shorter period.
const SPACE_MORPH_PULSE = 0.68
// The peak of the SPACE flourish morphs toward a SUBTLY smaller square than the real task-square
// (v0.6.6): scale the square's radii about the box centre so the flourish "pinches in" just a touch
// rather than hitting the full-size square. Only used for the periodic space dip — the crisp task
// glyph and kind-change morphs still use the true SQUARE_RADII. (0.95 = barely smaller than full;
// 0.9 was ~2px too small, 0.68 read as far too small.)
const SPACE_MORPH_SQUARE_SCALE = 0.95
const SPACE_MORPH_SQUARE_RADII = SQUARE_RADII.map((r) => r * SPACE_MORPH_SQUARE_SCALE)

/** Draw the kind's outline shape. Fill/stroke are set by the caller via props. */
function KindShape({ kind, requested }: { kind: EntityKind; requested?: boolean }) {
  switch (kind) {
    case "entity":
      // The raw Idea — an "add" CROSS with a genuinely EMPTY center (like ✜): FOUR separate arms
      // that stop short of the middle, leaving a hollow square gap at the core. No enclosed
      // silhouette (so it never fills). The open, un-closed center reads as "not yet shaped" — it
      // can still become any specialized kind. Drawn as bare strokes, never filled.
      return (
        <path
          d="M12 4 L12 9.5 M12 14.5 L12 20 M4 12 L9.5 12 M14.5 12 L20 12"
          fill="none"
        />
      )
    case "task":
      // A "sent as request" task hangs a diagonal flag/leg off its bottom-right
      // CORNER, pointing DOWN-LEFT to a tip (like a "9" descender). The right + left
      // edges stay put; the bottom edge runs from the left corner to where the flag
      // attaches, the flag dips below to the tip, then climbs back to the corner. ONE
      // continuous silhouette (so it fills solid when complete), not a detached stroke.
      return requested ? (
        <path d="M4.5,4.5 L19.5,4.5 L19.5,19.5 L10.8,22.4 L14,19.5 L4.5,19.5 Z" />
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
      // A capital "Z" rotated 45° anticlockwise — the ontology's Individual mark.
      // Authored upright (top bar → diagonal → bottom bar) and rotated −45° about the
      // centre; a non-convex stroke letterform, so it's drawn as a bare path (never
      // filled — Individuals aren't completable).
      return <path d="M6 6.5 L18 6.5 L6 17.5 L18 17.5" transform="rotate(-45 12 12)" fill="none" />

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
  cancelled,
  requested,
  ongoing,
  spinOnce,
  flashFill,
  pulse,
  className,
}: {
  kind: EntityKind
  /**
   * FILLED ⇒ the shape fills solid. Fill DERIVES from close: a closed entity of a
   * fillable kind (task/space/resource/moment/instant) fills. Terminal kinds and
   * cancelled entities never fill (the row fades / a bar is drawn instead).
   */
  filled?: boolean
  /**
   * ONGOING ⇒ the glyph SLOWLY ROTATES clockwise — the "live span in progress" signal
   * for a started-but-unended Moment/Space or any entity with an open session (see
   * `getState` → "ongoing"). Driven by the Web Animations API (see the effect below): a
   * calm 2.34s/turn whose angular velocity EASES IN at start (playbackRate ramp 0→1) and
   * decelerates OUT to the nearest upright at stop, so it never snaps on/off. Skipped
   * entirely under `prefers-reduced-motion`. The only motion in the zero0 glyph set.
   */
  ongoing?: boolean
  /**
   * SPIN-ONCE trigger — a monotonically increasing counter. Whenever it INCREASES, the glyph
   * performs ONE full clockwise turn (a "written" acknowledgement, used when an INSTANT records
   * a mark). Independent of `ongoing` (which is a continuous spin); a one-shot lands back
   * upright. Skipped under `prefers-reduced-motion`. Ignored while `ongoing` (already spinning).
   */
  spinOnce?: number
  /**
   * FLASH-FILL trigger — a monotonically increasing counter, like `spinOnce` but with NO
   * rotation. Whenever it INCREASES the glyph fills to 100% then relaxes back to its base
   * (outline) over {@link FLASH_MS}. The "state just switched" acknowledgement used when a §4
   * chip becomes a notification (an ongoing entity stopped, or an instant was marked). Skipped
   * under `prefers-reduced-motion`.
   */
  flashFill?: number
  /**
   * PULSE — while true, the whole glyph breathes gently (a slow opacity pulse) to mark a
   * lingering NOTIFICATION chip. Purely decorative; independent of the ongoing rotation.
   */
  pulse?: boolean
  /**
   * DONE mark — overlay a check on the shape. Drawn whether the shape is outline or
   * filled: on a filled shape the check strokes in the BACKGROUND colour so it stays
   * legible. Independent of fill — a done-but-open entity reads as done.
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
  // The spin must pivot the shape's VISUAL centre, not the 24×24 box centre (12,12). A
  // triangle's centroid sits 1/3 up from its base, so the moment's TRIANGLE_UP centres at
  // y=14 (58.33%), not 12 — spinning about the box centre made it visibly wobble. Map only
  // the kinds whose centroid differs from the box centre; everything else stays 50% 50%.
  // Set ALWAYS (not just while ongoing) so the deceleration landing also pivots correctly.
  const spinOrigin = kind === "moment" ? "50% 58.33%" : kind === "instant" ? "50% 41.67%" : "50% 50%"

  const svgRef = useRef<SVGSVGElement | null>(null)
  const landingRef = useRef<Animation | null>(null)
  const rafRef = useRef<number | null>(null)

  // MORPH: while `morphing`, the crisp KindShape is swapped for a sampled `<polygon ref={polyRef}>`
  // whose `points` are written directly by rAF (no per-frame React state → no re-render storm).
  // Driven by two triggers: (a) a one-shot morph when `kind` changes between two morphable kinds,
  // and (b) a periodic hexagon→square→hexagon flourish while a SPACE is ongoing (spinning).
  const [morphing, setMorphing] = useState(false)
  const polyRef = useRef<SVGPolygonElement | null>(null)
  const morphRafRef = useRef<number | null>(null)
  const prevKindRef = useRef<EntityKind>(kind)

  useEffect(() => {
    const el = svgRef.current
    if (!el || typeof el.animate !== "function") return
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    if (!ongoing) return

    // A just-prior STOP may still be decelerating — cancel it so the fresh spin wins.
    landingRef.current?.cancel()
    landingRef.current = null

    // START — a persistent infinite linear rotation whose angular velocity EASES IN by
    // ramping the animation's playbackRate from 0 → 1 over EASE_MS (a smooth spin-up).
    const spin = el.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
      duration: SPIN_MS,
      iterations: Number.POSITIVE_INFINITY,
      easing: "linear",
    })
    spin.playbackRate = 0
    const t0 = performance.now()
    const rampUp = (t: number) => {
      spin.playbackRate = easeOutCubic(Math.min(1, (t - t0) / EASE_MS))
      if (t - t0 < EASE_MS) rafRef.current = requestAnimationFrame(rampUp)
    }
    rafRef.current = requestAnimationFrame(rampUp)

    // STOP — capture the current angle, cancel the infinite spin, then ease OUT to the
    // nearest upright (next 360°) so it decelerates to a clean rest instead of snapping.
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      const ct = Number(spin.currentTime ?? 0)
      const fromDeg = ((ct % SPIN_MS) / SPIN_MS) * 360
      spin.cancel()
      const landing = el.animate([{ transform: `rotate(${fromDeg}deg)` }, { transform: "rotate(360deg)" }], {
        duration: EASE_MS,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      })
      landingRef.current = landing
      // rotate(360°) === upright, so cancelling on finish reverts to the static glyph with
      // no visual jump.
      landing.onfinish = () => {
        landing.cancel()
        if (landingRef.current === landing) landingRef.current = null
      }
    }
  }, [ongoing, kind])

  // ── ONE-SHOT SPIN (mark "written" acknowledgement) ─────────────────────────────────────────
  // When `spinOnce` INCREASES, play a single 360° turn and land upright. Skipped on the initial
  // mount (no spin until an actual mark), while `ongoing` (the continuous spin owns rotation),
  // and under reduced-motion. Uses its own animation slot so it never fights the ongoing spin.
  const spinOnceRef = useRef<number | undefined>(spinOnce)
  const onceAnimRef = useRef<Animation | null>(null)
  const flashRef = useRef<SVGGElement | null>(null)

  // Play the overlay fill-flash (0 → 100% → 0 opacity) over `duration`. Shared by the mark
  // spin (SPIN_MS) and the standalone notification flash (FLASH_MS). No-op under reduced-motion
  // or before the overlay mounts. Returns the Animation so callers can cancel on cleanup.
  const playFlash = (duration: number): Animation | null => {
    const flash = flashRef.current
    if (!flash || typeof flash.animate !== "function") return null
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null
    const a = flash.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], {
      duration,
      easing: "ease-in-out",
      fill: "forwards",
    })
    a.onfinish = () => a.cancel()
    return a
  }
  useEffect(() => {
    const prev = spinOnceRef.current
    spinOnceRef.current = spinOnce
    if (spinOnce == null || prev == null || spinOnce <= prev) return // no increase ⇒ nothing
    if (ongoing) return // already spinning continuously
    const el = svgRef.current
    if (!el || typeof el.animate !== "function") return
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return

    onceAnimRef.current?.cancel()
    const once = el.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
      duration: SPIN_MS,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)", // ease-out: a lively kick that settles upright
      fill: "forwards",
    })
    onceAnimRef.current = once
    once.onfinish = () => {
      once.cancel() // rotate(360°) === upright ⇒ revert to static with no jump
      if (onceAnimRef.current === once) onceAnimRef.current = null
    }

    // FILL FLASH — an overlay silhouette that ramps 0 → 100% opacity at the spin's midpoint,
    // then back to 0 (empty/outline). The instant briefly reads full then relaxes to outline;
    // when the mark DOES complete it, the base `filled` prop takes over and it stays full.
    const flashAnim = playFlash(SPIN_MS)

    return () => {
      once.cancel()
      flashAnim?.cancel()
      if (onceAnimRef.current === once) onceAnimRef.current = null
    }
  }, [spinOnce, ongoing])

  // ── STANDALONE FILL FLASH (no rotation) ────────────────────────────────────────────────────
  // When `flashFill` INCREASES, play ONLY the overlay fill flash (no spin) over FLASH_MS. This is
  // the notification chip's "state just switched" acknowledgement — a brief fill that relaxes back
  // to the glyph's actual (outline) state.
  const flashFillRef = useRef<number | undefined>(flashFill)
  useEffect(() => {
    const prev = flashFillRef.current
    flashFillRef.current = flashFill
    if (flashFill == null || prev == null || flashFill <= prev) return
    const a = playFlash(FLASH_MS)
    return () => a?.cancel()
  }, [flashFill])

  // ── MORPH driver (kind-change one-shot + space-ongoing periodic flourish) ──────────────────
  useEffect(() => {
    const prev = prevKindRef.current
    prevKindRef.current = kind
    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

    const toR = RADII[kind]
    const fromR = RADII[prev]
    const entry = !reduce && !!toR && !!fromR && prev !== kind // morph between two morphable kinds
    const periodic = !reduce && !!toR && kind === "space" && !!ongoing // spinning-space flourish

    if (!entry && !periodic) {
      setMorphing(false)
      return
    }
    setMorphing(true)
    const t0 = performance.now()

    const tick = (now: number) => {
      const el = polyRef.current
      if (!el) {
        morphRafRef.current = requestAnimationFrame(tick)
        return
      }
      const t = now - t0
      if (entry && t < MORPH_MS) {
        // One-shot: ease from the PREVIOUS shape into the new one.
        el.setAttribute("points", buildPoints(lerpRadii(fromR as number[], toR as number[], easeInOut(t / MORPH_MS))))
        morphRafRef.current = requestAnimationFrame(tick)
      } else if (periodic) {
        // Continuous: rest at hexagon, then a brief there-and-back dip toward the square near the
        // end of each period (no dwell on the square — a quick 0→1→0 sine pulse).
        const phase = (now % SPACE_MORPH_PERIOD_MS) / SPACE_MORPH_PERIOD_MS
        const inPulse = phase > 1 - SPACE_MORPH_PULSE
        const f = inPulse ? Math.sin(((phase - (1 - SPACE_MORPH_PULSE)) / SPACE_MORPH_PULSE) * Math.PI) : 0
        el.setAttribute("points", buildPoints(f === 0 ? (toR as number[]) : lerpRadii(toR as number[], SPACE_MORPH_SQUARE_RADII, f)))
        morphRafRef.current = requestAnimationFrame(tick)
      } else {
        // Entry morph done and nothing periodic ⇒ settle back to the crisp KindShape.
        setMorphing(false)
      }
    }
    morphRafRef.current = requestAnimationFrame(tick)

    return () => {
      if (morphRafRef.current != null) cancelAnimationFrame(morphRafRef.current)
      morphRafRef.current = null
    }
  }, [kind, ongoing])

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 24 24"
      className={(className ?? "") + (pulse ? " zero0-glyph-pulse" : "")}
      style={{ transformOrigin: spinOrigin }}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {morphing && RADII[kind] ? (
        // Sampled silhouette, driven by the morph rAF. Initial points = the current kind so the
        // very first paint matches before the effect's first frame runs.
        <polygon ref={polyRef} points={buildPoints(RADII[kind] as number[])} />
      ) : (
        <KindShape kind={kind} requested={requested && kind === "task"} />
      )}
      {/* FILL-FLASH overlay — a filled copy of the shape, hidden (opacity 0) until a mark spin
          ramps it to full at the spin midpoint then back to 0. Explicit fill/stroke so it
          flashes even when the base glyph is an outline. */}
      <g ref={flashRef} fill="currentColor" stroke="none" style={{ opacity: 0 }} aria-hidden="true">
        <KindShape kind={kind} requested={requested && kind === "task"} />
      </g>
      {done && (
        <path
          d="M7.5 12.5 L10.5 15.5 L16.5 8.5"
          fill="none"
          stroke={filled ? "var(--background)" : "currentColor"}
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
