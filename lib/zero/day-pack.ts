const DAY_MS = 86_400_000
// Minimum effective duration (as a fraction of a day) an item reserves when packing
// overlap columns, so zero-length instants and very short items still claim a slot
// and push concurrent neighbours sideways instead of overlapping invisibly.
const MIN_EVENT_FRAC = (20 * 60 * 1000) / DAY_MS

export type DayBucketItem<T> = { it: T; isInstant: boolean }
// An item laid out inside a day band/column: `sf`/`ef` are time-of-day fractions
// [0,1] (top/bottom within the day); `col`/`cols` are its column index and the
// column count of its overlap cluster (so width = 1/cols, left = col/cols).
export type DayPlaced<T> = DayBucketItem<T> & { sf: number; ef: number; col: number; cols: number }

/**
 * Lay out one day's items like a mini day-calendar: each item is placed vertically
 * by its real start/end time (clipped to the day), and a run of mutually-overlapping
 * items is split into side-by-side COLUMNS (the classic calendar algorithm) so
 * concurrent items sit next to each other instead of stacking down the whole day.
 *
 * Generic over any item carrying a [from,to] epoch interval, so the serpentine
 * week-columns and the day-column week view share one implementation.
 */
export function packDay<T extends { from: number; to: number }>(
  bucket: DayBucketItem<T>[],
  dayStartMs: number,
): DayPlaced<T>[] {
  if (bucket.length === 0) return []
  const evs = bucket.map(({ it, isInstant }) => {
    const sf = Math.min(1, Math.max(0, (it.from - dayStartMs) / DAY_MS))
    const ef = Math.min(1, Math.max(sf, (it.to - dayStartMs) / DAY_MS))
    return { it, isInstant, sf, ef }
  })
  // Earliest first; longer first on ties for stable, left-anchored column packing.
  evs.sort((a, b) => a.sf - b.sf || b.ef - a.ef)
  const effEnd = (e: (typeof evs)[number]) => Math.max(e.ef, e.sf + MIN_EVENT_FRAC)

  const out: DayPlaced<T>[] = []
  let cluster: typeof evs = []
  let clusterEnd = -1
  const flush = () => {
    const colEnds: number[] = [] // effective end fraction currently occupying each column
    const tmp: { e: (typeof evs)[number]; col: number }[] = []
    for (const e of cluster) {
      let c = colEnds.findIndex((end) => end <= e.sf + 1e-6) // first free column
      if (c === -1) {
        c = colEnds.length
        colEnds.push(effEnd(e))
      } else {
        colEnds[c] = effEnd(e)
      }
      tmp.push({ e, col: c })
    }
    const cols = Math.max(1, colEnds.length)
    for (const { e, col } of tmp) out.push({ ...e, col, cols })
    cluster = []
    clusterEnd = -1
  }
  for (const e of evs) {
    // A gap (this item starts at/after everything seen so far) closes the cluster.
    if (cluster.length && e.sf >= clusterEnd - 1e-6) flush()
    cluster.push(e)
    clusterEnd = Math.max(clusterEnd, effEnd(e))
  }
  flush()
  return out
}
