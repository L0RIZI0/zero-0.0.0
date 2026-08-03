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

let segments: AccessSegment[] = []
let currentEntityId: string | null = null
let hydrated = false
let visibilityInstalled = false

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

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return
  hydrated = true
  segments = read()
  installVisibility()
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
  if (typeof window === "undefined") return null
  const source = hydrated ? segments : read()
  let max: number | null = null
  for (const s of source) {
    const t = s.leftAt ?? s.enteredAt
    if (max == null || t > max) max = t
  }
  return max
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
