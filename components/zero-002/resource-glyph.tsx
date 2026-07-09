"use client"

import { useEffect, useState } from "react"
import { Globe } from "lucide-react"
import { getWebResource, resolveWebResourceByUrl, webFaviconUrl } from "@/lib/zero-002/web-resources"
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

  // A root-relative URL ("/vision", "/zero-laws") is one of Zero's OWN internal
  // pages, not an external site. We brand it with the Zero wordmark "z" (same
  // lowercase, semibold, tight-tracked mark as the corner logo) on a fixed
  // near-black app-icon tile — and skip the favicon lookup entirely (hostOf would
  // otherwise treat "/vision" as the host "vision" and fetch a generic globe that
  // would cover the "z").
  const isInternal = !!url && url.startsWith("/")
  const favicon = isInternal ? null : webFaviconUrl(resource, url)

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
      {/* Fallback tile — always beneath; covered once the favicon loads, revealed if
          it's missing or errors. Internal Zero pages use the branded "z" tile; known
          resources show their monogram on brand tint; unknown URLs get a neutral globe. */}
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center font-semibold leading-none text-white",
          // Hairline ring keeps the near-black tile crisp against a dark canvas.
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
