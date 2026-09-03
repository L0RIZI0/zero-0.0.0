/**
 * @zero/dayline-contract — GLYPH GEOMETRY SPEC
 * ============================================
 *
 * Framework-neutral, dependency-free description of every entity glyph in Zero, extracted verbatim
 * from the live React/SVG implementation (`components/zero0/zero0-glyph.tsx`). Grok's canvas engine
 * has only a screenshot to go on; this file is the source of truth so the redraw is pixel-faithful
 * rather than eyeballed.
 *
 * WHY THIS SHAPE OF DELIVERABLE
 * -----------------------------
 * It's DATA, not prose or React. Every glyph is authored in a 24×24 box centred on (12,12), painted
 * with the entity's accent colour. Polygons are plain vertex lists; the few letterform/relational
 * kinds are given as explicit segment paths. All of it maps 1:1 onto Canvas 2D:
 *
 *   - `<polygon points="x,y x,y …">`      →  ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(…)×; ctx.closePath()
 *   - `<line x1 y1 x2 y2>`                 →  ctx.moveTo(x1,y1); ctx.lineTo(x2,y2)
 *   - `<circle cx cy r>`                   →  ctx.arc(cx,cy,r,0,2π)
 *   - `<path d="M… L…">` (open, no Z)      →  moveTo on M, lineTo on L, DO NOT closePath
 *   - stroke (outline) vs fill (solid)     →  ctx.stroke() vs ctx.fill(), see STATE MODIFIERS
 *
 * Scale the whole 24-box to whatever device size you draw at (e.g. `ctx.scale(px/24, px/24)`), keep
 * stroke widths in these same 24-box units so they scale with the shape, and use round joins/caps
 * (`ctx.lineJoin = ctx.lineCap = "round"`).
 *
 * SCOPE: only FOUR kinds actually appear on the dayline — `space`, `task`, `moment`, `instant` (see
 * `DaylineKind` in index.ts). The rest (`resource`, `community`, `organism`, `entity`, `individual`,
 * `soul`, `link`) are documented here for completeness because Zero's glyph system is shared app-wide
 * and the engine may be reused elsewhere; a dayline-only implementation can safely ignore them.
 */

export const GLYPH_BOX = 24
export const GLYPH_CX = 12
export const GLYPH_CY = 12

/**
 * OPTICAL OVERSIZE — read before trusting the numbers.
 *
 * A regular hexagon / pentagon / diamond reads visually SMALLER than a square of equal bounding width
 * because its corners are cut and its mass sits inside the box. Space, Community and Resource are
 * therefore drawn ~15% larger than a bounding-equal peer (circumradius ~10.38 vs the Task square's
 * 7.5 half-width) so they sit at the same visual mass as the Task square beside them in a row. The
 * circle (Organism) is likewise grown to r=9.8 for the same reason. These oversizes are BAKED INTO
 * the vertex lists below — do not re-scale them.
 */

/** Regular hexagon, pointy-top, circumradius ~10.4 (the ~15% optical oversize). Space. */
export const HEXAGON = "12,1.6 21.01,6.8 21.01,17.2 12,22.4 2.99,17.2 2.99,6.8"
/** Regular pentagon, pointy-top, circumradius ~10.38. Community. */
export const PENTAGON = "12,1.62 21.87,8.79 18.10,20.40 5.90,20.40 2.13,8.79"
/** Square-on-point (diamond), circumradius ~10.38. Resource. */
export const DIAMOND = "12,1.62 22.38,12 12,22.38 1.62,12"
/** Upward triangle. Moment. Centroid sits LOW (see SPIN_ORIGIN). */
export const TRIANGLE_UP = "12,4 20,19 4,19"
/** Downward triangle. Instant. Centroid sits HIGH (see SPIN_ORIGIN). */
export const TRIANGLE_DOWN = "12,20 20,5 4,5"
/** Axis-aligned square, 15×15, half-width 7.5. Task (base, un-requested). */
export const SQUARE = "4.5,4.5 19.5,4.5 19.5,19.5 4.5,19.5"

/**
 * The convex kinds each reduce to a closed polygon (fill when complete, stroke otherwise). The
 * remaining kinds have no clean convex silhouette and are drawn as explicit paths — listed here as
 * canvas-ready segment/primitive data. All coordinates are in the 24-box.
 */
export type GlyphPrimitive =
  | { op: "polygon"; points: string; closed: true }
  | { op: "circle"; cx: number; cy: number; r: number; solid?: boolean }
  | { op: "segments"; d: string; closed: boolean } // `d` = SVG path using only M / L, absolute
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; dash?: [number, number] }

/**
 * PRIMARY SILHOUETTE per kind. `fillable: true` means the shape closes into a solid area and MUST
 * fill when the entity is complete (see STATE MODIFIERS → filled). `fillable: false` kinds never
 * fill regardless of state (they aren't completable, or have no enclosed area).
 */
export const GLYPH_GEOMETRY: Record<
  string,
  { fillable: boolean; primitives: GlyphPrimitive[]; note?: string }
> = {
  // ── Fillable convex kinds ────────────────────────────────────────────────────────────────────
  task: {
    fillable: true,
    primitives: [{ op: "polygon", points: SQUARE, closed: true }],
    note: "Base task. See TASK_REQUESTED for the 'sent as request' pennant variant.",
  },
  space: {
    fillable: true,
    // Hexagon + an ISOMETRIC-CUBE interior: a small solid centre node with three spokes to the TOP,
    // BOTTOM-LEFT and BOTTOM-RIGHT vertices, splitting the hexagon into three rhombic faces so a
    // spinning (ongoing) space reads as a tumbling cube. Spokes + dot are drawn at reduced opacity
    // and inherit the OUTLINE stroke, so they vanish when the shape fills solid on complete.
    primitives: [
      { op: "polygon", points: HEXAGON, closed: true },
      { op: "segments", d: "M12,12 L12,1.6 M12,12 L2.99,17.2 M12,12 L21.01,17.2", closed: false }, // opacity 0.5
      { op: "circle", cx: 12, cy: 12, r: 1.8, solid: true }, // opacity 0.42, solid node
    ],
    note: "Interior spokes at opacity 0.5, centre dot solid at opacity 0.42. Both drop when filled.",
  },
  resource: { fillable: true, primitives: [{ op: "polygon", points: DIAMOND, closed: true }] },
  moment: { fillable: true, primitives: [{ op: "polygon", points: TRIANGLE_UP, closed: true }] },
  instant: { fillable: true, primitives: [{ op: "polygon", points: TRIANGLE_DOWN, closed: true }] },
  community: { fillable: true, primitives: [{ op: "polygon", points: PENTAGON, closed: true }] },

  // ── Non-fillable kinds ───────────────────────────────────────────────────────────────────────
  organism: {
    fillable: false,
    primitives: [{ op: "circle", cx: 12, cy: 12, r: 9.8 }],
    note: "Circle grown to r=9.8 for optical parity with the hexagon.",
  },
  entity: {
    fillable: false,
    // The raw Idea: an add-CROSS with a genuinely EMPTY centre — four separate arms that stop short
    // of the middle. Never fills; the hollow core reads as 'not yet shaped'.
    primitives: [{ op: "segments", d: "M12 3 L12 9 M12 15 L12 21 M3 12 L9 12 M15 12 L21 12", closed: false }],
  },
  individual: {
    fillable: false,
    // A capital 'Z' (top bar → diagonal → bottom bar) rotated −45° about the centre. Rotate these
    // three chained segments by −45° around (12,12) at draw time. Never fills.
    primitives: [{ op: "segments", d: "M6 6.5 L18 6.5 L6 17.5 L18 17.5", closed: false }],
    note: "Apply rotate(-45°) about (12,12) to the path.",
  },
  soul: {
    fillable: false,
    // The smallest essence — a bare solid dot. ALWAYS solid regardless of state.
    primitives: [{ op: "circle", cx: 12, cy: 12, r: 3.5, solid: true }],
  },
  link: {
    fillable: false,
    // FORTHCOMING relational kind: two small open endpoint circles joined by a DASHED segment (a
    // blueprint/ghost of a planned-but-not-real kind). Endpoints offset off the node edges so the
    // line meets each circle rather than piercing it. Never fills.
    primitives: [
      { op: "circle", cx: 6, cy: 18, r: 2.6 },
      { op: "circle", cx: 18, cy: 6, r: 2.6 },
      { op: "line", x1: 7.84, y1: 16.16, x2: 16.16, y2: 7.84, dash: [2.4, 2] },
    ],
  },
}

/**
 * TASK — 'sent as request' variant. When a task is a request, the square's bottom-right corner grows
 * a diagonal flag/leg pointing down-left to a tip (like a '9' descender). It is ONE continuous closed
 * silhouette (so it still fills solid when complete), NOT a detached stroke. Use this closed polygon
 * in place of `SQUARE` when `requested` is set on a task.
 */
export const TASK_REQUESTED = "4.5,4.5 19.5,4.5 19.5,19.5 10.8,22.4 14,19.5 4.5,19.5"

/**
 * STATE MODIFIERS
 * ---------------
 * State never changes the KIND shape; it changes stroke/fill and adds overlays. Apply in this order.
 *
 * 1. FILL vs OUTLINE
 *    - Default: OUTLINE — stroke the silhouette, no fill. strokeWidth = STROKE.base (1.6).
 *    - `filled` (entity is COMPLETE, and the kind is `fillable`): FILL solid with the accent colour,
 *      strokeWidth = 0. A filled shape has no stroke to thicken, so `scheduled` is ignored while filled.
 *      Non-fillable kinds ignore `filled`.
 *
 * 2. SCHEDULED (heavier outline) — 'pinned to the future, not yet begun'. Only affects the OUTLINE
 *    state: bump strokeWidth to STROKE.scheduled (2.9), except SPACE which uses STROKE.scheduledSpace
 *    (3.1) because the hexagon reads slightly light at its oversize. While scheduled, shrink Space /
 *    Community / Resource by DAMP (scale 0.9739 about (12,12), i.e. translate 12·(1−s)=0.3130 then
 *    scale) so the heavier centred stroke doesn't balloon their baked-in oversize.
 *
 * 3. FLIP180 (static) — rotate the SILHOUETTE 180° about (12,12). Marks a Space with a FUTURE planned
 *    occurrence. Applies to the shape only; the DONE check and CANCEL bar overlays below stay upright.
 *    Composes with the ongoing spin (spin rotates the whole glyph; flip is a static inner rotation).
 *
 * 4. DONE (overlay) — a check mark, drawn whether outline or filled:
 *      path  M7.5 12.5 L10.5 15.5 L16.5 8.5   (open, stroke only, width 1.8)
 *    Stroke colour = accent (currentColor) on an outline glyph, or the BACKGROUND colour on a filled
 *    glyph so it stays legible against the solid fill. A done-but-open entity still shows the check.
 *
 * 5. CANCELLED (overlay) — a horizontal bar across the whole box, drawn OVER whatever state the glyph
 *    had (so a completed-then-cancelled glyph stays filled AND barred). Two stacked lines from
 *    (3,12) to (21,12): first a BACKGROUND-colour casing at width 3.4, then the accent bar at width
 *    1.8 on top. It extends past the shape so its ends read even on a filled silhouette.
 */
export const STROKE = {
  base: 1.6,
  scheduled: 2.9,
  scheduledSpace: 3.1,
  filled: 0,
} as const

/** DAMP transform applied to space/community/resource WHILE scheduled (see modifier 2). */
export const SCHEDULED_DAMP = { translate: 0.313, scale: 0.9739, about: [12, 12] as const } as const

/** DONE check overlay path (open, stroke width 1.8). Colour: accent on outline, background on fill. */
export const DONE_CHECK = "M7.5 12.5 L10.5 15.5 L16.5 8.5"

/** CANCEL bar overlay: casing then bar, both from x=3 to x=21 at y=12. */
export const CANCEL_BAR = {
  x1: 3,
  y1: 12,
  x2: 21,
  y2: 12,
  casingWidth: 3.4, // background colour, drawn first
  barWidth: 1.8, // accent colour, drawn on top
} as const

/**
 * MOTION (optional — the canvas engine may reproduce or simplify these)
 * ---------------------------------------------------------------------
 * SPIN ORIGIN: rotations must pivot the shape's VISUAL CENTRE, not the box centre, or triangles
 * visibly wobble. A triangle's centroid sits 1/3 up from its base:
 *   - moment  (TRIANGLE_UP):   origin (50%, 58.33%)   → y ≈ 14
 *   - instant (TRIANGLE_DOWN): origin (50%, 41.67%)   → y ≈ 10
 *   - every other kind:        origin (50%, 50%)      → (12,12)
 *
 * ONGOING (live span in progress): a calm continuous clockwise spin, ~2.345s per full turn, linear
 * angular velocity, with an ease-IN ramp (~0.65s) at start and an ease-OUT deceleration to the
 * nearest upright at stop, so it never snaps on/off. For a Space, the interior spokes+dot spin with
 * it (they're part of the silhouette) → the tumbling-cube read. Skip entirely under
 * prefers-reduced-motion.
 *
 * SPIN-ONCE: a single 360° turn landing upright (ease-out cubic-bezier(0.22,1,0.36,1) over ~2.345s),
 * used when an Instant records a mark. Independent of `ongoing`.
 *
 * FLASH-FILL: a filled copy of the silhouette ramping 0→100%→0 opacity (~0.72s standalone, or over
 * the spin duration when paired with SPIN-ONCE) — a 'state just switched' pulse. The base state then
 * reasserts itself (an outline glyph relaxes back to outline).
 *
 * MORPH (kind change): between two convex fillable kinds, the silhouette can be tweened by sampling
 * each as a RADIAL signature (N=48 rays from (12,12), index 0 = straight up, clockwise) and lerping
 * the two radius arrays — always top-aligned so a hexagon melts into a square without spinning to
 * realign. ~0.38s, ease-in-out. This is a nicety, not required for a faithful static render.
 */
export const SPIN = {
  fullTurnMs: 2345,
  easeMs: 650,
  flashMs: 720,
  morphMs: 380,
  spinOnceEasing: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const

export const SPIN_ORIGIN: Record<string, [number, number]> = {
  moment: [12, 14], // 50% / 58.33%
  instant: [12, 10], // 50% / 41.67%
  // all others default to [12, 12]
}
