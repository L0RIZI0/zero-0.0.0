import type { CalEvent, EventCategory, EventKind } from "./types";
import { addDays, HOUR, MINUTE, startOfDay, zonedDate, zonedParts } from "./time";

let seq = 0;
function nid(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}`;
}

function ev(
  title: string,
  start: number,
  end: number,
  category: EventCategory,
  kind: EventKind = "event",
  extra: Partial<CalEvent> = {},
): CalEvent {
  return { id: nid("e"), title, start, end, category, kind, ...extra };
}

function atDay(origin: number, dayOffset: number, h: number, m = 0): number {
  const sod = startOfDay(addDays(origin, dayOffset));
  return sod + h * HOUR + m * MINUTE;
}

/**
 * A lived-in calendar: nested work, travel, life chapters, and a block that
 * contains *right now* so the now-lens always has something to inflate.
 */
export function seedCalendar(now: number): CalEvent[] {
  seq = 0;
  const p = zonedParts(now);
  const today0 = startOfDay(now);
  const events: CalEvent[] = [];

  // Life chapters — locked bands so the life zoom has structure.
  events.push(
    ev("EPFL", zonedDate(2018, 9, 1), zonedDate(2022, 7, 1), "life", "band", {
      locked: true,
    }),
    ev(
      "First studio",
      zonedDate(2022, 8, 15),
      zonedDate(2024, 3, 1),
      "work",
      "band",
      { locked: true },
    ),
    ev(
      "Independent",
      zonedDate(2024, 3, 1),
      zonedDate(p.year + 1, 1, 1),
      "work",
      "band",
      { locked: true },
    ),
    ev(
      "Moved to Lausanne",
      zonedDate(2023, 4, 12, 10, 0),
      zonedDate(2023, 4, 12, 10, 0) + MINUTE,
      "life",
      "milestone",
      { locked: true },
    ),
    ev(
      "Started Dayline",
      zonedDate(2026, 6, 26, 9, 30),
      zonedDate(2026, 6, 26, 9, 30) + MINUTE,
      "focus",
      "milestone",
    ),
    ev(
      "First spring prototype",
      zonedDate(2026, 8, 14, 18, 0),
      zonedDate(2026, 8, 14, 18, 0) + MINUTE,
      "focus",
      "milestone",
    ),
  );

  // Recent travel
  events.push(
    ev(
      "Lisbon",
      zonedDate(2026, 8, 1, 8, 0),
      zonedDate(2026, 8, 8, 22, 0),
      "travel",
      "band",
    ),
    ev(
      "Flight LX 90",
      zonedDate(2026, 8, 1, 6, 40),
      zonedDate(2026, 8, 1, 9, 10),
      "travel",
      "event",
    ),
    ev(
      "Alps weekend",
      zonedDate(2026, 9, 11, 8, 0),
      zonedDate(2026, 9, 14, 20, 0),
      "travel",
      "band",
    ),
    ev(
      "Berlin conference",
      zonedDate(2026, 10, 20, 8, 0),
      zonedDate(2026, 10, 23, 18, 0),
      "travel",
      "band",
    ),
    ev(
      "Ship week",
      zonedDate(2026, 11, 9, 9, 0),
      zonedDate(2026, 11, 13, 18, 0),
      "focus",
      "band",
    ),
  );

  // Expand weekdays around now as nested job + standup + a few meetings.
  const jobDays: { offset: number; id: string }[] = [];
  for (let d = -52; d <= 52; d++) {
    const t = atDay(today0, d, 8, 30);
    const parts = zonedParts(t);
    if (parts.weekdayIndex >= 5) continue;
    const job = ev(
      "Day job",
      atDay(today0, d, 8, 30),
      atDay(today0, d, 17, 30),
      "work",
      "band",
    );
    events.push(job);
    jobDays.push({ offset: d, id: job.id });

    if (d >= -18 && d <= 18) {
      events.push(
        ev(
          "Standup",
          atDay(today0, d, 9, 0),
          atDay(today0, d, 9, 18),
          "work",
          "event",
          { parentId: job.id },
        ),
      );
    }
  }

  const jobOf = (offset: number) => jobDays.find((j) => j.offset === offset)?.id;

  // Today — Thursday 27 Aug 2026-ish. Dense, nested, contains now.
  const todayJob = jobOf(0);
  events.push(
    ev(
      "Design review · warp field",
      atDay(today0, 0, 10, 0),
      atDay(today0, 0, 11, 30),
      "work",
      "event",
      { parentId: todayJob },
    ),
    ev(
      "Ticket 482",
      atDay(today0, 0, 10, 35),
      atDay(today0, 0, 11, 5),
      "focus",
      "event",
      { parentId: todayJob },
    ),
    ev("Lunch", atDay(today0, 0, 12, 15), atDay(today0, 0, 13, 0), "personal"),
    ev(
      "1:1 Sam",
      atDay(today0, 0, 14, 0),
      atDay(today0, 0, 14, 45),
      "work",
      "event",
      { parentId: todayJob },
    ),
    ev(
      "Inbox zero",
      atDay(today0, 0, 16, 0),
      atDay(today0, 0, 16, 30),
      "work",
      "event",
      { parentId: todayJob },
    ),
    ev("Climbing", atDay(today0, 0, 18, 45), atDay(today0, 0, 19, 45), "personal"),
    ev(
      "Dayline session",
      atDay(today0, 0, 20, 30),
      atDay(today0, 0, 22, 45),
      "focus",
    ),
  );

  // Yesterday
  const yJob = jobOf(-1);
  events.push(
    ev(
      "Write the spring paper",
      atDay(today0, -1, 10, 0),
      atDay(today0, -1, 12, 30),
      "focus",
      "event",
      { parentId: yJob },
    ),
    ev("Physio", atDay(today0, -1, 18, 0), atDay(today0, -1, 19, 0), "personal"),
  );

  // Tomorrow (Fri)
  const tJob = jobOf(1);
  events.push(
    ev(
      "Planning · September",
      atDay(today0, 1, 10, 30),
      atDay(today0, 1, 12, 0),
      "work",
      "event",
      { parentId: tJob },
    ),
    ev(
      "Sister visiting",
      atDay(today0, 1, 18, 0),
      atDay(today0, 1, 22, 30),
      "life",
      "band",
    ),
    ev("Dinner with Maya", atDay(today0, 1, 19, 0), atDay(today0, 1, 21, 30), "personal"),
  );

  // Weekend
  events.push(
    ev(
      "Alps reconnaissance",
      atDay(today0, 2, 8, 0),
      atDay(today0, 2, 18, 30),
      "travel",
      "band",
    ),
    ev("Farmers market", atDay(today0, 3, 11, 0), atDay(today0, 3, 13, 0), "personal"),
    ev("Deep work", atDay(today0, 3, 15, 0), atDay(today0, 3, 18, 0), "focus"),
  );

  // Next week scatter
  const nJob = jobOf(4);
  events.push(
    ev(
      "Investor coffee",
      atDay(today0, 4, 11, 0),
      atDay(today0, 4, 12, 0),
      "work",
      "event",
      { parentId: nJob },
    ),
    ev("Dentist", atDay(today0, 5, 8, 0), atDay(today0, 5, 8, 45), "personal"),
    ev(
      "Sync · Berlin talk",
      atDay(today0, 6, 15, 0),
      atDay(today0, 6, 16, 0),
      "work",
      "event",
      { parentId: jobOf(6) },
    ),
  );

  // Gym Tue / Thu around now
  for (let d = -40; d <= 40; d++) {
    const t = atDay(today0, d, 18, 30);
    const wd = zonedParts(t).weekdayIndex;
    if (wd !== 1 && wd !== 3) continue;
    if (d === 0) continue; // today is climbing instead
    events.push(ev("Gym", t, t + 70 * MINUTE, "personal"));
  }

  // A quiet birthday
  events.push(
    ev(
      "Birthday dinner",
      zonedDate(2026, 7, 18, 19, 0),
      zonedDate(2026, 7, 18, 23, 0),
      "life",
    ),
  );

  // Make sure "now" is inside the evening session even if the clock moved.
  const session = events.find((e) => e.title === "Dayline session");
  if (session) {
    if (now < session.start || now > session.end) {
      session.start = now - 40 * MINUTE;
      session.end = now + 80 * MINUTE;
    }
  }

  return events;
}

export function loadEvents(now: number): CalEvent[] {
  try {
    const raw = localStorage.getItem("dayline.events.v1");
    if (!raw) return seedCalendar(now);
    const parsed = JSON.parse(raw) as CalEvent[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seedCalendar(now);
    return parsed;
  } catch {
    return seedCalendar(now);
  }
}

export function saveEvents(events: CalEvent[]) {
  try {
    localStorage.setItem("dayline.events.v1", JSON.stringify(events));
  } catch {
    /* quota — ignore */
  }
}
