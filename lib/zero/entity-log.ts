/**
 * ENTITY LIFECYCLE LOG — derive helpers for ontology Meta field 1.
 *
 * The target model is: an entity's lifecycle is ONE append-only, typed list of
 * {@link Instant} entries (created / done / undone / closed / reopened / … ), and
 * its CURRENT state is DERIVED by folding that log rather than read from separate
 * boolean scalars. See the "entity log model" memory / spec for the full plan.
 *
 * Every derive helper reads `entity.log` IF PRESENT and otherwise FALLS BACK to the
 * existing scalar fields (`creationDate`, `done`, `doneOn`, `closed`/`closedOn`,
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
import type { Entity, Epoch, Instant, LogType, Session } from "./types"

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
 * done" parity idea. Fallback: the scalar `done` flag.
 */
export function isDone(entity: Entity): boolean {
  const last = lastEntry(entity, ...DONE_TYPES)
  if (last) return last.type === "done"
  return !!entity.done
}

/** When the DONE marker last flipped true. Log: latest `done`.at; else the `doneOn` scalar.
 *  Renamed from `getCompletedOn` (v0.2.229) alongside the `completed`→`done` field rename. */
export function getDoneOn(entity: Entity): Epoch | undefined {
  const last = lastEntry(entity, ...DONE_TYPES)
  if (last) return last.type === "done" ? last.at : undefined
  return entity.doneOn
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

/** Birth time. Log: first `created`.at; else the scalar `creationDate`. */
export function getCreatedAt(entity: Entity): Epoch | undefined {
  return firstEntry(entity, "created")?.at ?? entity.creationDate
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

/**
 * Construct a single log entry, dropping undefined optional fields. `meta` carries the extra
 * fields relevant to specific entry types: `by`/`where` provenance (any entry) and the `auto`
 * SESSION flag (on a play `session-open`). The session RAIL is encoded by `type` itself
 * (accessed/exited = focus, session-open/close = play, mark = mark) — see {@link deriveSessionsFromLog}.
 */
export function makeInstant(
  type: LogType,
  at: Epoch = Date.now(),
  meta?: { by?: string; where?: string; auto?: boolean },
): Instant {
  const entry: Instant = { at, type }
  if (meta?.by != null) entry.by = meta.by
  if (meta?.where != null) entry.where = meta.where
  if (meta?.auto != null) entry.auto = meta.auto
  return entry
}

/**
 * The next per-entity log id = `1 + max existing id` (1 when the log is empty or all pre-id). Since
 * the log is append-only (entries are never deleted), this is monotonic and can never collide with
 * an existing id — the guarantee that lets a CORRECTION reference a boundary by id. O(n) over a tiny
 * per-entity log, called only on append.
 */
export function nextLogId(log: Instant[] | undefined): number {
  let max = 0
  for (const e of log ?? []) if (typeof e.id === "number" && e.id > max) max = e.id
  return max + 1
}

/**
 * BACKFILL missing ids on a (legacy, pre-id) log, in array order, preserving any ids already
 * present and assigning fresh ones ABOVE the current max so nothing collides. Idempotent: a log
 * that's already fully id'd is returned unchanged (same ref). Used at hydrate so every stored log
 * is id-complete BEFORE any append runs (which is what makes `nextLogId` correct thereafter), and
 * to seal logs built in bulk by {@link buildLogFromScalars}.
 */
export function ensureLogIds(log: Instant[] | undefined): Instant[] {
  if (!log || log.length === 0) return log ?? []
  if (log.every((e) => typeof e.id === "number")) return log
  let max = 0
  for (const e of log) if (typeof e.id === "number" && e.id > max) max = e.id
  return log.map((e) => (typeof e.id === "number" ? e : { ...e, id: ++max }))
}

/**
 * Return a NEW log array with `entry` appended (never mutates the input). Use in
 * write paths so React state updates stay referentially clean. STAMPS a per-entity `id`
 * ({@link nextLogId}) when the entry lacks one, so every appended entry is addressable.
 */
export function appendInstant(log: Instant[] | undefined, entry: Instant): Instant[] {
  const stamped = typeof entry.id === "number" ? entry : { ...entry, id: nextLogId(log) }
  return [...(log ?? []), stamped]
}

/**
 * Construct a generic FIELD-SET log entry (`type: "set"`). `value` is the new value the
 * field took, or `null` to record that it was CLEARED. This is the single primitive every
 * field setter uses, so the unified log becomes the UNION of an entity's lifecycle AND its
 * edits — no per-field log structures needed.
 */
export function makeSet(
  field: string,
  value: string | number | boolean | null,
  at: Epoch = Date.now(),
  provenance?: { by?: string; where?: string },
): Instant {
  const entry: Instant = { at, type: "set", field, value }
  if (provenance?.by != null) entry.by = provenance.by
  if (provenance?.where != null) entry.where = provenance.where
  return entry
}

/**
 * The per-field HISTORY VIEW — every `set` entry for `field`, chronological. This is how a
 * "title history", "color history", "schedule history", etc. are derived from the ONE log
 * rather than stored separately. Empty when the field was never set through the log.
 */
export function fieldHistory(entity: Entity, field: string): Instant[] {
  return (entity.log ?? []).filter((e) => e.type === "set" && e.field === field)
}

/**
 * A short human label for ONE log entry, used by the raw-data history view so the user can
 * retrace an entity's whole life. Lifecycle entries read as their bare verb (`created`,
 * `done`, `closed`, …); a `set` entry reads `field = value` (or `field cleared`). Callers
 * that want to pretty-print time-valued fields (e.g. `startAt`) can pass a `formatValue`.
 */
export function describeLogEntry(
  e: Instant,
  formatValue?: (field: string, value: string | number | boolean) => string,
): string {
  if (e.type !== "set") return e.type
  const field = e.field ?? "field"
  // OCCURRENCE entries (v0.2.254) carry a pre-formatted human phrase as their value ("added · 6:00 PM–
  // 1:30 AM"); render as "occurrence <phrase>" rather than the generic "field = value" form.
  if (field === "occurrence" && typeof e.value === "string") return `occurrence ${e.value}`
  if (e.value == null) return `${field} cleared`
  const v = formatValue ? formatValue(field, e.value) : String(e.value)
  return `${field} = ${v}`
}

/**
 * Fold an entity's legacy SCALAR lifecycle fields into a starting {@link Instant}
 * log — the one-time seed used by the Phase 2 migration AND by the write paths when
 * they encounter a pre-log entity. Best-effort and LOSSY by nature: the scalars only
 * retain the LATEST timestamp per axis (one `doneOn`, one `closedOn`, one
 * `reopenedOn`), so this reconstructs a coherent SNAPSHOT, not full history — real
 * history accumulates from the next toggle onward. Entries are sorted ascending by
 * `at` so `created` comes first.
 *
 * `cancelled` folds in via `cancelledOn` (Phase 2b); entities cancelled BEFORE that
 * scalar existed have no real time, so this approximates them at `creationDate`. The
 * terminal `retired`/`died` states fold from `retiredOn`/`diedOn` (per-kind fields).
 */
export function buildLogFromScalars(entity: Entity): Instant[] {
  const log: Instant[] = []
  // Terminal timestamps live on per-kind interfaces, not EntityBase.
  const term = entity as { retiredOn?: Epoch; diedOn?: Epoch }
  const creationDate = entity.creationDate ?? entity.doneOn ?? Date.now()
  log.push(makeInstant("created", creationDate, { by: entity.createdBy, where: entity.createdWhere }))
  if (entity.done && entity.doneOn != null) log.push(makeInstant("done", entity.doneOn))
  if (entity.complete && entity.completeOn != null) log.push(makeInstant("completed", entity.completeOn))
  if (entity.closed && entity.closedOn != null) log.push(makeInstant("closed", entity.closedOn))
  if (entity.reopened && entity.reopenedOn != null) log.push(makeInstant("reopened", entity.reopenedOn))
  // Cancelled: use its timestamp when known, else approximate at creation time.
  if (entity.cancelled) log.push(makeInstant("cancelled", entity.cancelledOn ?? creationDate))
  if (term.retiredOn != null) log.push(makeInstant("retired", term.retiredOn))
  if (term.diedOn != null) log.push(makeInstant("died", term.diedOn))
  // Sort chronologically THEN seal ids (1..n in that order) — these entries were built by direct
  // push (bypassing appendInstant), so this is where they get their addressable ids.
  return ensureLogIds(log.sort((a, b) => a.at - b.at))
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
  const doneScalar = !!entity.done
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

// --- Sessions AS A FOLD (log → sessions[] cache) ----------------------------

/**
 * DERIVE the {@link Session}[] cache purely from the log's presence events — the fold that makes
 * `schedule.sessions[]` a REBUILDABLE materialized view rather than an independent store. This is
 * the "log is truth, sessions[] is a cache" half of the hybrid: writers dual-write (append a
 * `session-open`/`session-close`/`mark` Instant AND update the cache), and this reconstructs the
 * exact same cache from the log alone. Used by the consistency audit now and, later, as the
 * rebuild path when the scalar cache is retired.
 *
 * TWO CONCERNS, one ordered walk (Loris' model; rail encoded by entry TYPE):
 *
 *  PRESENCE (focus rail) — ONE continuous span so ACCESS never pauses:
 *   - `accessed` → open a `focus` session (also opens an AUTO ongoing span if the entity is an
 *      ongoing-on-enter kind AND not currently done/closed — see `blocked` tracking below).
 *   - `exited`   → close the open focus session (and the auto ongoing span, if any).
 *
 *  ONGOING (play rail) — a SINGLE non-overlapping span with a FLAVOR, so DURATION never
 *  double-counts. Openers no-op while already ongoing (union/absorption); a closer whose flavor
 *  doesn't match the current span is a no-op:
 *   - AUTO flavor  — opened by `accessed` (when eligible) or `resumed`; closed by `paused`, `exited`,
 *      or a TERMINAL lifecycle entry (done/completed/closed/cancelled/retired/died).
 *   - REMOTE flavor— opened by `started` (legacy `session-open`); closed ONLY by `stopped` (legacy
 *     `session-close`). REMOTE SURVIVES navigation — an `exited` does NOT close a remote span.
 *  `mark` → a zero-length session (`endAt === startAt`, via "mark").
 *
 *  DONE/CLOSED TRACKING (the "terminal ends ongoing" rule, Loris' choice): the fold tracks a
 *  `blocked` flag AS IT WALKS (done/completed/closed/cancelled/retired/died ⇒ blocked; undone/
 *  uncompleted/reopened/restored ⇒ unblocked). An AUTO ongoing span opens only when
 *  `ongoingOnEnter && !blocked`, and a blocking entry closes any open auto span. This is why
 *  `ongoingOnEnter` is a STATIC kind flag, not the old whole-entity `canAutoPlay` boolean: the
 *  done/closed half must be evaluated PER MOMENT in history (a task that was ongoing and later
 *  completed must still reconstruct its historical auto span), which a single final-state boolean
 *  couldn't do. (No revival auto-reopen: undoing done while still viewing won't re-open ongoing until
 *  you re-enter — deliberate simplification, revisit with the editing model.)
 *
 * On any close, a span ≤ `minSessionMs` is DISCARDED (matches the writer's discard-short rule), so a
 * sub-threshold blip leaves no cached session. An unclosed open stays OPEN (no `endAt`) — the running
 * session on its rail. `ongoingOnEnter` is INJECTED (entity-log must not import kinds); when omitted,
 * no auto ongoing is derived (presence-only).
 *
 * ABSORPTION EDGE (documented, intentional): only ONE ongoing span at a time. A `started` while an
 * auto span is open is absorbed (stays auto, dies on `exited`); an `accessed` while a remote span is
 * open is absorbed (stays remote, survives `exited`). This trades a rare overlap for guaranteed
 * no-double-count.
 */
export function deriveSessionsFromLog(
  entity: Entity,
  opts: { minSessionMs?: number; ongoingOnEnter?: boolean } = {},
): Session[] {
  const log = entity.log
  if (!log || log.length === 0) return []
  const minSessionMs = opts.minSessionMs ?? 0
  const ongoingOnEnter = opts.ongoingOnEnter ?? false
  const out: Session[] = []
  // Live pointers in a holder object: closures mutate these, and property access (unlike a captured
  // `let`) isn't narrowed to `never` by TS control-flow across those closure calls.
  const st: {
    focusIdx: number | null
    ongoing: { idx: number; flavor: "auto" | "remote" } | null
    blocked: boolean
  } = { focusIdx: null, ongoing: null, blocked: false }

  // Close the session at `idx` at `at`; DISCARD it if sub-threshold. Fixes the live pointers when a
  // splice shifts later indices.
  const closeAt = (idx: number, at: number) => {
    const s = out[idx]
    if (at - s.startedAt <= minSessionMs) {
      out.splice(idx, 1)
      if (st.focusIdx != null && st.focusIdx > idx) st.focusIdx--
      if (st.ongoing != null && st.ongoing.idx > idx) st.ongoing.idx--
    } else {
      s.endedAt = at
    }
  }
  const openOngoing = (at: number, flavor: "auto" | "remote") => {
    if (st.ongoing != null) return // absorption: one ongoing at a time
    const s: Session = { startedAt: at, via: "play" }
    if (flavor === "auto") s.auto = true
    out.push(s)
    st.ongoing = { idx: out.length - 1, flavor }
  }
  const closeAutoOngoing = (at: number) => {
    if (st.ongoing?.flavor === "auto") {
      closeAt(st.ongoing.idx, at)
      st.ongoing = null
    }
  }

  for (const e of log) {
    switch (e.type) {
      case "accessed":
        out.push({ startedAt: e.at, via: "focus" })
        st.focusIdx = out.length - 1
        if (ongoingOnEnter && !st.blocked) openOngoing(e.at, "auto")
        break
      case "resumed":
        if (!st.blocked) openOngoing(e.at, "auto")
        break
      case "started":
      case "session-open": // legacy alias
        openOngoing(e.at, "remote")
        break
      case "paused":
        closeAutoOngoing(e.at)
        break
      case "stopped":
      case "session-close": // legacy alias
        if (st.ongoing?.flavor === "remote") {
          closeAt(st.ongoing.idx, e.at)
          st.ongoing = null
        }
        break
      case "exited":
        closeAutoOngoing(e.at) // remote survives navigation
        if (st.focusIdx != null) {
          closeAt(st.focusIdx, e.at)
          st.focusIdx = null
        }
        break
      // TERMINAL lifecycle → close the auto ongoing span and block further auto opens.
      case "done":
      case "completed":
      case "closed":
      case "cancelled":
      case "retired":
      case "died":
        closeAutoOngoing(e.at)
        st.blocked = true
        break
      // REVIVAL → auto may open again on the next access (no immediate reopen).
      case "undone":
      case "uncompleted":
      case "reopened":
      case "restored":
        st.blocked = false
        break
      case "mark":
        out.push({ startedAt: e.at, endedAt: e.at, via: "mark" })
        break
    }
  }
  return out
}
