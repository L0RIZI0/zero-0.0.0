"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  getWebResource,
  resolveWebResourceByUrl,
  webDisplayName,
  webFaviconUrl,
  webFaviconFallbackUrl,
  type WebResource,
} from "@/lib/zero/web-resources"
import { readResourceLastUrl, writeResourceLastUrl } from "@/lib/zero/persistence"
import { cn } from "@/lib/utils"

/**
 * The root `/0` web surface — Zero behaving as a contextual browser, ported from the
 * `/2` log-model app's `resource-canvas` but kept DEP-FREE to match the zero0 tree
 * (no lucide-react; a tiny inline glyph instead). It fills the canvas content area
 * edge-to-edge when the drilled-in context is a web resource (`entity.webUrl`), while
 * zero0's own zero header (breadcrumb), create field, and footer stay in place.
 *
 * Three render paths (unchanged from /2 — that behavior "was working good enough"):
 *  - DESKTOP (Electron) → a native WebContentsView driven to track a DOM placeholder,
 *    so any site loads LIVE (frame-blocking headers don't apply to top-level content).
 *  - WEB · "live"        → a real <iframe> (Photopea and other frame-friendly sites).
 *  - WEB · "illustrative" → a branded stand-in for sites that refuse framing, noting
 *    it "opens natively in the Zero desktop app".
 * Internal Zero routes ("/vision") and external URLs both work; the last-visited page
 * is remembered per-resource so reopening resumes where you left off.
 */

/**
 * Resolve an internal/relative resource URL (Zero's own "/zero-laws" page) to an
 * ABSOLUTE URL the native WebContentsView can load — Electron's `loadURL` rejects a
 * bare path. Built from `protocol` + `host` (not `location.origin`, which serializes
 * to "null" for a custom `app:` scheme). Absolute URLs pass through untouched.
 */
function toDesktopUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url
  if (typeof window === "undefined") return url
  const { protocol, host } = window.location
  return `${protocol}//${host}${url.startsWith("/") ? url : `/${url}`}`
}

export function Zero0ResourceCanvas({
  id,
  url,
  resourceId,
  active = true,
}: {
  id: string
  url: string
  resourceId?: string
  active?: boolean
}) {
  const resource = getWebResource(resourceId) ?? resolveWebResourceByUrl(url)
  // Feature-detect the desktop bridge (injected by the Electron preload; undefined on
  // the web and during SSR).
  const [isDesktop, setIsDesktop] = useState(false)
  // "Resume where I left off": prefer the last url remembered for THIS resource
  // (desktop native only) over the entity's original webUrl. Computed ONCE at mount so
  // later navigations don't remount the view. Falls back to `url` on the web.
  const [initialUrl] = useState(() => (typeof window === "undefined" ? url : readResourceLastUrl(id) ?? url))
  useEffect(() => {
    // Require the ACTUAL native bridge API (resource.mount), not just the isDesktop flag:
    // a partial/stub `window.zero` (e.g. an env that sets isDesktop but no bridge) must NOT
    // route to NativeSurface, which would crash calling the missing mount(). On a real
    // desktop build the full API is always present, so this is stricter-but-equivalent.
    setIsDesktop(typeof window !== "undefined" && typeof window.zero?.resource?.mount === "function")
  }, [url])

  if (isDesktop) {
    return (
      <div className="h-full w-full overflow-hidden bg-card">
        <NativeSurface
          id={id}
          url={initialUrl}
          resourceId={resourceId}
          active={active}
          name={webDisplayName(url, resource?.id)}
          resource={resource}
        />
      </div>
    )
  }

  // Only a KNOWN, frame-friendly resource (Photopea) actually embeds in an <iframe>.
  // Everything else — a known illustrative tool (Figma) OR any UNKNOWN site the user
  // pinned (github.com, …) — gets the universal branded stand-in inviting them to open
  // it in the desktop app, instead of a broken iframe that the site refuses to frame.
  const live = resource?.mode === "live"
  return (
    <div className="h-full w-full overflow-hidden bg-card">
      {live ? (
        <LiveSurface url={url} name={webDisplayName(url, resource?.id)} />
      ) : (
        <IllustrativeSurface resource={resource} url={url} />
      )}
    </div>
  )
}

// Native views can't be GPU-transformed/clipped like the DOM, so mount the view
// IMMEDIATELY but PARKED OFFSCREEN at full size (so the network load runs while any
// layout settles), then snap it onto the placeholder once the page is dom-ready and
// the rect has been stable for a few frames. A blurred branded preview covers the gap.
const STABLE_FRAMES = 6
const SETTLE_TIMEOUT_MS = 1600
const hiddenRectOf = (r: { y: number; width: number; height: number }) => ({
  x: -100000,
  y: Math.max(0, Math.round(r.y)),
  width: Math.max(1, Math.round(r.width)),
  height: Math.max(1, Math.round(r.height)),
})

function NativeSurface({
  id,
  url,
  resourceId,
  active,
  name,
  resource,
}: {
  id: string
  url: string
  resourceId?: string
  active: boolean
  name: string
  resource?: WebResource
}) {
  const holderRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<"settling" | "live" | "error">("settling")
  const [detail, setDetail] = useState("")
  const [retryKey, setRetryKey] = useState(0)
  const activeRef = useRef(active)
  activeRef.current = active

  useLayoutEffect(() => {
    const bridge = window.zero
    const holder = holderRef.current
    if (!bridge || !holder) return

    let raf = 0
    let stable = 0
    let lastKey = ""
    let ready = false
    let revealed = false
    let lastSent = ""
    const start = performance.now()

    // The native view tracks the DOM placeholder's rect. Edge-to-edge is achieved
    // simply by the placeholder filling the canvas content area horizontally.
    const rectOf = () => {
      const r = holder.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    const keyOf = (r: { x: number; y: number; width: number; height: number }) =>
      `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`

    bridge.resource.mount({ id, url: toDesktopUrl(url), resourceId, rect: hiddenRectOf(rectOf()) })

    const offStatus = bridge.resource.onStatus((s) => {
      if (s.id !== id) return
      if (s.ok) ready = true
      else {
        setDetail(s.detail || "")
        setPhase("error")
      }
    })

    // Remember the last page navigated to (skip internal app:// routes — those are
    // Zero's own pages, not user browsing, and shouldn't override the resource url).
    const offNav = bridge.resource.onNavigated?.((n) => {
      if (n.id !== id || !n.url || n.url.startsWith("app://")) return
      writeResourceLastUrl(id, n.url)
    })

    const loop = () => {
      const rect = rectOf()
      const key = keyOf(rect)
      if (key === lastKey) stable++
      else {
        stable = 0
        lastKey = key
      }
      const settled = stable >= STABLE_FRAMES || performance.now() - start > SETTLE_TIMEOUT_MS

      if (!revealed) {
        if (ready && settled && activeRef.current && rect.width > 0) {
          revealed = true
          lastSent = key
          bridge.resource.setBounds({ id, rect })
          setPhase("live")
        } else {
          const hk = `hidden:${Math.round(rect.width)}x${Math.round(rect.height)}`
          if (hk !== lastSent) {
            lastSent = hk
            bridge.resource.setBounds({ id, rect: hiddenRectOf(rect) })
          }
        }
      } else {
        const onScreen = activeRef.current
        const sendKey = onScreen ? key : "off"
        if (sendKey !== lastSent) {
          lastSent = sendKey
          bridge.resource.setBounds({ id, rect: onScreen ? rect : hiddenRectOf(rect) })
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      offStatus()
      offNav?.()
      bridge.resource.unmount(id)
    }
  }, [id, url, resourceId, retryKey])

  const covered = phase !== "live"

  return (
    <div ref={holderRef} className="relative h-full w-full bg-card">
      {/* Blurred branded preview — during morph + initial load, then fades out. */}
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-200",
          covered ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!covered}
      >
        <div className="absolute inset-0 scale-105 opacity-70 blur-[8px]">
          <PreviewSkeleton tint={resource?.tint} preview={resource?.preview} />
        </div>
        <div className="absolute inset-0 bg-background/40" />
        {phase !== "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="h-10 w-10">
              <Zero0ResourceGlyph resourceId={resource?.id} url={url} />
            </span>
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" aria-hidden />
              <p className="text-[13px] text-muted-foreground">{`Loading ${name}…`}</p>
            </div>
          </div>
        )}
      </div>

      {/* Graceful failure — retry + escape hatch to the real browser. */}
      {phase === "error" && (
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div className="flex max-w-[320px] flex-col items-center gap-3 rounded-xl border border-border bg-popover/95 px-6 py-6 text-center shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)]">
            <span className="h-11 w-11">
              <Zero0ResourceGlyph resourceId={resource?.id} url={url} />
            </span>
            <p className="text-pretty text-sm font-medium leading-snug">{`${name} couldn't be loaded here`}</p>
            {detail && <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{detail}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setPhase("settling")
                  setDetail("")
                  setRetryKey((k) => k + 1)
                }}
                className="rounded-md bg-secondary px-3 py-1.5 text-[12px] font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => window.zero?.openExternal(url)}
                className="rounded-md px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                Open in browser
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Real embedded web surface (the live hero path). */
function LiveSurface({ url, name }: { url: string; name: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="relative h-full w-full">
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground" aria-hidden />
          <p className="text-[13px] text-muted-foreground">{`Loading ${name}…`}</p>
        </div>
      )}
      <iframe
        src={url}
        title={name}
        onLoad={() => setLoaded(true)}
        className="h-full w-full border-0"
        allow="fullscreen; clipboard-read; clipboard-write"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  )
}

const NEUTRAL_TINT = "#8A8F99"

/**
 * Branded stand-in for a resource that can't be embedded here — a KNOWN frame-blocking
 * tool (Figma) OR any UNKNOWN website the user pinned. This is the UNIVERSAL placeholder:
 * when `resource` is undefined we synthesize the display from the URL itself (name =
 * hostname, real favicon via the glyph, neutral tint, a generic "opens natively" invite,
 * and the default mockup behind), so github.com reads exactly like Figma does.
 */
function IllustrativeSurface({ resource, url }: { resource?: WebResource; url: string }) {
  const name = webDisplayName(url, resource?.id)
  const tint = resource?.tint ?? NEUTRAL_TINT
  const tagline = resource?.tagline ?? "Full site — loads as a real native window in the Zero desktop app."
  const artifact = resource?.artifact ?? "Any website"
  const preview = resource?.preview ?? "design"
  return (
    <div className="flex h-full w-full flex-col bg-card text-foreground">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="h-5 w-5">
          <Zero0ResourceGlyph resourceId={resource?.id} url={url} />
        </span>
        <span className="text-[13px] font-medium">{name}</span>
        <span className="ml-auto flex items-center gap-1.5" aria-hidden>
          <span className="h-2 w-8 rounded-full bg-foreground/10" />
          <span className="h-2 w-8 rounded-full bg-foreground/10" />
          <span className="h-5 w-5 rounded-[4px]" style={{ backgroundColor: tint }} />
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <PreviewSkeleton tint={tint} preview={preview} />
        <div className="absolute inset-0 flex items-center justify-center bg-background/45 px-6 backdrop-blur-[1.5px]">
          <div className="flex max-w-[300px] flex-col items-center gap-3 rounded-xl border border-border bg-popover/95 px-6 py-6 text-center shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)]">
            <span className="h-11 w-11">
              <Zero0ResourceGlyph resourceId={resource?.id} url={url} />
            </span>
            <p className="text-pretty text-sm font-medium leading-snug">
              {`${name} opens natively in the Zero desktop app`}
            </p>
            <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{tagline}</p>
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{ backgroundColor: `${tint}22`, color: tint }}
            >
              {artifact}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A tasteful faux-UI skeleton per tool type — structured app furniture, NOT
 * decorative blobs, so it reads as that tool sitting behind the notice.
 */
function PreviewSkeleton({
  tint = NEUTRAL_TINT,
  preview = "design",
}: {
  tint?: string
  preview?: WebResource["preview"]
}) {
  const bar = "rounded bg-foreground/10"
  if (preview === "doc") {
    return (
      <div className="flex h-full w-full justify-center overflow-hidden p-8">
        <div className="flex w-full max-w-[520px] flex-col gap-3">
          <div className={cn(bar, "h-6 w-2/3")} />
          <div className={cn(bar, "h-3 w-full")} />
          <div className={cn(bar, "h-3 w-11/12")} />
          <div className={cn(bar, "h-3 w-full")} />
          <div className={cn(bar, "mt-3 h-3 w-1/2")} />
          <div className={cn(bar, "h-24 w-full")} />
          <div className={cn(bar, "h-3 w-10/12")} />
          <div className={cn(bar, "h-3 w-full")} />
        </div>
      </div>
    )
  }
  if (preview === "board") {
    return (
      <div className="grid h-full w-full grid-cols-3 gap-4 overflow-hidden p-6">
        {[0, 1, 2].map((col) => (
          <div key={col} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tint }} />
              <span className={cn(bar, "h-3 w-20")} />
            </div>
            {[0, 1, 2].map((card) => (
              <div key={card} className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
                <div className={cn(bar, "h-3 w-full")} />
                <div className={cn(bar, "h-3 w-2/3")} />
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="hidden w-44 shrink-0 flex-col gap-2 border-r border-border p-3 sm:flex">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={cn(bar, "h-3", i % 2 ? "w-3/4" : "w-full")} />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-6 p-8">
        {[0, 1].map((f) => (
          <div key={f} className="flex h-44 w-40 flex-col overflow-hidden rounded-md border border-border bg-background/70">
            <div className="h-8 w-full" style={{ backgroundColor: `${tint}26` }} />
            <div className="flex flex-1 flex-col gap-2 p-3">
              <div className={cn(bar, "h-3 w-2/3")} />
              <div className={cn(bar, "h-3 w-full")} />
              <div className={cn(bar, "mt-auto h-8 w-1/2")} style={{ backgroundColor: `${tint}33` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden w-44 shrink-0 flex-col gap-2 border-l border-border p-3 lg:flex">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={cn(bar, "h-3", i % 3 ? "w-full" : "w-1/2")} />
        ))}
      </div>
    </div>
  )
}

/**
 * Dep-free resource identity glyph (the zero0 equivalent of `components/zero`'s
 * lucide-based `ResourceGlyph`): the REAL favicon layered over a tinted monogram
 * tile, with an inline SVG globe for unknown URLs and a branded "z" tile for internal
 * Zero routes. No lucide-react — keeps the zero0 tree dependency-free.
 */
function Zero0ResourceGlyph({
  resourceId,
  url,
  className,
}: {
  resourceId?: string
  url?: string
  className?: string
}) {
  const resource = getWebResource(resourceId) ?? resolveWebResourceByUrl(url)
  const tint = resource?.tint ?? "#8A8F99"
  const isInternal = !!url && url.startsWith("/")
  // Favicon sources, best → most-available: [0] DuckDuckGo (preserves transparency, so it
  // sits cleanly on the dark canvas), [1] Google (always available, but opaque/white). We
  // walk the chain on load error; when we FALL BACK to the opaque source, the icon may
  // carry a baked-in white square, so we frame it on a soft rounded chip (`onFallback`).
  const sources = useMemo(
    () =>
      isInternal
        ? []
        : ([webFaviconUrl(resource, url), webFaviconFallbackUrl(resource, url)].filter(Boolean) as string[]),
    [isInternal, resource, url],
  )
  const [srcIdx, setSrcIdx] = useState(0)
  const [status, setStatus] = useState<"loading" | "ok" | "error">(sources.length ? "loading" : "error")
  useEffect(() => {
    setSrcIdx(0)
    setStatus(sources.length ? "loading" : "error")
  }, [sources])
  const favicon = sources[srcIdx] ?? null
  // On the opaque Google fallback (any index past the first), frame the icon so a possible
  // white background reads as a deliberate chip rather than a stray block.
  const onFallback = status === "ok" && srcIdx > 0

  return (
    <span
      className={cn("relative flex h-full w-full items-center justify-center overflow-hidden rounded-[4px]", className)}
      aria-hidden="true"
    >
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center font-semibold leading-none text-white",
          isInternal && "ring-1 ring-inset ring-white/15",
        )}
        style={{ backgroundColor: isInternal ? "#0A0A0A" : tint }}
      >
        {isInternal ? (
          <span style={{ fontSize: "0.72em" }} className="tracking-tight">
            z
          </span>
        ) : resource ? (
          <span style={{ fontSize: "0.5em" }} className="tracking-tight">
            {resource.monogram}
          </span>
        ) : (
          <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        )}
      </span>
      {favicon && status !== "error" && (
        <img
          src={favicon || "/placeholder.svg"}
          alt=""
          draggable={false}
          onLoad={() => setStatus("ok")}
          onError={() =>
            setSrcIdx((i) => {
              // Walk the chain: try the next source, else give up (→ monogram).
              if (i + 1 < sources.length) return i + 1
              setStatus("error")
              return i
            })
          }
          className={cn(
            "absolute inset-0 h-full w-full object-contain transition-opacity duration-150",
            // Opaque fallback (Google): the icon likely carries a baked-in white square, so
            // render it AS a clean white rounded chip (icon + backing merge into one tile) —
            // reads intentional in dark mode. Transparent source: dark backing so the real
            // mark sits cleanly on the canvas.
            onFallback ? "rounded-[4px] bg-white p-[18%] ring-1 ring-inset ring-black/10" : "bg-card p-[12%]",
            status === "ok" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </span>
  )
}
