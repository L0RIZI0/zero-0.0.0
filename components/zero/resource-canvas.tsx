"use client"

import { useState } from "react"
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
 * Two render paths, chosen by the catalog's `mode`:
 *  - "live"          → a real <iframe>. Photopea (and any frame-friendly site) loads
 *                      fully, so you genuinely work and export real files. An unknown
 *                      typed URL is also attempted live.
 *  - "illustrative"  → a branded faux-app stand-in for sites that refuse framing
 *                      (Figma/Notion/Linear). It reads the concept and states it
 *                      "opens natively in the Zero desktop app".
 *
 * In the eventual Electron build the live path swaps to a native WebContentsView with
 * no change here — every resource becomes truly live.
 */
export function ResourceCanvas({ url, resourceId }: { url: string; resourceId?: string }) {
  const resource = getWebResource(resourceId) ?? resolveWebResourceByUrl(url)
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
