// ============================================================================
// SLEEP SKY (/0) — a procedurally-generated night sky for sleep Moments.
// ----------------------------------------------------------------------------
// A sleep Moment's planned tick isn't a flat accent bar — it's a tiny window
// onto the night the user slept through: a deep-blue nebula wash, a faint warm
// cloud glow, and a scatter of stars (round dots + a few 4-point sparkles).
//
// Built ENTIRELY from layered CSS gradients (one `background` string), so it
// costs a single paint and rides the timeline's pan/ripple transforms for free
// — no <canvas>, no per-frame JS, no image. Each sleep gets its OWN sky, seeded
// by a PRNG on the occurrence key: stable across renders & pans (never shimmers)
// yet unique per night.
//
// This is the /0 variant of the /2 sleep-sky, tuned BLUER + DARKER to fit the
// near-black zero0 canvas: deeper night-blue anchors, the cold palette chosen
// far more often, and the warm "milky-way" glow kept fainter so the tick reads
// as a cold, dim, oceanic night rather than /2's warmer dreamscape.
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
 * case-insensitive.
 */
const SLEEP_RE = /^\s*(slept|sleep(ing)?|asleep|nap(ped|ping)?|slumber(ed|ing)?|dozed?|snoozed?)\b/i

export function isSleepTitle(title: string | undefined | null): boolean {
  return !!title && SLEEP_RE.test(title)
}

// Palette anchors — pushed DARKER + BLUER than /2. The night blues start nearly
// black and stay oceanic; plum/rose are deepened so even a "warm" night reads dim.
const NIGHT_BLUE = ["#05081f", "#070d2e", "#0b1440", "#101e52"] // near-black → deep oceanic blue
const NIGHT_PLUM = ["#0d0b2a", "#181146", "#241a52", "#2c1f57"] // dark royal purple
const NIGHT_ROSE = ["#3a1f48", "#4a2450", "#552a52", "#5f3358"] // muted deep plum-rose
const CLOUD_WARM = ["#b07f3f", "#c2924f", "#a06f3c", "#b58a4a"] // dimmer amber glow
const CLOUD_ROSE = ["#6e3f66", "#5f375f", "#7a4a68", "#6c3f6a"] // deep pink nebula clouds

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

  // MOOD — `blue` (0 cold … 1 warm) tilts the base palette; `starry` scales stars.
  const blue = rnd()
  const starry = rnd()

  // STARS — a seeded scatter, mostly pure white (a minority warm-gold), bright so
  // they read as real stars against the dark. Count scales with `starry`.
  const starCount = Math.round(26 + starry * 18) // ~26–44
  for (let i = 0; i < starCount; i++) {
    const x = rflt(rnd, 1, 99).toFixed(1)
    const y = rflt(rnd, 6, 94).toFixed(1)
    const big = rnd() < 0.16
    const r = (big ? rflt(rnd, 1.8, 2.8) : rflt(rnd, 0.5, 1.4)).toFixed(2)
    const gold = rnd() < 0.08 // fewer gold stars → cooler overall
    const a = rflt(rnd, 0.72, 1).toFixed(2)
    const core = gold ? `rgba(255,226,175,${a})` : `rgba(255,255,255,${a})`
    layers.push(`radial-gradient(${r}px ${r}px at ${x}% ${y}%, ${core} 0%, rgba(255,255,255,0) 72%)`)
  }

  // SPIKY 4-POINT SPARKLES — 3–5 crossed ray pairs that read as a "+" glint.
  const spikeCount = rint(rnd, 3, 5)
  for (let i = 0; i < spikeCount; i++) {
    const x = rflt(rnd, 4, 96).toFixed(1)
    const y = rflt(rnd, 12, 88).toFixed(1)
    const len = rflt(rnd, 3.2, 5.5)
    const thin = 0.55
    const a = rflt(rnd, 0.8, 1).toFixed(2)
    const c = `rgba(255,255,255,${a})`
    layers.push(`radial-gradient(${len.toFixed(1)}px ${thin}px at ${x}% ${y}%, ${c} 0%, rgba(255,255,255,0) 80%)`)
    layers.push(`radial-gradient(${thin}px ${len.toFixed(1)}px at ${x}% ${y}%, ${c} 0%, rgba(255,255,255,0) 80%)`)
  }

  // CLOUD GLOWS — 1 amber "milky-way" cluster + 1-2 rose puffs. Kept FAINTER than
  // /2 (lower alpha) so the warmth never overpowers the dark-blue base.
  const warmX = rint(rnd, 40, 80)
  const warmY = rint(rnd, 30, 70)
  const warmAlpha = (0.14 + (1 - blue) * 0.14).toFixed(2) // fainter than /2's 0.22 base
  layers.push(
    `radial-gradient(${rint(rnd, 55, 90)}% ${rint(rnd, 120, 200)}% at ${warmX}% ${warmY}%, ` +
      `${hexA(pick(rnd, CLOUD_WARM), Number(warmAlpha))} 0%, ${hexA(pick(rnd, CLOUD_WARM), 0.06)} 35%, rgba(0,0,0,0) 70%)`,
  )
  const roseCount = rint(rnd, 1, 2)
  for (let i = 0; i < roseCount; i++) {
    layers.push(
      `radial-gradient(${rint(rnd, 50, 85)}% ${rint(rnd, 110, 190)}% at ${rint(rnd, 5, 55)}% ${rint(rnd, 25, 75)}%, ` +
        `${hexA(pick(rnd, CLOUD_ROSE), 0.3)} 0%, rgba(0,0,0,0) 68%)`,
    )
  }

  // BASE NEBULA — a seeded-angle linear wash. Lean HARD toward the cold pool so
  // most nights read distinctly blue; only the warmest tail draws rosier stops.
  const angle = rint(rnd, 80, 130)
  const coldPool = [...NIGHT_BLUE, ...NIGHT_BLUE, ...NIGHT_BLUE, ...NIGHT_BLUE, ...NIGHT_PLUM]
  const warmPool = [...NIGHT_BLUE, ...NIGHT_BLUE, ...NIGHT_PLUM, ...NIGHT_ROSE]
  const cold = blue < 0.78 // far bluer bias than /2's 0.62
  const pool = cold ? coldPool : warmPool
  const a0 = pick(rnd, pool)
  const a1 = pick(rnd, pool)
  const a2 = pick(rnd, cold ? coldPool : [...warmPool, ...CLOUD_ROSE])
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
