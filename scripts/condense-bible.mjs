// Condense each merged bottom-half bible cell into a straight-to-the-point WHAT-IS.
// Faithful summary of the concatenated prose; where merged fragments CONTRADICT, we surface
// "⚠ conflict:" rather than silently resolving (those are Loris' to adjudicate). Cleans paste-cruft
// HTML to a plain <span class="v0e"> wrapper and PRESERVES each cell's existing `reconcile` marker.
import { head, list } from "@vercel/blob"

const KIND_COL = {
  idea: "c-entity", instant: "c-4", moment: "c-3", resource: "c-2", task: "c-1",
  space: "c-0", organism: "c-6", community: "c-7", individual: "c-5", soul: "c-soul",
}

// rowId -> { kind: concise what-is }
const PATCH = {
  "r-open": {
    idea: "First state on creation — the raw idea any entity starts as before it is shaped.",
    instant: "Default on creation (a future schedule ⇒ scheduled instead).",
    moment: "Default on creation (a future schedule ⇒ scheduled instead).",
    resource: "Default on creation; also when empty/missing/unavailable.",
    task: "First state on creation (a future schedule ⇒ scheduled instead).",
    space: "First state on creation (a future schedule ⇒ scheduled instead).",
    organism: "Draft default on creation (future founding start ⇒ expected).",
    community: "Draft default on creation (future founding start ⇒ expected).",
    individual: "Default on creation (future start ⇒ expected).",
    soul: "No — seeded & permanent, never created.",
  },
  "r-scheduled": {
    idea: "⚠ conflict: 'not plannable' vs 'can be planned ⇒ Scheduled (shaping into task/moment refines fields)'.",
    instant: "Yes — field at (start = end = at, duration 0); recurrence.",
    moment: "Yes — fields start / end / duration / recurrence.",
    resource: "Yes — fields start / end / duration / recurrence.",
    task: "Yes — fields start / end / duration / recurrence.",
    space: "Yes — fields start / end / duration / recurrence.",
    organism: "Yes — reads 'Expected'; fields start/end/duration (no recurrence on the being — use a recurring Moment child).",
    community: "Yes — reads 'Expected'; fields start/end/duration/recurrence.",
    individual: "Yes — reads 'Expected'; field start only.",
    soul: "No — a Soul is timeless.",
  },
  "r-complete": {
    idea: "Yes — when manually marked complete.",
    instant: "Auto once at/start/end passes, or earlier manually (glyph spins once + fills). Default max 1 occurrence. Auto-closes next midnight unless --close:manual.",
    moment: "Auto once end passes, or earlier manually (glyph fills, awaits close). Auto-closes next midnight unless --close:manual.",
    resource: "Reads 'Ready'. Auto when a set end passes, or manually (glyph spins + fills). Web pages always ready unless 404.",
    task: "When Done + all task-children complete (glyph fills, awaits close). Auto-closes next midnight unless --close:manual or owner ≠ executioner.",
    space: "Auto once set end passes (glyph fills, row stays live awaiting midnight close).",
    organism: "No — beings don't complete.",
    community: "No — beings don't complete.",
    individual: "No — beings don't complete.",
    soul: "No.",
  },
  "r-done": {
    idea: "No.",
    instant: "No.",
    moment: "No.",
    resource: "No.",
    task: "Yes — a soft checkmark unique to Tasks. Completes the task unless a task-child is still open (reads 'done but open'). Auto-completes next midnight unless closed earlier or owner ≠ executioner.",
    space: "No.",
    organism: "No.",
    community: "No.",
    individual: "No.",
    soul: "No.",
  },
  "r-closed": {
    idea: "Closed — fades.",
    instant: "Auto-closes next midnight after complete (fills + fades), or manually; unless --close:manual. State = Closed.",
    moment: "Auto-closes next midnight after complete (fills + fades), or manually; unless --close:manual.",
    resource: "Closed by hand (fills + fades).",
    task: "Filed at midnight after Done (fills + fades), or manually; unless --close:manual.",
    space: "Filed at the stamped midnight, manual only (fills + fades).",
    organism: "⚠ conflict: 'Dead (diedOn)' vs 'Retired'. Manual only, glyph fades, keeps outline. (r-deleted says closing a live one ⇒ retired.)",
    community: "Reads 'Retired' — fades, keeps outline (retiredOn). Manual only.",
    individual: "Reads 'Dead' — glyph fades + mirrored vertically (if was alive; else strikethrough like cancelled). Closable anytime: while alive ⇒ dead (a kill; age = born→death, status row hidden); while not alive ⇒ closed.",
    soul: "No — a Soul cannot be closed (permanent).",
  },
  "r-cancelled": {
    idea: "Yes — manually. Bar + strike + fade.",
    instant: "Yes — manually. Bar + strike + fade.",
    moment: "Yes — manually. Bar + strike + fade.",
    resource: "Yes — manually. Bar + strike + fade.",
    task: "Yes — manually. Bar over glyph + strike + fade.",
    space: "Yes — manually. Bar over glyph + strike + fade.",
    organism: "Yes — manually, while open or scheduled. Bar + strike + fade.",
    community: "Yes — manually, while open or scheduled. Bar + strike + fade.",
    individual: "⚠ conflict: 'an Individual can't be cancelled' vs 'Yes — cancellable while open/scheduled'.",
    soul: "No — a Soul cannot be cancelled.",
  },
  "r-deleted": {
    idea: "Yes.",
    instant: "Yes — prompts what to do with any children, then confirms. State = Deleted.",
    moment: "Yes — prompts about children, then confirms.",
    resource: "Yes — prompts about children, then confirms.",
    task: "Yes — prompts about children, then confirms.",
    space: "Yes — prompts about children, then confirms.",
    organism: "Deletable only while NOT alive (draft: open/scheduled/cancelled). A published/live Organism can't be deleted — only Unpublished back to draft. (Publish = birth via publishedAt; SHIPPED.)",
    community: "Deletable only while NOT alive (draft: open/scheduled/cancelled). A published/live Community can't be deleted — only Unpublished back to draft. (Publish = birth via publishedAt; SHIPPED.)",
    individual: "Deletable only while not alive.",
    soul: "No — a Soul cannot be deleted.",
  },
  "r-status": {
    idea: "⚠ conflict: 'Yes, on enter' vs 'none'. (Idea is view-only elsewhere ⇒ likely never ongoing.)",
    instant: "Never — a point in time. Glyph spins once at at/start/end; no ongoing.",
    moment: "Ongoing when ① an open PLAY session, or ② a concrete start has passed & not yet ended. Glyph spins.",
    resource: "Ongoing when an open PLAY session (auto-opened on enter). Glyph spins.",
    task: "Ongoing when an open PLAY session (auto-opened on enter while undone). Focus/viewing never flips state. Glyph spins.",
    space: "Ongoing when ① an open PLAY session, ② a concrete start is in progress, or ③ a contained child is ongoing (rollup). Glyph spins.",
    organism: "Never ongoing — a being reads ALIVE (rollup stops at beings).",
    community: "Never ongoing — a being reads ALIVE (rollup stops at beings).",
    individual: "Never ongoing — a being reads ALIVE (rollup stops at beings).",
    soul: "None.",
  },
  "r-enter": {
    idea: "Presence only (ACCESS ticks).",
    instant: "Presence only; never ongoing.",
    moment: "Presence only (ACCESS ticks); does NOT auto-play.",
    resource: "Auto-PLAY ⇒ spins.",
    task: "Auto-PLAY while undone ⇒ spins; a Done task is presence-only (no spin).",
    space: "Auto-opens a PLAY session ⇒ spins + DURATION counts; ACCESS also ticks.",
    organism: "Presence only; never spins.",
    community: "Presence only; never spins.",
    individual: "Presence only (ACCESS ticks); never spins.",
  },
  "r-glyphclick": {
    idea: "View only.",
    instant: "Mark — adds one occurrence; glyph flashes its fill once.",
    moment: "Idle ⇒ Play (manual stopwatch, activity rail); spinning ⇒ Stop.",
    resource: "Idle ⇒ Play; spinning ⇒ Stop.",
    task: "Spinning ⇒ Stop; resting + undone ⇒ Done; done ⇒ un-done (resumes if still open).",
    space: "Idle ⇒ Play; spinning ⇒ Stop.",
    organism: "View only.",
    community: "View only.",
    individual: "View only.",
    soul: "View only.",
  },
  "r-play": {
    instant: "— use Mark instead.",
    moment: "Play ⇒ open a play session; Stop ⇒ close it.",
    resource: "Play / Stop; auto-plays on enter.",
    task: "Via glyph; auto-plays on enter.",
    space: "Play ⇒ open a play session; Stop ⇒ close it (records on the activity rail).",
  },
  "r-mark": {
    instant: "Append a zero-length occurrence toward the tally. --maxnb:3 soft cap / --maxnbhard:3 hard cap; default max 1.",
  },
  "r-schedule": {
    idea: "— none (unshaped).",
    instant: "at (start = end = at, a point).",
    moment: "start · end · duration.",
    resource: "start · end · duration (when set).",
    task: "start · end · due · duration.",
    space: "start · end · duration.",
    organism: "— AGE from createdAt.",
    community: "— AGE from createdAt.",
    individual: "— AGE from createdAt.",
    soul: "— none.",
  },
  "r-transform": {
    idea: "The base any kind can be de-specialized back to.",
    soul: "— cannot transform.",
  },
  "r-children": {
    idea: "Yes — nests like any entity.",
    soul: "— animates one Individual; not a container.",
  },
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const wrap = (s) => `<span class="v0e">${esc(s)}</span>`

const P = "entities-bible/table.json"
let url
try { url = (await head(P))?.url } catch {}
if (!url) { const { blobs } = await list({ prefix: P, limit: 1 }); url = blobs[0]?.url }
const doc = await (await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" })).json()

let changed = 0
for (const [rowId, byKind] of Object.entries(PATCH)) {
  for (const [kind, text] of Object.entries(byKind)) {
    const key = `${rowId}::${KIND_COL[kind]}`
    const prev = doc.cells[key] || {}
    doc.cells[key] = { ...prev, html: wrap(text) } // preserves reconcile & any other props
    changed++
  }
}
doc.updatedAt = Date.now()

if (process.argv.includes("--dry")) {
  console.log(`DRY: would rewrite ${changed} cells across ${Object.keys(PATCH).length} rows`)
  process.exit(0)
}

const base = process.env.BIBLE_BASE_URL || "http://localhost:3000"
const res = await fetch(`${base}/api/entities-bible`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ doc }),
})
console.log("PUT", res.status, await res.text())
console.log(`rewrote ${changed} cells`)
