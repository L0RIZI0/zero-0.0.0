import { put, list, head } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SHARED STORE for the Entities Bible (`/entities`). The table doc lives in a single Blob so it is
// the SAME document for Loris's browser AND for v0 — enabling the collaborative loop: Loris edits
// cells / drops "@v0 …" directives, v0 reads this blob next turn, appends results, and writes back.
// (localStorage stays only as an offline fallback cache on the client.)
//
//   GET  /api/entities-bible  → { doc } | { doc: null }   (latest saved doc, or null if none yet)
//   PUT  /api/entities-bible  ← { doc }  → { ok, updatedAt }
//
// The provisioned Blob store is PUBLIC. That's fine: this is non-sensitive documentation, and the
// blob URL is never handed to the client — the route reads it server-side and returns only JSON.
// Single-user dogfooding app: no auth. Turn-based editing ⇒ last-write-wins is acceptable; v0
// always GETs immediately before it PUTs so it never clobbers a fresh human edit.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const PATHNAME = "entities-bible/table.json"

export const dynamic = "force-dynamic"

// READ-AFTER-WRITE CACHE. The public Blob store is eventually consistent: for ~2–3s after a PUT,
// fetching the blob URL can still return the PREVIOUS content (or 404). That window is what made
// reloads show the stale "draft" and let a save-on-hydrate clobber a fresh doc. To close it, we keep
// the last written doc in module memory and, on GET, return whichever of {blob, memory} has the
// newer `updatedAt`. This is strongly consistent within a running server instance (the dev server /
// a warm serverless instance); across cold instances the blob is still the durable source of truth.
type Doc = { updatedAt?: number; [k: string]: unknown }
let lastWrite: Doc | null = null

async function readBlob(): Promise<Doc | null> {
  let url: string | null = null
  try {
    const meta = await head(PATHNAME)
    url = meta?.url ?? null
  } catch {
    const { blobs } = await list({ prefix: PATHNAME, limit: 1 })
    url = (blobs.find((b) => b.pathname === PATHNAME) ?? blobs[0])?.url ?? null
  }
  if (!url) return null
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" })
  if (!res.ok) return null
  const text = await res.text()
  return text ? (JSON.parse(text) as Doc) : null
}

export async function GET() {
  try {
    const blobDoc = await readBlob()
    // Pick the newer of the durable blob and the in-memory last write.
    const blobAt = blobDoc?.updatedAt ?? 0
    const memAt = lastWrite?.updatedAt ?? 0
    const doc = memAt > blobAt ? lastWrite : (blobDoc ?? lastWrite)
    return NextResponse.json({ doc: doc ?? null })
  } catch (error) {
    console.log("[v0] entities-bible GET:", error instanceof Error ? error.message : error)
    // On error, still surface the last known write rather than nothing.
    return NextResponse.json({ doc: lastWrite ?? null })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const doc = body?.doc
    if (!doc || typeof doc !== "object") {
      return NextResponse.json({ error: "Missing doc" }, { status: 400 })
    }
    const updatedAt = Date.now()
    const stamped = { ...doc, updatedAt }
    lastWrite = stamped // serve this immediately on subsequent GETs, before CDN propagation
    await put(PATHNAME, JSON.stringify(stamped), {
      access: "public",
      contentType: "application/json",
      allowOverwrite: true, // stable pathname — overwrite the single canonical doc
      addRandomSuffix: false,
      cacheControlMaxAge: 0, // don't let the CDN serve a stale doc between turns
    })
    return NextResponse.json({ ok: true, updatedAt })
  } catch (error) {
    console.log("[v0] entities-bible PUT:", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "Save failed" }, { status: 500 })
  }
}
