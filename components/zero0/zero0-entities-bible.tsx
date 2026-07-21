"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Bold,
  Italic,
  List,
  RemoveFormatting,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Baseline,
  Highlighter,
  StickyNote,
} from "lucide-react"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import type { EntityKind } from "@/lib/zero/types"

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE ENTITIES BIBLE — an interactive cheat sheet documenting every entity KIND (columns) against
// every FIELD / STATE / INTERACTION (rows). Seeded from the live model (KIND_META, getState,
// docs/interaction-matrix.md) so it reflects CURRENT behaviour, then editable/extendable by hand.
//
//   • Cells are RICH TEXT (contentEditable) — bold / italic / list / clear + TEXT COLOR and
//     HIGHLIGHT via the toolbar swatch popovers (execCommand, persisted in the cell HTML).
//   • Cells size to their CONTENT (a real <table>, auto layout) — no forced min widths, no
//     always-on control gutters. Row/column ops (move · insert · delete) live in a RIGHT-CLICK
//     menu that also shows the cell's row/col NUMBER.
//   • NOTES — two flavours, both via the "Note" toolbar button:
//       – select a word/sentence first ⇒ an INLINE note: the text gets a dotted underline and a
//         floating tooltip on hover (stored inline as a `[data-note]` span in the cell HTML).
//       – no selection (just a caret in a cell) ⇒ a CELL FOOTNOTE: a small corner marker + a
//         numbered entry in the footnotes list under the table (stored as `cell.note`).
//   • The "Glyph" row seeds the REAL ontology glyph for each kind (via <Zero0Glyph>), display-only.
//   • SHARED STORE: the doc persists to a private Blob via /api/entities-bible so it is the SAME
//     document for Loris AND v0 (localStorage is only an offline fallback cache). This enables the
//     collaborative loop — Loris edits / drops "@v0 …" requests, v0 reads the blob next turn and
//     appends replies. AUTHORSHIP colour: Loris's typing is BLUE by default; v0-authored text is
//     wrapped `.v0e` (neutral foreground). Cells with an unresolved "@v0" show an amber marker.
//
// contentEditable is intentionally UNCONTROLLED: each cell's innerHTML is seeded ONCE on mount and
// read back on blur. React never rewrites it during typing (which would jump the caret); cells are
// keyed by a stable id so reordering rows/cols preserves their DOM + edits.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// localStorage is now only an OFFLINE FALLBACK cache; the shared Blob (via /api/entities-bible) is
// the source of truth so v0 and Loris edit the SAME document.
const STORAGE_KEY = "zero:entities-bible:v3"

// AUTHORSHIP colour model: text typed by Loris is BLUE by default; text authored by v0 is wrapped
// in `<span class="v0e">` so it renders in the neutral foreground (black in light / near-white in
// dark). Bumping this constant re-runs the wrap migration. All SEED content is v0-authored.
const AUTHOR_MODEL = 2
const wrapV0 = (html: string) =>
  html && !html.includes('class="v0e"') ? `<span class="v0e">${html}</span>` : html

type Cell = {
  /** Rich-text HTML for a normal cell. */
  html?: string
  /** If set, the cell renders this kind's ontology glyph (display-only) instead of text. */
  glyph?: EntityKind
  /**
   * If set, the cell renders this kind's ontology glyph as a small LEADING badge ALONGSIDE its
   * editable text (unlike `glyph`, which replaces the content). The glyph is drawn in its base
   * OPEN state — outline, no fill — i.e. identical to the "Glyph" row. Used on the "Creatable?"
   * row to show, per kind, the shape a freshly-created (open-state) entity takes.
   */
  glyphInline?: EntityKind
  /** A cell-level footnote (rendered as a corner marker + a numbered entry below the table). */
  note?: string
}

type Grid = {
  rowIds: string[]
  colIds: string[]
  /** Keyed by `${rowId}::${colId}`. */
  cells: Record<string, Cell>
  /** Which authorship-colour migration has been applied (see AUTHOR_MODEL). */
  authorModel?: number
  /** Server write timestamp (set by the API on save). */
  updatedAt?: number
}

const cellKey = (rowId: string, colId: string) => `${rowId}::${colId}`

// Wrap all existing cell content as v0-authored (neutral) exactly once, so that fresh typing —
// which is unwrapped — defaults to the user's blue. Idempotent via the `authorModel` stamp.
function ensureAuthorModel(grid: Grid): Grid {
  if (grid.authorModel === AUTHOR_MODEL) return grid
  const cells: Record<string, Cell> = {}
  for (const [k, cell] of Object.entries(grid.cells)) {
    cells[k] = cell.html ? { ...cell, html: wrapV0(cell.html) } : cell
  }
  return { ...grid, cells, authorModel: AUTHOR_MODEL }
}

// The field-label column and the "Name" row have stable ids so cell-specific styling (e.g. the
// centered kind names) survives row/column reordering.
const FIELD_COL = "c-field"
const NAME_ROW = "r-name"

// The eight creatable kinds in Loris's draft column order (matches the ID row 1–8).
const KIND_COLS: EntityKind[] = [
  "space",
  "task",
  "resource",
  "moment",
  "instant",
  "individual",
  "organism",
  "community",
]

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const stripHtml = (html: string) => html.replace(/<[^>]*>/g, "").trim()

// ── The cheat-sheet content ─────────────────────────────────────────────────────────────────
// Each row = a FIELD / STATE / INTERACTION. Per-kind cells are keyed by kind; a missing kind
// renders "—". Everything here mirrors CURRENT behaviour (KIND_META, getStateInner, the matrix).
type RowDef = {
  id: string
  /** Field-label (col 0) HTML. */
  label: string
  /** Optional accent color for the label (used to colour-code the STATE rows). */
  labelColor?: string
  /** Center the kind cells (used for short scalar rows like Name / ID). */
  center?: boolean
  /** Seed the ontology glyph instead of text. */
  glyph?: boolean
  /** Seed each kind's open-state glyph as a leading badge ALONGSIDE the cell text. */
  glyphInline?: boolean
  /** Per-kind cell HTML. */
  cells?: Partial<Record<EntityKind, string>>
}

// State colour-coding (also demonstrates the colour feature).
const C = {
  open: "#2563eb",
  scheduled: "#d97706",
  ongoing: "#16a34a",
  done: "#15803d",
  complete: "#0d9488",
  closed: "#475569",
  cancelled: "#dc2626",
}

const ROWS: RowDef[] = [
  { id: "r-glyph", label: "Glyph", glyph: true, center: true },
  {
    id: NAME_ROW,
    label: "Name",
    center: true,
    cells: kindMap((k) => cap(k)),
  },
  { id: "r-id", label: "ID", center: true, cells: kindMapI((_, i) => String(i + 1)) },
  {
    id: "r-desc",
    label: "Description",
    cells: {
      space: "A context that holds things",
      task: "A thing to do",
      resource: "An asset, reference, or tool",
      moment: "A span in time",
      instant: "A point in time",
      individual: "A person, animated by a Soul",
      organism: "A company, a point of view",
      community: "A place to gather people and discussions",
    },
  },
  {
    id: "r-family",
    label: "Family",
    cells: {
      space: "What · container",
      task: "What · action",
      resource: "What · thing",
      moment: "When · span",
      instant: "When · point",
      individual: "Who · being",
      organism: "Who · being",
      community: "Who · being",
    },
  },
  {
      id: "r-creatable",
      label: "Creatable?",
      cells: {
        space: "Yes",
      task: "Yes",
      resource: "Yes",
      moment: "Yes",
      instant: "Yes",
      individual: "Yes (temp)",
      organism: "Yes",
      community: "Yes",
    },
  },
  {
    id: "r-planned",
    label: "Planned kind?",
    cells: {
      space: "Yes — span is its essence",
      task: "Yes",
      resource: "Yes — when set",
      moment: "Yes — span is its essence",
      instant: "No — a point + mark tally",
      individual: "No — being → AGE",
      organism: "No — being → AGE",
      community: "No — being → AGE",
    },
  },
  {
    id: "r-done",
    label: "Done-state?",
    cells: { task: "Yes — a soft checkmark, its own axis" },
  },
  {
    id: "r-fills",
    label: "Fills when closed?",
    cells: {
      space: "Yes",
      task: "Yes",
      resource: "Yes",
      moment: "Yes",
      instant: "Yes",
      individual: "No — only fades",
      organism: "No — only fades",
      community: "No — only fades",
    },
  },
  {
    id: "r-terminal",
    label: "Terminal end",
    glyphInline: true,
    cells: {
      individual: "death",
      organism: "death",
      community: "retire",
    },
  },
  {
    id: "r-open",
    label: "State: open",
    labelColor: C.open,
    cells: {
      space: "Live; empty or holding open things (outline)",
      task: "A live to-do (outline)",
      resource: "Live / available (a web resource glyph is always filled)",
      moment: "Planned but not started, or “whenever” (idle)",
      instant: "No time set yet",
      individual: "Alive / present",
      organism: "Alive / present",
      community: "Alive / present",
    },
  },
  {
    id: "r-scheduled",
    label: "State: scheduled",
    labelColor: C.scheduled,
    cells: {
      instant: "Concrete <code>at</code> set, not yet reached (instant-only word)",
    },
  },
  {
    id: "r-ongoing",
    label: "State: ongoing",
    labelColor: C.ongoing,
    cells: {
      space: "Open PLAY session, OR concrete start in progress, OR a contained child is ongoing (rollup)",
      task: "Open PLAY session (auto-opened on enter while undone). Focus/viewing never flips state",
      resource: "Open PLAY session (auto-opened on enter)",
      moment: "Open PLAY session, OR concrete start passed &amp; not yet ended",
      instant: "Never — a point in time",
      individual: "Never — a being reads ALIVE, not “in progress” (rollup stops at beings)",
      organism: "Never — a being reads ALIVE (rollup stops here)",
      community: "Never — a being reads ALIVE (rollup stops here)",
    },
  },
  {
    id: "r-donestate",
    label: "State: done",
    labelColor: C.done,
    cells: {
      task:
        "Marked Done (checkmark). Completes the task — unless a " +
        '<span data-note="A Task marked Done while it still has an open task-child reads the dedicated word done (ranked above ongoing), NOT complete; it auto-completes the instant the last task-child completes. Non-task children never gate.">task-child is still open</span>' +
        ", when it reads “done but open”",
    },
  },
  {
    id: "r-complete",
    label: "State: complete",
    labelColor: C.complete,
    cells: {
      space: "Its set end has passed; glyph FILLS, row stays live awaiting midnight close",
      task: "Done + all task-children complete; glyph fills, awaits close",
      resource: "When a set end passes",
      moment: "Its end has passed; glyph fills, awaits close",
      instant: "Reached its max occurrences (marks + a passed <code>at</code>); default max 1",
      individual: "— beings don’t “complete”",
      organism: "— beings don’t “complete”",
      community: "— beings don’t “complete”",
    },
  },
  {
    id: "r-closed",
    label: "State: closed / dead / retired",
    labelColor: C.closed,
    cells: {
      space: "Closed — filed at the stamped midnight (fills + fades)",
      task: "Closed — filed at midnight after Done (fills + fades)",
      resource: "Closed by hand (fills + fades)",
      moment: "Closed at the next midnight (fills + fades)",
      instant: "Closed at the next midnight (fills + fades)",
      individual: "<b>Dead</b> — fades, keeps its outline (<code>diedOn</code>)",
      organism: "<b>Dead</b> — fades, keeps its outline (<code>diedOn</code>)",
      community: "<b>Retired</b> — fades, keeps its outline (<code>retiredOn</code>)",
    },
  },
  {
    id: "r-cancelled",
    label: "State: cancelled",
    labelColor: C.cancelled,
    cells: {
      space: "Called off — bar over glyph + strike + fade",
      task: "Called off — bar over glyph + strike + fade",
      resource: "Called off — bar + strike + fade",
      moment: "Called off — bar + strike + fade",
      instant: "Called off — bar + strike + fade",
      individual: "Not available — an Individual can’t be cancelled",
      organism: "Called off — bar + strike + fade",
      community: "Called off — bar + strike + fade",
    },
  },
  {
    id: "r-enter",
    label: "On enter (drill-in)",
    cells: {
      space: "Auto-opens a PLAY session ⇒ spins + DURATION counts; ACCESS (presence) also ticks",
      task: "Auto-PLAY while undone ⇒ spins; a Done task is presence-only (ACCESS ticks, no spin)",
      resource: "Auto-PLAY ⇒ spins",
      moment: "Presence only (ACCESS ticks); does NOT auto-play",
      instant: "Presence only; never ongoing",
      individual: "Presence only (ACCESS ticks); never spins",
      organism: "Presence only; never spins",
      community: "Presence only; never spins",
    },
  },
  {
    id: "r-glyphclick",
    label: "Glyph click",
    cells: {
      space: "Idle ⇒ Play; spinning ⇒ Stop",
      task: "Spinning ⇒ Stop; resting + undone ⇒ Done; done ⇒ un-done (resumes if still open)",
      resource: "Idle ⇒ Play; spinning ⇒ Stop",
      moment: "Idle ⇒ Play (manual stopwatch, activity rail); spinning ⇒ Stop",
      instant: "Mark — adds one occurrence; glyph flashes its fill once",
      individual: "— view only",
      organism: "— view only",
      community: "— view only",
    },
  },
  {
    id: "r-play",
    label: "Play / Stop (menu)",
    cells: {
      space: "Play ⇒ open a play session; Stop ⇒ close it (records on the activity rail)",
      task: "Via glyph; auto-plays on enter",
      resource: "Play / Stop; auto-plays on enter",
      moment: "Play ⇒ open a play session; Stop ⇒ close it",
      instant: "— use Mark instead",
      individual: "—",
      organism: "—",
      community: "—",
    },
  },
  {
    id: "r-mark",
    label: "Mark",
    cells: {
      instant:
        "Append a zero-length occurrence toward the tally. <code>--maxnb:3</code> soft cap, " +
        "<code>--maxnbhard:3</code> hard cap; default max 1 = a unique occurrence",
    },
  },
  {
    id: "r-sources",
    label: "Ongoing sources",
    cells: {
      space: "① open play · ② concrete started span · ③ rollup from a contained child",
      task: "① open play (focus/viewing never flips state)",
      resource: "① open play",
      moment: "① open play · ② concrete started span",
      instant: "none",
      individual: "none — rollup stops at beings",
      organism: "none — rollup stops at beings",
      community: "none — rollup stops at beings",
    },
  },
  {
    id: "r-schedule",
    label: "Schedule fields",
    cells: {
      space: "start · end · duration",
      task: "start · end · due · duration",
      resource: "start · end · duration (when set)",
      moment: "start · end · duration",
      instant: "at (start = end = at, a point)",
      individual: "— AGE from <code>createdAt</code>",
      organism: "— AGE from <code>createdAt</code>",
      community: "— AGE from <code>createdAt</code>",
    },
  },
  {
    id: "r-usecase",
    label: "Usecase",
    cells: {
      space: "“Work”, “Kitchen”, a project",
      task: "“Write the report”, “Buy milk”",
      resource: "A website, a doc, a tool",
      moment: "“Lunch 1–2pm”, “Sprint week”",
      instant: "“Ship v1”, a heartbeat ping",
      individual: "“Loris”, a contact",
      organism: "“Vercel”, a company / POV",
      community: "“The team”, a group",
    },
  },
]

// Build a full per-kind map from a fn (keeps the seed declarations terse).
function kindMap(fn: (k: EntityKind) => string): Partial<Record<EntityKind, string>> {
  const out: Partial<Record<EntityKind, string>> = {}
  KIND_COLS.forEach((k) => (out[k] = fn(k)))
  return out
}
function kindMapI(fn: (k: EntityKind, i: number) => string): Partial<Record<EntityKind, string>> {
  const out: Partial<Record<EntityKind, string>> = {}
  KIND_COLS.forEach((k, i) => (out[k] = fn(k, i)))
  return out
}

function seedGrid(): Grid {
  const colIds = [FIELD_COL, ...KIND_COLS.map((_, i) => `c-${i}`)]
  const cells: Record<string, Cell> = {}
  for (const row of ROWS) {
    const label = row.labelColor
      ? `<span style="color:${row.labelColor}">${row.label}</span>`
      : row.label
    cells[cellKey(row.id, FIELD_COL)] = { html: label }
    KIND_COLS.forEach((kind, i) => {
      const colId = `c-${i}`
      if (row.glyph) cells[cellKey(row.id, colId)] = { glyph: kind }
      else
        cells[cellKey(row.id, colId)] = {
          html: row.cells?.[kind] ?? "—",
          ...(row.glyphInline ? { glyphInline: kind } : {}),
        }
    })
  }
  // A seeded CELL FOOTNOTE demonstrating the footnote flavour (Individual is only temporarily creatable).
  const indCol = `c-${KIND_COLS.indexOf("individual")}`
  const creatableCell = cells[cellKey("r-creatable", indCol)]
  if (creatableCell)
    creatableCell.note =
      "Normally an Individual is spawned WITH a Soul, not created ad hoc — it’s temporarily creatable so Loris can dogfood people/other Individuals directly."
  return { rowIds: ROWS.map((r) => r.id), colIds, cells }
}

// Move item at `from` to `to` in a fresh copy of the array.
function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr
  const next = arr.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

let uidCounter = 0
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(uidCounter++).toString(36)}`

// ── One editable rich-text cell (uncontrolled contentEditable). ─────────────────────────────────
function EditableCell({
  cellId,
  initialHtml,
  active,
  centered,
  onFocus,
  onCommit,
}: {
  cellId: string
  initialHtml: string
  active: boolean
  centered?: boolean
  onFocus: (cellId: string, el: HTMLDivElement) => void
  onCommit: (cellId: string, html: string) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  // Seed innerHTML exactly once — never on subsequent renders (that would move the caret).
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // AUTHORSHIP GUARD: text typed by the user must stay BLUE (the .bible-cell default). Left to the
  // browser, typing at the edge of a v0-authored `<span class="v0e">` gets absorbed into it and
  // inherits the neutral (black) colour. So we intercept plain text insertion and drop the typed
  // characters as a BARE text node OUTSIDE any enclosing .v0e span (splitting the span at the
  // caret). Everything else (delete, paste, formatting, Enter, IME composition) is left native.
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== "insertText" || e.data == null || e.isComposing) return
      const sel = window.getSelection()
      if (!sel || !sel.rangeCount) return
      const range = sel.getRangeAt(0)
      if (!root.contains(range.startContainer)) return
      e.preventDefault()
      range.deleteContents()
      // Find an enclosing .v0e span (if any) between the caret and the cell root.
      let v0e: HTMLElement | null = null
      let n: Node | null = range.startContainer
      while (n && n !== root) {
        if (n instanceof HTMLElement && n.classList.contains("v0e")) {
          v0e = n
          break
        }
        n = n.parentNode
      }
      const textNode = document.createTextNode(e.data)
      if (v0e && v0e.parentNode) {
        // Split the v0e span: move everything after the caret into a new trailing v0e span, then
        // insert the bare text between the two halves so it renders blue.
        const tail = document.createRange()
        tail.setStart(range.startContainer, range.startOffset)
        tail.setEnd(v0e, v0e.childNodes.length)
        const frag = tail.extractContents()
        const parent = v0e.parentNode
        const afterV0e = v0e.nextSibling
        parent.insertBefore(textNode, afterV0e)
        if (frag.textContent && frag.textContent.length > 0) {
          const tailSpan = document.createElement("span")
          tailSpan.className = "v0e"
          tailSpan.appendChild(frag)
          parent.insertBefore(tailSpan, textNode.nextSibling)
        }
        if (!v0e.textContent) v0e.remove()
      } else {
        range.insertNode(textNode)
      }
      const after = document.createRange()
      after.setStartAfter(textNode)
      after.collapse(true)
      sel.removeAllRanges()
      sel.addRange(after)
    }
    root.addEventListener("beforeinput", onBeforeInput)
    return () => root.removeEventListener("beforeinput", onBeforeInput)
  }, [])
  return (
    <div
      ref={ref}
      role="textbox"
      aria-multiline="true"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      onFocus={() => ref.current && onFocus(cellId, ref.current)}
      onBlur={() => ref.current && onCommit(cellId, ref.current.innerHTML)}
      className={
        "bible-cell h-full min-w-[3rem] px-2 py-1 text-[10px] leading-snug outline-none [&_ul]:my-0 [&_ul]:list-disc [&_ul]:pl-5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] " +
        (centered ? "text-center " : "") +
        (active ? "bg-primary/5 ring-1 ring-inset ring-primary/40" : "")
      }
    />
  )
}

// A tiny square control button used by the toolbar / popovers.
function IconBtn({
  title,
  onClick,
  children,
  disabled,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      // Preserve the focused editable's selection so toolbar formatting applies to it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}

// One row in the right-click context menu.
function MenuItem({
  onSelect,
  disabled,
  danger,
  icon,
  children,
}: {
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      className={
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors disabled:pointer-events-none disabled:opacity-30 " +
        (danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted")
      }
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center text-muted-foreground">{icon}</span>
      {children}
    </button>
  )
}

// Curated colour swatches (author-content colours, not app chrome — kept tasteful, no purple).
const TEXT_COLORS = [
  { name: "Red", hex: "#dc2626" },
  { name: "Orange", hex: "#ea580c" },
  { name: "Amber", hex: "#d97706" },
  { name: "Green", hex: "#16a34a" },
  { name: "Teal", hex: "#0d9488" },
  { name: "Blue", hex: "#2563eb" },
  { name: "Pink", hex: "#db2777" },
  { name: "Slate", hex: "#475569" },
]
const HILITE_COLORS = [
  { name: "Yellow", hex: "#fef08a" },
  { name: "Green", hex: "#bbf7d0" },
  { name: "Blue", hex: "#bfdbfe" },
  { name: "Pink", hex: "#fbcfe8" },
  { name: "Orange", hex: "#fed7aa" },
  { name: "Slate", hex: "#e2e8f0" },
]

type Menu = { x: number; y: number; ri: number; ci: number }
type Picker = { x: number; y: number; kind: "fore" | "hilite" }
type NotePopover = { x: number; y: number; mode: "inline" | "cell"; cellId: string; initial: string }
type HoverNote = { text: string; x: number; y: number }

export function Zero0EntitiesBible() {
  const [grid, setGrid] = useState<Grid>(seedGrid)
  const [hydrated, setHydrated] = useState(false)
  // Shared-store sync status shown in the header ("saving…" / "saved" / "offline").
  const [sync, setSync] = useState<"idle" | "saving" | "saved" | "offline">("idle")
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The exact grid object produced by hydration (loaded doc or seed). The save effect refuses to
  // PUT this object, so an untouched / freshly-seeded page can never clobber the shared doc.
  const hydratedGridRef = useRef<Grid | null>(null)
  // Whether the shared store was reachable at load. When false, saves are suppressed so we never
  // overwrite a real doc we merely failed to read.
  const storeReachableRef = useRef(false)
  const [activeCell, setActiveCell] = useState<string | null>(null)
  // Sticky floating header: the first two rows (Glyph + Name) stay in the table, but once they
  // scroll above the viewport a condensed header appears pinned to the top, echoing each column's
  // glyph + name. We measure the live column widths and mirror the horizontal scroll so it aligns.
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const tableRef = useRef<HTMLTableElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null) // the sticky formatting toolbar (pinned at top)
  const triggerRowRef = useRef<HTMLTableRowElement | null>(null) // the Name row (index 1)
  const [stickyHead, setStickyHead] = useState<{
    left: number
    width: number
    scrollLeft: number
    colW: number[]
    /** Viewport offset (px) so the floating header sits just BELOW the sticky toolbar, not over it. */
    top: number
    open: boolean
  } | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [picker, setPicker] = useState<Picker | null>(null)
  const [notePopover, setNotePopover] = useState<NotePopover | null>(null)
  const [hoverNote, setHoverNote] = useState<HoverNote | null>(null)
  const [noteText, setNoteText] = useState("")
  const activeElRef = useRef<HTMLDivElement | null>(null)
  // A saved Range for an INLINE note — captured before the note input steals the selection.
  const savedRangeRef = useRef<Range | null>(null)
  const noteInputRef = useRef<HTMLInputElement | null>(null)
  // Toolbar-button anchors so the colour / note popovers open beneath their icon.
  const colorAnchorRef = useRef<HTMLSpanElement | null>(null)
  const hiliteAnchorRef = useRef<HTMLSpanElement | null>(null)
  const noteAnchorRef = useRef<HTMLSpanElement | null>(null)

  // Hydrate from the SHARED Blob store after mount (SSR-safe: server + first client render both
  // show the seed skeleton, then this swaps in the stored doc — no hydration mismatch). Falls back
  // to the localStorage cache when the network is unavailable.
  //
  // ⚠️ CLOBBER SAFETY: the save effect below must NEVER push the grid object that hydration
  // produced (a loaded doc, or a fresh seed). Otherwise a reload whose GET transiently fails — or a
  // fresh context with empty localStorage — would fall back to the seed and immediately PUT it,
  // wiping the real shared doc. We therefore record the exact hydrated object in `hydratedGridRef`
  // and skip saving while `grid` is still that object. Only a genuine user edit (which produces a
  // NEW grid object) is ever written back. An empty store is seeded via a single controlled PUT
  // here, and only when the store was actually reachable.
  useEffect(() => {
    let cancelled = false
    const readLocal = (): Grid | null => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as Grid
        return parsed?.rowIds?.length && parsed?.colIds?.length && parsed.cells ? parsed : null
      } catch {
        return null
      }
    }
    ;(async () => {
      let remote: Grid | null = null
      let reachable = true
      try {
        const res = await fetch("/api/entities-bible", { cache: "no-store" })
        if (res.ok) {
          const { doc } = (await res.json()) as { doc: Grid | null }
          if (doc?.rowIds?.length && doc?.colIds?.length && doc.cells) remote = doc
        } else {
          reachable = false
        }
      } catch {
        reachable = false
      }
      if (cancelled) return

      const local = readLocal()
      // Prefer the shared doc; else adopt a local cache; else start from a fresh seed.
      const source = remote ?? local ?? seedGrid()
      const finalGrid = ensureAuthorModel(source)
      hydratedGridRef.current = finalGrid // mark this object as "not a user edit" → never auto-PUT
      storeReachableRef.current = reachable
      setGrid(finalGrid)
      setSync(reachable ? "saved" : "offline")
      setHydrated(true)

      // Controlled one-shot seed: only when the store is genuinely empty AND reachable. Never when
      // offline (that would risk overwriting a real doc we simply failed to read).
      if (reachable && !remote) {
        try {
          await fetch("/api/entities-bible", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ doc: finalGrid }),
          })
        } catch {
          /* non-fatal — a later user edit will persist it */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Persist USER EDITS: cache locally immediately, then debounce-push to the shared Blob store so
  // v0 sees the edits next turn. Skips the hydrated/seed object (see CLOBBER SAFETY above) and never
  // pushes when the store was unreachable at load.
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(grid))
    } catch {
      /* quota / private mode — non-fatal */
    }
    if (grid === hydratedGridRef.current) return // untouched hydrate/seed result — do not save
    if (!storeReachableRef.current) {
      setSync("offline")
      return
    }
    setSync("saving")
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/entities-bible", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doc: grid }),
        })
        setSync(res.ok ? "saved" : "offline")
      } catch {
        setSync("offline")
      }
    }, 800)
  }, [grid, hydrated])

  // Drive the sticky floating header: show it once the first two rows scroll above the viewport,
  // measuring live column widths and mirroring the wrapper's horizontal scroll. Uses capture-phase
  // scroll so it works whether the page scrolls at the window or inside an ancestor container.
  useEffect(() => {
    const wrap = wrapRef.current
    const table = tableRef.current
    if (!wrap || !table) return
    let raf = 0
    const compute = () => {
      raf = 0
      const trigger = triggerRowRef.current
      const wrapRect = wrap.getBoundingClientRect()
      const triggerBottom = trigger ? trigger.getBoundingClientRect().bottom : Infinity
      // Open only after the Glyph+Name rows have scrolled past the top, while the table is still on
      // screen (leave ~48px so it doesn't flash for a sliver of remaining table). We keep the header
      // MOUNTED and toggle `open` so it can transition in/out smoothly rather than pop.
      const open = triggerBottom <= 0 && wrapRect.bottom >= 48
      const firstRow = table.querySelector("tbody tr")
      const colW = firstRow
        ? Array.from(firstRow.children).map((c) => (c as HTMLElement).getBoundingClientRect().width)
        : []
      // The toolbar is sticky at the viewport top; sit the floating header just below it so it never
      // covers the formatting controls. Clamp to >= 0 in case the toolbar has scrolled off entirely.
      const tb = toolbarRef.current?.getBoundingClientRect()
      const top = tb ? Math.max(0, tb.bottom) : 0
      setStickyHead((s) => {
        // Once closed and never re-opened, drop it entirely to avoid an empty fixed layer.
        if (!open && !s) return null
        return { left: wrapRect.left, width: wrapRect.width, scrollLeft: wrap.scrollLeft, colW, top, open }
      })
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute)
    }
    compute()
    window.addEventListener("scroll", onScroll, { passive: true, capture: true })
    window.addEventListener("resize", onScroll)
    wrap.addEventListener("scroll", onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(table)
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions)
      window.removeEventListener("resize", onScroll)
      wrap.removeEventListener("scroll", onScroll)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [hydrated, grid])

  // Dismiss any popover (menu / picker / note) on OUTSIDE click, scroll, or Escape.
  // IMPORTANT: this is a NATIVE window listener, so React's `stopPropagation` inside the popovers
  // does NOT block it — and for trusted discrete clicks React flushes this effect synchronously, so
  // the very click that OPENS a popover would otherwise reach window and close it again (the bug that
  // made color/highlight/note "do nothing"). We therefore guard by the real event target: clicks that
  // originate inside the toolbar (the trigger buttons) or inside any popover never dismiss.
  useEffect(() => {
    if (!menu && !picker && !notePopover) return
    const hardClose = () => {
      setMenu(null)
      setPicker(null)
      setNotePopover(null)
    }
    const closeOnClick = (e: Event) => {
      const node = e.target as Node | null
      const el = node instanceof Element ? node : node?.parentElement ?? null
      if (toolbarRef.current && node && toolbarRef.current.contains(node)) return // a toolbar trigger
      if (el?.closest("[data-bible-popover]")) return // inside a popover (swatches, note input, menu)
      hardClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hardClose()
    window.addEventListener("click", closeOnClick)
    window.addEventListener("scroll", hardClose, true)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("click", closeOnClick)
      window.removeEventListener("scroll", hardClose, true)
      window.removeEventListener("keydown", onKey)
    }
  }, [menu, picker, notePopover])

  // Focus the note input when the note popover opens.
  useEffect(() => {
    if (notePopover) {
      setNoteText(notePopover.initial)
      // next tick so the element is mounted
      requestAnimationFrame(() => noteInputRef.current?.focus())
    }
  }, [notePopover])

  const handleFocus = useCallback((cellId: string, el: HTMLDivElement) => {
    activeElRef.current = el
    setActiveCell(cellId)
  }, [])

  const handleCommit = useCallback((cellId: string, html: string) => {
    setGrid((g) => {
      const prev = g.cells[cellId]
      if (prev?.html === html) return g
      return { ...g, cells: { ...g.cells, [cellId]: { ...prev, html } } }
    })
  }, [])

  // Read the focused editable's current HTML straight back into the grid (used after execCommand,
  // which mutates the DOM without firing blur).
  const commitActive = useCallback(() => {
    const el = activeElRef.current
    if (el && activeCell) handleCommit(activeCell, el.innerHTML)
  }, [activeCell, handleCommit])

  // Apply a no-arg rich-text command to the focused editable.
  const exec = useCallback(
    (command: string) => {
      activeElRef.current?.focus()
      document.execCommand(command, false)
      commitActive()
    },
    [commitActive],
  )

  // Apply a valued command (colour). styleWithCSS ⇒ inline-style spans instead of <font> tags.
  // If the user has no text selected (just a caret, or focus was lost), colour the WHOLE active
  // cell — matching the natural "click in a cell, pick a colour" expectation. `foreColor`/
  // `hiliteColor` are no-ops on a collapsed selection, which is why this felt broken before.
  const execColor = useCallback(
    (command: string, value: string) => {
      const el = activeElRef.current
      if (!el) {
        setPicker(null)
        return
      }
      el.focus()
      const sel = window.getSelection()
      const hasCellSelection =
        sel && sel.rangeCount > 0 && !sel.isCollapsed && el.contains(sel.anchorNode) && el.contains(sel.focusNode)
      if (!hasCellSelection) {
        // Select the whole cell so the command has something to act on.
        const range = document.createRange()
        range.selectNodeContents(el)
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
      try {
        document.execCommand("styleWithCSS", false, "true")
      } catch {
        /* not supported — falls back to font tags */
      }
      const ok = document.execCommand(command, false, value)
      if (!ok && command === "hiliteColor") document.execCommand("backColor", false, value)
      commitActive()
      setPicker(null)
    },
    [commitActive],
  )

  // ── Note flow ───────────────────────────────────────────────────────────────────────────────
  // Toolbar "Note": a non-collapsed selection inside the active cell ⇒ INLINE note; otherwise a
  // CELL footnote for the active cell.
  const openNoteFromToolbar = useCallback(
    (anchor: DOMRect) => {
      if (!activeCell) return
      const sel = window.getSelection()
      const el = activeElRef.current
      let mode: "inline" | "cell" = "cell"
      if (sel && sel.rangeCount && !sel.isCollapsed && el && el.contains(sel.anchorNode)) {
        mode = "inline"
        savedRangeRef.current = sel.getRangeAt(0).cloneRange()
      } else {
        savedRangeRef.current = null
      }
      const initial = mode === "cell" ? grid.cells[activeCell]?.note ?? "" : ""
      setNotePopover({
        x: Math.min(anchor.left, window.innerWidth - 320),
        y: anchor.bottom + 6,
        mode,
        cellId: activeCell,
        initial,
      })
    },
    [activeCell, grid.cells],
  )

  // Marker click ⇒ edit an existing cell footnote.
  const openNoteForCell = useCallback((cellId: string, anchor: DOMRect, initial: string) => {
    savedRangeRef.current = null
    setNotePopover({
      x: Math.min(anchor.left, window.innerWidth - 320),
      y: anchor.bottom + 6,
      mode: "cell",
      cellId,
      initial,
    })
  }, [])

  const saveNote = useCallback(() => {
    const pop = notePopover
    if (!pop) return
    const text = noteText.trim()
    if (pop.mode === "inline") {
      const range = savedRangeRef.current
      const el = activeElRef.current
      if (text && range && el) {
        el.focus()
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        const span = document.createElement("span")
        span.setAttribute("data-note", text)
        span.appendChild(range.extractContents())
        range.insertNode(span)
        sel?.removeAllRanges()
        handleCommit(pop.cellId, el.innerHTML)
      }
    } else {
      // Cell footnote: set (or clear on empty).
      setGrid((g) => {
        const prev = g.cells[pop.cellId] ?? { html: "" }
        const next: Cell = { ...prev }
        if (text) next.note = text
        else delete next.note
        return { ...g, cells: { ...g.cells, [pop.cellId]: next } }
      })
    }
    savedRangeRef.current = null
    setNotePopover(null)
  }, [notePopover, noteText, handleCommit])

  // ── Column ops ────────────────────────────────────────────────────────────────────────────
  const addColumn = useCallback((afterIndex?: number) => {
    setGrid((g) => {
      const newCol = uid("c")
      const at = afterIndex == null ? g.colIds.length : afterIndex + 1
      const colIds = g.colIds.slice()
      colIds.splice(at, 0, newCol)
      const cells = { ...g.cells }
      for (const rowId of g.rowIds) cells[cellKey(rowId, newCol)] = { html: "" }
      return { ...g, colIds, cells }
    })
  }, [])

  const removeColumn = useCallback((index: number) => {
    setGrid((g) => {
      if (g.colIds.length <= 1) return g
      const colId = g.colIds[index]
      const colIds = g.colIds.filter((_, i) => i !== index)
      const cells = { ...g.cells }
      for (const rowId of g.rowIds) delete cells[cellKey(rowId, colId)]
      return { ...g, colIds, cells }
    })
  }, [])

  const moveColumn = useCallback((index: number, dir: -1 | 1) => {
    setGrid((g) => ({ ...g, colIds: arrayMove(g.colIds, index, index + dir) }))
  }, [])

  // ── Row ops ──��────────────────────────────────────────────────────────────────────────────
  const addRow = useCallback((afterIndex?: number) => {
    setGrid((g) => {
      const newRow = uid("r")
      const at = afterIndex == null ? g.rowIds.length : afterIndex + 1
      const rowIds = g.rowIds.slice()
      rowIds.splice(at, 0, newRow)
      const cells = { ...g.cells }
      for (const colId of g.colIds) cells[cellKey(newRow, colId)] = { html: "" }
      return { ...g, rowIds, cells }
    })
  }, [])

  const removeRow = useCallback((index: number) => {
    setGrid((g) => {
      if (g.rowIds.length <= 1) return g
      const rowId = g.rowIds[index]
      const rowIds = g.rowIds.filter((_, i) => i !== index)
      const cells = { ...g.cells }
      for (const colId of g.colIds) delete cells[cellKey(rowId, colId)]
      return { ...g, rowIds, cells }
    })
  }, [])

  const moveRow = useCallback((index: number, dir: -1 | 1) => {
    setGrid((g) => ({ ...g, rowIds: arrayMove(g.rowIds, index, index + dir) }))
  }, [])

  const resetTable = useCallback(() => {
    setGrid(ensureAuthorModel(seedGrid()))
    setActiveCell(null)
  }, [])

  // Open the row/col context menu at the cursor, clamped to the viewport.
  const openMenu = useCallback((e: React.MouseEvent, ri: number, ci: number) => {
    e.preventDefault()
    const MENU_W = 176
    const MENU_H = 380
    const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8)
    const y = Math.min(e.clientY, window.innerHeight - MENU_H - 8)
    setMenu({ x: Math.max(8, x), y: Math.max(8, y), ri, ci })
  }, [])

  // Skeleton (pre-hydration) — same on server + first client paint to avoid mismatch.
  if (!hydrated) {
    return (
      <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
        Loading the entities bible…
      </div>
    )
  }

  const rowCount = grid.rowIds.length
  const colCount = grid.colIds.length

  // Assign footnote numbers in row-major order + build the list for below the table.
  const footnoteNum: Record<string, number> = {}
  const footnotes: { n: number; note: string; loc: string }[] = []
  for (const rowId of grid.rowIds) {
    for (const colId of grid.colIds) {
      const key = cellKey(rowId, colId)
      const c = grid.cells[key]
      if (c?.note) {
        const n = footnotes.length + 1
        footnoteNum[key] = n
        const rowLabel = stripHtml(grid.cells[cellKey(rowId, FIELD_COL)]?.html ?? "")
        const colLabel = colId === FIELD_COL ? "" : stripHtml(grid.cells[cellKey(NAME_ROW, colId)]?.html ?? "")
        footnotes.push({ n, note: c.note, loc: [rowLabel, colLabel].filter(Boolean).join(" · ") })
      }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Authorship colours: what Loris types defaults to BLUE; v0-authored text (wrapped .v0e) is
          the neutral foreground. Scoped to the editable cells. */}
      <style>{`
        .bible-cell { color: #2563eb; }
        .dark .bible-cell { color: #60a5fa; }
        .bible-cell .v0e { color: var(--foreground); }
      `}</style>

      {/* Legend + shared-store sync status. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#2563eb" }} aria-hidden />
          you
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-foreground" aria-hidden />
          v0
        </span>
        <span className="flex items-center gap-1.5">
          <span className="rounded bg-amber-400/25 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            @v0
          </span>
          type an <code className="rounded bg-muted px-1">@v0 …</code> request in any cell
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span
            className={
              "inline-block h-1.5 w-1.5 rounded-full " +
              (sync === "saving"
                ? "bg-amber-500"
                : sync === "offline"
                  ? "bg-destructive"
                  : "bg-emerald-500")
            }
            aria-hidden
          />
          {sync === "saving" ? "saving…" : sync === "offline" ? "offline (local only)" : "saved to shared store"}
        </span>
      </div>

      {/* Formatting toolbar — acts on the focused cell. z-30 keeps it ABOVE the floating column
          header (z-20), which is itself offset to sit just below this bar. */}
      <div ref={toolbarRef} className="sticky top-0 z-30 flex flex-wrap items-center gap-1 rounded-md border border-border bg-background/95 p-1.5 backdrop-blur">
        <IconBtn title="Bold" onClick={() => exec("bold")}>
          <Bold className="h-4 w-4" />
        </IconBtn>
        <IconBtn title="Italic" onClick={() => exec("italic")}>
          <Italic className="h-4 w-4" />
        </IconBtn>
        <IconBtn title="Bulleted list" onClick={() => exec("insertUnorderedList")}>
          <List className="h-4 w-4" />
        </IconBtn>
        <IconBtn title="Clear formatting" onClick={() => exec("removeFormat")}>
          <RemoveFormatting className="h-4 w-4" />
        </IconBtn>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        {/* Text colour */}
        <IconBtn
          title="Text color"
          onClick={() => {
            const r = colorAnchorRef.current?.getBoundingClientRect()
            if (r) setPicker({ x: r.left, y: r.bottom + 6, kind: "fore" })
          }}
        >
          <span ref={colorAnchorRef} className="flex items-center justify-center">
            <Baseline className="h-4 w-4" />
          </span>
        </IconBtn>
        {/* Highlight */}
        <IconBtn
          title="Highlight"
          onClick={() => {
            const r = hiliteAnchorRef.current?.getBoundingClientRect()
            if (r) setPicker({ x: r.left, y: r.bottom + 6, kind: "hilite" })
          }}
        >
          <span ref={hiliteAnchorRef} className="flex items-center justify-center">
            <Highlighter className="h-4 w-4" />
          </span>
        </IconBtn>
        {/* Note */}
        <IconBtn
          title="Add note (select text for a hover-note, or none for a cell footnote)"
          disabled={!activeCell}
          onClick={() => {
            const r = noteAnchorRef.current?.getBoundingClientRect()
            if (r) openNoteFromToolbar(r)
          }}
        >
          <span ref={noteAnchorRef} className="flex items-center justify-center">
            <StickyNote className="h-4 w-4" />
          </span>
        </IconBtn>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <IconBtn title="Add row (at end)" onClick={() => addRow()}>
          <span className="flex items-center text-[10px] font-medium">
            <Plus className="h-3.5 w-3.5" />R
          </span>
        </IconBtn>
        <IconBtn title="Add column (at end)" onClick={() => addColumn()}>
          <span className="flex items-center text-[10px] font-medium">
            <Plus className="h-3.5 w-3.5" />C
          </span>
        </IconBtn>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={resetTable}
          className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Reset to draft
        </button>
      </div>

      {/* The grid — a real table so cells size to content. Horizontal scroll on overflow. Inline
          [data-note] spans get a dotted underline + help cursor; hover shows a floating tooltip. */}
      <div
        ref={wrapRef}
        className="overflow-x-auto rounded-md border border-border [&_[data-note]]:cursor-help [&_[data-note]]:underline [&_[data-note]]:decoration-dotted [&_[data-note]]:decoration-muted-foreground/70 [&_[data-note]]:underline-offset-2"
        onMouseOver={(e) => {
          const t = (e.target as HTMLElement).closest("[data-note]")
          if (t) setHoverNote({ text: t.getAttribute("data-note") ?? "", x: e.clientX, y: e.clientY })
        }}
        onMouseMove={(e) => {
          const t = (e.target as HTMLElement).closest("[data-note]")
          if (t) setHoverNote((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))
          else if (hoverNote) setHoverNote(null)
        }}
        onMouseLeave={() => setHoverNote(null)}
      >
        <table ref={tableRef} className="border-collapse">
          <tbody>
            {grid.rowIds.map((rowId, ri) => (
              <tr key={rowId} ref={ri === 1 ? triggerRowRef : undefined}>
                {grid.colIds.map((colId, ci) => {
                  const key = cellKey(rowId, colId)
                  const cell = grid.cells[key] ?? { html: "" }
                  const border =
                    "border border-border align-top" + (ci === 0 ? " bg-muted/20 font-semibold" : "")
                  if (cell.glyph) {
                    return (
                      <td
                        key={colId}
                        onContextMenu={(e) => openMenu(e, ri, ci)}
                        className={border + " p-2 text-center"}
                        title={cap(cell.glyph)}
                      >
                        <Zero0Glyph kind={cell.glyph} className="mx-auto h-6 w-6 text-foreground" />
                      </td>
                    )
                  }
                  const centered = ROWS.find((r) => r.id === rowId)?.center && colId !== FIELD_COL
                  const fnNum = footnoteNum[key]
                  return (
                    <td
                      key={colId}
                      onContextMenu={(e) => openMenu(e, ri, ci)}
                      className={border + " relative p-0"}
                    >
                      <div className={cell.glyphInline ? "flex items-start" : undefined}>
                        {cell.glyphInline && (
                          <span
                            title={`${cap(cell.glyphInline)} — open state`}
                            className="mt-1.5 ml-1.5 flex shrink-0"
                          >
                            <Zero0Glyph kind={cell.glyphInline} className="h-4 w-4 text-foreground" />
                          </span>
                        )}
                        <div className={cell.glyphInline ? "min-w-0 flex-1" : undefined}>
                          <EditableCell
                            cellId={key}
                            initialHtml={cell.html ?? ""}
                            active={activeCell === key}
                            centered={centered}
                            onFocus={handleFocus}
                            onCommit={handleCommit}
                          />
                        </div>
                      </div>
                      {fnNum != null && (
                        <button
                          type="button"
                          title={cell.note}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation()
                            openNoteForCell(key, (e.currentTarget as HTMLElement).getBoundingClientRect(), cell.note ?? "")
                          }}
                          className="absolute right-0.5 top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded bg-primary/15 px-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/25"
                        >
                          {fnNum}
                        </button>
                      )}
                      {/* Unresolved "@v0 …" directive marker — flags a cell awaiting a v0 reply. */}
                      {/@v0\b/i.test(stripHtml(cell.html ?? "")) && (
                        <span
                          title="Awaiting v0 — this cell contains an @v0 request"
                          className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-amber-400/25 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300"
                        >
                          @v0
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sticky floating header — appears once the Glyph + Name rows scroll above the top. Echoes
          each column's glyph + name, aligned to the live column widths and horizontal scroll. */}
      {stickyHead && (
        <div
          aria-hidden={!stickyHead.open}
          className={
            "fixed z-20 overflow-hidden rounded-b-md border-x border-b border-border bg-background/85 shadow-sm backdrop-blur transition-[opacity,transform] duration-200 ease-out supports-[backdrop-filter]:bg-background/70 motion-reduce:transition-none " +
            (stickyHead.open ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0")
          }
          style={{ left: stickyHead.left, width: stickyHead.width, top: stickyHead.top }}
        >
          <div className="flex" style={{ transform: `translateX(${-stickyHead.scrollLeft}px)`, willChange: "transform" }}>
            {grid.colIds.map((colId, ci) => {
              const glyphKind = grid.cells[cellKey(grid.rowIds[0] ?? "", colId)]?.glyph
              const nameHtml = grid.cells[cellKey(grid.rowIds[1] ?? "", colId)]?.html
              const name = nameHtml ? stripHtml(nameHtml) : ""
              return (
                <div
                  key={colId}
                  style={{ width: stickyHead.colW[ci] }}
                  className={
                    "flex shrink-0 items-center gap-2 border-r border-border/50 px-2 py-1.5 last:border-r-0" +
                    (ci === 0 ? " bg-muted/40" : "")
                  }
                >
                  {glyphKind && <Zero0Glyph kind={glyphKind} className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  {ci === 0 ? (
                    <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      Field
                    </span>
                  ) : (
                    <span className="truncate text-[11px] font-medium text-foreground">{name}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Footnotes list. */}
      {footnotes.length > 0 && (
        <ol className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
          {footnotes.map((f) => (
            <li key={f.n} className="flex gap-2">
              <span className="flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded bg-primary/15 px-1 text-[10px] font-medium text-primary">
                {f.n}
              </span>
              <span>
                {f.loc && <strong className="text-foreground">{f.loc}: </strong>}
                {f.note}
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Click a cell to edit. Use the toolbar for <strong className="text-foreground">bold</strong>,{" "}
        <em className="text-foreground">italic</em>, lists, <span className="text-foreground">color</span>, and{" "}
        <span className="text-foreground">highlight</span>. Select some text then hit{" "}
        <span className="text-foreground">Note</span> for a hover-note, or hit it with no selection for a cell
        footnote. <span className="text-foreground">Right-click a cell</span> to move, insert, or delete its row or
        column. Your edits are <span style={{ color: "#2563eb" }}>blue</span>; v0 replies in the neutral color.
        Everything saves to a shared store, so v0 sees your edits and{" "}
        <code className="rounded bg-muted px-1">@v0 …</code> requests on the next turn.
      </p>

      {/* Colour picker popover. */}
      {picker && (
        <div
          data-bible-popover
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{ left: Math.max(8, Math.min(picker.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 200)), top: picker.y }}
          className="fixed z-50 rounded-md border border-border bg-popover p-2 shadow-md"
        >
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {picker.kind === "fore" ? "Text color" : "Highlight"}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {(picker.kind === "fore" ? TEXT_COLORS : HILITE_COLORS).map((c) => (
              <button
                key={c.hex}
                type="button"
                title={c.name}
                aria-label={c.name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => execColor(picker.kind === "fore" ? "foreColor" : "hiliteColor", c.hex)}
                className="h-6 w-6 rounded border border-border transition-transform hover:scale-110"
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec("removeFormat")}
            className="mt-2 w-full rounded px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Clear formatting
          </button>
        </div>
      )}

      {/* Note editor popover. */}
      {notePopover && (
        <div
          data-bible-popover
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{ left: Math.max(8, notePopover.x), top: notePopover.y, width: 300 }}
          className="fixed z-50 rounded-md border border-border bg-popover p-3 shadow-md"
        >
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {notePopover.mode === "inline" ? "Hover note (on the selected text)" : "Cell footnote"}
          </div>
          <input
            ref={noteInputRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault()
                saveNote()
              }
            }}
            placeholder="Add context, a question, a caveat…"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/40"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={saveNote}
              className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setNotePopover(null)}
              className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Cancel
            </button>
            {notePopover.mode === "cell" && notePopover.initial && (
              <button
                type="button"
                onClick={() => {
                  setNoteText("")
                  // Clear + close.
                  setGrid((g) => {
                    const prev = g.cells[notePopover.cellId]
                    if (!prev) return g
                    const next = { ...prev }
                    delete next.note
                    return { ...g, cells: { ...g.cells, [notePopover.cellId]: next } }
                  })
                  setNotePopover(null)
                }}
                className="ml-auto rounded px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      {/* Floating hover-note tooltip for inline notes. */}
      {hoverNote && (
        <div
          style={{ left: hoverNote.x + 12, top: hoverNote.y + 12 }}
          className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs leading-relaxed text-popover-foreground shadow-md"
        >
          {hoverNote.text}
        </div>
      )}

      {/* Right-click row/column menu. */}
      {menu && (
        <div
          role="menu"
          data-bible-popover
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-50 w-44 rounded-md border border-border bg-popover p-1 shadow-md"
        >
          <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Row {menu.ri} · Col {menu.ci}
          </div>
          <div className="my-1 h-px bg-border" aria-hidden />
          <MenuItem
            icon={<ArrowUp className="h-3.5 w-3.5" />}
            disabled={menu.ri === 0}
            onSelect={() => {
              moveRow(menu.ri, -1)
              setMenu(null)
            }}
          >
            Move row up
          </MenuItem>
          <MenuItem
            icon={<ArrowDown className="h-3.5 w-3.5" />}
            disabled={menu.ri === rowCount - 1}
            onSelect={() => {
              moveRow(menu.ri, 1)
              setMenu(null)
            }}
          >
            Move row down
          </MenuItem>
          <MenuItem
            icon={<Plus className="h-3.5 w-3.5" />}
            onSelect={() => {
              addRow(menu.ri - 1)
              setMenu(null)
            }}
          >
            Insert row above
          </MenuItem>
          <MenuItem
            icon={<Plus className="h-3.5 w-3.5" />}
            onSelect={() => {
              addRow(menu.ri)
              setMenu(null)
            }}
          >
            Insert row below
          </MenuItem>
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            danger
            disabled={rowCount <= 1}
            onSelect={() => {
              removeRow(menu.ri)
              setMenu(null)
            }}
          >
            Delete row
          </MenuItem>
          <div className="my-1 h-px bg-border" aria-hidden />
          <MenuItem
            icon={<ArrowLeft className="h-3.5 w-3.5" />}
            disabled={menu.ci === 0}
            onSelect={() => {
              moveColumn(menu.ci, -1)
              setMenu(null)
            }}
          >
            Move column left
          </MenuItem>
          <MenuItem
            icon={<ArrowRight className="h-3.5 w-3.5" />}
            disabled={menu.ci === colCount - 1}
            onSelect={() => {
              moveColumn(menu.ci, 1)
              setMenu(null)
            }}
          >
            Move column right
          </MenuItem>
          <MenuItem
            icon={<Plus className="h-3.5 w-3.5" />}
            onSelect={() => {
              addColumn(menu.ci - 1)
              setMenu(null)
            }}
          >
            Insert column left
          </MenuItem>
          <MenuItem
            icon={<Plus className="h-3.5 w-3.5" />}
            onSelect={() => {
              addColumn(menu.ci)
              setMenu(null)
            }}
          >
            Insert column right
          </MenuItem>
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            danger
            disabled={colCount <= 1}
            onSelect={() => {
              removeColumn(menu.ci)
              setMenu(null)
            }}
          >
            Delete column
          </MenuItem>
        </div>
      )}
    </div>
  )
}
