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
// FLAT-TOP hexagon — the SAME hexagon rotated 30° (a flat EDGE on top instead of a point). Same
// circumradius (~10.4) as the pointy-top HEXAGON, so morphing between the two changes only the
// ORIENTATION, never the size. Drives the SPACE "ongoing" flourish (see the morph driver): a live
// space continuously morphs point-top ⇄ flat-top instead of spinning.
const FLAT_HEXAGON = "17.2,2.99 22.4,12 17.2,21.01 6.8,21.01 1.6,12 6.8,2.99"
// Scaled to the SAME ~15% optical oversize as the HEXAGON (circumradius ~10.38): a pentagon reads
// optically small (pointed top, wide flat base sits low), so Community is grown to match the
// hexagon-Space's mass rather than a bounding-equal peer.
const PENTAGON = "12,1.62 21.87,8.79 18.10,20.40 5.90,20.40 2.13,8.79"
// Scaled to the SAME ~15% optical oversize as the HEXAGON/PENTAGON (circumradius ~10.38): a diamond
// reads optically small (only 4 points, large empty corners), so Resource is grown to match the
// hexagon-Space's mass rather than a bounding-equal peer.
const DIAMOND = "12,1.62 22.38,12 12,22.38 1.62,12"
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
  organism: Array.from({ length: MORPH_N }, () => 9.8), // circle ⇒ constant radius (matches KindShape r)
}
// Radial signature of the flat-top hexagon — the morph TARGET for the SPACE ongoing flourish.
const SPACE_FLAT_HEXAGON_RADII = radiiFromVerts(parseVerts(FLAT_HEXAGON))

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

const MORPH_MS = 380 // one-shot kind-change morph duration
// One full point-top → flat-top → point-top cycle of the SPACE "ongoing" flourish (v0.2.297). Kept
// close to the old spin cadence (SPIN_MS 2345) so a live space feels the same "calm, ambient" tempo,
// just morphing instead of rotating.
const SPACE_MORPH_CYCLE_MS = 2345

/** Draw the kind's outline shape. Fill/stroke are set by the caller via props.
 *  `"link"` is a FORTHCOMING (id-5) placeholder kind — not yet in the real `EntityKind` union —
 *  so the param is widened to allow it without polluting the ontology type everywhere. */
function KindShape({
  kind,
  requested,
  scheduled,
}: {
  kind: EntityKind | "link"
  requested?: boolean
  scheduled?: boolean
}) {
  // OVERSIZE DAMPING when THICK — the space/community/resource polygons bake in a ~15% optical
  // oversize (circumradius ~10.38). A scheduled (thick) stroke is centred on the path, so its outer
  // half-stroke pushes the shape even bigger; to compensate we shrink those three to a ~12% oversize
  // while thick. Scale = 1.12/1.15 ≈ 0.9739 about the box centre (12,12) → translate 12·(1−s).
  const DAMP = scheduled ? "translate(0.3130 0.3130) scale(0.9739)" : undefined
  switch (kind) {
    case "link":
      // ⟨forthcoming · id 5⟩ THE LINK — a relation reified: two endpoint NODES on either side joined
      // by a connecting segment (the "between" that relates any two entities). Sits between the
      // thing-block (Resource/Task) and the context-block (Space). The joining segment is DASHED —
      // a blueprint/ghost marking a kind that is planned but not yet real; the nodes are small open
      // circles. Never fills (it isn't a live kind). Endpoints offset off the node edges so the
      // line meets each circle rather than piercing it.
      return (
        <g fill="none">
          <circle cx="6" cy="18" r="2.6" />
          <circle cx="18" cy="6" r="2.6" />
          <line x1="7.84" y1="16.16" x2="16.16" y2="7.84" strokeDasharray="2.4 2" />
        </g>
      )
    case "entity":
      // The raw Idea — an ✜-style "add" CROSS with a genuinely EMPTY center: FOUR separate arms
      // that stop short of the middle, leaving a hollow gap at the core. Drawn with SVG primitives
      // (NOT the ✜ Unicode char, which renders blank — JetBrains Mono lacks U+271C, confirmed) so
      // it paints identically everywhere. No enclosed silhouette, so it never fills; the open,
      // un-closed center reads as "not yet shaped" — it can still become any specialized kind.
      return <path d="M12 3 L12 9 M12 15 L12 21 M3 12 L9 12 M15 12 L21 12" fill="none" />
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
      // The HEXAGON carries a ~15% optical oversize (see its definition) so it reads as big as the
      // Task square; DAMP shrinks it to ~10% while thick (see above) so the heavier stroke doesn't
      // balloon it.
      return <polygon points={HEXAGON} transform={DAMP} />
    case "resource":
      return <polygon points={DIAMOND} transform={DAMP} />
    case "moment":
      return <polygon points={TRIANGLE_UP} />
    case "instant":
      return <polygon points={TRIANGLE_DOWN} />
    case "community":
      return <polygon points={PENTAGON} transform={DAMP} />
    case "organism":
      // r bumped 9 → 9.8: a circle reads optically SMALLER than the hexagon/square at equal radius,
      // so it's grown to sit at the same visual mass as the hexagon-Space beside it (id 6/7 harmony).
      return <circle cx="12" cy="12" r="9.8" />
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
  scheduled,
  spinOnce,
  flashFill,
  pulse,
  className,
}: {
  kind: EntityKind | "link"
  /**
   * FILLED ⇒ the shape fills solid. Fill DERIVES from close: a closed entity of a
   * fillable kind (task/space/resource/moment/instant) fills. Terminal kinds and
   * cancelled entities never fill (the row fades / a bar is drawn instead).
   */
  filled?: boolean
  /**
   * SCHEDULED ⇒ the outline is drawn with a HEAVIER stroke (the "not yet begun, but
   * pinned to the future" signal) — the STATE-axis `scheduled` word (rendered "expected"
   * for beings; see `getState`). Purely a stroke-weight bump over the base open outline,
   * so an open vs a scheduled entity read apart at a glance. Ignored while `filled` (a
   * filled silhouette has no stroke to thicken).
   */
  scheduled?: boolean
  /**
   * ONGOING ⇒ the "live span in progress" signal for a started-but-unended entity or any
   * entity with an open session (see `getState` → "ongoing"). For MOST kinds the glyph SLOWLY
   * ROTATES clockwise — driven by the Web Animations API (see the effect below): a calm
   * 2.34s/turn whose angular velocity EASES IN at start (playbackRate ramp 0→1) and decelerates
   * OUT to the nearest upright at stop, so it never snaps on/off. SPACE is the exception
   * (v0.2.297): instead of rotating it continuously MORPHS point-top ⇄ flat-top hexagon (see the
   * morph driver's periodic branch). Skipped entirely under `prefers-reduced-motion`.
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
  const prevKindRef = useRef<EntityKind | "link">(kind)

  useEffect(() => {
    const el = svgRef.current
    if (!el || typeof el.animate !== "function") return
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    if (!ongoing) return
    // SPACE does NOT rotate while ongoing (v0.2.297) — it continuously morphs point-top ⇄ flat-top
    // hexagon instead (handled by the morph driver's periodic branch). Every other kind still spins.
    if (kind === "space") return

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

    const toR = RADII[kind as EntityKind] // "link" isn't morphable ⇒ undefined ⇒ no morph, static shape
    const fromR = RADII[prev as EntityKind]
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
        // Continuous SPACE flourish (v0.2.297): morph point-top ⇄ flat-top hexagon forever instead of
        // rotating. `f` runs a smooth raised-cosine 0→1→0 each cycle, so one cycle is
        // pointy → flat → pointy with no snap at the turning points; at f≈0.5 the radial lerp passes
        // through a near-regular dodecagon (both hexagons share a circumradius, so only the ORIENTATION
        // changes — the glyph never grows or shrinks).
        const phase = (now % SPACE_MORPH_CYCLE_MS) / SPACE_MORPH_CYCLE_MS
        const f = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)
        el.setAttribute("points", buildPoints(lerpRadii(toR as number[], SPACE_FLAT_HEXAGON_RADII, f)))
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

  // Scheduled stroke is 2.9 for every kind EXCEPT the space HEXAGON, which reads slightly light at
  // its ~15% oversize, so it gets a touch heavier (3.1) to match the other thick glyphs' weight.
  const scheduledStroke = kind === "space" ? 3.1 : 2.9
  const strokeW = filled ? 0 : scheduled ? scheduledStroke : 1.6

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 24 24"
      className={(className ?? "") + (pulse ? " zero0-glyph-pulse" : "")}
      style={{ transformOrigin: spinOrigin }}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeW}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {morphing && RADII[kind as EntityKind] ? (
        // Sampled silhouette, driven by the morph rAF. Initial points = the current kind so the
        // very first paint matches before the effect's first frame runs.
        <polygon ref={polyRef} points={buildPoints(RADII[kind as EntityKind] as number[])} />
      ) : (
        <KindShape kind={kind} requested={requested && kind === "task"} scheduled={scheduled} />
      )}
      {/* FILL-FLASH overlay — a filled copy of the shape, hidden (opacity 0) until a mark spin
          ramps it to full at the spin midpoint then back to 0. Explicit fill/stroke so it
          flashes even when the base glyph is an outline. */}
      <g ref={flashRef} fill="currentColor" stroke="none" style={{ opacity: 0 }} aria-hidden="true">
        <KindShape kind={kind} requested={requested && kind === "task"} scheduled={scheduled} />
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
