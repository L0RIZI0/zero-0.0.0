// ============================================================================
// SLEEP SKY — a dreamy, procedurally-generated night sky for sleep Moments.
// ----------------------------------------------------------------------------
// A sleep Moment's tick isn't a flat accent bar — it's a tiny window onto the
// night the user slept through: a deep blue→plum→pink nebula wash, a couple of
// soft amber/rose cloud glows, and a scatter of stars (round dots + a few
// spiky 4-point sparkles).
//
// It is built ENTIRELY out of layered CSS gradients (one `background` string),
// so it costs the browser a single paint and rides the timeline's pan/ripple
// transforms for free — no <canvas>, no per-frame JS, no image to load. Each
// sleep gets its OWN sky because every layer's position/size/hue is drawn from
// a PRNG seeded by the occurrence key: stable across renders & pans (so it
// never shimmers), yet unique per night (a recurring "Slept" differs nightly).
//
// The idle veil (a dark overlay that lifts on hover) is NOT baked in here — the
// components paint the veil as a separate layer so the sky itself stays vivid.
// ============================================================================

/** Deterministic 32-bit hash of a string → PRNG seed. */
function hashSeed(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 — tiny, fast, well-distributed seeded PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A sleep title = the moment is a slumber. Matches "Slept", "Sleep", "Sleeping",
 * "asleep", "nap"/"napped"/"napping", "slumber", "dozed", "snoozed" — leading word,
 * case-insensitive, so both "slept" and "Slept" (and "Napped a bit") light up.
 */
const SLEEP_RE = /^\s*(slept|sleep(ing)?|asleep|nap(ped|ping)?|slumber(ed|ing)?|dozed?|snoozed?)\b/i

export function isSleepTitle(title: string | undefined | null): boolean {
  return !!title && SLEEP_RE.test(title)
}

// Palette anchors for the nebula base — deep night blues into royal purple, plum
// and a dusty rose, with warm amber reserved for the glowing star-cluster clouds.
const NIGHT_BLUE = ["#0b1030", "#101a44", "#16205a", "#1c2b6b"] // cold, oceanic night
const NIGHT_PLUM = ["#1b1740", "#33235f", "#3d2a5e", "#472a63"] // royal purple
const NIGHT_ROSE = ["#5a2f63", "#6e335f", "#7d3f5e", "#8a4a63"] // dusty plum-rose
const CLOUD_WARM = ["#d9a45b", "#e6b36b", "#c98a52", "#e0a860"] // amber "milky way" glow
const CLOUD_ROSE = ["#9c5a86", "#8a4d7a", "#b06a80", "#a35c88"] // pinkish nebula clouds

const pick = <T>(rnd: () => number, arr: T[]): T => arr[Math.floor(rnd() * arr.length) % arr.length]
const rint = (rnd: () => number, lo: number, hi: number) => Math.round(lo + rnd() * (hi - lo))
const rflt = (rnd: () => number, lo: number, hi: number) => lo + rnd() * (hi - lo)

/**
 * Build the CSS `background` value (layered top→bottom: stars, then cloud glows,
 * then the base nebula gradient) for a sleep tick, seeded by `seed`.
 */
export function sleepSkyBackground(seed: string): string {
  const rnd = mulberry32(hashSeed(seed))
  const layers: string[] = []

  // --- MOOD — each night leans somewhere on two axes so no two skies feel alike:
  //     `blue` (0 cold-blue … 1 warm-plum-rose) tilts the base palette, and
  //     `starry` (0 sparse … 1 dense) scales the star count. ---
  const blue = rnd()
  const starry = rnd()

  // --- STARS (top layers) — a seeded scatter, MOSTLY pure white (a minority
  //     warm-gold), bright (high alpha) so they read as real stars, not haze.
  //     A few are larger, and a handful are spiky 4-point sparkles (a soft core
  //     dot + a crossed pair of thin rays). Percentage-positioned so they spread
  //     across the bar at any width. Count scales with the `starry` mood. ---
  const starCount = Math.round(26 + starry * 18) // ~26–44
  for (let i = 0; i < starCount; i++) {
    const x = rflt(rnd, 1, 99).toFixed(1)
    const y = rflt(rnd, 6, 94).toFixed(1)
    // Most stars small; a minority noticeably larger (rnd()^3 biases small).
    const big = rnd() < 0.16
    const r = (big ? rflt(rnd, 1.8, 2.8) : rflt(rnd, 0.5, 1.4)).toFixed(2)
    const gold = rnd() < 0.18
    const a = rflt(rnd, 0.72, 1).toFixed(2)
    const core = gold ? `rgba(255,226,175,${a})` : `rgba(255,255,255,${a})`
    layers.push(`radial-gradient(${r}px ${r}px at ${x}% ${y}%, ${core} 0%, rgba(255,255,255,0) 72%)`)
  }

  // --- SPIKY 4-POINT SPARKLES — 3–5 of them, each a crossed pair of thin ray
  //     ellipses (wide+short and tall+narrow) that read as a "+" glint. Placed
  //     independently and kept bright & white. ---
  const spikeCount = rint(rnd, 3, 5)
  for (let i = 0; i < spikeCount; i++) {
    const x = rflt(rnd, 4, 96).toFixed(1)
    const y = rflt(rnd, 12, 88).toFixed(1)
    const len = rflt(rnd, 3.2, 5.5) // ray half-length in px
    const thin = 0.55
    const a = rflt(rnd, 0.8, 1).toFixed(2)
    const c = `rgba(255,255,255,${a})`
    // horizontal ray, then vertical ray → a crossed sparkle
    layers.push(`radial-gradient(${len.toFixed(1)}px ${thin}px at ${x}% ${y}%, ${c} 0%, rgba(255,255,255,0) 80%)`)
    layers.push(`radial-gradient(${thin}px ${len.toFixed(1)}px at ${x}% ${y}%, ${c} 0%, rgba(255,255,255,0) 80%)`)
  }

  // --- CLOUD GLOWS (mid layers) — 1 amber "milky-way" cluster + 1-2 rose nebula
  //     puffs, large soft ellipses at seeded spots, low alpha so they bloom. A
  //     bluer night keeps the warm cluster fainter. ---
  const warmX = rint(rnd, 40, 80)
  const warmY = rint(rnd, 30, 70)
  const warmAlpha = (0.34 + (1 - blue) * 0.24).toFixed(2) // fainter on cold-blue nights
  layers.push(
    `radial-gradient(${rint(rnd, 55, 90)}% ${rint(rnd, 120, 200)}% at ${warmX}% ${warmY}%, ` +
      `${hexA(pick(rnd, CLOUD_WARM), Number(warmAlpha))} 0%, ${hexA(pick(rnd, CLOUD_WARM), 0.14)} 35%, rgba(0,0,0,0) 70%)`,
  )
  const roseCount = rint(rnd, 1, 2)
  for (let i = 0; i < roseCount; i++) {
    layers.push(
      `radial-gradient(${rint(rnd, 50, 85)}% ${rint(rnd, 110, 190)}% at ${rint(rnd, 5, 55)}% ${rint(rnd, 25, 75)}%, ` +
        `${hexA(pick(rnd, CLOUD_ROSE), 0.4)} 0%, rgba(0,0,0,0) 68%)`,
    )
  }

  // --- BASE NEBULA (bottom layer) — a seeded-angle linear wash. The `blue` mood
  //     picks stops from a cold-blue-heavy set or a warm-plum-rose-heavy set so
  //     some nights read distinctly bluer and others rosier. ---
  const angle = rint(rnd, 80, 130)
  const coldPool = [...NIGHT_BLUE, ...NIGHT_BLUE, ...NIGHT_PLUM]
  const warmPool = [...NIGHT_PLUM, ...NIGHT_ROSE, ...NIGHT_ROSE]
  const pool = blue < 0.5 ? coldPool : warmPool
  const a0 = pick(rnd, pool)
  const a1 = pick(rnd, pool)
  const a2 = pick(rnd, blue < 0.5 ? [...coldPool, ...CLOUD_ROSE] : [...warmPool, ...CLOUD_ROSE])
  const a3 = pick(rnd, pool)
  layers.push(`linear-gradient(${angle}deg, ${a0} 0%, ${a1} 38%, ${a2} 68%, ${a3} 100%)`)

  return layers.join(", ")
}

/** #rrggbb + alpha → rgba() string. */
function hexA(hex: string, alpha: number): string {
  const n = hex.replace("#", "")
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
