"use client"

import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { resolveWebResourceByUrl, webFaviconUrl, webFaviconFallbackUrl } from "@/lib/zero/web-resources"

/**
 * A COMPACT inline favicon for a web Resource — the small site mark shown right before the
 * displayed title in ENTITY CONTENT rows and the breadcrumb. Distinct from the resource
 * canvas's big monogram tile (`ResourceGlyph`): this is a bare icon that walks the same
 * source chain — [0] DuckDuckGo (transparency-preserving, sits cleanly on dark) → [1] Google
 * (always-available, opaque) — and, if BOTH fail, renders nothing so no stray block is left
 * behind (the diamond kind-glyph already carries the "this is a Resource" cue). Internal Zero
 * routes ("/vision") have no host, so they show the small "z" chip instead.
 */
export function Zero0Favicon({ url, resourceId, className }: { url?: string; resourceId?: string; className?: string }) {
  const isInternal = !!url && url.startsWith("/")
  const resource = useMemo(() => resolveWebResourceByUrl(url), [url])
  const sources = useMemo(
    () =>
      !url || isInternal
        ? []
        : ([webFaviconUrl(resource, url), webFaviconFallbackUrl(resource, url, 32)].filter(Boolean) as string[]),
    [url, isInternal, resource],
  )
  const [srcIdx, setSrcIdx] = useState(0)
  const [status, setStatus] = useState<"loading" | "ok" | "error">(sources.length ? "loading" : "error")
  useEffect(() => {
    setSrcIdx(0)
    setStatus(sources.length ? "loading" : "error")
  }, [sources])

  const box = cn("inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-hidden rounded-[3px]", className)

  // Internal Zero route → a tiny dark "z" chip (no external favicon exists).
  if (isInternal) {
    return (
      <span aria-hidden className={cn(box, "bg-foreground/85 text-[8px] font-semibold leading-none text-background")}>
        z
      </span>
    )
  }

  const favicon = sources[srcIdx]
  if (!favicon || status === "error") return null

  // On the opaque Google fallback (index past the first) frame the icon so a possible white
  // background reads as a deliberate chip rather than a stray block on the dark surface.
  const framed = status === "ok" && srcIdx > 0
  return (
    <span aria-hidden className={cn(box, framed && "bg-white/90 p-px")}>
      <img
        src={favicon || "/placeholder.svg"}
        alt=""
        draggable={false}
        className="h-full w-full object-contain"
        onLoad={() => setStatus("ok")}
        onError={() =>
          setSrcIdx((i) => {
            if (i + 1 < sources.length) return i + 1
            setStatus("error")
            return i
          })
        }
      />
    </span>
  )
}
