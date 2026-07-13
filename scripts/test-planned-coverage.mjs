// Standalone check of the PAST-planned-tick coverage math + opacity mapping used in
// components/zero0/zero0-dayline.tsx. Pure arithmetic mirror (no React/DOM), so it can run
// in node and assert the floor/linear/ceiling behavior deterministically.
const COVERAGE_OPACITY_MIN = 0.15
const COVERAGE_OPACITY_MAX = 0.9

// Mirror of the memo's per-occurrence overlap loop. `inSubtree(occId, segEntityId)` stands in
// for isInSubtree (self + space descendants); tests pass an explicit predicate.
function coverage(st, en, segs, inSubtree, now) {
  if (!(en > st && en <= now)) return undefined // future / ongoing / point → no score
  const total = en - st
  let overlap = 0
  for (const seg of segs) {
    const segEn = seg.leftAt ?? now
    if (segEn <= st || seg.enteredAt >= en) continue
    if (!inSubtree(seg.entityId)) continue
    overlap += Math.min(en, segEn) - Math.max(st, seg.enteredAt)
  }
  return Math.max(0, Math.min(1, overlap / total))
}

function opacity(cov) {
  return cov == null ? 0.4 : COVERAGE_OPACITY_MIN + cov * (COVERAGE_OPACITY_MAX - COVERAGE_OPACITY_MIN)
}

let failed = 0
function eq(label, got, want) {
  const ok = Math.abs(got - want) < 1e-9
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  got=${got} want=${want}`)
}

const now = 100_000
const here = (id) => id === "X" // matching-place predicate
// window [0,10000], 10s
const W = [0, 10_000]

// 0% covered → floor 0.15
eq("no presence → cov 0", coverage(...W, [], here, now), 0)
eq("no presence → opacity floor", opacity(coverage(...W, [], here, now)), 0.15)

// 50% covered (first half, matching place) → 0.525
const half = [{ entityId: "X", enteredAt: 0, leftAt: 5_000 }]
eq("50% → cov 0.5", coverage(...W, half, here, now), 0.5)
eq("50% → opacity 0.525", opacity(coverage(...W, half, here, now)), 0.525)

// 100% covered → ceiling 0.90
const full = [{ entityId: "X", enteredAt: 0, leftAt: 10_000 }]
eq("100% → cov 1", coverage(...W, full, here, now), 1)
eq("100% → opacity ceiling 0.90", opacity(coverage(...W, full, here, now)), 0.9)

// Presence at the WRONG place is ignored → floor
const wrong = [{ entityId: "Y", enteredAt: 0, leftAt: 10_000 }]
eq("wrong place → cov 0", coverage(...W, wrong, here, now), 0)

// Presence PARTIALLY outside the window is clipped (5s inside of a 10s seg) → 50%
const spill = [{ entityId: "X", enteredAt: -5_000, leftAt: 5_000 }]
eq("clipped spill → cov 0.5", coverage(...W, spill, here, now), 0.5)

// Open segment (leftAt null) uses `now` as its end
const open = [{ entityId: "X", enteredAt: 5_000, leftAt: null }]
eq("open seg → cov 0.5", coverage(...W, open, here, now), 0.5)

// A future window (end after now) → undefined (no score, stays flat 0.4)
eq("future → undefined", coverage(200_000, 210_000, full, here, now) === undefined ? 1 : 0, 1)

// Over-coverage from multiple matching segments is clamped to 1
const over = [
  { entityId: "X", enteredAt: 0, leftAt: 8_000 },
  { entityId: "X", enteredAt: 6_000, leftAt: 10_000 },
]
eq("over-coverage clamps → cov 1", coverage(...W, over, here, now), 1)

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
