/**
 * dock-layout.ts — the Dock's pure layout engine.
 *
 * SINGLE SOURCE OF TRUTH for how pinned cards (ENTx · REG2) are sized and packed
 * given the available width. It is a pure function (no DOM, no React) so it can be
 * unit-reasoned and tweaked in one place; `dock.tsx` measures the container width
 * and renders whatever this returns.
 *
 * DESIGN (matches the product intent):
 *  1. Cards are pointy-top hexagon footprints: `w = h × HEX_RATIO` (√3/2).
 *  2. TWO-REGIME shrink as width tightens (e.g. an in/out panel squeezes REG2):
 *       • Regime 1 — the FRAME + padding shrink while the content (glyph/title/meta)
 *         stays at scale 1. The card just gets tighter around its content.
 *       • Regime 2 — once the frame is too close to the content, the CONTENT scales
 *         down too, but never below CONTENT_FLOOR (so glyph/title/meta always stay
 *         at comfortable minimum sizes).
 *  3. HONEYCOMB wrap — if even at the minimum comfortable card a single row would
 *     overflow, cards break into multiple offset rows that interlock (alternate rows
 *     shifted half a period, pulled up by ¼ card height) so pinned hexagons tessellate
 *     like a beehive. Wrap is chosen to keep cards as large as possible within a
 *     height budget. Applies uniformly to all cards (hex + rect alike).
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

/** Gap for a given card count — roomy when sparse, tightening to a floor as the row
 *  fills (kept from the previous count-based scheme so single-row docks are unchanged). */
function gapFor(count: number, parentIsSpace: boolean) {
  const WIDE = parentIsSpace ? 28 : 36
  const TIGHT = parentIsSpace ? 12 : 16
  const FROM = 3
  const FULL = 9
  if (count <= FROM) return WIDE
  if (count >= FULL) return TIGHT
  const t = (count - FROM) / (FULL - FROM)
  return Math.round(WIDE + (TIGHT - WIDE) * t)
}

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

  // Before measurement (SSR / first paint), render the resting single row so the dock
  // matches its historical look until the ResizeObserver reports a real width.
  if (!availableWidth || availableWidth <= 0 || count <= 0) {
    return singleRow(base.cardW, base.cardH, count, parentIsSpace)
  }

  // --- Try SINGLE ROW first ------------------------------------------------------
  // Widest card that fits `count` across one row with the count-based gap, clamped to
  // [min, base]. If that clamp still fits (≥ min), stay single-row.
  const gap1 = gapFor(count, parentIsSpace)
  const perCard1 = (availableWidth - gap1 * (count - 1)) / count
  if (perCard1 >= min.cardW) {
    const cardW = Math.round(clamp(perCard1, min.cardW, base.cardW))
    const cardH = Math.round(cardW / HEX_RATIO)
    return singleRow(cardW, cardH, count, parentIsSpace)
  }

  // --- HONEYCOMB (multi-row) -----------------------------------------------------
  // Grow rows until the widest row's card (at min-or-larger) fits the width AND the
  // stack fits the height budget. Pick the FEWEST rows that satisfy both, keeping
  // cards as large as possible.
  for (let rows = 2; rows <= count; rows++) {
    const cols = Math.ceil(count / rows)
    const gap = gapFor(cols, parentIsSpace)
    // Offset rows are shifted half a period, so a row effectively needs room for
    // `cols + 0.5` cards to guarantee the shifted row still fits.
    const denom = cols + 0.5
    const perCard = (availableWidth - gap * (cols - 1)) / denom
    const cardW = Math.round(clamp(perCard, min.cardW, base.cardW))
    const cardH = Math.round(cardW / HEX_RATIO)
    // Interlocked rows advance by ¾ of card height; total stack height:
    const overlap = Math.round(cardH * 0.25)
    const stackH = cardH + (rows - 1) * (cardH - overlap)
    const widthOk = perCard >= min.cardW
    const heightOk = stackH <= HONEYCOMB_HEIGHT_BUDGET
    if (widthOk && heightOk) {
      return honeycomb(cardW, cardH, count, rows, gap)
    }
  }

  // Fallback: everything is tight — pack at min card into as many rows as needed.
  const cols = Math.max(1, Math.floor((availableWidth + gapFor(count, parentIsSpace)) / (min.cardW + gapFor(count, parentIsSpace))))
  const rows = Math.max(1, Math.ceil(count / Math.max(1, cols)))
  return honeycomb(min.cardW, min.cardH, count, rows, gapFor(cols, parentIsSpace))
}

function singleRow(cardW: number, cardH: number, count: number, parentIsSpace: boolean): DockLayout {
  return {
    cardW,
    cardH,
    contentScale: contentScaleFor(cardW),
    rowCounts: count > 0 ? [count] : [],
    gapX: gapFor(count, parentIsSpace),
    rowOverlap: 0,
    rowOffset: 0,
    multiRow: false,
  }
}

function honeycomb(cardW: number, cardH: number, count: number, rows: number, gapX: number): DockLayout {
  return {
    cardW,
    cardH,
    contentScale: contentScaleFor(cardW),
    rowCounts: distribute(count, rows),
    gapX,
    rowOverlap: Math.round(cardH * 0.25),
    rowOffset: Math.round((cardW + gapX) / 2),
    multiRow: true,
  }
}
