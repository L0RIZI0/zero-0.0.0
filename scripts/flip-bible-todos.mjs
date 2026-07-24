// Flip the 5 playability-model [TODO: …] markers in the /entities bible FIELD labels to built
// reality now that v0.7 shipped (WHENEVER sentinel removed; playability = kind∈{idea,task,
// resource,moment,space} AND idle; idea auto-plays on enter + is plannable; instant marks pulse
// their task ancestors' glyphs once). Rewrites ONLY the `::c-field` label cells of these rows —
// per-kind cells are left untouched. PUT body is { doc } per the route contract.
import { head, list } from "@vercel/blob"

const BASE = process.env.BIBLE_BASE_URL || "http://localhost:3000"
const DRY = process.argv.includes("--dry")
const P = "entities-bible/table.json"
const wrap = (t) => `<span class="v0e">${t}</span>`

// rowId -> the NEW field-label html (TODO note removed, replaced by built [CUR] prose).
const LABELS = {
  "r-status":
    "Status · ongoing / idle — a DERIVED projection off the log (open play session, or a concrete-started moment/space, or a contained descendant that is ongoing). Shown for every kind; the §0 row auto-hides when there's no signal. Not stored.",
  "r-enter":
    "On enter (drill-in) — the playable kinds {idea, task, resource, space} auto-punch-in (spin) on dwell (ONGOING_ON_ENTER); presence/focus is recorded separately for every kind. No WHENEVER.",
  "r-glyphclick":
    "Glyph click — idle ⇒ Play, ongoing ⇒ Stop, ended ⇒ Reopen (menu), for {idea, task, resource, moment, space} incl. a future-scheduled start. TASK routes through its Done glyph (which stops a running span); instant MARKS instead.",
  "r-play":
    "Play / Stop — playability = kind ∈ {idea, task, resource, moment, space} AND status idle (isPlayable = PLAYABLE_KINDS ∧ not-ended). Opens/closes a via:\"play\" session on the bottom rail; never writes the scalar start/end. The WHENEVER sentinel is gone.",
  "r-schedule":
    "Schedule fields — startAt is a concrete epoch or absent (no 'whenever' sentinel). Playability derives from kind + idle status, NOT from schedule; an unplanned playable is still playable.",
}

async function blobUrl() {
  try { const h = await head(P); if (h?.url) return h.url } catch {}
  const { blobs } = await list({ prefix: P, limit: 1 })
  return blobs[0]?.url
}

const url = await blobUrl()
const doc = await (await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" })).json()

let flipped = 0
for (const [rid, text] of Object.entries(LABELS)) {
  const key = `${rid}::c-field`
  const existing = doc.cells[key]
  doc.cells[key] = { ...(existing || {}), html: wrap(text) }
  flipped++
}
doc.updatedAt = Date.now()
console.log(`flipped ${flipped} field labels`)

if (DRY) { console.log("[dry] not writing"); process.exit(0) }
const res = await fetch(`${BASE}/api/entities-bible`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ doc }),
})
console.log("PUT", res.status, await res.text())
