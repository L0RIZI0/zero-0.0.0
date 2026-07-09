/**
 * ENTITY LIFECYCLE LOG — derive helpers for ontology Meta field 1.
 *
 * The target model is: an entity's lifecycle is ONE append-only, typed list of
 * {@link Instant} entries (created / done / undone / closed / reopened / … ), and
 * its CURRENT state is DERIVED by folding that log rather than read from separate
 * boolean scalars. See the "entity log model" memory / spec for the full plan.
 *
 * Every derive helper reads `entity.log` IF PRESENT and otherwise FALLS BACK to the
 * existing scalar fields (`createdAt`, `completed`, `completedOn`, `closed`/`closedOn`,
 * `reopened`/`reopenedOn`, `createdBy`, `createdWhere`), so entities that predate the
 * log — or seeded entities that never persist one — stay correct.
 *
 * PHASE 2 (Jul 2026): the completion + close/reopen WRITE paths in `data.ts` now
 * DUAL-WRITE — they keep the scalar fields (as a backup / rollback) AND append typed
 * {@link Instant} entries via {@link appendInstant}, seeding a coherent starting log
 * from the scalars via {@link buildLogFromScalars} when one is absent. Reads already
 * prefer the log, so it is the source of truth; the scalars are the safety net until
 * a later phase retires them. `cancelled` is intentionally NOT yet in the log (it has
 * no timestamp scalar to fold, so it would be lossy) — it stays scalar-only for now.
 *
 * The pure builders (`appendInstant`, `makeInstant`, `buildLogFromScalars`) never
 * mutate; they return new values, safe for the write paths and React state.
 */
import type { Entity, Epoch, Instant, LogType } from "./types"

/** Log entry types that TOGGLE completion on/off (the "doneState" parity view). */
const DONE_TYPES: readonly LogType[] = ["done", "undone"]

/**
 * The LAST entry whose type is one of `types`, scanning the log in order. Returns
 * `undefined` when the entity has no log or no matching entry. Order is defined by
 * the array itself (append-only ⇒ chronological); we do not re-sort by `at`.
 */
export function lastEntry(entity: Entity, ...types: LogType[]): Instant | undefined {
  const log = entity.log
  if (!log || log.length === 0) return undefined
  const want = new Set(types)
  for (let i = log.length - 1; i >= 0; i--) {
    if (want.has(log[i].type)) return log[i]
  }
  return undefined
}

/** The FIRST entry whose type is one of `types` (used for "created" = birth). */
export function firstEntry(entity: Entity, ...types: LogType[]): Instant | undefined {
  const log = entity.log
  if (!log || log.length === 0) return undefined
  const want = new Set(types)
  for (let i = 0; i < log.length; i++) {
    if (want.has(log[i].type)) return log[i]
  }
  return undefined
}

/** Whether the entity carries any log entries at all. */
export function hasLog(entity: Entity): boolean {
  return !!entity.log && entity.log.length > 0
}

// --- State derivations (log-if-present, else scalar fallback) ---------------

/**
 * Whether the entity is currently DONE. Log view: the latest done/undone toggle is
 * a `done`. This is the typed-log generalization of the user's "odd-length list ⇒
 * done" parity idea. Fallback: the scalar `completed` flag.
 */
export function isDone(entity: Entity): boolean {
  const last = lastEntry(entity, ...DONE_TYPES)
  if (last) return last.type === "done"
  return !!entity.completed
}

/** When completion last flipped true. Log: latest `done`.at; else `completedOn`. */
export function getCompletedOn(entity: Entity): Epoch | undefined {
  const last = lastEntry(entity, ...DONE_TYPES)
  if (last) return last.type === "done" ? last.at : undefined
  return entity.completedOn
}

/**
 * The current MANUAL close state — the "Close"/"Reopen" toggle, DISTINCT from
 * completion (done/undone) and from the cancelled/derived closes. Returns:
 *   - `"closed"`   — last close/reopen toggle was a Close;
 *   - `"reopened"` — last toggle was a Reopen (overrides a DERIVED close);
 *   - `null`       — never manually closed or reopened (derived rules apply).
 * Log view: the latest `closed`/`reopened` entry. Fallback: the `closed`/`reopened`
 * scalars (kept mutually exclusive by `setEntityClosed`). Callers (see `isClosed`)
 * still handle `cancelled` and the derived time-based closes separately.
 */
export function getCloseState(entity: Entity): "closed" | "reopened" | null {
  const last = lastEntry(entity, "closed", "reopened")
  if (last) return last.type === "closed" ? "closed" : "reopened"
  if (entity.closed) return "closed"
  if (entity.reopened) return "reopened"
  return null
}

/** Birth time. Log: first `created`.at; else the scalar `createdAt`. */
export function getCreatedAt(entity: Entity): Epoch | undefined {
  return firstEntry(entity, "created")?.at ?? entity.createdAt
}

/** Creator id. Log: first `created`.by; else the scalar `createdBy`. */
export function getCreatedBy(entity: Entity): string | undefined {
  return firstEntry(entity, "created")?.by ?? entity.createdBy
}

/** Creation place. Log: first `created`.where; else the scalar `createdWhere`. */
export function getCreatedWhere(entity: Entity): string | undefined {
  return firstEntry(entity, "created")?.where ?? entity.createdWhere
}

/**
 * The chronological ACCESS records ("who was here, when"). Only the log can express
 * these — there is no scalar equivalent — so this is empty until logs are populated.
 */
export function getAccesses(entity: Entity): Instant[] {
  return (entity.log ?? []).filter((e) => e.type === "accessed")
}

// --- Pure builders (for the Phase 2 write paths; no mutation) ---------------

/** Construct a single log entry, dropping undefined provenance fields. */
export function makeInstant(
  type: LogType,
  at: Epoch = Date.now(),
  provenance?: { by?: string; where?: string },
): Instant {
  const entry: Instant = { at, type }
  if (provenance?.by != null) entry.by = provenance.by
  if (provenance?.where != null) entry.where = provenance.where
  return entry
}

/**
 * Return a NEW log array with `entry` appended (never mutates the input). Use in
 * write paths so React state updates stay referentially clean.
 */
export function appendInstant(log: Instant[] | undefined, entry: Instant): Instant[] {
  return [...(log ?? []), entry]
}

/**
 * Fold an entity's legacy SCALAR lifecycle fields into a starting {@link Instant}
 * log — the one-time seed used by the Phase 2 migration AND by the write paths when
 * they encounter a pre-log entity. Best-effort and LOSSY by nature: the scalars only
 * retain the LATEST timestamp per axis (one `completedOn`, one `closedOn`, one
 * `reopenedOn`), so this reconstructs a coherent SNAPSHOT, not full history — real
 * history accumulates from the next toggle onward. Entries are sorted ascending by
 * `at` so `created` comes first. `cancelled` is deliberately excluded (no timestamp).
 */
export function buildLogFromScalars(entity: Entity): Instant[] {
  const log: Instant[] = []
  const createdAt = entity.createdAt ?? entity.completedOn ?? Date.now()
  log.push(makeInstant("created", createdAt, { by: entity.createdBy, where: entity.createdWhere }))
  if (entity.completed && entity.completedOn != null) log.push(makeInstant("done", entity.completedOn))
  if (entity.closed && entity.closedOn != null) log.push(makeInstant("closed", entity.closedOn))
  if (entity.reopened && entity.reopenedOn != null) log.push(makeInstant("reopened", entity.reopenedOn))
  return log.sort((a, b) => a.at - b.at)
}
