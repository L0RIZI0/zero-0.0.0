/**
 * dock-layout.ts — the Dock's pure layout engine.
 *
 * SINGLE SOURCE OF TRUTH for how pinned cards (ENTx · REG2) are sized and packed
 * given the available width. It is a pure function (no DOM, no React) so it can be
 * unit-reasoned and tweaked in one place; `dock.tsx` measures the container width
 * and renders whatever this returns.
 *
 * DESIGN (matches the product intent) — a PROGRESSIVE cascade as width tightens
 * (e.g. an in/out panel squeezes REG2). Each regime is exhausted before the next
 * begins (with minor natural overlap), so the dock degrades gracefully:
 *  0. GAP SQUEEZE — cards stay at their full base size; only the inter-card GAP
 *     shrinks, from GAP_WIDE down to GAP_TIGHT. Cards simply slide closer together.
 *  1. FRAME SHRINK — gap has bottomed out at GAP_TIGHT; now the card FRAME + padding
 *     shrink (base → min) while the content (glyph/title/meta) stays at scale 1.
 *  2. CONTENT SHRINK — the frame is now too close to the content, so the CONTENT
 *     scales down too, but never below CONTENT_FLOOR (comfortable min font sizes).
 *  3. HONEYCOMB wrap — even the min card in a tight row would overflow, so cards break
 *     into multiple offset rows that interlock (adjacent rows shifted half a period,
 *     pulled up by ¼ card height). The honeycomb uses its OWN near-zero gap (GAP_HONEY)
 *     so pointy-top hexagons actually tessellate like a beehive instead of floating
 *     apart. Applies uniformly to all cards (hex + rect alike).
 */

/** √3/2 — pointy-top regular-hexagon width:height ratio. */
export const HEX_RATIO = 0.866

/** Content scale floor. The dock content at scale 1 is: glyph 18px, title 13px,
 *  meta/counter 10px. The floor keeps them at comfortable minimums:
 *  glyph ≥ ~14px, title ≥ ~10.5px (18×0.8, 13×0.8). Below the meta floor the meta
 *  is hidden rather than shrunk into illegibility (handled in entity-node). */
export const CONTENT_FLOOR = 0.8

export type DockLayout = {
  /** Card frame footprint in px. */
  cardW: number
  cardH: number
  /** 1 in regime 1; scales toward CONTENT_FLOOR in regime 2. Multiplies glyph +
   *  title + meta sizes in the card. */
  contentScale: number
  /** Cards per row, top → bottom (last row may hold fewer). */
  rowCounts: number[]
  /** Horizontal gap between cards within a row (px). */
  gapX: number
  /** Negative vertical spacing between rows so hexagons interlock (px, ≥ 0). */
  rowOverlap: number
  /** Horizontal shift applied to alternate (odd-index) rows so cards nest in the
   *  valleys of the row above — the honeycomb offset (px). */
  rowOffset: number
  /** True when packed into more than one row. */
  multiRow: boolean
}

type Input = {
  /** Inner width available to the dock row (px). ≤ 0 ⇒ not measured yet. */
  availableWidth: number
  /** Number of pinned cards. */
  count: number
  /** Whether the dock's context entity is a Space (packs a touch tighter). */
  parentIsSpace: boolean
  /** Depth of the dock's context (0 = home view → larger base cards). */
  contextDepth: number
}

/** Base (resting, uncrowded) card footprint — mirrors the historical hardcoded
 *  values so home/unsqueezed docks look identical: 150×130 at home, 116×100 else. */
function baseCard(contextDepth: number) {
  const cardH = contextDepth === 0 ? 150 : 116
  return { cardW: Math.round(cardH * HEX_RATIO), cardH }
}

/** Smallest comfortable card the frame is allowed to shrink to before we wrap into
 *  another honeycomb row. ~68% of base keeps the hexagon + content legible. */
function minCard(contextDepth: number) {
  const base = baseCard(contextDepth)
  const cardW = Math.round(base.cardW * 0.68)
  return { cardW, cardH: Math.round(cardW / HEX_RATIO) }
}

/** Single-row gap bounds. As width tightens the gap squeezes from `wide` (the resting,
 *  roomy spacing) down to `tight` (the floor) BEFORE any card-frame shrink begins.
 *  Cards inside a Space pack a touch tighter than inside a task/event context. */
function gapBounds(parentIsSpace: boolean) {
  return { wide: parentIsSpace ? 28 : 36, tight: parentIsSpace ? 12 : 16 }
}

/** Honeycomb horizontal gap. Near-zero so pointy-top hexagons kiss and tessellate
 *  (the visual breathing room comes from the hexagon's own footprint inset, not from
 *  a gap). A tiny positive value avoids sub-pixel edge fighting. */
const GAP_HONEY = 2

/** Width at which content begins to scale (regime 1 → 2 boundary): the content
 *  stack's intrinsic width plus minimal horizontal padding. Below this the frame
 *  can no longer absorb the shrink with padding alone. */
const CONTENT_INTRINSIC_W = 72 // glyph/title/counter natural width at scale 1
const MIN_PAD_X = 6 // minimal breathing room each side before content scales
const CONTENT_BOUND_W = CONTENT_INTRINSIC_W + MIN_PAD_X * 2 // ≈ 84

/** Total vertical budget for a multi-row honeycomb dock, so REG2 never dominates the
 *  View. Rows beyond this force smaller cards. */
const HONEYCOMB_HEIGHT_BUDGET = 340

/** Content scale for a chosen card width: 1 until the frame crowds the content, then
 *  down toward CONTENT_FLOOR. */
function contentScaleFor(cardW: number) {
  if (cardW >= CONTENT_BOUND_W) return 1
  return clamp(cardW / CONTENT_BOUND_W, CONTENT_FLOOR, 1)
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** Distribute `count` items into `rows` near-equal rows (earlier rows get the extra
 *  when it doesn't divide evenly), so the honeycomb reads balanced. */
function distribute(count: number, rows: number): number[] {
  const base = Math.floor(count / rows)
  let rem = count % rows
  const out: number[] = []
  for (let i = 0; i < rows; i++) {
    out.push(base + (rem > 0 ? 1 : 0))
    if (rem > 0) rem--
  }
  return out
}

export function computeDockLayout(input: Input): DockLayout {
  const { availableWidth, count, parentIsSpace, contextDepth } = input
  const base = baseCard(contextDepth)
  const min = minCard(contextDepth)
  const { wide, tight } = gapBounds(parentIsSpace)

  // Before measurement (SSR / first paint), render the resting single row so the dock
  // matches its historical look until the ResizeObserver reports a real width.
  if (!availableWidth || availableWidth <= 0 || count <= 0) {
    return singleRow(base.cardW, base.cardH, wide, count)
  }

  // A lone card: no gap to squeeze — the frame just shrinks toward min if starved.
  if (count === 1) {
    const cardW = Math.round(clamp(availableWidth, min.cardW, base.cardW))
    return singleRow(cardW, Math.round(cardW / HEX_RATIO), wide, 1)
  }

  // --- Regime 0: GAP SQUEEZE (cards at BASE size) --------------------------------
  // The gap absorbs the width change first. `gapAtBase` is the spacing that would
  // exactly fill the leftover width with full-size cards; while it's still ≥ tight,
  // cards stay at base and only the gap moves.
  const gapAtBase = (availableWidth - count * base.cardW) / (count - 1)
  if (gapAtBase >= tight) {
    return singleRow(base.cardW, base.cardH, Math.round(clamp(gapAtBase, tight, wide)), count)
  }

  // --- Regime 1+2: FRAME then CONTENT shrink (gap pinned at tight) ---------------
  // Gap has bottomed out; now shrink the card frame down toward min. `contentScaleFor`
  // (applied in singleRow) keeps content at scale 1 until the frame crowds it, then
  // scales it down to the floor — so regimes 1 and 2 flow into each other naturally.
  const perCard = (availableWidth - tight * (count - 1)) / count
  if (perCard >= min.cardW) {
    const cardW = Math.round(clamp(perCard, min.cardW, base.cardW))
    return singleRow(cardW, Math.round(cardW / HEX_RATIO), tight, count)
  }

  // --- Regime 3: HONEYCOMB (multi-row) -------------------------------------------
  // CONTINUITY: the single row bottomed out at exactly `min` right before wrapping, so
  // honeycomb cards INHERIT that `min` size and STAY there — they must NOT jump back up
  // to base just because multi-row frees horizontal room. We only add rows to fit the
  // min-size cards at the near-zero GAP_HONEY (so hexagons tessellate). Pick the FEWEST
  // rows whose offset width AND stack height both fit at `min`.
  for (let rows = 2; rows <= count; rows++) {
    const cols = Math.ceil(count / rows)
    // Offset rows are shifted half a period, so a row needs room for `cols + 0.5` cards.
    const neededW = (cols + 0.5) * min.cardW + GAP_HONEY * (cols - 1)
    const overlap = Math.round(min.cardH * 0.25)
    const stackH = min.cardH + (rows - 1) * (min.cardH - overlap)
    if (neededW <= availableWidth && stackH <= HONEYCOMB_HEIGHT_BUDGET) {
      return honeycomb(min.cardW, min.cardH, count, rows)
    }
  }

  // Last resort: even stacked, min-size cards overflow. Use the most rows (fewest cols)
  // and shrink the card BELOW min to fit the width — the only case cards go under `min`,
  // so content scaling continues smoothly downward (still never an upward jump).
  const rows = count
  const cols = Math.ceil(count / rows) // 1 col
  const perCardH = (availableWidth - GAP_HONEY * (cols - 1)) / (cols + 0.5)
  const cardW = Math.round(clamp(perCardH, 1, min.cardW))
  return honeycomb(cardW, Math.round(cardW / HEX_RATIO), count, rows)
}

function singleRow(cardW: number, cardH: number, gapX: number, count: number): DockLayout {
  return {
    cardW,
    cardH,
    contentScale: contentScaleFor(cardW),
    rowCounts: count > 0 ? [count] : [],
    gapX,
    rowOverlap: 0,
    rowOffset: 0,
    multiRow: false,
  }
}

function honeycomb(cardW: number, cardH: number, count: number, rows: number): DockLayout {
  return {
    cardW,
    cardH,
    contentScale: contentScaleFor(cardW),
    rowCounts: distribute(count, rows),
    gapX: GAP_HONEY,
    // Pointy-top tessellation: advance ¾·h vertically (overlap ¼·h) and shift the
    // next row half a period (½ of card+gap) so cards sit in the valleys above.
    rowOverlap: Math.round(cardH * 0.25),
    rowOffset: Math.round((cardW + GAP_HONEY) / 2),
    multiRow: true,
  }
}

/** Absolute box for one card within the dock container. */
export type DockCardBox = { left: number; top: number; width: number; height: number }

/**
 * Resolve a `DockLayout` + measured width into ABSOLUTE per-card boxes (left/top/
 * width/height, px) plus the container's total size. This is what lets the dock
 * render one FLAT, stably-keyed list of absolutely-positioned cards (no re-parenting
 * between row `<div>`s → no remount jump) and simply CSS-transition each card's box
 * when the structure flips single↔honeycomb.
 *
 * Positioning uses left/top ONLY — never transforms — so an open card's
 * `position: fixed` window still resolves against the viewport (a transformed
 * ancestor would capture it).
 *
 * Honeycomb centering mirrors the verified flex version: each row is centered in the
 * width, then alternate rows are shifted ±rowOffset/2 so adjacent rows differ by a
 * full half-period and nest in each other's valleys while the group stays centered.
 */
export function dockCardBoxes(
  layout: DockLayout,
  availableWidth: number,
): { boxes: DockCardBox[]; width: number; height: number } {
  const { cardW, cardH, gapX, rowCounts, rowOverlap, rowOffset, multiRow } = layout
  const boxes: DockCardBox[] = []
  const advanceY = cardH - rowOverlap
  rowCounts.forEach((cols, r) => {
    const rowWidth = cols * cardW + (cols - 1) * gapX
    // Center the row, then apply the alternating half-period nest shift.
    const nudge = multiRow ? (r % 2 === 1 ? rowOffset / 2 : -rowOffset / 2) : 0
    const startX = (availableWidth - rowWidth) / 2 + nudge
    const top = r * advanceY
    for (let i = 0; i < cols; i++) {
      boxes.push({ left: Math.round(startX + i * (cardW + gapX)), top: Math.round(top), width: cardW, height: cardH })
    }
  })
  const rows = rowCounts.length
  const height = rows > 0 ? (rows - 1) * advanceY + cardH : 0
  return { boxes, width: availableWidth, height }
}

/** A compact string that changes ONLY when the STRUCTURE changes (row breakdown or
 *  card size), used by the dock to enable a one-shot CSS tween across a structural
 *  flip while leaving continuous same-structure width tracking un-transitioned. */
export function dockStructureKey(layout: DockLayout): string {
  return `${layout.rowCounts.join("-")}|${layout.cardW}x${layout.cardH}`
}
