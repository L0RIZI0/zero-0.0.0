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
//   • Cells size to their CONTENT (a real <table>, auto layout) — no forced min column widths and
//     no always-on control gutters bloating them.
//   • Row/column ops (move · insert · delete) live in a RIGHT-CLICK menu on any cell, which also
//     shows that cell's row/col NUMBER.
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

// Build the seed grid from the draft: a field-label column + one column per kind, and the rows
// Glyph / Name / ID / Usecase / State:open / State:ongoing, plus a couple of empty rows to grow into.
function seedGrid(): Grid {
  const colIds = [FIELD_COL, ...KIND_COLS.map((_, i) => `c-${i}`)]
  const rowDefs: { id: string; label: string; fill?: (kind: EntityKind, i: number) => Cell }[] = [
    { id: "r-glyph", label: "Glyph", fill: (kind) => ({ glyph: kind }) },
    { id: NAME_ROW, label: "Name", fill: (kind) => ({ html: cap(kind) }) },
    { id: "r-id", label: "ID", fill: (_k, i) => ({ html: String(i + 1) }) },
    { id: "r-usecase", label: "Usecase" },
    { id: "r-state-open", label: "State:open" },
    { id: "r-state-ongoing", label: "State:ongoing" },
    { id: "r-empty-1", label: "" },
  ]
  const cells: Record<string, Cell> = {}
  for (const row of rowDefs) {
    cells[cellKey(row.id, FIELD_COL)] = { html: row.label }
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
        "h-full min-w-[3rem] px-3 py-1.5 text-sm leading-relaxed text-foreground outline-none [&_ul]:my-0 [&_ul]:list-disc [&_ul]:pl-5 " +
        (centered ? "text-center " : "") +
        (active ? "bg-primary/5 ring-1 ring-inset ring-primary/40" : "")
      }
    />
  )
}

// A tiny square control button used by the toolbar.
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
        (danger
          ? "text-destructive hover:bg-destructive/10"
          : "text-foreground hover:bg-muted")
      }
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center text-muted-foreground">{icon}</span>
      {children}
    </button>
  )
}

type Menu = { x: number; y: number; ri: number; ci: number }

export function Zero0EntitiesBible() {
  const [grid, setGrid] = useState<Grid>(seedGrid)
  const [hydrated, setHydrated] = useState(false)
  const [activeCell, setActiveCell] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
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

  // Dismiss the context menu on any outside click, scroll, or Escape.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null)
    window.addEventListener("click", close)
    window.addEventListener("scroll", close, true)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("click", close)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("keydown", onKey)
    }
  }, [menu])

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

      {/* The grid — a real table so cells size to content. Horizontal scroll on overflow. */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="border-collapse">
          <tbody>
            {grid.rowIds.map((rowId, ri) => (
              <tr key={rowId}>
                {grid.colIds.map((colId, ci) => {
                  const key = cellKey(rowId, colId)
                  const cell = grid.cells[key] ?? { html: "" }
                  const border =
                    "border border-border align-top" + (ci === 0 ? " bg-muted/20" : "")
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
                  const centered = rowId === NAME_ROW && colId !== FIELD_COL
                  return (
                    <td key={colId} onContextMenu={(e) => openMenu(e, ri, ci)} className={border + " p-0"}>
                      <EditableCell
                        cellId={key}
                        initialHtml={cell.html ?? ""}
                        active={activeCell === key}
                        centered={centered}
                        onFocus={handleFocus}
                        onCommit={handleCommit}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Click a cell to edit. Use the toolbar for <strong className="text-foreground">bold</strong>,{" "}
        <em className="text-foreground">italic</em>, and bulleted lists.{" "}
        <span className="text-foreground">Right-click a cell</span> to move, insert, or delete its row
        or column. Everything you type is saved locally in this browser.
      </p>

      {/* Right-click row/column menu. */}
      {menu && (
        <div
          role="menu"
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
