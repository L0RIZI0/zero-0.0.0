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
  detachChildFromContext,
  getChildren,
  getEntity,
  renameEntity,
  reorderContextItems,
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
import { looksLikeUrl, normalizeUrl } from "./web-resources"
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
  /** Children whose line was REMOVED → unlinked from this body (entity kept). */
  unlinked: number
}

/**
 * The snapshot captured when the markdown code view OPENS — the ordered child ids and the exact
 * serialized line for each, aligned 1:1 (`ids[i]` ↔ `lines[i]`). Reconcile uses it to give every
 * line a stable IDENTITY without polluting the file with visible id tokens: an unchanged line still
 * maps to its child (so a reorder is a reorder, not N edits), a vanished line means "unlink that
 * child", and a brand-new line means "create". Without it, apply falls back to the old positional
 * reconcile (which can only rename/create, never remove or reorder).
 */
export interface MarkdownBaseline {
  ids: string[]
  lines: string[]
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
  } else if (entity.kind === "resource" && looksLikeUrl(entry.title)) {
    // URL-TITLED RESOURCE with no explicit `--url` (`reso: https://…`). Serialize omits `--url` when it
    // merely echoes the title, so a resource CREATED or EDITED via a markdown line would otherwise get
    // an EMPTY `webUrl` and open blank — the create FIELD binds webUrl via looksLikeUrl, but the
    // markdown `addParsedEntity` path never did (regression once entities could be made from md lines,
    // v0.2.355). Mirror the create field: bind webUrl from the URL title. Idempotent (url===webUrl → no
    // change); editing the URL text in the line retargets the resource. Curated (title≠url) resources
    // emit `--url` and are handled above, so they never reach here.
    const url = normalizeUrl(entry.title)
    if (url !== (entity.webUrl ?? "")) {
      if (setEntityWebUrl(id, url)) changed = true
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
 * Longest common subsequence over two string arrays → a map newIndex→baseIndex for the lines that
 * are UNCHANGED (byte-identical) between baseline and new text. Classic O(n·m) DP + backtrack. The
 * match is monotonic in both indices, so it naturally represents "these lines survived, possibly
 * reordered around" while leaving genuinely added/removed/edited lines as residuals.
 */
function lcsMatch(base: string[], next: string[]): Map<number, number> {
  const n = base.length
  const m = next.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = base[i] === next[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out = new Map<number, number>() // next index → base index
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (base[i] === next[j]) {
      out.set(j, i)
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return out
}

/**
 * Reconcile an edited markdown file back into the children graph — the zoom-OUT commit.
 *
 * IDENTITY-BASED when a {@link MarkdownBaseline} snapshot is given (the normal path from the code
 * view). Each new line is matched to a baseline child so the four intents are distinguished:
 *   • UNCHANGED line (LCS match) → same child, no field write (byte-identical ⇒ nothing to do);
 *   • EDITED line → paired with a removed baseline line by residual order → apply field diff;
 *   • REMOVED line → its baseline child is UNLINKED from this body (kept in the store);
 *   • NEW line → CREATE a child (honoring its prefix).
 * Finally the context's sibling ORDER is set to the new line order, so moving lines reorders rows.
 * A changed KIND on an existing child is still IGNORED (v1 rule).
 *
 * POSITIONAL FALLBACK when no baseline is passed: line i → child i, rename/create only, never
 * removes or reorders (the pre-identity behavior, kept so any other caller stays safe).
 */
export function applyMarkdownToChildren(
  id: string,
  text: string,
  baseline?: MarkdownBaseline,
): ApplyMarkdownResult {
  const lines = parseMarkdown(text)
  const result: ApplyMarkdownResult = { created: 0, changed: 0, ignoredKindChange: 0, unlinked: 0 }

  // ── Positional fallback (no snapshot) ─────────────────────────────────────
  if (!baseline) {
    const existing = getChildren(id)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const child = existing[i]
      if (child) {
        if (line.kind !== child.kind) result.ignoredKindChange++
        if (applyEntryFields(child, line.entry, true)) result.changed++
      } else {
        const created = addParsedEntity({ title: line.entry.title, contextId: id, kind: line.kind })
        applyEntryFields(created, line.entry, false)
        result.created++
      }
    }
    return result
  }

  // ── Identity-based reconcile ──────────────────────────────────────────────
  const baseRaw = baseline.lines.map((s) => s.trim())
  const newRaw = lines.map((l) => l.raw.trim())
  const match = lcsMatch(baseRaw, newRaw) // newIndex → baseIndex, for unchanged lines

  // Which child id each new line resolves to (matched / edited / created); drives the final order.
  const resolved: (string | null)[] = new Array(lines.length).fill(null)
  const usedBase = new Set<number>()
  for (const [ni, bi] of match) {
    resolved[ni] = baseline.ids[bi]
    usedBase.add(bi)
  }

  // Residuals: baseline children whose line has no exact match (removed OR edited) and new lines
  // with no match (created OR edited). We must pair edits to the RIGHT child — a naive by-order
  // pairing bleeds content across entities when a commit edits one line AND removes another (e.g.
  // editing a Task while deleting the Space above would rename the SPACE's entity to the Task text).
  // So pair in two passes.
  const baseResid = baseline.ids
    .map((_, i) => i)
    .filter((i) => !usedBase.has(i))
    .map((bi) => ({ bi, child: getEntity(baseline.ids[bi]) }))
  const residualNew = lines.map((_, i) => i).filter((i) => !match.has(i))
  const consumed = new Set<number>() // indices INTO baseResid that got paired

  const pairInto = (ni: number, x: number) => {
    consumed.add(x)
    const child = baseResid[x].child!
    resolved[ni] = child.id
    if (lines[ni].kind !== child.kind) result.ignoredKindChange++ // v1: kind swap keeps the entity
    if (applyEntryFields(child, lines[ni].entry, true)) result.changed++
  }
  const stillNew: number[] = []

  // Pass 1 — pair each leftover line to the first unconsumed leftover child of the SAME KIND, in
  // order. This is the identity-safe pairing: a Task edit can only land on a surviving Task.
  for (const ni of residualNew) {
    const x = baseResid.findIndex((r, i) => !consumed.has(i) && r.child && r.child.kind === lines[ni].kind)
    if (x >= 0) pairInto(ni, x)
    else stillNew.push(ni)
  }
  // Pass 2 — any line still unpaired, paired by ORDER to any remaining live child, is an in-place
  // KIND SWAP (title/attrs edited and the prefix changed too). Honor the v1 rule: keep the entity,
  // apply the other fields, ignore the kind change. Leftover beyond that → genuinely new.
  const finalNew: number[] = []
  for (const ni of stillNew) {
    const x = baseResid.findIndex((r, i) => !consumed.has(i) && r.child)
    if (x >= 0) pairInto(ni, x)
    else finalNew.push(ni)
  }

  // Leftover NEW lines → create. (Includes lines whose baseline child vanished from the store.)
  for (const ni of finalNew) {
    const line = lines[ni]
    const created = addParsedEntity({ title: line.entry.title, contextId: id, kind: line.kind })
    applyEntryFields(created, line.entry, false)
    resolved[ni] = created.id
    result.created++
  }

  // Leftover BASELINE children → their line was removed → unlink from this body (entity kept).
  baseResid.forEach((r, i) => {
    if (!consumed.has(i) && detachChildFromContext(baseline.ids[r.bi], id)) result.unlinked++
  })

  // Reorder this context to the new LINE order. Append any surviving children not represented by a
  // line (defensive — shouldn't happen since every child serialized to a line) so none are dropped.
  const orderedIds = resolved.filter((x): x is string => !!x)
  const remaining = getChildren(id)
    .map((c) => c.id)
    .filter((cid) => !orderedIds.includes(cid))
  reorderContextItems(id, [...orderedIds, ...remaining])

  return result
}
