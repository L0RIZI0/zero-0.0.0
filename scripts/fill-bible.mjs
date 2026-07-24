// Fill the MISSING cells in the /entities bible's "Transform into" + "Children of" rows with
// concise what-is prose derived from code (menu-model.ts CHANGE_KINDS + data.ts getChildren).
// Only writes cells that are currently absent; never overwrites authored/existing cells. Leaves
// the `link` (c-facet) column empty to match how Remote Play treats it (a relationship facet,
// not a base kind). PUT body is { doc } per the route contract.
import { head, list } from "@vercel/blob"

const BASE = process.env.BIBLE_BASE_URL || "http://localhost:3000"
const DRY = process.argv.includes("--dry")
const P = "entities-bible/table.json"

const wrap = (t) => `<span class="v0e">${t}</span>`

// col -> what-is text. Standard transformable line (the 7 action kinds).
const XFORM = "Yes — Change into any other creatable kind, or de-specialize back to idea. Never into individual/soul."
const NEST = "Yes — nests under any entity via parentId (and cross-links via taggedContextIds)."

const FILL = {
  "r-transform": {
    "c-1": XFORM, // task
    "c-2": XFORM, // resource
    "c-3": XFORM, // moment
    "c-4": XFORM, // instant
    "c-0": XFORM, // space
    "c-6": XFORM, // organism
    "c-7": XFORM, // community
    // individual: code pushes the submenu with NO source-guard, so it IS offered all 8 targets —
    // but individual/soul are never valid targets and transforming the identity self would break
    // root-scoping. Flagged as a should-not.
    "c-5": "⚠ Menu currently offered (no source-guard), but transforming the identity self would break root-scoping — treat as should-not.",
  },
  "r-children": {
    "c-1": NEST, // task
    "c-3": NEST, // moment
    "c-4": NEST, // instant (structural: allowed; semantically a point, rarely a container)
    "c-0": NEST, // space (the canonical container)
    "c-6": NEST, // organism
    "c-7": NEST, // community
    // resource: a cross-cutting catalog item — ASSIGNED to contexts (assignedResourceIds), not
    // nested as a structural child.
    "c-2": "Assigned to contexts (assignedResourceIds), not nested as a structural child.",
    // individual: the root Individual is the top container — everything nests under it.
    "c-5": "Yes — the root Individual is the top container; the whole tree nests under it.",
  },
}

async function blobUrl() {
  try { const h = await head(P); if (h?.url) return h.url } catch {}
  const { blobs } = await list({ prefix: P, limit: 1 })
  return blobs[0]?.url
}

const url = await blobUrl()
const doc = await (await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" })).json()

let filled = 0, skipped = 0
for (const [rid, cols] of Object.entries(FILL)) {
  for (const [cid, text] of Object.entries(cols)) {
    const key = `${rid}::${cid}`
    const existing = doc.cells[key]
    const bare = (existing?.html || "").replace(/<[^>]*>/g, "").trim()
    if (bare && bare !== "—") { skipped++; continue } // never overwrite authored prose
    doc.cells[key] = { ...(existing || {}), html: wrap(text) }
    filled++
  }
}
doc.updatedAt = Date.now()
console.log(`filled ${filled} missing cells, skipped ${skipped} existing`)

if (DRY) { console.log("[dry] not writing"); process.exit(0) }
const res = await fetch(`${BASE}/api/entities-bible`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ doc }),
})
console.log("PUT", res.status, await res.text())
