// ENTITY CONTENT as a markdown file (v1) — the SOURCE-OF-TRUTH projection.
//
// The plan (Loris, Aug 2026): an entity's content IS a markdown file. Every zoom level of the
// ENTITY CONTENT frame is a projection derived by PARSING that file:
//   • zoom-IN  → the raw markdown (this module serializes it),
//   • zoom-OUT → the rendered child rows (Zero re-parses + reconciles via this module).
//
// A line prefixed with a 4-letter KIND code is a CHILD-ENTITY reference; unprefixed lines are
// (future) rich text — parsed here but NOT persisted in v1 (see applyMarkdownToChildren).
//
// Grammar (one child per line):
//   <4-letter kind>: <title> [--color:#rrggbb]
// e.g.
//   task: Task
//   mome: Moment --color:#a855f7
//   inst: Instant --color:#ec4899
//
// v1 is DERIVED from the children graph (no persisted markdown field yet), so it is safe for
// seeded data with no migration. Reconcile rules chosen by Loris:
//   • a REMOVED line KEEPS its child (v1 never deletes),
//   • a changed KIND prefix on an EXISTING child is IGNORED (title/color still apply),
//   • EXTRA lines CREATE new children, edits rename / recolor.

import { addParsedEntity, getChildren, renameEntity, setEntityAccent } from "./data"
import { kindForPrefix, kindToPrefix, parseHexColor } from "./create-parse"
import type { EntityKind } from "./types"

/** One entity-reference line, parsed. `raw` is kept for round-trip diagnostics. */
export interface MarkdownEntityLine {
  kind: EntityKind
  title: string
  /** Normalized `#rrggbb`, or undefined when the line carried no `--color`. */
  color?: string
  raw: string
}

/** Result of reconciling an edited file back into the children graph. */
export interface ApplyMarkdownResult {
  created: number
  renamed: number
  recolored: number
  /** Lines whose prefix named a different kind than the existing child (ignored in v1). */
  ignoredKindChange: number
}

// ── Serialize ───────────────────────────────────────────────────────────────

/** Serialize ONE child entity to its markdown line. Emits `--color` only when the entity
 *  carries an explicit accent, so the projection round-trips exactly (a childless default has
 *  no color token). */
function serializeChildLine(e: { kind: EntityKind; title: string; color?: string }): string {
  let line = `${kindToPrefix(e.kind)}: ${e.title}`.trimEnd()
  if (e.color) line += ` --color:${e.color.toLowerCase()}`
  return line
}

/**
 * Project an entity's CONTENT to markdown: one line per child, in the content-view order
 * (`getChildren`). A childless entity yields "" (an empty file). This is the exact text the
 * zoom-IN code view shows.
 */
export function serializeEntityToMarkdown(id: string): string {
  return getChildren(id)
    .map((child) => serializeChildLine(child))
    .join("\n")
}

// ── Parse ─────────────────────────────────────────────────────────────────��─

/**
 * Parse ONE line. Returns an entity-reference line when it starts with a known 4-letter kind
 * prefix followed by `:`, else null (blank OR future rich-text — neither is a child ref in v1).
 * The `--color:#hex` token is pulled out and normalized; everything else remaining is the title.
 */
export function parseMarkdownLine(raw: string): MarkdownEntityLine | null {
  const line = raw.trim()
  if (!line) return null
  const m = line.match(/^([a-zA-Z]{4})\s*:\s*([\s\S]*)$/)
  if (!m) return null
  const kind = kindForPrefix(m[1])
  if (!kind) return null // 4 letters but not a real kind → treat as rich text (ignored v1)

  let rest = m[2]
  let color: string | undefined
  // Extract the first `--color:<value>` token (value runs to the next whitespace).
  const cm = rest.match(/--color:(\S+)/i)
  if (cm) {
    const normalized = parseHexColor(cm[1])
    if (normalized) color = normalized
    rest = (rest.slice(0, cm.index) + rest.slice(cm.index! + cm[0].length)).trim()
  }
  const title = rest.replace(/\s+/g, " ").trim()
  if (!title) return null // a prefix with no title isn't a usable child ref
  return { kind, title, color, raw }
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

// ── Reconcile (apply edits back) ──────────────────────────────────────────────

/**
 * Reconcile an edited markdown file back into the children graph — the zoom-OUT commit.
 * POSITIONAL: entity-ref line i maps to existing child i (in `getChildren` order). Per Loris's
 * v1 rules: extra lines CREATE children; a changed title RENAMES; a changed `--color` RECOLORS;
 * a changed KIND on an existing child is IGNORED (only new lines honor their prefix); FEWER lines
 * KEEP the remaining children (never deletes). A line that omits `--color` does NOT clear an
 * existing accent (serialize always re-emits it, so absence isn't a delete intent in v1).
 */
export function applyMarkdownToChildren(id: string, text: string): ApplyMarkdownResult {
  const lines = parseMarkdown(text)
  const existing = getChildren(id)
  const result: ApplyMarkdownResult = { created: 0, renamed: 0, recolored: 0, ignoredKindChange: 0 }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const child = existing[i]
    if (child) {
      if (line.kind !== child.kind) result.ignoredKindChange++
      if (line.title && line.title !== child.title) {
        if (renameEntity(child.id, line.title)) result.renamed++
      }
      if (line.color && line.color.toLowerCase() !== (child.color ?? "").toLowerCase()) {
        if (setEntityAccent(child.id, line.color)) result.recolored++
      }
    } else {
      // New line beyond the existing children → create a child of the line's kind.
      const created = addParsedEntity({ title: line.title, contextId: id, kind: line.kind })
      if (line.color) setEntityAccent(created.id, line.color)
      result.created++
    }
  }
  return result
}
