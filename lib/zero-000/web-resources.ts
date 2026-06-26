// Web-resource catalog — the heart of Zero-as-a-contextual-browser.
//
// A "resource" is a web app the user can summon into a Task (Figma, Photopea,
// Notion…). Conceptually it's a shortcut to that tool's web app, openable from
// anywhere; opening it expands a Task window whose body IS the tool.
//
// EMBED REALITY (why `mode` exists):
//  - In a browser tab the only way to host another site is an <iframe>, and most
//    SaaS send `X-Frame-Options`/`frame-ancestors` headers that make the browser
//    refuse to frame them. We cannot override that from a web app — it's enforced
//    by the browser itself.
//  - So each resource declares how it can be shown TODAY:
//      • "live"         → genuinely embeds in an <iframe> (e.g. Photopea), so you
//                         really work inside the Task and produce a real artifact.
//      • "illustrative" → the site blocks framing (Figma, Notion, Linear…); we show
//                         a faithful branded stand-in that reads the concept and
//                         notes it "opens natively in the Zero desktop app".
//  - In the eventual Electron desktop build, a native WebContentsView loads the URL
//    as real top-level content (frame headers don't apply), so every resource becomes
//    "live" with NO change to this catalog or the surrounding UX — only the surface
//    renderer swaps. That's the whole point of routing everything through this model.

export type WebEmbedMode = "live" | "illustrative"

export interface WebResource {
  id: string
  name: string
  /** Canonical URL opened when this resource is summoned. */
  url: string
  /** Hostnames that map a typed URL back to this resource (no leading www.). */
  domains: string[]
  /** Two-letter monogram for the resource glyph tile. */
  monogram: string
  /** Brand-ish tint for the glyph tile + canvas accents. */
  tint: string
  mode: WebEmbedMode
  /** One-line "what it is", shown on the illustrative canvas. */
  tagline: string
  /** The concrete OUTPUT the tool produces — the future "outputs wire into the
   *  Task's Outputs" story. Shown as a chip on the canvas. */
  artifact: string
  /** Which faux-UI skeleton the ILLUSTRATIVE canvas renders (ignored for live). */
  preview?: "design" | "doc" | "board"
}

/**
 * The known catalog. Photopea is the LIVE hero (real image editor, embeds cleanly,
 * exports real files, and exposes a postMessage API so its exports can later flow
 * back into the Task's Outputs). Figma / Notion / Linear are illustrative because
 * they refuse framing — they demonstrate the breadth of "resources anywhere" and
 * become live in the desktop build.
 */
export const WEB_RESOURCES: WebResource[] = [
  {
    id: "wr_photopea",
    name: "Photopea",
    url: "https://www.photopea.com",
    domains: ["photopea.com"],
    monogram: "Pp",
    tint: "#3D7BD9",
    mode: "live",
    tagline: "Full image editor — layers, masks, retouching.",
    artifact: "Exports PNG · PSD · SVG",
  },
  {
    id: "wr_figma",
    name: "Figma",
    url: "https://www.figma.com",
    domains: ["figma.com"],
    monogram: "Fg",
    tint: "#C9685E",
    mode: "illustrative",
    tagline: "Collaborative interface design canvas.",
    artifact: "Produces frames · components",
    preview: "design",
  },
  {
    id: "wr_notion",
    name: "Notion",
    url: "https://www.notion.so",
    domains: ["notion.so", "notion.com"],
    monogram: "No",
    tint: "#8A8780",
    mode: "illustrative",
    tagline: "Docs, wikis and databases.",
    artifact: "Produces docs · databases",
    preview: "doc",
  },
  {
    id: "wr_linear",
    name: "Linear",
    url: "https://linear.app",
    domains: ["linear.app"],
    monogram: "Ln",
    tint: "#7B6CA6",
    mode: "illustrative",
    tagline: "Issue tracking and product planning.",
    artifact: "Produces issues · cycles",
    preview: "board",
  },
]

const byId = new Map(WEB_RESOURCES.map((r) => [r.id, r]))
const byDomain = new Map<string, WebResource>()
for (const r of WEB_RESOURCES) for (const d of r.domains) byDomain.set(d, r)

export function getWebResource(id: string | undefined): WebResource | undefined {
  return id ? byId.get(id) : undefined
}

/** Strip protocol/leading www. and lowercase the hostname for matching. */
function hostOf(input: string): string | null {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`)
    return u.hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return null
  }
}

/** Resolve a stored/typed URL to its catalog resource (by registrable domain). */
export function resolveWebResourceByUrl(url: string | undefined): WebResource | undefined {
  if (!url) return undefined
  const host = hostOf(url)
  if (!host) return undefined
  // Exact, then suffix match (e.g. "files.figma.com" → figma.com).
  return byDomain.get(host) ?? WEB_RESOURCES.find((r) => r.domains.some((d) => host === d || host.endsWith(`.${d}`)))
}

/**
 * Heuristic: does this free-text input look like a URL / bare domain the user
 * means to open (e.g. "www.figma.com", "photopea.com", "https://x.com/path")?
 * Deliberately conservative so ordinary task titles ("Call the bank") never match:
 * requires a single token with a dot and a plausible TLD, or an explicit scheme.
 */
export function looksLikeUrl(input: string): boolean {
  const t = input.trim()
  if (!t || /\s/.test(t)) return false
  if (/^[a-z]+:\/\//i.test(t)) return true
  // bare domain: label(.label)+ with a 2+ char alpha TLD, optional path/query.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(t) && /\.[a-z]{2,}($|\/)/i.test(t)
}

/** Normalize a typed URL into a full https URL (adds scheme if missing). */
export function normalizeUrl(input: string): string {
  const t = input.trim()
  return /^[a-z]+:\/\//i.test(t) ? t : `https://${t}`
}

/** Short display label for a URL — the resource name, else the bare hostname. */
export function webDisplayName(url: string, resourceId?: string): string {
  return getWebResource(resourceId)?.name ?? hostOf(url) ?? url
}

/**
 * Best-effort REAL favicon for a resource/URL. We resolve the host (catalog
 * domain first, else the typed URL's host) and fetch its icon through Google's
 * favicon service, which returns a clean square PNG at the requested size for any
 * public site — so a Figma/Notion/Linear task (or any pinned website) shows its
 * genuine mark instead of a monogram. The glyph falls back to the monogram tile
 * if this is null or the image fails to load. `size` should be the rendered px so
 * the icon is crisp on hi-dpi (request 2× the box).
 */
export function webFaviconUrl(resource: WebResource | undefined, url?: string, size = 64): string | null {
  const host = resource?.domains[0] ?? hostOf(url ?? "")
  if (!host) return null
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`
}
