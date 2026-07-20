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

export async function GET() {
  try {
    // Resolve the canonical blob URL. `head` looks up by exact pathname and is more consistent than
    // `list` right after a write; fall back to `list` if head misses.
    let url: string | null = null
    try {
      const meta = await head(PATHNAME)
      url = meta?.url ?? null
    } catch {
      const { blobs } = await list({ prefix: PATHNAME, limit: 1 })
      url = (blobs.find((b) => b.pathname === PATHNAME) ?? blobs[0])?.url ?? null
    }
    if (!url) return NextResponse.json({ doc: null })
    // Fetch content server-side, busting any CDN cache so a fresh save is seen immediately.
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" })
    if (!res.ok) return NextResponse.json({ doc: null })
    const text = await res.text()
    const doc = text ? JSON.parse(text) : null
    return NextResponse.json({ doc })
  } catch (error) {
    console.log("[v0] entities-bible GET:", error instanceof Error ? error.message : error)
    return NextResponse.json({ doc: null })
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
    const payload = JSON.stringify({ ...doc, updatedAt })
    await put(PATHNAME, payload, {
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
