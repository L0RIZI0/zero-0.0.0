import { put, get } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SHARED STORE for the Entities Bible (`/entities`). The table doc lives in a single private Blob
// so it is the SAME document for Loris's browser AND for v0 — enabling the collaborative loop:
// Loris edits cells / drops "@v0 …" directives, v0 reads this blob next turn, appends results, and
// writes back. (localStorage stays only as an offline fallback cache on the client.)
//
//   GET  /api/entities-bible  → { doc } | { doc: null }   (latest saved doc, or null if none yet)
//   PUT  /api/entities-bible  ← { doc }  → { ok, updatedAt }
//
// Single-user dogfooding app: no auth. Turn-based editing ⇒ last-write-wins is acceptable; v0
// always GETs immediately before it PUTs so it never clobbers a fresh human edit.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const PATHNAME = "entities-bible/table.json"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const result = await get(PATHNAME, { access: "private" })
    if (!result) return NextResponse.json({ doc: null })
    // `get` streams the blob; read it to text and parse.
    const text = await new Response(result.stream).text()
    const doc = text ? JSON.parse(text) : null
    return NextResponse.json({ doc })
  } catch (error) {
    // A missing blob throws — treat as "no doc yet" rather than an error.
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
      access: "private",
      contentType: "application/json",
      allowOverwrite: true, // stable pathname — overwrite the single canonical doc
      addRandomSuffix: false,
    })
    return NextResponse.json({ ok: true, updatedAt })
  } catch (error) {
    console.log("[v0] entities-bible PUT:", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "Save failed" }, { status: 500 })
  }
}
