"use client"

import { Globe } from "lucide-react"
import { getWebResource, resolveWebResourceByUrl } from "@/lib/zero/web-resources"
import { cn } from "@/lib/utils"

/**
 * The identity glyph for a RESOURCE TASK — a small app-icon-style tinted tile
 * carrying the resource's monogram (the stand-in for its favicon). Used wherever a
 * normal entity would show its `NodeGlyph` (do-list row, dock card, window header),
 * so a Figma/Photopea task reads as that tool at a glance.
 *
 * Fills its parent box (the shared glyph box is 16–20px), so it inherits the same
 * Flip-driven size tween as the geometric glyphs. An unknown typed URL (no catalog
 * match) falls back to a neutral globe tile.
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

  return (
    <span
      className={cn(
        "flex h-full w-full items-center justify-center overflow-hidden rounded-[4px] font-semibold leading-none text-white",
        className,
      )}
      style={{ backgroundColor: tint }}
      aria-hidden="true"
    >
      {resource ? (
        // Monogram scaled to the tile; tiny but reads as an app-icon mark.
        <span style={{ fontSize: "0.5em" }} className="tracking-tight">
          {resource.monogram}
        </span>
      ) : (
        <Globe className="h-[62%] w-[62%]" strokeWidth={2.25} />
      )}
    </span>
  )
}
