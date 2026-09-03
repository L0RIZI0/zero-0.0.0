import type { DaylineKind, DaylineMark, DaylineTrack } from "./contract";

export type EventKind = "band" | "event" | "milestone";
export type EventCategory = "work" | "life" | "travel" | "personal" | "focus";

export type CalEvent = {
  id: string;
  title: string;
  start: number;
  end: number;
  kind: EventKind;
  category: EventCategory;
  parentId?: string;
  /** Life chapters stay put unless the user really wants to move them. */
  locked?: boolean;
  /** Accent override (contract marks pass resolved OKLCH/hex). */
  color?: string;
  track?: DaylineTrack;
  point?: boolean;
  ongoing?: boolean;
  openEnded?: boolean;
  unknownEnd?: boolean;
  unknownStart?: boolean;
  cancelled?: boolean;
  auto?: boolean;
  entityKind?: DaylineKind;
  /** Round-trip to the contract mark. Identity tokens live on the mark. */
  mark?: DaylineMark;
};

export type TickUnit =
  | "year"
  | "month"
  | "week"
  | "day"
  | "hour"
  | "minute";

export type TickMark = {
  t: number;
  x: number;
  unit: TickUnit;
  major: boolean;
  label?: string;
  labelWidth: number;
  /** Day-boundary (midnight) — drawn longer. */
  boundary?: boolean;
  /** False = label only, no tick line (e.g. noon date). */
  drawTick?: boolean;
};

export type PlacedChip = {
  event: CalEvent;
  x0: number;
  x1: number;
  y: number;
  h: number;
  lane: number;
  depth: number;
  clustered: boolean;
  clusterCount: number;
};

export type PointerMode =
  | "none"
  | "pan"
  | "pinch"
  | "drag-event"
  | "resize-start"
  | "resize-end";

export type DaylineSnapshot = {
  spanMs: number;
  centerT: number;
  hoverId: string | null;
  selectedId: string | null;
  cursorT: number | null;
  warp: number;
  nowLens: boolean;
  now: number;
  eventCount: number;
  selected: CalEvent | null;
  source?: "demo" | "sample";
  lastIntent?: string | null;
};

export const STORAGE_KEY = "dayline.events.v1";
export const SETTINGS_KEY = "dayline.settings.v1";
export const SOURCE_KEY = "dayline.source.v1";

export const MIN_SPAN_MS = 20 * 60 * 1000;
export const MAX_SPAN_MS = 120 * 365.25 * 24 * 3600 * 1000;
export const MIN_EVENT_MS = 10 * 60 * 1000;
