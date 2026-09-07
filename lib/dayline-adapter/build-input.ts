// ─────────────────────────────────────────────────────────────────────────────
// ZERO-SIDE DAYLINE ADAPTER — model → contract mapper
//
// Turns Zero's ontology into the engine's `DaylineData`. This is the ONLY place that
// knows both sides: it imports Zero's model (getCalendarBars / getEntity / getFaceModel)
// and the neutral contract (`@/packages/dayline-contract`). The engine imports the
// contract alone and never sees anything below.
//
// It deliberately reuses `getCalendarBars` — the absolute-time `CalBar` classification
// the dayline and calendar already share — instead of re-deriving occurrences/sessions.
// `DaylineMark` was designed to mirror `CalBar`, so this file is a field map plus glyph
// resolution, not a second copy of the scheduling rules. When Zero's model changes, call
// this again and hand the result to `handle.update()`.
// ─────────────────────────────────────────────────────────────────────────────

import type { DaylineData, DaylineMark, DaylineKind, DaylineGlyph } from "@/packages/dayline-contract"
import { getCalendarBars, getAccessBars, type CalBar } from "@/lib/zero/dayline-bars"
import { getEntity } from "@/lib/zero/data"
import { getFaceModel } from "@/lib/zero/face-model"

/** All kinds the contract accepts. Anything unexpected falls back to a neutral square ("task"). */
const KNOWN_KINDS = new Set<DaylineKind>([
  "space",
  "task",
  "moment",
  "instant",
  "resource",
  "community",
  "organism",
  "entity",
  "individual",
  "soul",
  "link",
])
function toDaylineKind(kind: string | undefined): DaylineKind {
  return kind && KNOWN_KINDS.has(kind as DaylineKind) ? (kind as DaylineKind) : "task"
}

/**
 * Resolve the glyph descriptor for a bar. The bar already carries the color and the live/cancelled
 * state; the FACE MODEL adds the two things a bar doesn't track — the "done" check and the Space
 * 180°-flip. `getFaceModel` is pure and cheap (documented safe to call per render).
 */
function glyphFor(bar: CalBar): DaylineGlyph {
  const entity = getEntity(bar.id)
  const face = entity ? getFaceModel(entity, bar.endMs) : null
  // Per-BLOCK liveness (v0.2.334): a block spins when it is itself ongoing/open-ended, not merely
  // because its entity is live somewhere else. `openEnded` covers the recorded open session.
  const blockLive = !!bar.ongoing || !!bar.openEnded
  return {
    kind: toDaylineKind(entity?.kind ?? undefined),
    accent: bar.color,
    ongoing: blockLive && !!face?.ongoing,
    flip180: !!face?.glyphFlip180,
    done: !!face?.showCheck,
    // A per-instance cancelled ghost, OR an entity whose state is cancelled.
    cancelled: !!bar.cancelled || !!face?.cancelled,
    // v0.3.0 glyph spec: the engine now draws the solid FILL from `filled` (fillsGlyph — complete/closed
    // fillable kinds), the heavier SCHEDULED stroke from `scheduled`, and the REQUESTED flap from
    // `requested`. Before v0.3.0 these had no engine treatment; the face model already tracked them.
    filled: !!face?.filled,
    scheduled: !!face?.scheduled,
    requested: !!face?.requested,
  }
}

/** Map one absolute-time `CalBar` onto a contract `DaylineMark`. Pure field translation. */
function toMark(bar: CalBar): DaylineMark {
  const entity = getEntity(bar.id)
  return {
    key: bar.key,
    entityId: bar.id,
    kind: toDaylineKind(entity?.kind ?? undefined),
    track: bar.track,
    start: bar.startMs,
    end: bar.endMs,
    title: bar.title,
    glyph: glyphFor(bar),
    point: bar.point || undefined,
    instant: bar.instant,
    ongoing: bar.ongoing,
    openEnded: bar.openEnded,
    unknownEnd: bar.unknownEnd,
    unknownStart: bar.unknownStart,
    cancelled: bar.cancelled,
    auto: bar.auto,
    // Nesting: hand the engine the model parent id. The engine nests a mark inside whichever OTHER
    // mark shares this entityId; if no such mark is on screen it renders as a root. Depth is left for
    // the engine to derive from these links (contract: depth is optional).
    parentId: entity?.parentId ?? null,
    sky: bar.sky,
    occRef: bar.occRef,
    sessionAnchorId: bar.sessionAnchorId,
  }
}

export interface BuildInputArgs {
  /** Window to gather marks for, absolute ms. The engine owns the axis; this is just how much history/
   *  future Zero feeds it. A generous window is fine — the list stays small. */
  lo: number
  hi: number
  /** Current instant (defaults to Date.now()). */
  now?: number
  /** Rail visibility intent. Zero's defaults: planned ON, recorded/access OFF. */
  rails?: { planned?: boolean; recorded?: boolean; access?: boolean }
}

/**
 * Build a full `DaylineData` snapshot. Recorded marks are included only when `rails.recorded` is on
 * (Zero's dayline hides them by default and also drops AUTO plays); planned marks always build.
 */
export function buildDaylineInput({ lo, hi, now = Date.now(), rails }: BuildInputArgs): DaylineData {
  const showRecorded = rails?.recorded ?? false
  const showAccess = rails?.access ?? false
  const { planned, recorded } = getCalendarBars(lo, hi, now)

  const marks: DaylineMark[] = []
  for (const bar of planned) marks.push(toMark(bar))
  if (showRecorded) {
    for (const bar of recorded) {
      // Mirror the dayline's rule: the recorded rail excludes AUTO plays (they're access, not a
      // deliberate session). The calendar shows them dimmed; the dayline does not.
      if (bar.auto) continue
      marks.push(toMark(bar))
    }
  }
  // ACCESS rail (v0.2.352): the machine-truth focus record, from the activity log — a DIFFERENT source
  // than occurrences/sessions. This is what was missing: the adapter only tapped getCalendarBars, so
  // access marks (incl. the current open focus, e.g. the v0 resource you're viewing) never reached the
  // engine even though it renders them and the toggle was on. Gather only when the rail is on.
  if (showAccess) {
    for (const bar of getAccessBars(lo, hi, now)) marks.push(toMark(bar))
  }

  return {
    now,
    marks,
    rails: { planned: rails?.planned ?? true, recorded: showRecorded, access: showAccess },
  }
}
