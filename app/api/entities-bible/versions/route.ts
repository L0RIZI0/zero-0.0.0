import { list } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"

// ─────────────────────────────────────────────────────────────────────────────────────────────
// VERSION HISTORY for the Entities Bible. The main route (../route.ts) auto-snapshots every content
// change to `entities-bible/versions/<updatedAt>.json`. This endpoint powers the in-app History panel:
//
//   GET /api/entities-bible/versions          → { versions: [{ ts, size }] }  (newest first)
//   GET /api/entities-bible/versions?ts=<ms>  → { doc }                        (that snapshot's doc)
//
// Restore is NOT a special server op: the client fetches a version's doc here, then PUTs it back to
// the main route as the new canonical doc (which itself snapshots the restore). So a restore is
// always reversible too — nothing is ever destroyed.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const VERSIONS_PREFIX = "entities-bible/versions/"

export const dynamic = "force-dynamic"

function versionTs(pathname: string): number {
  const m = pathname.match(/(\d+)\.json$/)
  return m ? Number(m[1]) : 0
}

export async function GET(request: NextRequest) {
  const tsParam = request.nextUrl.searchParams.get("ts")
  try {
    const { blobs } = await list({ prefix: VERSIONS_PREFIX })

    // ?ts=<ms> → return that specific snapshot's doc.
    if (tsParam) {
      const want = Number(tsParam)
      const match = blobs.find((b) => versionTs(b.pathname) === want)
      if (!match) return NextResponse.json({ doc: null }, { status: 404 })
      const res = await fetch(`${match.url}?t=${Date.now()}`, { cache: "no-store" })
      if (!res.ok) return NextResponse.json({ doc: null }, { status: 404 })
      const text = await res.text()
      return NextResponse.json({ doc: text ? JSON.parse(text) : null })
    }

    // No param → the list, newest first.
    const versions = blobs
      .map((b) => ({ ts: versionTs(b.pathname), size: b.size }))
      .filter((v) => v.ts > 0)
      .sort((a, b) => b.ts - a.ts)
    return NextResponse.json({ versions })
  } catch (error) {
    console.log("[v0] entities-bible versions GET:", error instanceof Error ? error.message : error)
    return NextResponse.json({ versions: [], doc: null }, { status: 500 })
  }
}
