"use client"

import { useMemo } from "react"
import { motion, AnimatePresence } from "motion/react"
import { FileText, ImageIcon, Link2, NotebookPen, Sheet, Presentation, CreditCard } from "lucide-react"
import { getResource, getSpaceAssets } from "@/lib/zero/data"
import type { Asset, AssetType } from "@/lib/zero/types"
import { panelSlideTransition } from "@/lib/zero/motion"
import { useZeroNav } from "@/lib/zero/nav-store"

const typeIcon: Record<AssetType, typeof FileText> = {
  document: FileText,
  deck: Presentation,
  image: ImageIcon,
  link: Link2,
  note: NotebookPen,
  sheet: Sheet,
  subscription: CreditCard,
}

function AssetRow({ asset, index }: { asset: Asset; index: number }) {
  const Icon = typeIcon[asset.type]
  const resource = asset.linkedResourceId ? getResource(asset.linkedResourceId) : undefined

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ ...panelSlideTransition, delay: index * 0.015 }}
      className="group relative flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-card"
    >
      {/* Continuity rail (Assets-only): a hairline running from the window's edge all
          the way to this row's icon — giving the impression it originates outside the
          space and overlaps every child. It reaches the edge by clearing the panel's
          content inset (`--panel-edge-inset`, = railWidth, set on the panel) plus this
          row's own left padding (px-2 = 8px), then stops at the icon. */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 h-px bg-border"
        style={{ left: "calc(-1 * (var(--panel-edge-inset, 48px) + 8px))", right: "calc(100% - 20px)" }}
      />
      <span
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground"
        style={resource?.tint ? { color: resource.tint, borderColor: `${resource.tint}33` } : undefined}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[12.5px] tracking-tight text-foreground">{asset.title}</span>
        <span className="truncate text-[11px] text-muted-foreground/70">{asset.preview}</span>
      </span>
      {resource && (
        <span className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {resource.name}
        </span>
      )}
    </motion.button>
  )
}

export function AssetPanel({ spaceId }: { spaceId: string }) {
  const { dataVersion } = useZeroNav()
  const assets = useMemo(() => getSpaceAssets(spaceId), [spaceId, dataVersion])

  return (
    // Keyed by context so switching nodes hard-swaps (instant, no cross-fade),
    // while add/remove within a context still animates.
    <div key={spaceId}>
      <AnimatePresence mode="popLayout" initial={false}>
        {assets.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-muted-foreground/60">
            No assets organized in this context yet.
          </p>
        ) : (
          assets.map((a, i) => <AssetRow key={a.id} asset={a} index={i} />)
        )}
      </AnimatePresence>
    </div>
  )
}
