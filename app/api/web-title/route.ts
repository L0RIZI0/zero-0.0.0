import { type NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Best-effort fetch of a web page's real <title> (or og:title), used to give a Zero web
// Resource a human "displayed title" while its stored title stays the raw URL. Kept server-
// side so it isn't blocked by the browser's CORS/opaque-response rules and no client key or
// origin is exposed. Failures are non-fatal — the caller falls back to the hostname.

/** Decode the handful of HTML entities that commonly appear in <title> text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ")
}

function extractTitle(html: string): string | null {
  // Prefer og:title (usually the cleanest human label), else the <title> element.
  const og =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i)
  if (og?.[1]) return decodeEntities(og[1]).trim() || null
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (t?.[1]) return decodeEntities(t[1].replace(/\s+/g, " ")).trim() || null
  return null
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url")
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 })
  // Only fetch real external http(s) pages. Internal Zero routes ("/vision") and other
  // schemes have no remote <title> to read.
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ title: null })
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ title: null })
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // A desktop UA + HTML accept so sites return their normal titled document.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    })
    clearTimeout(timer)
    if (!res.ok) return NextResponse.json({ title: null })
    // Read only the first chunk — <head>/<title> is near the top; avoid pulling huge bodies.
    const reader = res.body?.getReader()
    let html = ""
    if (reader) {
      const decoder = new TextDecoder()
      for (let i = 0; i < 16; i++) {
        const { value, done } = await reader.read()
        if (value) html += decoder.decode(value, { stream: true })
        if (done || /<\/title>/i.test(html) || html.length > 200_000) break
      }
      reader.cancel().catch(() => {})
    } else {
      html = await res.text()
    }
    return NextResponse.json({ title: extractTitle(html) })
  } catch (error) {
    console.log("[v0] web-title fetch:", error instanceof Error ? error.message : error)
    return NextResponse.json({ title: null })
  }
}
