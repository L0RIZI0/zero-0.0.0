"use client"

import { useEffect, useState } from "react"
import { Globe } from "lucide-react"
import { getWebResource, resolveWebResourceByUrl, webFaviconUrl } from "@/lib/zero-000/web-resources"
import { cn } from "@/lib/utils"

/**
 * The identity glyph for a RESOURCE TASK — a small app-icon-style tile carrying the
 * resource's REAL favicon. Used wherever a normal entity would show its `NodeGlyph`
 * (do-list row, dock card, window header, context menu), so a Figma/Photopea task
 * reads as that tool at a glance.
 *
 * Rendering: the favicon (fetched for the resource's domain, or any pinned website's
 * host) is layered over a tinted monogram tile. The tile shows first and stays as the
 * fallback; the favicon fades in once it loads, and we fall back to the tile (or a
 * neutral globe for an unknown URL) if there's no host or the image errors.
 *
 * Fills its parent box (the shared glyph box is 16–20px), so it inherits the same
 * Flip-driven size tween as the geometric glyphs.
 */
export function ResourceGlyph({
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
  const favicon = webFaviconUrl(resource, url)

  // Reset load state if the underlying resource/url changes (glyph is reused).
  const [status, setStatus] = useState<"loading" | "ok" | "error">(favicon ? "loading" : "error")
  useEffect(() => {
    setStatus(favicon ? "loading" : "error")
  }, [favicon])

  return (
    <span
      className={cn("relative flex h-full w-full items-center justify-center overflow-hidden rounded-[4px]", className)}
      aria-hidden="true"
    >
      {/* Fallback tile (monogram on brand tint) — always beneath; covered once the
          favicon loads, revealed if it's missing or errors. */}
      <span
        className="absolute inset-0 flex items-center justify-center font-semibold leading-none text-white"
        style={{ backgroundColor: tint }}
      >
        {resource ? (
          <span style={{ fontSize: "0.5em" }} className="tracking-tight">
            {resource.monogram}
          </span>
        ) : (
          <Globe className="h-[62%] w-[62%]" strokeWidth={2.25} />
        )}
      </span>

      {/* Real favicon on a clean plate so transparent marks read well. Plain <img>
          (no crossOrigin — display only), so the favicon service's lack of CORS
          headers doesn't block it. */}
      {favicon && status !== "error" && (
        <img
          src={favicon || "/placeholder.svg"}
          alt=""
          draggable={false}
          onLoad={() => setStatus("ok")}
          onError={() => setStatus("error")}
          className={cn(
            "absolute inset-0 h-full w-full bg-card object-contain p-[12%] transition-opacity duration-150",
            status === "ok" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </span>
  )
}
