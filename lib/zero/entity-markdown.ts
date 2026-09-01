// ENTITY CONTENT as a markdown file — the SOURCE-OF-TRUTH projection.
//
// The plan (Loris, Aug 2026): an entity's content IS a markdown file. Every zoom level of the
// ENTITY CONTENT frame is a projection derived by PARSING that file:
//   • zoom-IN  → the raw markdown (this module serializes it),
//   • zoom-OUT → the rendered child rows (Zero re-parses + reconciles via this module).
//
// v0.2.354 — FULL META. A child line now carries EVERY visible/stored field the row render
// derives from, so the file is a faithful mirror (the goal: markdown as the single source of
// truth for renders). The line body after the kind prefix is the EXACT create-bar grammar,
// parsed by the SAME `parseEntry` the command line uses — so the file and the create bar speak
// one language and stay in lock-step.
//
// Grammar (one child per line): `<4-letter kind>: <title> [meta…]`, where meta is any mix of
//   --displaytitle:"…"  --url:…  --color:#rrggbb
//   --start:YYMMDDHHMM  --end:…  --at:…  --due:…  --duration:<min>  --repeat:daily|weekly|…
//   --description:"…"   :done  :cancel  :request
// e.g.
//   task: Ship v0.2.354 --due:2609050000 :done
//   mome: Slept --start:2609020000 --end:2609020800 --color:#a855f7
//   reso: https://v0.app --displaytitle:"v0 by Vercel"
//
// APPLY is DIFF-BASED: each field is compared against the entity's current value and only
// written when it actually changed. This makes re-applying an untouched file a pure no-op (it
// never disturbs recurrence anchors, lifecycle logs, or seeded-override bookkeeping) and makes
// idempotency structural rather than something each setter must guarantee. For an EXISTING
// child, a field the file OMITS is treated as a deletion and CLEARED (the file is authoritative);
// for a NEW line we only SET present fields, so a freshly-typed `mome: Foo` keeps its default
// schedule exactly like the create bar. Two fields are set-only in v1 (documented below):
// `--displaytitle`/`--url` change but cannot be blanked (no clear path on their setters, and
// URL-titled resources deliberately omit a redundant `--url`).
//
// v1 reconcile rules chosen by Loris still hold: a REMOVED line KEEPS its child (never deletes),
// a changed KIND prefix on an EXISTING child is IGNORED (only new lines honor their prefix).

import {
  addParsedEntity,
  getChildren,
  renameEntity,
  setEntityAccent,
  setEntityCancelled,
  setEntityDescription,
  setEntityDuration,
  setEntityRepeat,
  setEntityRequested,
  setEntityScheduleField,
  setEntityWebUrl,
  setTaskDone,
  setWebTitle,
} from "./data"
import {
  kindForPrefix,
  kindToPrefix,
  parseDateToken,
  parseDurationToMinutes,
  parseEntry,
  parseHexColor,
  parseRepeatToken,
  repeatLabel,
  type EntryParse,
} from "./create-parse"
import { isDone } from "./entity-log"
import type { Entity, EntityKind } from "./types"

/** One entity-reference line: its kind prefix + the create-bar parse of everything after it. */
export interface MarkdownEntityLine {
  kind: EntityKind
  /** Full parse of the line body (title + `--attrs` + `:actions`), via {@link parseEntry}. */
  entry: EntryParse
  raw: string
}

/** Result of reconciling an edited file back into the children graph. */
export interface ApplyMarkdownResult {
  created: number
  /** Existing children touched (any field changed). */
  changed: number
  /** Lines whose prefix named a different kind than the existing child (ignored in v1). */
  ignoredKindChange: number
}

// ── Serialize ─────────────────────────────────────────────────────────────────

/** Local-time epoch → the 10-digit `YYMMDDHHMM` token {@link parseDateToken} round-trips.
 *  MINUTE precision (seconds dropped) — the diff-apply floors both sides to the minute so this
 *  loss never causes a spurious rewrite. */
function fmtStamp(epoch: number): string {
  const d = new Date(epoch)
  const p = (n: number) => String(n).padStart(2, "0")
  return (
    p(d.getFullYear() % 100) + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes())
  )
}

/** Quote a value only when it needs it (spaces or empty), so simple tokens stay bare. */
function quoteIfNeeded(v: string): string {
  return v === "" || /\s/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v
}

/** Serialize ONE child entity to its markdown line — the exact text the zoom-IN code view shows.
 *  Only meaningful fields are emitted, in a stable order, so the projection round-trips exactly. */
function serializeChildLine(e: Entity): string {
  const parts: string[] = [`${kindToPrefix(e.kind)}: ${e.title}`.trimEnd()]

  // Friendlier label (resource pages, renamed entities) — only when it differs from the title.
  if (e.displayTitle && e.displayTitle !== e.title) parts.push(`--displaytitle:${quoteIfNeeded(e.displayTitle)}`)
  // Web surface — skipped when it merely echoes a URL title (typed-URL resources), which keeps
  // the line clean AND makes its absence a non-event on apply (never clobbers such a resource).
  if (e.webUrl && e.webUrl !== e.title) parts.push(`--url:${e.webUrl}`)
  if (e.color) parts.push(`--color:${e.color.toLowerCase()}`)

  const s = e.schedule
  if (s) {
    if (e.kind === "instant") {
      const at = s.at ?? s.startDate
      if (at != null) parts.push(`--at:${fmtStamp(at)}`)
    } else {
      if (s.startDate != null) parts.push(`--start:${fmtStamp(s.startDate)}`)
      if (s.endDate != null) parts.push(`--end:${fmtStamp(s.endDate)}`)
      if (s.dueDate != null) parts.push(`--due:${fmtStamp(s.dueDate)}`)
    }
    if (s.duration != null) parts.push(`--duration:${s.duration}`)
    if (s.repeat) parts.push(`--repeat:${repeatLabel(s.repeat)}`)
  }

  if (e.description) parts.push(`--description:${quoteIfNeeded(e.description)}`)

  // Lifecycle flags last — they read like a status suffix.
  if (isDone(e)) parts.push(":done")
  if (e.cancelled) parts.push(":cancel")
  if (e.requested) parts.push(":request")

  return parts.join(" ")
}

/**
 * Project an entity's CONTENT to markdown: one line per child, in content-view order
 * (`getChildren`). A childless entity yields "" (an empty file).
 */
export function serializeEntityToMarkdown(id: string): string {
  return getChildren(id)
    .map((child) => serializeChildLine(child))
    .join("\n")
}

// ── Parse ───────────────────────────────────────────────────────────────────

/**
 * Parse ONE line into an entity-reference line, or null (blank OR future rich-text — neither is
 * a child ref in v1). A line is a child ref iff it starts with a known 4-letter kind prefix + `:`
 * and, after the create-bar parse of the remainder, has a non-empty title.
 */
export function parseMarkdownLine(raw: string): MarkdownEntityLine | null {
  const line = raw.trim()
  if (!line) return null
  const m = line.match(/^([a-zA-Z]{4})\s*:\s*([\s\S]*)$/)
  if (!m) return null
  const kind = kindForPrefix(m[1])
  if (!kind) return null // 4 letters but not a real kind → treat as rich text (ignored v1)
  const entry = parseEntry(m[2])
  if (!entry.title) return null // a prefix with no title isn't a usable child ref
  return { kind, entry, raw }
}

/** Parse a whole file into its ordered entity-reference lines (blank + rich-text lines dropped). */
export function parseMarkdown(text: string): MarkdownEntityLine[] {
  const out: MarkdownEntityLine[] = []
  for (const raw of text.split("\n")) {
    const parsed = parseMarkdownLine(raw)
    if (parsed) out.push(parsed)
  }
  return out
}

// ── Reconcile (apply edits back) ────────────────────────────────────────────

const floorMin = (x: number) => Math.floor(x / 60000) * 60000

/**
 * Apply one parsed line's fields to `entityId`, DIFF-BASED. Returns true if anything changed.
 * `clearAbsent` = true for an EXISTING child (the file is authoritative: an omitted field is a
 * deletion), false for a freshly CREATED child (only set what's present, preserving kind defaults
 * exactly like the create bar).
 */
function applyEntryFields(entity: Entity, entry: EntryParse, clearAbsent: boolean): boolean {
  const id = entity.id
  let changed = false

  // Last write wins for a repeated flag, matching the create bar.
  const attr = new Map<string, string>()
  for (const a of entry.attrs) attr.set(a.field, a.value)
  const has = (f: string) => attr.has(f)
  const act = new Set(entry.actions)

  // TITLE — the free text; only rename on a real change (never cleared, always present).
  if (entry.title && entry.title !== entity.title) {
    if (renameEntity(id, entry.title)) changed = true
  }

  // COLOR (accent). Compare normalized hex so `#ABC`/`#aabbcc` variants don't churn.
  {
    const desired = has("color") ? parseHexColor(attr.get("color")!) : null
    if (has("color") || clearAbsent) {
      const cur = entity.color ? (parseHexColor(entity.color) ?? entity.color.toLowerCase()) : null
      if ((desired ?? null) !== (cur ?? null)) {
        if (setEntityAccent(id, desired)) changed = true
      }
    }
  }

  // DISPLAY TITLE — set/change only (its setter can't blank in v1).
  if (has("displaytitle")) {
    const v = attr.get("displaytitle")!
    if (v && v !== (entity.displayTitle ?? "")) {
      if (setWebTitle(id, v)) changed = true
    }
  }

  // WEB URL — set/change only (URL-titled resources omit a redundant `--url`, so absence ≠ clear).
  if (has("url")) {
    const v = attr.get("url")!
    if (v !== (entity.webUrl ?? "")) {
      if (setEntityWebUrl(id, v)) changed = true
    }
  }

  // DESCRIPTION — fully authoritative (its setter clears on empty).
  if (has("description") || clearAbsent) {
    const desired = has("description") ? attr.get("description")! : ""
    if (desired !== (entity.description ?? "")) {
      if (setEntityDescription(id, desired)) changed = true
    }
  }

  // SCHEDULE. Instants own only the collapsed `at` point (start slot); spans/tasks own start/end/due.
  const s = entity.schedule
  const setDate = (key: "startDate" | "endDate" | "dueDate", present: boolean, tok: string | undefined, cur?: number) => {
    if (!present && !clearAbsent) return
    let desired: number | null = null
    if (present) {
      const parsed = parseDateToken(tok!)
      if (parsed == null) return // unparseable → leave as-is rather than wipe
      desired = parsed
    }
    const curFloored = cur == null ? null : floorMin(cur)
    const desFloored = desired == null ? null : floorMin(desired)
    if (curFloored !== desFloored) {
      if (setEntityScheduleField(id, key, desired)) changed = true
    }
  }

  if (entity.kind === "instant") {
    const present = has("at") || has("start")
    const tok = has("at") ? attr.get("at") : attr.get("start")
    setDate("startDate", present, tok, s?.at ?? s?.startDate)
  } else {
    setDate("startDate", has("start"), attr.get("start"), s?.startDate)
    setDate("endDate", has("end"), attr.get("end"), s?.endDate)
    setDate("dueDate", has("due"), attr.get("due"), s?.dueDate)
  }

  // DURATION (minutes).
  if (has("duration") || clearAbsent) {
    let desired: number | null = null
    let skip = false
    if (has("duration")) {
      const m = parseDurationToMinutes(attr.get("duration")!)
      if (m == null) skip = true
      else desired = m
    }
    if (!skip && (s?.duration ?? null) !== desired) {
      if (setEntityDuration(id, desired)) changed = true
    }
  }

  // REPEAT — compare via the label (its serialize form) so equal rules don't churn.
  if (has("repeat") || clearAbsent) {
    let desired: ReturnType<typeof parseRepeatToken> = null
    let skip = false
    if (has("repeat")) {
      desired = parseRepeatToken(attr.get("repeat")!)
      if (desired == null) skip = true
    }
    const curLabel = s?.repeat ? repeatLabel(s.repeat) : null
    const desLabel = desired ? repeatLabel(desired) : null
    if (!skip && curLabel !== desLabel) {
      if (setEntityRepeat(id, desired)) changed = true
    }
  }

  // LIFECYCLE flags — authoritative from the presence of the positive action.
  {
    const want = act.has("done")
    if (want !== isDone(entity)) {
      setTaskDone(id, want)
      changed = true
    }
  }
  {
    const want = act.has("cancel")
    if (want !== !!entity.cancelled) {
      setEntityCancelled(id, want)
      changed = true
    }
  }
  {
    const want = act.has("request")
    if (want !== !!entity.requested) {
      setEntityRequested(id, want)
      changed = true
    }
  }

  return changed
}

/**
 * Reconcile an edited markdown file back into the children graph — the zoom-OUT commit.
 * POSITIONAL: entity-ref line i maps to existing child i (in `getChildren` order). Extra lines
 * CREATE children (honoring their prefix); FEWER lines KEEP the remaining children (never deletes);
 * a changed KIND on an existing child is IGNORED. All field edits flow through {@link applyEntryFields}.
 */
export function applyMarkdownToChildren(id: string, text: string): ApplyMarkdownResult {
  const lines = parseMarkdown(text)
  const existing = getChildren(id)
  const result: ApplyMarkdownResult = { created: 0, changed: 0, ignoredKindChange: 0 }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const child = existing[i]
    if (child) {
      if (line.kind !== child.kind) result.ignoredKindChange++
      // Re-read to apply against the freshest scalars (title/schedule may shift mid-loop).
      if (applyEntryFields(child, line.entry, true)) result.changed++
    } else {
      const created = addParsedEntity({ title: line.entry.title, contextId: id, kind: line.kind })
      applyEntryFields(created, line.entry, false)
      result.created++
    }
  }
  return result
}
