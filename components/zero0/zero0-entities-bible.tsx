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
} from "lucide-react"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import type { EntityKind } from "@/lib/zero/types"

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE ENTITIES BIBLE — a generic, interactive spreadsheet for documenting every entity kind
// against every axis (kind · state · click · remote play · ongoing conditions · …). It is a plain
// grid: no fixed header row/col — the field labels (Glyph, Name, ID, …) just live in the first
// column, and the kind names live in the "Name" row, exactly like Loris's OneNote draft.
//
//   • Cells are RICH TEXT (contentEditable) — bold / italic / bullet list / clear, via the toolbar.
//   • Rows and columns can be ADDED, REMOVED, and MOVED (up/down, left/right).
//   • The "Glyph" row seeds the REAL ontology glyph for each kind (via <Zero0Glyph>), display-only.
//   • State persists to localStorage (`zero:entities-bible:v1`) — this is a local-first doc we build
//     up over time, so edits must survive reloads (matches the app's `zero:*` storage convention).
//
// contentEditable is intentionally UNCONTROLLED: each cell's innerHTML is seeded ONCE on mount (via
// ref) and read back on blur. React never rewrites it during typing (which would jump the caret),
// and because cells are keyed by a stable id, reordering rows/cols preserves their DOM + edits.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "zero:entities-bible:v1"

type Cell = {
  /** Rich-text HTML for a normal cell. */
  html?: string
  /** If set, the cell renders this kind's ontology glyph (display-only) instead of text. */
  glyph?: EntityKind
}

type Grid = {
  rowIds: string[]
  colIds: string[]
  /** Keyed by `${rowId}::${colId}`. */
  cells: Record<string, Cell>
}

const cellKey = (rowId: string, colId: string) => `${rowId}::${colId}`

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

// Build the seed grid from the draft: a field-label column + one column per kind, and the rows
// Glyph / Name / ID / Usecase / State:open / State:ongoing, plus a couple of empty rows to grow into.
function seedGrid(): Grid {
  const colIds = ["c-field", ...KIND_COLS.map((_, i) => `c-${i}`)]
  const rowDefs: { id: string; label: string; fill?: (kind: EntityKind, i: number) => Cell }[] = [
    { id: "r-glyph", label: "Glyph", fill: (kind) => ({ glyph: kind }) },
    { id: "r-name", label: "Name", fill: (kind) => ({ html: cap(kind) }) },
    { id: "r-id", label: "ID", fill: (_k, i) => ({ html: String(i + 1) }) },
    { id: "r-usecase", label: "Usecase" },
    { id: "r-state-open", label: "State:open" },
    { id: "r-state-ongoing", label: "State:ongoing" },
    { id: "r-empty-1", label: "" },
  ]
  const cells: Record<string, Cell> = {}
  for (const row of rowDefs) {
    cells[cellKey(row.id, "c-field")] = { html: row.label }
    KIND_COLS.forEach((kind, i) => {
      cells[cellKey(row.id, `c-${i}`)] = row.fill ? row.fill(kind, i) : { html: "" }
    })
  }
  return { rowIds: rowDefs.map((r) => r.id), colIds, cells }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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
  onFocus,
  onCommit,
}: {
  cellId: string
  initialHtml: string
  active: boolean
  onFocus: (cellId: string, el: HTMLDivElement) => void
  onCommit: (cellId: string, html: string) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  // Seed innerHTML exactly once — never on subsequent renders (that would move the caret).
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        "min-h-[2.5rem] w-full px-3 py-2 text-sm leading-relaxed text-foreground outline-none [&_ul]:list-disc [&_ul]:pl-5 " +
        (active ? "bg-primary/5 ring-1 ring-inset ring-primary/40" : "")
      }
    />
  )
}

// A tiny square control button used by the row/column gutters + toolbar.
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

export function Zero0EntitiesBible() {
  const [grid, setGrid] = useState<Grid>(seedGrid)
  const [hydrated, setHydrated] = useState(false)
  const [activeCell, setActiveCell] = useState<string | null>(null)
  const activeElRef = useRef<HTMLDivElement | null>(null)

  // Hydrate from localStorage after mount (SSR-safe: server + first client render both show the
  // seed skeleton, then this swaps in stored content — no hydration mismatch, and cells mount with
  // the correct initial html because the whole table is gated on `hydrated`).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Grid
        if (parsed?.rowIds?.length && parsed?.colIds?.length && parsed.cells) setGrid(parsed)
      }
    } catch {
      /* ignore malformed storage */
    }
    setHydrated(true)
  }, [])

  // Persist on every change once hydrated.
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(grid))
    } catch {
      /* quota / private mode — non-fatal */
    }
  }, [grid, hydrated])

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

  // Apply a rich-text command to the focused editable. execCommand is deprecated but remains the
  // simplest cross-browser way to toggle inline formatting inside a contentEditable region.
  const exec = useCallback((command: string) => {
    activeElRef.current?.focus()
    document.execCommand(command, false)
    // Persist the change immediately (blur may not fire before the next action).
    const el = activeElRef.current
    if (el && activeCell) handleCommit(activeCell, el.innerHTML)
  }, [activeCell, handleCommit])

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

  // ── Row ops ───────────────────────────────────────────────────────────────────────────────
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
    setGrid(seedGrid())
    setActiveCell(null)
  }, [])

  // Column-width template: an auto row-gutter, then equal min-width columns.
  const gridTemplate = `2rem repeat(${grid.colIds.length}, minmax(9rem, 1fr))`

  // Skeleton (pre-hydration) — same on server + first client paint to avoid mismatch.
  if (!hydrated) {
    return (
      <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
        Loading the entities bible…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Formatting toolbar — acts on the focused cell. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 rounded-md border border-border bg-background/95 p-1.5 backdrop-blur">
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
        <IconBtn title="Add row" onClick={() => addRow()}>
          <span className="flex items-center text-[10px] font-medium">
            <Plus className="h-3.5 w-3.5" />R
          </span>
        </IconBtn>
        <IconBtn title="Add column" onClick={() => addColumn()}>
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

      {/* The grid. Horizontal scroll on overflow so many columns stay usable. */}
      <div className="overflow-x-auto rounded-md border border-border">
        <div style={{ minWidth: "max-content" }}>
          {/* Column control gutter. */}
          <div className="grid border-b border-border bg-muted/30" style={{ gridTemplateColumns: gridTemplate }}>
            <div className="border-r border-border" aria-hidden />
            {grid.colIds.map((colId, ci) => (
              <div
                key={colId}
                className="flex items-center justify-center gap-0.5 border-r border-border py-1 last:border-r-0"
              >
                <IconBtn title="Move column left" onClick={() => moveColumn(ci, -1)} disabled={ci === 0}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn title="Insert column right" onClick={() => addColumn(ci)}>
                  <Plus className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn
                  title="Delete column"
                  onClick={() => removeColumn(ci)}
                  disabled={grid.colIds.length <= 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn
                  title="Move column right"
                  onClick={() => moveColumn(ci, 1)}
                  disabled={ci === grid.colIds.length - 1}
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </IconBtn>
              </div>
            ))}
          </div>

          {/* Data rows, each with a left row-control gutter. */}
          {grid.rowIds.map((rowId, ri) => (
            <div
              key={rowId}
              className="group grid border-b border-border last:border-b-0"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {/* Row controls — revealed on row hover. */}
              <div className="flex flex-col items-center justify-center gap-0.5 border-r border-border bg-muted/20 py-1 opacity-30 transition-opacity group-hover:opacity-100">
                <IconBtn title="Move row up" onClick={() => moveRow(ri, -1)} disabled={ri === 0}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn title="Insert row below" onClick={() => addRow(ri)}>
                  <Plus className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn title="Delete row" onClick={() => removeRow(ri)} disabled={grid.rowIds.length <= 1}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn title="Move row down" onClick={() => moveRow(ri, 1)} disabled={ri === grid.rowIds.length - 1}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </IconBtn>
              </div>

              {grid.colIds.map((colId) => {
                const key = cellKey(rowId, colId)
                const cell = grid.cells[key] ?? { html: "" }
                if (cell.glyph) {
                  return (
                    <div
                      key={colId}
                      className="flex items-center justify-center border-r border-border last:border-r-0"
                      title={cap(cell.glyph)}
                    >
                      <Zero0Glyph kind={cell.glyph} className="h-6 w-6 text-foreground" />
                    </div>
                  )
                }
                return (
                  <div key={colId} className="border-r border-border last:border-r-0">
                    <EditableCell
                      cellId={key}
                      initialHtml={cell.html ?? ""}
                      active={activeCell === key}
                      onFocus={handleFocus}
                      onCommit={handleCommit}
                    />
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Click a cell to edit. Use the toolbar for <strong className="text-foreground">bold</strong>,{" "}
        <em className="text-foreground">italic</em>, and bulleted lists. Hover a row or column edge to
        move, insert, or delete it. Everything you type is saved locally in this browser.
      </p>
    </div>
  )
}
