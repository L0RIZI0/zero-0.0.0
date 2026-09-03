/**
 * dock-layout.ts — the Dock's pure layout engine.
 *
 * SINGLE SOURCE OF TRUTH for how pinned cards (ENTx · REG2) are sized and packed
 * given the available width. It is a pure function (no DOM, no React) so it can be
 * unit-reasoned and tweaked in one place; `dock.tsx` measures the container width
 * and renders whatever this returns.
 *
 * DESIGN (matches the product intent) — a PROGRESSIVE, SINGLE-ROW cascade as width
 * tightens (e.g. an in/out panel squeezes REG2). Each regime is exhausted before the
 * next begins (with minor natural overlap), so the dock degrades gracefully:
 *  0. GAP SQUEEZE — cards stay at their full base size; only the inter-card GAP
 *     shrinks, from `wide` down to `tight`. Cards simply slide closer together.
 *  1. FRAME SHRINK — gap has bottomed out at `tight`; now the card FRAME + padding
 *     shrink while the content (glyph/title/meta) stays at scale 1.
 *  2. CONTENT SHRINK — the frame is now too close to the content, so the CONTENT
 *     scales down too, but never below CONTENT_FLOOR (comfortable min font sizes).
 *     The card bottoms out at CARD_FLOOR (the width at which content hits the floor)
 *     and stays there. The dock stays a SINGLE ROW at all times — no wrapping.
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

/** Single-row gap bounds. `wide` = resting, roomy spacing; `tight` = the floor the gap
 *  bottoms out at. The gap and the card frame shrink TOGETHER as width tightens (see
 *  computeDockLayout), but the gap shrinks FASTER (GAP_AGGRESSION) so it visually keeps
 *  pace with — rather than lagging behind — the shrinking frames. Cards inside a Space
 *  pack a touch tighter than inside a task/event context. */
function gapBounds(parentIsSpace: boolean) {
  return { wide: parentIsSpace ? 28 : 36, tight: parentIsSpace ? 12 : 16 }
}

/** How much faster the GAP shrinks than the card frame (in fractional terms). At 2, the
 *  gap reaches its `tight` floor by the time the card has shrunk only halfway from base
 *  to floor — counterbalancing the fact that a smaller card would otherwise make the gap
 *  look relatively larger. */
const GAP_AGGRESSION = 2

/** Width at which content begins to scale (regime 1 → 2 boundary): the content
 *  stack's intrinsic width plus minimal horizontal padding. Below this the frame
 *  can no longer absorb the shrink with padding alone. */
const CONTENT_INTRINSIC_W = 72 // glyph/title/counter natural width at scale 1
const MIN_PAD_X = 6 // minimal breathing room each side before content scales
const CONTENT_BOUND_W = CONTENT_INTRINSIC_W + MIN_PAD_X * 2 // ≈ 84

/** Absolute smallest card width. This is the point at which the content has scaled all
 *  the way to CONTENT_FLOOR — shrinking the frame further would only shrink content
 *  below the comfortable floor, so the card stops here and the dock stays single-row. */
const CARD_FLOOR_W = Math.round(CONTENT_BOUND_W * CONTENT_FLOOR) // ≈ 67

/** Content scale for a chosen card width: 1 until the frame crowds the content, then
 *  down toward CONTENT_FLOOR. */
function contentScaleFor(cardW: number) {
  if (cardW >= CONTENT_BOUND_W) return 1
  return clamp(cardW / CONTENT_BOUND_W, CONTENT_FLOOR, 1)
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export function computeDockLayout(input: Input): DockLayout {
  const { availableWidth, count, parentIsSpace, contextDepth } = input
  const base = baseCard(contextDepth)
  const { wide, tight } = gapBounds(parentIsSpace)

  // Before measurement (SSR / first paint), render the resting single row so the dock
  // matches its historical look until the ResizeObserver reports a real width.
  if (!availableWidth || availableWidth <= 0 || count <= 0) {
    return singleRow(base.cardW, base.cardH, wide, count)
  }

  // A lone card: no gap to squeeze — the frame just shrinks toward the floor if starved.
  if (count === 1) {
    const cardW = Math.round(clamp(availableWidth, CARD_FLOOR_W, base.cardW))
    return singleRow(cardW, Math.round(cardW / HEX_RATIO), wide, 1)
  }

  // CO-SHRINK MODEL. The card frame and the inter-card gap shrink TOGETHER and
  // continuously as the width tightens — no discrete "gap first, then frame" regimes.
  // They're coupled: as the card shrinks from `base` toward the floor by fraction
  // `fc`, the gap shrinks from `wide` toward `tight` by fraction `fc × GAP_AGGRESSION`
  // (so the gap moves faster and bottoms out first). We solve for the `cardW` that makes
  // `n·cardW + (n−1)·gap(cardW) = availableWidth`, i.e. cards + gaps exactly fill the row.
  //
  //   gap(cardW) = wide − G·min(1, AGG·fc),   fc = (base − cardW)/(base − floor)
  //
  // This is piecewise-linear in cardW with a knee where the gap hits `tight`:
  const D = base.cardW - CARD_FLOOR_W // total frame shrink room
  const G = wide - tight // total gap shrink room
  const n = count

  // Resting / roomy: at or above the full base row width, stay at base + wide gap
  // (extra space just leaves the centered row breathing).
  const restWidth = n * base.cardW + (n - 1) * wide
  if (availableWidth >= restWidth) {
    return singleRow(base.cardW, base.cardH, wide, n)
  }

  // Segment A — gap still descending (fc < 1/AGG). Solve the linear total for cardW:
  //   total = n·cardW + (n−1)·[wide − G·AGG·(base − cardW)/D]
  // Let A = (n−1)·G·AGG/D → total = (n + A)·cardW + (n−1)·wide − A·base.
  const A = ((n - 1) * G * GAP_AGGRESSION) / D
  const cardW_A = (availableWidth - (n - 1) * wide + A * base.cardW) / (n + A)
  const cardW_gapFloor = base.cardW - D / GAP_AGGRESSION // width at which gap reaches tight

  let cardW: number
  let gap: number
  if (cardW_A >= cardW_gapFloor) {
    // Gap has not yet floored: both shrink together, gap faster.
    cardW = cardW_A
    const fc = (base.cardW - cardW) / D
    gap = wide - G * GAP_AGGRESSION * fc
  } else {
    // Segment B — gap floored at `tight`; the frame keeps shrinking alone toward the
    // floor. Content scaling (contentScaleFor, applied in singleRow) takes over once the
    // frame crosses ~84px. The card bottoms out at CARD_FLOOR_W and STAYS there — single
    // row always, so an even narrower width just overflows/clips (never wraps).
    gap = tight
    cardW = (availableWidth - tight * (n - 1)) / n
  }

  cardW = Math.round(clamp(cardW, CARD_FLOOR_W, base.cardW))
  return singleRow(cardW, Math.round(cardW / HEX_RATIO), Math.round(clamp(gap, tight, wide)), n)
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
