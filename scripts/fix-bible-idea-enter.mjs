// Fix the ONE stale cell surfaced during validation: r-enter::c-entity (the Idea column of the
// "On enter" row) still read "Presence only (ACCESS ticks)" — but v0.7 added idea to
// ONGOING_ON_ENTER, so entering an idea now auto-punches-in (spins), matching the row's own label
// and the resource cell. Rewrites just that one cell. PUT body is { doc } per the route contract.
import { head, list } from "@vercel/blob"

const BASE = process.env.BIBLE_BASE_URL || "http://localhost:3000"
const DRY = process.argv.includes("--dry")
const P = "entities-bible/table.json"
const wrap = (t) => `<span class="v0e">${t}</span>`

const KEY = "r-enter::c-entity"
const NEW = "Auto-PLAY ⇒ spins (shaping an idea = working on it); ACCESS also ticks."

async function blobUrl() {
  try { const h = await head(P); if (h?.url) return h.url } catch {}
  const { blobs } = await list({ prefix: P, limit: 1 })
  return blobs[0]?.url
}

const url = await blobUrl()
const doc = await (await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" })).json()

const before = doc.cells[KEY]?.html
doc.cells[KEY] = { ...(doc.cells[KEY] || {}), html: wrap(NEW) }
doc.updatedAt = Date.now()
console.log("BEFORE:", before)
console.log("AFTER :", doc.cells[KEY].html)

if (DRY) { console.log("[dry] not writing"); process.exit(0) }
const res = await fetch(`${BASE}/api/entities-bible`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ doc }),
})
console.log("PUT", res.status, await res.text())
