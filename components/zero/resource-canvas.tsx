"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { getWebResource, resolveWebResourceByUrl, webDisplayName, type WebResource } from "@/lib/zero/web-resources"
import { ResourceGlyph } from "./resource-glyph"
import { cn } from "@/lib/utils"

/**
 * The body of a RESOURCE TASK — Zero behaving as a contextual browser. It fills the
 * Task window's central rectangle (Task windows are rectangular, so unlike a Space
 * leaf there's no octagon to clip the web surface). No browser chrome: per the
 * design, a resource is a CONTEXT, not a mini-browser — the Task's own header glyph
 * (the resource favicon/monogram) and title already identify it.
 *
 * Three render paths:
 *  - DESKTOP (Electron) → a native WebContentsView (see `NativeSurface`). Loaded as
 *                         top-level content, so frame-blocking headers don't apply:
 *                         Figma, Notion, Linear, anything loads LIVE. This is the
 *                         whole point of the desktop app.
 *  - WEB · "live"       → a real <iframe>. Photopea (and any frame-friendly site)
 *                         loads fully so you genuinely work and export real files.
 *  - WEB · "illustrative" → a branded faux-app stand-in for sites that refuse
 *                         framing, noting it "opens natively in the Zero desktop app".
 */
export function ResourceCanvas({
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
  // Feature-detect the desktop bridge once on mount (window.zero is injected by the
  // Electron preload; undefined in the browser, and during SSR).
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    setIsDesktop(typeof window !== "undefined" && !!window.zero?.isDesktop)
  }, [])

  if (isDesktop) {
    return (
      <div className="h-full w-full overflow-hidden bg-card">
        <NativeSurface
          id={id}
          url={url}
          resourceId={resourceId}
          active={active}
          name={webDisplayName(url, resource?.id)}
          resource={resource}
        />
      </div>
    )
  }

  const illustrative = resource?.mode === "illustrative"
  return (
    <div className="h-full w-full overflow-hidden bg-card">
      {illustrative ? (
        <IllustrativeSurface resource={resource!} />
      ) : (
        <LiveSurface url={url} name={webDisplayName(url, resource?.id)} />
      )}
    </div>
  )
}

/**
 * DESKTOP path. Renders a transparent PLACEHOLDER and drives a native
 * WebContentsView (which lives in the Electron main process, floating above the DOM)
 * to track this placeholder's screen rect. Because the native view isn't part of the
 * DOM we can't clip/transform it, so we stream its bounds on every layout change
 * (resize, scroll, and the open/close morph) via rAF, and tear it down on unmount.
 */
const OFFSCREEN = { x: -10000, y: -10000, width: 0, height: 0 }
// Native views can't be GPU-transformed/clipped like the DOM, so during the open
// morph they'd visibly trail the window. Instead we keep the view UNMOUNTED while
// the rect is still changing, show a blurred branded preview in the DOM, and only
// mount + snap the live view in once the rect has been STABLE for a few frames.
const STABLE_FRAMES = 6
const SETTLE_TIMEOUT_MS = 1600

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
  // settling = morph/load in progress (blurred preview shown); live = snapped in.
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
    let mounted = false
    let lastSent = ""
    const start = performance.now()

    const rectOf = () => {
      const r = holder.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    const keyOf = (r: { x: number; y: number; width: number; height: number }) =>
      `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`

    // Reveal (snap-in) or error, driven by the native load result for THIS task.
    const offStatus = bridge.resource.onStatus((s) => {
      if (s.id !== id) return
      if (s.ok) setPhase("live")
      else {
        setDetail(s.detail || "")
        setPhase("error")
      }
    })

    const loop = () => {
      const rect = rectOf()
      const key = keyOf(rect)
      if (!mounted) {
        // Wait for the morph to settle (rect unchanged for N frames) before mounting.
        if (key === lastKey) stable++
        else {
          stable = 0
          lastKey = key
        }
        const settled = stable >= STABLE_FRAMES || performance.now() - start > SETTLE_TIMEOUT_MS
        if (settled && activeRef.current && rect.width > 0) {
          mounted = true
          lastSent = key
          bridge.resource.mount({ id, url, resourceId, rect })
        }
      } else {
        // Live: keep the native view pinned to the placeholder; park it offscreen
        // when this window isn't the active leaf so it can't paint over ancestors.
        const onScreen = activeRef.current
        const sendKey = onScreen ? key : "off"
        if (sendKey !== lastSent) {
          lastSent = sendKey
          bridge.resource.setBounds({ id, rect: onScreen ? rect : OFFSCREEN })
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      offStatus()
      bridge.resource.unmount(id)
    }
  }, [id, url, resourceId, retryKey])

  const covered = phase !== "live" // blurred preview/error sits over the (empty) holder

  return (
    <div ref={holderRef} className="relative h-full w-full bg-card">
      {/* Blurred branded preview — visible during the morph + initial load, then
          fades out as the live native view snaps in. */}
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-200",
          covered ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!covered}
      >
        <div className="absolute inset-0 scale-105 opacity-70 blur-[8px]">
          {resource ? <PreviewSkeleton resource={resource} /> : <div className="h-full w-full bg-muted" />}
        </div>
        <div className="absolute inset-0 bg-background/40" />
        {phase !== "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="h-10 w-10">
              <ResourceGlyph resourceId={resource?.id} url={url} />
            </span>
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" aria-hidden />
              <p className="text-[13px] text-muted-foreground">{`Loading ${name}…`}</p>
            </div>
          </div>
        )}
      </div>

      {/* Graceful failure (e.g. a site that refuses to load) — never a dead white
          view; offer a retry and an escape hatch to the real browser. */}
      {phase === "error" && (
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div className="flex max-w-[320px] flex-col items-center gap-3 rounded-xl border border-border bg-popover/95 px-6 py-6 text-center shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)]">
            <span className="h-11 w-11">
              <ResourceGlyph resourceId={resource?.id} url={url} />
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

/** Branded stand-in for a frame-blocking resource. */
function IllustrativeSurface({ resource }: { resource: WebResource }) {
  return (
    <div className="flex h-full w-full flex-col bg-card text-foreground">
      {/* Faux app chrome — identifies the tool, no Zero browser controls. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="h-5 w-5">
          <ResourceGlyph resourceId={resource.id} />
        </span>
        <span className="text-[13px] font-medium">{resource.name}</span>
        <span className="ml-auto flex items-center gap-1.5" aria-hidden>
          <span className="h-2 w-8 rounded-full bg-foreground/10" />
          <span className="h-2 w-8 rounded-full bg-foreground/10" />
          <span className="h-5 w-5 rounded-[4px]" style={{ backgroundColor: resource.tint }} />
        </span>
      </div>

      {/* Representative skeleton, dimmed, with the "native" notice floating over it. */}
      <div className="relative min-h-0 flex-1">
        <PreviewSkeleton resource={resource} />
        <div className="absolute inset-0 flex items-center justify-center bg-background/45 px-6 backdrop-blur-[1.5px]">
          <div className="flex max-w-[300px] flex-col items-center gap-3 rounded-xl border border-border bg-popover/95 px-6 py-6 text-center shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)]">
            <span className="h-11 w-11">
              <ResourceGlyph resourceId={resource.id} />
            </span>
            <p className="text-pretty text-sm font-medium leading-snug">
              {`${resource.name} opens natively in the Zero desktop app`}
            </p>
            <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{resource.tagline}</p>
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{ backgroundColor: `${resource.tint}22`, color: resource.tint }}
            >
              {resource.artifact}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A tasteful faux-UI skeleton per tool type — structured app furniture (rails,
 * frames, doc lines, board columns), NOT decorative blobs, so it reads as that
 * tool sitting behind the notice.
 */
function PreviewSkeleton({ resource }: { resource: WebResource }) {
  const bar = "rounded bg-foreground/10"
  if (resource.preview === "doc") {
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
  if (resource.preview === "board") {
    return (
      <div className="grid h-full w-full grid-cols-3 gap-4 overflow-hidden p-6">
        {[0, 1, 2].map((col) => (
          <div key={col} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: resource.tint }} />
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
  // "design": canvas with frames flanked by layer + property rails.
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
            <div className="h-8 w-full" style={{ backgroundColor: `${resource.tint}26` }} />
            <div className="flex flex-1 flex-col gap-2 p-3">
              <div className={cn(bar, "h-3 w-2/3")} />
              <div className={cn(bar, "h-3 w-full")} />
              <div className={cn(bar, "mt-auto h-8 w-1/2")} style={{ backgroundColor: `${resource.tint}33` }} />
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
