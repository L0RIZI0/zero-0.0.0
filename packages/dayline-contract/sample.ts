// Sample DaylineData exercising every tricky case the engine must handle. Import this to develop the
// engine against realistic input without needing Zero's model. All times are relative to a fixed `now`
// so the fixture is deterministic.

import type { DaylineData, DaylineMark } from "./index"

const NOW = Date.UTC(2026, 7, 28, 12, 34, 0) // 2026-08-28 12:34 UTC — matches Zero's current preview clock
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const accent = {
  space: "oklch(0.62 0.19 264)", // indigo
  task: "oklch(0.70 0.15 145)", // green
  moment: "oklch(0.75 0.16 60)", // amber
  instant: "oklch(0.65 0.20 20)", // red
  neutral: "oklch(0.72 0.004 75)",
}

const marks: DaylineMark[] = [
  // A normal planned Task span, a few hours from now.
  {
    key: "plan:task-a",
    entityId: "task-a",
    kind: "task",
    track: "planned",
    start: NOW + 3 * HOUR,
    end: NOW + 5 * HOUR,
    title: "Draft the contract",
    glyph: { kind: "task", accent: accent.task },
    occRef: { id: "task-a", day: 0 },
  },

  // An ONGOING moment — live right now, open-ended (trailing edge fades, glyph spins).
  {
    key: "plan:moment-live",
    entityId: "moment-live",
    kind: "moment",
    track: "planned",
    start: NOW - 40 * MIN,
    end: NOW,
    title: "Focus block",
    glyph: { kind: "moment", accent: accent.moment, ongoing: true },
    ongoing: true,
    openEnded: true,
    occRef: { id: "moment-live", day: 0 },
  },

  // A CANCELLED occurrence — must render as a struck-through ghost, NOT be dropped.
  {
    key: "plan:task-cancelled",
    entityId: "task-cancelled",
    kind: "task",
    track: "planned",
    start: NOW + DAY + 2 * HOUR,
    end: NOW + DAY + 3 * HOUR,
    title: "Cancelled standup",
    glyph: { kind: "task", accent: accent.task, cancelled: true },
    cancelled: true,
    occRef: { id: "task-cancelled", day: 1 },
  },

  // An INSTANT — a zero-length point in time.
  {
    key: "plan:instant-ship",
    entityId: "instant-ship",
    kind: "instant",
    track: "planned",
    start: NOW + 8 * HOUR,
    end: NOW + 8 * HOUR,
    title: "Ship v0.2.347",
    glyph: { kind: "instant", accent: accent.instant },
    point: true,
    instant: true,
    occRef: { id: "instant-ship", day: 0 },
  },

  // A Space with a FUTURE planned occurrence → glyph flips 180°. Also a NESTING PARENT.
  {
    key: "plan:space-project",
    entityId: "space-project",
    kind: "space",
    track: "planned",
    start: NOW + 30 * MIN,
    end: NOW + 6 * HOUR,
    title: "Zero",
    glyph: { kind: "space", accent: accent.space, flip180: true },
    depth: 0,
    parentId: null,
    occRef: { id: "space-project", day: 0 },
  },
  // A child nested inside the Space above (depth 1).
  {
    key: "plan:task-child",
    entityId: "task-child",
    kind: "task",
    track: "planned",
    start: NOW + HOUR,
    end: NOW + 2 * HOUR,
    title: "dayline contract",
    glyph: { kind: "task", accent: accent.task },
    depth: 1,
    parentId: "space-project",
    occRef: { id: "task-child", day: 0 },
  },

  // An occurrence far in the FUTURE — forces the axis to compress the dead space between (the exact case
  // Zero's lens/scroll model handles). Different month.
  {
    key: "plan:moment-far",
    entityId: "moment-far",
    kind: "moment",
    track: "planned",
    start: NOW + 30 * DAY,
    end: NOW + 32 * DAY,
    title: "Quarterly review",
    glyph: { kind: "moment", accent: accent.moment },
    occRef: { id: "moment-far", day: 30 },
  },

  // A RECORDED session (bottom rail) — a real tracked block earlier today.
  {
    key: "sess:5001:0",
    entityId: "task-a",
    kind: "task",
    track: "recorded",
    start: NOW - 3 * HOUR,
    end: NOW - 90 * MIN,
    title: "Draft the contract",
    glyph: { kind: "task", accent: accent.task },
    sessionAnchorId: 5001,
  },

  // A recorded AUTO play — dimmed.
  {
    key: "sess:5002:0",
    entityId: "moment-live",
    kind: "moment",
    track: "recorded",
    start: NOW - 20 * MIN,
    end: NOW,
    title: "Focus block",
    glyph: { kind: "moment", accent: accent.moment, ongoing: true },
    ongoing: true,
    auto: true,
    sessionAnchorId: 5002,
  },
]

export const sampleData: DaylineData = {
  now: NOW,
  marks,
  rails: { planned: true, recorded: false, access: false },
}
