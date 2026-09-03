// One-shot restructure of the /entities bible bottom half.
// - Merges duplicated state rows (capability-row + state-row + hand-added dups) into ONE canonical
//   row per STATE, plus one STATUS row (ongoing/idle).
// - Preserves ALL authored prose: when rows merge, cells are CONCATENATED (this row's text first,
//   then merged-in rows' text), so nothing is lost. Reconcile markers are preserved (strongest wins).
// - Keeps BEHAVIOR rows distinct. Keeps the header/identity block (rows 0-5) untouched.
// - Writes target-state [TODO] notes onto the glyph/play/enter/ongoing rows for the whenever-removal.
// Reads the current doc from Blob, transforms in-memory, PUTs it back (API auto-snapshots the prior).

import { list } from "@vercel/blob"

const KEY = "entities-bible/table.json"
const SEP = ' <span style="opacity:.4">·</span> ' // visible separator between merged fragments

// --- fetch current ---
const { blobs } = await list({ prefix: KEY, limit: 1 })
if (!blobs.length) throw new Error("no bible blob")
const doc = await (await fetch(`${blobs[0].url}?t=${Date.now()}`, { cache: "no-store" })).json()

const cell = (r, c) => doc.cells[`${r}::${c}`]
const cols = doc.colIds // includes c-field
const contentCols = cols.filter((c) => c !== "c-field")

// strongest reconcile wins when merging (gap > match > none — a gap anywhere is worth surfacing)
const rank = { gap: 2, match: 1 }
function mergeReconcile(a, b) {
  const ra = rank[a] ?? 0
  const rb = rank[b] ?? 0
  const best = Math.max(ra, rb)
  return best === 2 ? "gap" : best === 1 ? "match" : undefined
}

// Merge a list of source rows into a single target row object { field, cells:{col:{html,reconcile}} }.
// `field` is the new canonical label. Prose concatenated in the order given (first = newest intent).
function mergeRows(field, note, srcRowIds) {
  const out = { field, cells: {} }
  for (const col of contentCols) {
    const frags = []
    let recon
    for (const rid of srcRowIds) {
      const cl = cell(rid, col)
      const html = (cl?.html ?? "").trim()
      if (html && html !== "—" && !frags.includes(html)) frags.push(html)
      recon = mergeReconcile(recon, cl?.reconcile)
    }
    let html = frags.join(SEP)
    if (html) out.cells[col] = recon ? { html, reconcile: recon } : { html }
  }
  if (note) out.note = note
  return out
}

// TODO note appended to the field cell of rows whose TARGET differs from today (whenever-removal).
const TODO = (txt) =>
  ` <span style="opacity:.5">[TODO: ${txt}]</span>`

// --- target row plan (order matters) ---
// state rows first (lifecycle), then the status axis, then behavior rows.
const plan = [
  // STATE rows: canonical label ← [source row ids], newest-intent first
  { id: "r-open", field: "State · open", src: ["r-open", "r-creatable"] },
  { id: "r-scheduled", field: "State · scheduled", src: ["r-scheduled", "r-planned"] },
  { id: "r-complete", field: "State · complete", src: ["r-complete", "r-mrtotrwz-1"] },
  { id: "r-done", field: "State · done", src: ["r-donestate", "r-done"] },
  {
    id: "r-closed",
    field: "State · closed / dead / retired",
    src: ["r-closed", "r-mrugx1sq-0", "r-mrv41tu4-2", "r-terminal"],
  },
  { id: "r-cancelled", field: "State · cancelled", src: ["r-cancelled", "r-mrv5t3i9-1"] },
  { id: "r-deleted", field: "State · deleted", src: ["r-mruyayc3-0"] },
  // STATUS axis (orthogonal to state) — ongoing/idle
  {
    id: "r-status",
    field: "Status · ongoing / idle",
    src: ["r-ongoing", "r-mrv2cw0l-0", "r-mrucnvi5-1", "r-sources"],
    note: TODO(
      "STATUS is a DERIVED projection (from the log), shown for EVERY kind, row auto-hidden on a §0 when it carries no signal. Not a stored field.",
    ),
  },
  // BEHAVIOR rows (kept distinct, orthogonal to state)
  {
    id: "r-enter",
    field: "On enter (drill-in)",
    src: ["r-enter"],
    note: TODO("playable kinds {idea,task,resource,moment,space} auto-punch-in on dwell; no WHENEVER."),
  },
  {
    id: "r-glyphclick",
    field: "Glyph click",
    src: ["r-glyphclick"],
    note: TODO("idle ⇒ Play, ongoing ⇒ Stop, ended ⇒ Reopen — for {idea,task,resource,moment,space}, incl. future-scheduled."),
  },
  {
    id: "r-play",
    field: "Play / Stop",
    src: ["r-play"],
    note: TODO("playability = kind∈{idea,task,resource,moment,space} AND status idle; WHENEVER sentinel removed."),
  },
  { id: "r-mark", field: "Mark", src: ["r-mark"] },
  {
    id: "r-schedule",
    field: "Schedule fields",
    src: ["r-schedule"],
    note: TODO("startAt no longer carries the 'whenever' sentinel; playability derives from kind+status, not schedule."),
  },
  { id: "r-remoteplay", field: "Remote Play", src: ["r-mrv48ox3-5"] },
  { id: "r-transform", field: "Transform into", src: ["r-mrugksk3-1"] },
  { id: "r-children", field: "Children of", src: ["r-mrv4ad42-6"] },
]

// --- header/identity rows to keep verbatim, in order ---
const HEADER_ROWS = ["r-id", "r-glyph", "r-name", "r-family", "r-desc", "r-usecase"]

// --- build the new doc ---
const newCells = {}
// keep header block as-is
for (const rid of HEADER_ROWS) {
  for (const col of cols) {
    const cl = doc.cells[`${rid}::${col}`]
    if (cl) newCells[`${rid}::${col}`] = cl
  }
}
// write merged rows
const wrapField = (txt) => `<span class="v0e">${txt}</span>`
for (const row of plan) {
  const merged = mergeRows(row.field, row.note, row.src)
  // field label cell (+ optional TODO note)
  newCells[`${row.id}::c-field`] = { html: wrapField(row.field + (row.note ?? "")) }
  for (const [col, val] of Object.entries(merged.cells)) {
    newCells[`${row.id}::${col}`] = val
  }
}

const newDoc = {
  colIds: doc.colIds,
  rowIds: [...HEADER_ROWS, ...plan.map((r) => r.id)],
  cells: newCells,
  updatedAt: Date.now(),
}

// sanity: report
console.log("OLD rows:", doc.rowIds.length, "cells:", Object.keys(doc.cells).length)
console.log("NEW rows:", newDoc.rowIds.length, "cells:", Object.keys(newDoc.cells).length)
console.log("NEW rowIds:", newDoc.rowIds.join(", "))

// --- PUT back (unless --dry) ---
if (process.argv.includes("--dry")) {
  const fs = await import("node:fs")
  fs.writeFileSync("/tmp/bible-new.json", JSON.stringify(newDoc, null, 2))
  console.log("DRY RUN — wrote /tmp/bible-new.json, did NOT upload")
} else {
  const base = process.env.BIBLE_BASE_URL || "http://localhost:3000"
  const res = await fetch(`${base}/api/entities-bible`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    // The route expects the doc WRAPPED as { doc }, not the bare doc.
    body: JSON.stringify({ doc: newDoc }),
  })
  console.log("PUT", res.status, await res.text())
}
