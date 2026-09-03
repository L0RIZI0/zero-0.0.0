"use client"

import { useSyncExternalStore } from "react"

// ============================================================================
// Activity log — Zero's ACCESS tracker (STEP 1)
// ----------------------------------------------------------------------------
// ACCESS is the MACHINE TRUTH of where the user (Individual) was in the hierarchy
// over time — set purely on enter/exit, NEVER user-editable. The signal is the
// FRONT/FOCUSED space (`activeId` in the nav-store): whenever it changes, we close
// the current access segment and open a new one. Home (root) counts as a real
// access, so the timeline is gap-free. (This is the ONE canonical "where I was"
// record — the word "presence" is retired to avoid a second name for it.)
//
//   AccessSegment = { entityId, enteredAt, leftAt }
//     leftAt === null  ⇒ this is the CURRENT segment (still here); its effective
//                        end is `now` until superseded or flushed.
//
// PERSISTENCE: a DEDICATED localStorage key `zero:activity-log:v1`, entirely
// separate from the entity store (`zero:user-items:v2`). Append-only. This can
// never corrupt entity data — worst case the day log is wrong and can be cleared.
//
// This is intentionally the smallest engine that proves the idea. A dev-only
// inspector (`§ 3`) reads it; the real dayline UI comes in a later step. Idle
// detection was deliberately deferred — we approximate "walked away" only via a
// visibility flush (freeze the open segment when the tab/app is hidden, resume a
// fresh one when it returns).
// ============================================================================

export interface AccessSegment {
  /** The focused space's entity id at this moment (root = ROOT_ID, "0"). */
  entityId: string
  /** When this access began (epoch ms). */
  enteredAt: number
  /** When it ended (epoch ms), or null while it is the current access. */
  leftAt: number | null
}

// Root `/0` owns its OWN access log, isolated from `/2` (which uses the vendored
// `lib/zero-002` copy under `zero:activity-log:v1`). Mirrors the `zero:root-items:v1`
// data isolation so root's activity never mixes with the dogfooding shell's.
const STORAGE_KEY = "zero:root-activity:v1"
// Safety cap so the log can't grow unbounded in a long-lived session. Oldest
// segments are dropped first; a day rarely exceeds a few hundred switches.
const MAX_SEGMENTS = 5000

// ── LIVENESS HEARTBEAT (v0.2.302, DEVICE-LEVEL v0.2.303) ────────────────────
// A dedicated single-timestamp key recording the last moment we had POSITIVE evidence
// the user was present at the DEVICE. Separate from the segment log so it can't perturb
// the where-I-was timeline. Two feeds, both take the MAX (getLastKnownAlive folds them):
//   1. DEVICE IDLE POLL (desktop): every HEARTBEAT_MS the heartbeat asks Electron for the
//      OS-wide idle time (`window.zero.system.getIdleSeconds` → powerMonitor). If the
//      device was used within AWAY_THRESHOLD_MS we stamp the REAL last-input moment
//      (now − idle). This is the key fix (v0.2.303): presence follows the DEVICE, not
//      Zero's focus — working in another app on the same machine keeps sessions alive.
//   2. ZERO INPUT (all builds): a throttled stamp on real input INTO Zero, so the web
//      build (no powerMonitor) still has a heartbeat, and desktop stays fresh between polls.
// OS sleep freezes both the poll and input, so after wake the idle time reads large and we
// don't stamp — a stale heartbeat cleanly means "device was away / asleep".
const ALIVE_KEY = "zero:root-alive:v1"
// How often the device-idle poll ticks. Short enough that last-known-alive stays accurate to
// ~HEARTBEAT_MS, long enough to be negligible (one cheap IPC + maybe one localStorage write).
const HEARTBEAT_MS = 20_000
// Min gap between input-driven stamps, so pointermove doesn't hammer localStorage.
const INPUT_STAMP_THROTTLE_MS = 5_000
// How long without ANY proof of life counts as "away" — mirrors data.ts ALIVE_GRACE_MS (4min)
// so a quick close/reopen or reload stays LIVE and only a genuine absence arms the away
// behaviour. Re-declared here (not imported) to keep this module free of an entity-store dep.
// Loris tuned 60s → 4min (v0.2.324).
const AWAY_THRESHOLD_MS = 4 * 60_000

let segments: AccessSegment[] = []
let currentEntityId: string | null = null
let hydrated = false
let visibilityInstalled = false
let heartbeatInstalled = false
// Last time the input feed actually WROTE the alive key (throttle bookkeeping).
let lastInputStampAt = 0
// FROZEN at first hydrate, BEFORE the heartbeat starts stamping fresh values:
// were we away (no heartbeat within AWAY_THRESHOLD_MS) at the moment the app loaded?
// The canvas reads this to decide whether to suppress the auto-resume of ongoing.
let awayOnLoad = false

// Monotonic revision, bumped on every structural change. `segments` is mutated
// IN PLACE (push / set leftAt), so its array reference stays stable — a
// useSyncExternalStore snapshot keyed on the array alone would miss those edits.
// Consumers that need to recompute on any change subscribe to this number instead.
let revision = 0

const listeners = new Set<() => void>()
function emit() {
  revision++
  for (const l of listeners) l()
}

// --- persistence -----------------------------------------------------------

function read(): AccessSegment[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    // Defensive shape check — skip anything malformed rather than throw.
    return parsed.filter(
      (s): s is AccessSegment =>
        !!s &&
        typeof (s as AccessSegment).entityId === "string" &&
        typeof (s as AccessSegment).enteredAt === "number" &&
        ((s as AccessSegment).leftAt === null ||
          typeof (s as AccessSegment).leftAt === "number"),
    )
  } catch {
    return []
  }
}

function write(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(segments))
  } catch {
    // Storage unavailable (private mode / quota) — keep the in-memory log.
  }
}

// --- liveness heartbeat ----------------------------------------------------

function readAlive(): number | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(ALIVE_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function stampAlive(now: number): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(ALIVE_KEY, String(now))
  } catch {
    // storage unavailable — the in-memory app keeps running; worst case we read
    // a slightly stale alive time on the next load.
  }
}

// Advance the alive key, monotonically (never move it backwards).
function stampAliveMax(at: number): void {
  const prev = readAlive()
  if (prev == null || at > prev) stampAlive(at)
}

function installHeartbeat(): void {
  if (heartbeatInstalled || typeof window === "undefined") return
  heartbeatInstalled = true

  // FEED 2 — input INTO Zero: throttled stamp on any real user event. Keeps the
  // heartbeat fresh while Zero is focused (and is the ONLY feed on web, where there's
  // no powerMonitor). Throttled so pointermove can't hammer localStorage.
  const markInput = () => {
    const now = Date.now()
    if (now - lastInputStampAt >= INPUT_STAMP_THROTTLE_MS) {
      lastInputStampAt = now
      stampAliveMax(now)
    }
  }
  for (const ev of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const) {
    window.addEventListener(ev, markInput, { passive: true })
  }

  // FEED 1 — DEVICE idle poll (desktop only): stamp the real last-input moment whenever
  // the whole device was used within the away threshold, regardless of Zero's focus.
  const getIdleSeconds = window.zero?.system?.getIdleSeconds
  if (!getIdleSeconds) return // web build: input feed above is the only heartbeat
  window.setInterval(() => {
    const now = Date.now()
    getIdleSeconds()
      .then((idleSec) => {
        if (typeof idleSec !== "number") return
        const idleMs = idleSec * 1000
        // Device used within the threshold ⇒ stamp the ACTUAL last-input instant
        // (now − idle), so last-known-alive is precise even between polls. Beyond the
        // threshold we don't advance — the device is away and the cap will land here.
        if (idleMs < AWAY_THRESHOLD_MS) stampAliveMax(now - idleMs)
      })
      .catch(() => {})
  }, HEARTBEAT_MS)
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return
  hydrated = true
  segments = read()
  // FREEZE the away-on-load verdict BEFORE the heartbeat can stamp a fresh value.
  // `null` last-alive (fresh install / cleared) ⇒ NOT away (don't suppress on a
  // first run). Any prior evidence older than the threshold ⇒ we were away.
  const last = lastKnownAliveRaw()
  awayOnLoad = last != null && Date.now() - last > AWAY_THRESHOLD_MS
  installVisibility()
  installHeartbeat()
  // NB: we deliberately do NOT stamp alive here. The entity-store hydrate cleanup
  // (data.ts) reads getLastKnownAlive() to decide whether a dangling ongoing span
  // is continuous-across-reload or a shutdown; stamping now would spuriously make
  // every load look "alive just now" and never cap. Continuity for a genuine quick
  // reload comes from the PREVIOUS session's last heartbeat / pagehide flush, which
  // sits within AWAY_THRESHOLD_MS. The first fresh stamp happens on the next tick.
}

// --- core recording --------------------------------------------------------

function closeOpen(now: number): boolean {
  const last = segments[segments.length - 1]
  if (last && last.leftAt === null) {
    last.leftAt = now
    return true
  }
  return false
}

function trim(): void {
  if (segments.length > MAX_SEGMENTS) segments = segments.slice(-MAX_SEGMENTS)
}

/**
 * Record that the focused space is now `entityId` (an ACCESS event). Closes the
 * current open segment (if the place changed) and opens a new one. A repeat of the
 * same id is a no-op unless the open segment was previously flushed (then it
 * resumes). This is called from the nav-store whenever `activeId` changes.
 */
export function recordAccess(entityId: string, now: number = Date.now()): void {
  if (typeof window === "undefined") return
  hydrate()
  const last = segments[segments.length - 1]
  const hasOpenHere = !!last && last.leftAt === null && last.entityId === entityId
  if (currentEntityId === entityId && hasOpenHere) return

  closeOpen(now)
  segments.push({ entityId, enteredAt: now, leftAt: null })
  currentEntityId = entityId
  trim()
  write()
  emit()
}

// --- visibility flush (approximate "walked away" without idle detection) ----

function installVisibility(): void {
  if (visibilityInstalled || typeof document === "undefined") return
  visibilityInstalled = true

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // Freeze the current access segment when the app/tab goes to the background so
      // the duration doesn't inflate while it's closed.
      if (closeOpen(Date.now())) {
        write()
        emit()
      }
    } else if (currentEntityId) {
      // Back in the foreground — resume access in the same place.
      const last = segments[segments.length - 1]
      if (!(last && last.leftAt === null)) {
        segments.push({ entityId: currentEntityId, enteredAt: Date.now(), leftAt: null })
        trim()
        write()
        emit()
      }
    }
  })

  // Last-chance flush on unload — pagehide is more reliable than beforeunload.
  window.addEventListener("pagehide", () => {
    if (closeOpen(Date.now())) write()
  })
}

// --- queries ---------------------------------------------------------------

/** All raw segments (oldest → newest). The last may be open (`leftAt === null`). */
export function getSegments(): AccessSegment[] {
  hydrate()
  return segments
}

/** Local-midnight bounds of the day containing `ref`. */
export function getDayBounds(ref: number = Date.now()): { start: number; end: number } {
  const d = new Date(ref)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const end = start + 24 * 60 * 60 * 1000
  return { start, end }
}

export interface DaySegment extends AccessSegment {
  /** Effective end used for rendering/aggregation (`leftAt` or `now`), clipped. */
  endAt: number
  /** Clipped start within the day. */
  startAt: number
  /** Clipped duration in ms (≥ 0). */
  durationMs: number
}

/**
 * Segments that overlap the given day, each clipped to the day's bounds (and to
 * `now` for the open segment). Ordered oldest → newest.
 */
export function getSegmentsForDay(
  ref: number = Date.now(),
  now: number = Date.now(),
): DaySegment[] {
  hydrate()
  const { start, end } = getDayBounds(ref)
  const dayEnd = Math.min(end, now)
  const out: DaySegment[] = []
  for (const s of segments) {
    const rawEnd = s.leftAt ?? now
    const startAt = Math.max(s.enteredAt, start)
    const endAt = Math.min(rawEnd, dayEnd)
    if (endAt <= startAt) continue
    out.push({ ...s, startAt, endAt, durationMs: endAt - startAt })
  }
  return out
}

/**
 * The most recent moment we have EVIDENCE the app was alive: the max `leftAt` across
 * the access log (the visibility/pagehide flush stamps this on EVERY hide/reload —
 * see installVisibility), falling back to the max `enteredAt`. `null` when there's no
 * log yet. This is the NO-HEARTBEAT liveness signal: the entity-store hydrate cleanup
 * uses it to tell a genuine shutdown (close the dangling focus session at this moment)
 * from a mere reload while still present (keep it running). Reads storage directly when
 * not yet hydrated, so it's safe to call from the entity store's own hydrate path.
 */
export function getLastKnownAlive(): number | null {
  return lastKnownAliveRaw()
}

// The shared implementation — reads storage directly when not yet hydrated, so it's
// safe to call from the entity store's own hydrate path (which runs before this
// module's hydrate). Folds in BOTH signals: the access-segment flushes (visibility/
// pagehide/switch) AND the input-gated heartbeat's dedicated alive key (v0.2.302),
// taking whichever is most recent.
function lastKnownAliveRaw(): number | null {
  if (typeof window === "undefined") return null
  const source = hydrated ? segments : read()
  let max: number | null = null
  for (const s of source) {
    const t = s.leftAt ?? s.enteredAt
    if (max == null || t > max) max = t
  }
  const alive = readAlive()
  if (alive != null && (max == null || alive > max)) max = alive
  return max
}

/**
 * Were we AWAY when the app loaded — i.e. no evidence of presence within
 * AWAY_THRESHOLD_MS of load? Frozen at first hydrate (before the heartbeat stamps a
 * fresh value), so it's a stable verdict for the whole session. The canvas uses it to
 * suppress the auto-resume of `ongoing` after a real absence until the user clicks
 * back into the entity content. `false` on a fresh install (no prior data) and after
 * a quick reload within the grace window.
 */
export function wasAwayOnLoad(): boolean {
  hydrate()
  return awayOnLoad
}

/**
 * Stamp alive = NOW immediately (v0.2.303). Called by the canvas the instant the user clicks
 * back into ENTITY CONTENT to resume after an away-gap, so last-known-alive resets on the SAME
 * gesture that disarms the away state — otherwise the still-stale heartbeat would make the
 * runtime watchdog immediately re-cap the freshly-resumed session before the next idle poll runs.
 */
export function markAliveNow(): void {
  stampAliveMax(Date.now())
}

export interface SpaceRollup {
  entityId: string
  totalMs: number
  /** Number of distinct visits within the day. */
  visits: number
}

/** Per-space totals for the day, sorted by time spent (desc). */
export function getDayRollup(
  ref: number = Date.now(),
  now: number = Date.now(),
): SpaceRollup[] {
  const byEntity = new Map<string, SpaceRollup>()
  for (const s of getSegmentsForDay(ref, now)) {
    const prev = byEntity.get(s.entityId)
    if (prev) {
      prev.totalMs += s.durationMs
      prev.visits += 1
    } else {
      byEntity.set(s.entityId, { entityId: s.entityId, totalMs: s.durationMs, visits: 1 })
    }
  }
  return [...byEntity.values()].sort((a, b) => b.totalMs - a.totalMs)
}

/**
 * Wipe the entire activity log for THIS browser only (dedicated key, so entity
 * data is untouched). Used by a reset chord / the inspector's clear button.
 */
export function clearActivityLog(): void {
  segments = []
  currentEntityId = null
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  emit()
}

// --- React binding ---------------------------------------------------------

const subscribe = (cb: () => void) => {
  hydrate()
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Subscribe to structural changes in the log (new/closed segments). */
export function useActivityLog(): AccessSegment[] {
  return useSyncExternalStore(
    subscribe,
    () => segments,
    () => segments,
  )
}

/**
 * Subscribe to the log's revision counter. Returns a number that increments on
 * every structural change. Because `segments` is mutated in place, this is the
 * reliable trigger for consumers that read via `getSegments()` and want to
 * recompute whenever anything changes (e.g. the dayline's access layer).
 */
export function useActivityRevision(): number {
  return useSyncExternalStore(
    subscribe,
    () => revision,
    () => 0,
  )
}
