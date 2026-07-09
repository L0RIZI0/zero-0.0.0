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

/**
 * The entity's title AS OF `epoch` — folds the additive `titleLog` so a historical view
 * (the activity tracker) shows the name the entity carried at that time rather than its
 * current one. Falls back to the current `title` when there is no history (never renamed).
 * The `titleLog` is chronological (oldest→newest); we return the last entry with
 * `at <= epoch`, and for a time BEFORE the first recorded title we return that earliest
 * known title (the closest faithful answer).
 */
export function titleAt(entity: Entity, epoch: Epoch): string {
  const log = entity.titleLog
  if (!log || log.length === 0) return entity.title
  let result = log[0].title
  for (const entry of log) {
    if (entry.at <= epoch) result = entry.title
    else break
  }
  return result
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

/** Log entry types that TOGGLE the COMPLETE verdict on/off (its own axis). */
const COMPLETE_TYPES: readonly LogType[] = ["completed", "uncompleted"]

/**
 * The EXPLICIT complete verdict from the log/scalars, IGNORING derivation:
 *   - `true`  — last complete-axis entry is `completed` (or the scalar is set);
 *   - `false` — last complete-axis entry is `uncompleted` (e.g. after a Reopen);
 *   - `null`  — never explicitly (un)completed ⇒ the caller applies DERIVED rules.
 * The `false` case is what makes Reopen stick: it short-circuits the derived
 * "done → midnight ⇒ complete" rule so a reopened entity stays open. Lives here
 * with the other log readers; the derived rule itself is in {@link isComplete}.
 */
export function getExplicitComplete(entity: Entity): boolean | null {
  const last = lastEntry(entity, ...COMPLETE_TYPES)
  if (last) return last.type === "completed"
  if (entity.complete) return true
  return null
}

/** When the COMPLETE verdict last flipped true. Log: latest `completed`.at; else `completeOn`. */
export function getCompleteOn(entity: Entity): Epoch | undefined {
  const last = lastEntry(entity, ...COMPLETE_TYPES)
  if (last) return last.type === "completed" ? last.at : undefined
  return entity.completeOn
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

/**
 * Whether the entity is currently CANCELLED (called off) — a separate axis from
 * done and closed. Log view: the latest `cancelled`/`restored` entry is a cancel.
 * Fallback: the `cancelled` scalar. (`restored` un-cancels.)
 */
export function isCancelled(entity: Entity): boolean {
  const last = lastEntry(entity, "cancelled", "restored")
  if (last) return last.type === "cancelled"
  return !!entity.cancelled
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
 * `at` so `created` comes first.
 *
 * `cancelled` folds in via `cancelledOn` (Phase 2b); entities cancelled BEFORE that
 * scalar existed have no real time, so this approximates them at `createdAt`. The
 * terminal `retired`/`died` states fold from `retiredOn`/`diedOn` (per-kind fields).
 */
export function buildLogFromScalars(entity: Entity): Instant[] {
  const log: Instant[] = []
  // Terminal timestamps live on per-kind interfaces, not EntityBase.
  const term = entity as { retiredOn?: Epoch; diedOn?: Epoch }
  const createdAt = entity.createdAt ?? entity.completedOn ?? Date.now()
  log.push(makeInstant("created", createdAt, { by: entity.createdBy, where: entity.createdWhere }))
  if (entity.completed && entity.completedOn != null) log.push(makeInstant("done", entity.completedOn))
  if (entity.complete && entity.completeOn != null) log.push(makeInstant("completed", entity.completeOn))
  if (entity.closed && entity.closedOn != null) log.push(makeInstant("closed", entity.closedOn))
  if (entity.reopened && entity.reopenedOn != null) log.push(makeInstant("reopened", entity.reopenedOn))
  // Cancelled: use its timestamp when known, else approximate at creation time.
  if (entity.cancelled) log.push(makeInstant("cancelled", entity.cancelledOn ?? createdAt))
  if (term.retiredOn != null) log.push(makeInstant("retired", term.retiredOn))
  if (term.diedOn != null) log.push(makeInstant("died", term.diedOn))
  return log.sort((a, b) => a.at - b.at)
}

/** One disagreement between an entity's log-derived state and its scalar backup. */
export interface LogScalarMismatch {
  id: string
  axis: "done" | "closed" | "cancelled"
  fromLog: string | boolean
  fromScalar: string | boolean
}

/**
 * DEV-only consistency audit (log-model Phase 3 groundwork): for an entity that
 * ALREADY carries a `log`, verify the log-derived state agrees with the scalar
 * backup on each lifecycle axis (done / manual-close / cancelled). Returns the list
 * of disagreements (empty = consistent). This is the safety check that must stay
 * clean through dogfooding BEFORE the scalars are retired — while both are written,
 * a mismatch means a write path updated one without the other (a bug to fix).
 *
 * Entities WITHOUT a log are skipped (they read pure scalar fallback, so they can't
 * disagree). Non-mutating and side-effect-free; the caller decides how to report.
 */
export function auditLogScalarConsistency(entity: Entity): LogScalarMismatch[] {
  if (!entity.log || entity.log.length === 0) return []
  const out: LogScalarMismatch[] = []

  const doneLog = isDone(entity)
  const doneScalar = !!entity.completed
  if (doneLog !== doneScalar) {
    out.push({ id: entity.id, axis: "done", fromLog: doneLog, fromScalar: doneScalar })
  }

  const closeLog = getCloseState(entity) ?? "none"
  const closeScalar = entity.closed ? "closed" : entity.reopened ? "reopened" : "none"
  if (closeLog !== closeScalar) {
    out.push({ id: entity.id, axis: "closed", fromLog: closeLog, fromScalar: closeScalar })
  }

  const cancelLog = isCancelled(entity)
  const cancelScalar = !!entity.cancelled
  if (cancelLog !== cancelScalar) {
    out.push({ id: entity.id, axis: "cancelled", fromLog: cancelLog, fromScalar: cancelScalar })
  }

  return out
}
