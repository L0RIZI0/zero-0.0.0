"use client"

import { motion } from "motion/react"
import { X } from "lucide-react"
import type { Space } from "@/lib/zero/types"
import { layerTransition, spaceLayoutId, spaceTitleId, contentTransition, userIdentityLayoutId } from "@/lib/zero/motion"
import { useZeroNav } from "@/lib/zero/nav-store"
import { TimelineStrip } from "./timeline-strip"
import { TaskList } from "./task-list"
import { ResourceStrip } from "./resource-strip"
import { AssetPanel } from "./asset-panel"
import { SpaceButton } from "./space-button"
import { CollapsibleColumn } from "./collapsible-column"
import { OutputPanel } from "./output-panel"
import { UserIdentity } from "./user-identity"
import { getChildSpaces, getSpaceAssets } from "@/lib/zero/data"

export function SpaceFrame({
  space,
  isRoot,
  onOpenChild,
  onClose,
}: {
  space: Space
  isRoot: boolean
  onOpenChild: (spaceId: string) => void
  onClose: () => void
}) {
  const accent = space.accent ?? "var(--accent)"
  const children = getChildSpaces(space.id)
  const assetCount = getSpaceAssets(space.id).length
  const { stack } = useZeroNav()
  // The root identity morphs to the header when a layer is open. While a layer
  // is open the header owns the shared element, so the root frame must not also
  // render it with the same layoutId (that would create a duplicate).
  const identityInHeader = stack.length > 1

  return (
    <motion.div
      layoutId={spaceLayoutId(space.id)}
      transition={layerTransition}
      style={{ borderRadius: isRoot ? 0 : 4 }}
      className={`relative flex h-full w-full flex-col overflow-hidden bg-background shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)] ${
        isRoot ? "" : "border border-border"
      }`}
    >
      {/* accent edge — shares element with the button's accent strip.
          Space 0 (root) has no accent edge. */}
      {!isRoot && (
        <motion.span
          layoutId={`${spaceLayoutId(space.id)}-accent`}
          transition={layerTransition}
          className="absolute left-0 top-0 z-10 h-full w-[3px]"
          style={{ backgroundColor: accent }}
        />
      )}

      {/* Frame header — extra bottom space at root so the user identity isn't
          crowded against the timeline below it. */}
      <div
        className={`flex items-center justify-between gap-3 px-6 pt-5 ${
          isRoot && !identityInHeader ? "pb-8" : "pb-3"
        }`}
      >
        {isRoot ? (
          // While a layer is open the header hosts the identity; render an
          // invisible placeholder here to preserve the header's height/layout.
          identityInHeader ? (
            <div aria-hidden className="h-11" />
          ) : (
            <UserIdentity size="lg" layoutId={userIdentityLayoutId} />
          )
        ) : (
          <div className="flex min-w-0 flex-col">
            <motion.h2
              layoutId={spaceTitleId(space.id)}
              transition={layerTransition}
              className="truncate text-[24px] leading-tight tracking-tight text-foreground"
            >
              {space.name}
            </motion.h2>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...contentTransition, delay: 0.08 }}
              className="mt-0.5 truncate text-[12.5px] text-muted-foreground"
            >
              {space.description}
            </motion.p>
          </div>
        )}

        {!isRoot && (
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${space.name}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Frame body — fades/translates in independently of the morph */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...contentTransition, delay: 0.1 }}
        className="flex min-h-0 flex-1 flex-col gap-4 px-6 pb-4"
      >
        <TimelineStrip spaceId={space.id} accent={typeof accent === "string" ? accent : undefined} />

        {/* Child spaces — a centered horizontal row beneath the timeline. */}
        {children.length > 0 && (
          <div className="flex flex-col items-center">
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {isRoot ? "Spaces" : "Subspaces"}
            </h3>
            <div className="flex w-full flex-wrap items-stretch justify-center gap-3 overflow-x-auto pb-1 no-scrollbar">
              {children.map((child) => (
                <SpaceButton key={child.id} space={child} onOpen={onOpenChild} />
              ))}
            </div>
          </div>
        )}

        {/* Inputs (far left) · Tasks (center) · Outputs (far right).
            Side slots are a fixed width so the center column — and its centered
            TASKS label — never shifts when a panel expands or collapses. */}
        <div className="flex min-h-[180px] flex-1 gap-4">
          <div className="hidden w-[230px] shrink-0 md:flex">
            <CollapsibleColumn title="Inputs" side="left" count={assetCount}>
              <AssetPanel spaceId={space.id} />
            </CollapsibleColumn>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center">
            <div className="flex min-h-0 w-full max-w-[80%] flex-1 flex-col">
              <TaskList spaceId={space.id} />
            </div>
          </div>

          <div className="hidden w-[230px] shrink-0 md:flex">
            <CollapsibleColumn title="Outputs" side="right" count={0}>
              <OutputPanel spaceId={space.id} />
            </CollapsibleColumn>
          </div>
        </div>

          <div className="flex min-h-[180px] flex-1 gap-4">
            <div className="hidden shrink-0 md:flex">
              <CollapsibleColumn title="Inputs" side="left" count={assetCount}>
                <AssetPanel spaceId={space.id} />
              </CollapsibleColumn>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center">
              <div className="flex min-h-0 w-full max-w-[80%] flex-1 flex-col">
                <TaskList spaceId={space.id} />
              </div>
            </div>

            <div className="hidden shrink-0 md:flex">
              <CollapsibleColumn title="Outputs" side="right" count={0}>
                <OutputPanel spaceId={space.id} />
              </CollapsibleColumn>
            </div>
          </div>
        </div>

        <ResourceStrip spaceId={space.id} />
      </motion.div>
    </motion.div>
  )
}
