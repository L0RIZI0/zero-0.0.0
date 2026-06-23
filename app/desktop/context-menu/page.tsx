"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  CornerUpRight,
  ExternalLink,
  Hexagon,
  ImageDown,
  Inbox,
  Link2,
  Pin,
  RotateCw,
  Scissors,
  Search,
  SquarePlus,
  X,
} from "lucide-react"
import { getWebResource, resolveWebResourceByUrl } from "@/lib/zero/web-resources"
import { ResourceGlyph } from "@/components/zero/resource-glyph"
import type { ZeroMenuContext } from "@/types/zero-desktop"
import { cn } from "@/lib/utils"

// Transparent margin inside the overlay window so the menu's drop-shadow has room
// to render without being clipped at the window edge. Mirrors the value main uses
// to anchor the card's top-left to the cursor.
const PAD = 14

type Item =
  | { kind: "sep" }
  | {
      kind: "item"
      id: string
      label: string
      icon: React.ComponentType<{ className?: string }>
      hint?: string
      sub?: string
      danger?: boolean
      accent?: boolean
    }

function buildItems(ctx: ZeroMenuContext): Item[] {
  const items: Item[] = []
  const sel = ctx.selectionText.trim()
  const snippet = sel.length > 28 ? `${sel.slice(0, 28)}…` : sel

  if (sel) {
    items.push(
      { kind: "item", id: "selection-to-outputs", label: "Add selection to Outputs", icon: Inbox, accent: true },
      { kind: "item", id: "selection-to-task", label: "New Task from selection", icon: SquarePlus },
      { kind: "item", id: "search-zero", label: `Search Zero`, icon: Search, sub: snippet },
      { kind: "sep" },
    )
  }
  if (ctx.linkURL) {
    items.push(
      { kind: "item", id: "open-link-task", label: "Open link as Task", icon: CornerUpRight, accent: true },
      { kind: "item", id: "copy-link", label: "Copy link address", icon: Link2 },
      { kind: "sep" },
    )
  }
  if (ctx.mediaType === "image" && ctx.srcURL) {
    items.push(
      { kind: "item", id: "image-to-outputs", label: "Save image to Outputs", icon: ImageDown, accent: true },
      { kind: "sep" },
    )
  }

  items.push(
    { kind: "item", id: "page-to-outputs", label: "Add page to Outputs", icon: Inbox },
    { kind: "item", id: "move-to-space", label: "Move to Space…", icon: Hexagon },
    { kind: "item", id: "pin-do-list", label: "Pin to do-list", icon: Pin },
    { kind: "sep" },
    { kind: "item", id: "back", label: "Back", icon: ArrowLeft, hint: "Alt ←" },
    { kind: "item", id: "forward", label: "Forward", icon: ArrowRight, hint: "Alt →" },
    { kind: "item", id: "reload", label: "Reload", icon: RotateCw, hint: "⌘R" },
  )

  if (ctx.isEditable) {
    items.push(
      { kind: "sep" },
      { kind: "item", id: "cut", label: "Cut", icon: Scissors, hint: "⌘X" },
      { kind: "item", id: "copy", label: "Copy", icon: Copy, hint: "⌘C" },
    )
  }

  items.push(
    { kind: "sep" },
    { kind: "item", id: "open-external", label: "Open in browser", icon: ExternalLink },
    { kind: "item", id: "close-resource", label: "Close resource", icon: X, danger: true },
  )
  return items
}

export default function ContextMenuPage() {
  const [ctx, setCtx] = useState<ZeroMenuContext | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Receive the right-click context from main.
  useEffect(() => {
    const bridge = window.zeroMenu
    if (!bridge) return
    return bridge.onShow((next) => setCtx(next))
  }, [])

  // Escape dismisses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.zeroMenu?.dismiss()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Report measured size so main can size + place the overlay window.
  useLayoutEffect(() => {
    if (!ctx || !cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    window.zeroMenu?.resize({
      width: Math.ceil(rect.width) + PAD * 2,
      height: Math.ceil(rect.height) + PAD * 2,
      anchorOffsetX: PAD,
      anchorOffsetY: PAD,
    })
  }, [ctx])

  if (!ctx) return <GlobalTransparent />

  const resource = getWebResource(ctx.resourceId) || resolveWebResourceByUrl(ctx.url)
  const name = resource?.name || hostOf(ctx.url) || "Resource"
  const host = hostOf(ctx.url)
  const items = buildItems(ctx)

  const run = (id: string) => () => window.zeroMenu?.action(id)

  return (
    <>
      <GlobalTransparent />
      <div style={{ padding: PAD }} className="flex min-h-screen items-start justify-start">
        <div
          ref={cardRef}
          role="menu"
          className="w-[256px] overflow-hidden rounded-xl border border-border bg-popover/95 text-popover-foreground shadow-[0_18px_50px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl"
        >
          {/* Header: which resource this menu is acting on. */}
          <div className="flex items-center gap-2.5 border-b border-border/70 px-3 py-2.5">
            <span className="h-6 w-6 shrink-0">
              <ResourceGlyph resourceId={resource?.id} url={ctx.url} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium leading-tight">{name}</p>
              {host && <p className="truncate text-[11px] leading-tight text-muted-foreground">{host}</p>}
            </div>
          </div>

          {/* Items */}
          <div className="py-1">
            {items.map((it, i) =>
              it.kind === "sep" ? (
                <div key={`s${i}`} className="my-1 h-px bg-border/70" />
              ) : (
                <button
                  key={it.id}
                  type="button"
                  role="menuitem"
                  onClick={run(it.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-2.5 py-[7px] text-left text-[13px] leading-none outline-none transition-colors",
                    it.danger
                      ? "text-destructive hover:bg-destructive/10"
                      : "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <it.icon
                    className={cn(
                      "h-[15px] w-[15px] shrink-0",
                      it.danger ? "text-destructive" : it.accent ? "text-foreground" : "text-muted-foreground",
                    )}
                  />
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.sub && (
                    <span className="max-w-[88px] truncate rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                      {it.sub}
                    </span>
                  )}
                  {it.hint && <span className="text-[11px] tabular-nums text-muted-foreground/80">{it.hint}</span>}
                </button>
              ),
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

/** Force the document transparent so only the menu card paints (the root layout
 *  sets an opaque bg on <html>; override it just for this overlay route). */
function GlobalTransparent() {
  return (
    <style>{`html,body{background:transparent !important;margin:0;overflow:hidden;}
      ::-webkit-scrollbar{display:none;}
      *{user-select:none;cursor:default;}`}</style>
  )
}
