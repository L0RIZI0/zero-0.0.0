/**
 * ENTITY LIFECYCLE LOG — derive helpers for ontology Meta field 1.
 *
 * The target model is: an entity's lifecycle is ONE append-only, typed list of
 * {@link Instant} entries (created / done / undone / closed / reopened / … ), and
 * its CURRENT state is DERIVED by folding that log rather than read from separate
 * boolean scalars. See the "entity log model" memory / spec for the full plan.
 *
 * PHASE 1 (this file): additive + NON-data-touching. Nothing here writes to storage
 * and no entity carries a `log` yet. Every helper reads `entity.log` IF PRESENT and
 * otherwise FALLS BACK to the existing scalar fields (`createdAt`, `completed`,
 * `completedOn`, `createdBy`, `createdWhere`). Because no persisted entity has a
 * `log`, these helpers are behavior-preserving today — they exist so the rest of the
 * app can start reading through them, ahead of the Phase 2 migration that will fold
 * the scalars into a real `log` and switch write paths to append Instants.
 *
 * The pure builders (`appendInstant`, `makeInstant`) never mutate; they return a new
 * array, ready for the Phase 2 write paths.
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
