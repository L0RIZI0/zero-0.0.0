// ============================================================================
// SHARED BAR CLASSIFICATION for the dayline ↔ calendar morph (v0.2.313)
// ----------------------------------------------------------------------------
// The dayline (`zero0-dayline.tsx`) and the calendar (`zero0-calendar.tsx`) must
// agree on WHAT ticks exist, their identity KEY, absolute time span, color, and
// label — so a tick can fly between the two layouts during the morph. The
// dayline keeps its own (view-specific, pct-based) memos untouched; this module
// produces the SAME ticks as ABSOLUTE-TIME bars (no view geometry) for the
// calendar, using the identical key scheme (`plan:${occKey}`, `sess:${id}:${i}`)
// and the same lib primitives (getDaylineOccurrences / getEntitiesWithSessions /
// effectiveScheduleEnd / isClosed / computeCloseAt / paintFor). The two code
// paths intentionally mirror each other; the classification comments here are
// abridged — see the dayline's `planned`/`sessions` memos for the full rationale.
// ============================================================================

import { ROOT_ID, getEntity, getInheritedAccent, getDaylineOccurrences, getEntitiesWithSessions } from "./data"
import type { TimelineOccurrence } from "./data"
import type { Entity } from "./types"
import { isClosed, computeCloseAt, effectiveScheduleEnd } from "./kinds"
import { rangeText, fmtTime } from "./timeline-format"
import { titleAt } from "./entity-log"
import { webLabel } from "./web-resources"
import { isSleepTitle, sleepSkyBackground } from "./sleep-sky"
import { getSegments } from "./activity-log"

const DAY_MS = 86_400_000
/** Neutral fill for an entity with no own/inherited accent. Mirrors the dayline's `NEUTRAL`. */
export const NEUTRAL = "oklch(0.72 0.004 75)"
/** Sentinel marking the COLORLESS root; render maps it to a theme-background fill. Mirrors dayline. */
export const ROOT_SENTINEL_COLOR = "#ffffff"

/** A dispatch identity for a planned occurrence's right-click menu (mirror of DaylineOccRef). */
export type CalOccRef = NonNullable<TimelineOccurrence["occRef"]>

/** An absolute-time bar — the dayline tick model MINUS the view-specific pct geometry. */
export interface CalBar {
  /** Identity key, IDENTICAL to the dayline's, so the morph can pair a tick across both views. */
  key: string
  id: string
  title: string
  color: string
  stroke: string | null
  /** Absolute epoch of the tick's start; `undefined` only for an end-only (unknown-start) tick. */
  startMs?: number
  /** Absolute epoch of the tick's effective end (declared/implied/close/now). */
  endMs: number
  /** `access` = the machine-truth "where I was" focus record (from the activity log), produced ONLY by
   *  {@link getAccessBars} for the dayline's access rail — never by getCalendarBars (the calendar omits
   *  it). Kept in the same union so the dayline adapter maps every bar through one code path. */
  track: "planned" | "recorded" | "access"
  point: boolean
  instant?: boolean
  ongoing?: boolean
  openEnded?: boolean
  unknownEnd?: boolean
  unknownStart?: boolean
  sky?: string
  range: string
  occRef?: CalOccRef
  sessionAnchorId?: number
  /** RECORDED only: true when this session was an AUTO play (ongoing-on-enter), vs a deliberate Play.
   *  The dayline EXCLUDES autos from its recorded rail, but the calendar SHOWS them dimmed (v0.2.332). */
  auto?: boolean
  /** PLANNED only: this occurrence was CANCELLED (per-instance override). Renders as a struck-through,
   *  22%-opacity ghost block/chip rather than vanishing (v0.2.340). */
  cancelled?: boolean
}

/** The entity label shown on a bar — web resources use their cropped display title (mirror of the
 *  dayline's `daylineLabel`); everything else uses the historical `titleAt` fold. */
function barLabel(entity: Entity, at: number): string {
  if (entity.webUrl) {
    return webLabel({
      webUrl: entity.webUrl,
      webResourceId: entity.webResourceId,
      webTitle: entity.displayTitle,
      title: entity.title,
    }).display
  }
  return titleAt(entity, at)
}

/** fill = the entity's own resolved color; stroke = its parent's color only inside a Space (mirror
 *  of the dayline's `paintFor`). */
export function paintFor(entityId: string): { fill: string; stroke: string | null } {
  const e = getEntity(entityId)
  const isRoot = entityId === ROOT_ID
  const own = e?.color ?? getInheritedAccent(e?.parentId ?? null)
  const fill = own ?? (isRoot ? ROOT_SENTINEL_COLOR : NEUTRAL)
  const parent = e?.parentId ? getEntity(e.parentId) : undefined
  const parentColor = parent ? (parent.color ?? getInheritedAccent(parent.parentId)) : undefined
  let cursor = parent
  let inSpace = false
  while (cursor) {
    if (cursor.kind === "space") {
      inSpace = true
      break
    }
    cursor = cursor.parentId ? getEntity(cursor.parentId) : undefined
  }
  const stroke = isRoot ? NEUTRAL : inSpace ? (parentColor ?? NEUTRAL) : null
  return { fill, stroke }
}

/**
 * PLANNED + RECORDED bars whose span overlaps `[lo, hi]`, as ABSOLUTE-TIME {@link CalBar}s (unclipped
 * — the calendar clips per day itself). `planned` = scheduled occurrences (top rail); `recorded` =
 * every `via:"play"` session (bottom rail). The continuous access spine is intentionally omitted (it
 * has no discrete-block calendar representation). Keys match the dayline exactly.
 */
export function getCalendarBars(lo: number, hi: number, now: number = Date.now()): {
  planned: CalBar[]
  recorded: CalBar[]
} {
  const planned: CalBar[] = []
  const recorded: CalBar[] = []

  // ---- PLANNED (top rail) — same source + rules as the dayline's `planned` memo ----
  for (const occ of getDaylineOccurrences(lo, hi, now)) {
    const s = occ.schedule
    if (!s) continue
    const startNum = typeof s.startDate === "number" ? s.startDate : undefined
    const st = startNum ?? s.at ?? s.dueDate
    const endNum = effectiveScheduleEnd(s) ?? undefined
    if (st == null && endNum == null) continue
    const closed = isClosed(occ, now)
    const closeAt = closed && endNum == null ? computeCloseAt(occ, now) : undefined
    const ongoing = !closed && endNum == null && startNum != null && startNum <= now
    const unknownEnd = !closed && endNum == null && startNum != null
    const unknownStart = endNum != null && st == null
    const en = endNum ?? closeAt ?? (ongoing ? now : st!)
    const anchor = st ?? en
    if (en < lo || anchor > hi) continue
    // A zero-length point in time. AT-markers and DUE deadlines both collapse here (an `at` or
    // `dueDate` with no span), which is exactly the set we also treat as INSTANTS below.
    const point = st != null && en <= st
    const isSleepSpan = st != null && en > st && occ.kind === "moment" && isSleepTitle(occ.title)
    const { fill, stroke } = paintFor(occ.id)
    planned.push({
      key: `plan:${occ.occKey}`,
      id: occ.id,
      title: occ.title,
      color: fill,
      stroke,
      startMs: st ?? undefined,
      endMs: en,
      track: "planned",
      point,
      // INSTANT behavior on the calendar (full-width, frontmost, centered chip) for genuine instants
      // AND for any point-in-time driven by an `at` or `dueDate` field (v0.2.321) — a deadline/marker
      // reads as a moment, not a lane-packed span. Guarded by `point` so a real span that merely also
      // carries a dueDate is NOT collapsed.
      instant: occ.kind === "instant" || (point && (s.at != null || s.dueDate != null)),
      ongoing,
      openEnded: ongoing,
      unknownEnd,
      unknownStart,
      sky: isSleepSpan ? sleepSkyBackground(occ.occKey) : undefined,
      range: unknownStart
        ? `unset – ${fmtTime(en)}`
        : ongoing
          ? `${rangeText(st!, en, s.repeat)} · ongoing`
          : rangeText(st!, en, s.repeat),
      occRef: occ.occRef,
      cancelled: occ.cancelled,
    })
  }

  // ---- RECORDED (bottom rail) — same source + rules as the dayline's `sessions` memo ----
  for (const e of getEntitiesWithSessions()) {
    const list = e.schedule?.sessions
    if (!list || list.length === 0) continue
    const { fill, stroke } = paintFor(e.id)
    const runs = [...list]
      .sort((a, b) => a.startedAt - b.startedAt)
      .filter((sess) => sess.via === "play")
      .map((sess) => ({
        start: sess.startedAt,
        end: sess.endedAt ?? now,
        open: sess.endedAt == null,
        anchorId: sess.anchorId,
        auto: !!sess.auto,
      }))
    runs.forEach((run, i) => {
      const rawStart = run.start
      const open = run.open
      const rawEnd = open ? now : run.end
      if (rawEnd < lo || rawStart > hi) return
      const st = Math.min(rawStart, rawEnd)
      recorded.push({
        key: `sess:${e.id}:${i}`,
        id: e.id,
        title: barLabel(e, st),
        color: fill,
        stroke,
        startMs: rawStart,
        endMs: rawEnd,
        track: "recorded",
        point: rawEnd <= rawStart,
        openEnded: open,
        unknownEnd: open,
        range: open ? `${rangeText(rawStart, rawEnd)} · play · ongoing` : `${rangeText(rawStart, rawEnd)} · play`,
        sessionAnchorId: !open && run.anchorId != null ? run.anchorId : undefined,
        auto: run.auto,
      })
    })
  }

  return { planned, recorded }
}

/**
 * ACCESS bars — the machine-truth "where I was" focus record, one per raw {@link AccessSegment} that
 * overlaps `[lo, hi]`. Mirror of the legacy dayline's `access` memo (zero0-dayline.tsx), minus the
 * pct-geometry: the canvas engine owns layout, so this returns absolute-time bars only. Sourced from
 * the activity log (`getSegments`), NOT from occurrences/sessions — this is the data the dayline
 * adapter was missing, which is why the access rail (and the current open focus) rendered nothing.
 *
 * Separate from {@link getCalendarBars} on purpose: the calendar never shows access, so it must not
 * pay for (or receive) these bars. The open segment (`leftAt == null`) is the current focus; its end
 * is `now` and it carries `openEnded`/`unknownEnd` so the engine can fade its trailing edge.
 */
export function getAccessBars(lo: number, hi: number, now: number): CalBar[] {
  const out: CalBar[] = []
  const segs = getSegments()
  for (const s of segs) {
    const st = s.enteredAt
    const en = s.leftAt ?? now
    if (en <= st) continue // zero/negative width
    if (en < lo || st > hi) continue // outside the window
    const open = s.leftAt == null
    const entity = getEntity(s.entityId)
    const { fill, stroke } = paintFor(s.entityId)
    out.push({
      key: `access:${s.entityId}:${s.enteredAt}`,
      id: s.entityId,
      title: entity ? barLabel(entity, st) : s.entityId === ROOT_ID ? "Home" : "Elsewhere",
      color: fill,
      stroke,
      startMs: st,
      endMs: en,
      track: "access",
      point: false,
      openEnded: open,
      unknownEnd: open,
      range: `${rangeText(st, en)} · access${open ? " · ongoing" : ""}`,
    })
  }
  return out
}

export { DAY_MS as CAL_DAY_MS }
