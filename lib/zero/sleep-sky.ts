// ============================================================================
// SLEEP SKY — a dreamy, procedurally-generated night sky for sleep Moments.
// ----------------------------------------------------------------------------
// A sleep Moment's dayline tick isn't a flat accent bar — it's a tiny window
// onto the night the user slept through: a deep blue→plum→pink nebula wash,
// a couple of soft amber/rose cloud glows, and a scatter of star dots.
//
// It is built ENTIRELY out of layered CSS gradients (one `background` string),
// so it costs the browser a single paint and rides the dayline's pan/ripple
// transforms for free — no <canvas>, no per-frame JS, no image to load. Each
// sleep gets its OWN sky because every layer's position/size/hue is drawn from
// a PRNG seeded by the occurrence key: stable across renders & pans (so it
// never shimmers), yet unique per night (a recurring "Slept" differs nightly).
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
const NIGHT = ["#12102e", "#1b1740", "#33235f", "#5a2f63", "#7d3f5e"]
const CLOUD_WARM = ["#d9a45b", "#e6b36b", "#c98a52"] // amber "milky way" glow
const CLOUD_ROSE = ["#9c5a86", "#8a4d7a", "#b06a80"] // pinkish nebula clouds

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

  // --- STARS (top layers) — a seeded scatter of tiny soft dots, mostly white
  //     with a few warm-gold ones. Percentage-positioned so they spread across
  //     the bar whatever its width; kept modest in count to stay light. ---
  const starCount = rint(rnd, 14, 22)
  for (let i = 0; i < starCount; i++) {
    const x = rflt(rnd, 1, 99).toFixed(1)
    const y = rflt(rnd, 8, 92).toFixed(1)
    const r = rflt(rnd, 0.5, 1.5).toFixed(2)
    const gold = rnd() < 0.28
    const a = rflt(rnd, 0.5, 1).toFixed(2)
    const core = gold ? `rgba(255,224,170,${a})` : `rgba(255,255,255,${a})`
    layers.push(`radial-gradient(${r}px ${r}px at ${x}% ${y}%, ${core} 0%, rgba(255,255,255,0) 70%)`)
  }

  // --- CLOUD GLOWS (mid layers) — 1 amber "milky-way" cluster + 1-2 rose nebula
  //     puffs, large soft ellipses at seeded spots, low alpha so they bloom. ---
  const warmX = rint(rnd, 40, 80)
  const warmY = rint(rnd, 30, 70)
  layers.push(
    `radial-gradient(${rint(rnd, 55, 90)}% ${rint(rnd, 120, 200)}% at ${warmX}% ${warmY}%, ` +
      `${hexA(pick(rnd, CLOUD_WARM), 0.5)} 0%, ${hexA(pick(rnd, CLOUD_WARM), 0.16)} 35%, rgba(0,0,0,0) 70%)`,
  )
  const roseCount = rint(rnd, 1, 2)
  for (let i = 0; i < roseCount; i++) {
    layers.push(
      `radial-gradient(${rint(rnd, 50, 85)}% ${rint(rnd, 110, 190)}% at ${rint(rnd, 5, 55)}% ${rint(rnd, 25, 75)}%, ` +
        `${hexA(pick(rnd, CLOUD_ROSE), 0.42)} 0%, rgba(0,0,0,0) 68%)`,
    )
  }

  // --- BASE NEBULA (bottom layer) — a seeded-angle linear wash through the night
  //     palette so no two skies share the same ground tone progression. ---
  const angle = rint(rnd, 80, 130)
  const a0 = pick(rnd, NIGHT)
  const a1 = pick(rnd, NIGHT)
  const a2 = pick(rnd, [...NIGHT, ...CLOUD_ROSE])
  const a3 = pick(rnd, NIGHT)
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
