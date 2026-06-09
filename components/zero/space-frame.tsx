"use client"

import { motion } from "motion/react"
import { X } from "lucide-react"
import type { Space } from "@/lib/zero/types"
import { getChildSpaces } from "@/lib/zero/data"
import { layerTransition, spaceLayoutId, spaceTitleId, contentTransition } from "@/lib/zero/motion"
import { TimelineStrip } from "./timeline-strip"
import { TaskList } from "./task-list"
import { ResourceStrip } from "./resource-strip"
import { AssetPanel } from "./asset-panel"
import { SpaceButton } from "./space-button"

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

  return (
    <motion.div
      layoutId={spaceLayoutId(space.id)}
      transition={layerTransition}
      style={{ borderRadius: isRoot ? 0 : 22 }}
      className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-background shadow-[0_24px_80px_-32px_rgba(40,32,24,0.35)]"
    >
      {/* accent edge — shares element with the button's accent strip */}
      <motion.span
        layoutId={`${spaceLayoutId(space.id)}-accent`}
        transition={layerTransition}
        className="absolute left-0 top-0 z-10 h-full w-[3px]"
        style={{ backgroundColor: accent }}
      />

      {/* Frame header */}
      <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3">
        <div className="flex min-w-0 flex-col">
          <motion.h2
            layoutId={spaceTitleId(space.id)}
            transition={layerTransition}
            className="truncate font-serif text-[24px] leading-tight tracking-tight text-foreground"
          >
            {isRoot ? "All Life" : space.name}
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

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
          {/* Left column: child spaces (or assets at leaf level) */}
          <div className="flex min-h-0 flex-col">
            {children.length > 0 ? (
              <>
                <h3 className="mb-2 px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {isRoot ? "Spaces" : "Subspaces"}
                </h3>
                <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto pr-1 no-scrollbar sm:grid-cols-2">
                  {children.map((child) => (
                    <SpaceButton key={child.id} space={child} onOpen={onOpenChild} />
                  ))}
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 rounded-xl border border-border bg-card/40 p-3">
                <AssetPanel spaceId={space.id} />
              </div>
            )}
          </div>

          {/* Right column: tasks always; assets too when there are child spaces */}
          <div className="flex min-h-0 flex-col gap-4">
            <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card/40 p-3">
              <TaskList spaceId={space.id} />
            </div>
            {children.length > 0 && (
              <div className="hidden min-h-0 flex-1 flex-col rounded-xl border border-border bg-card/40 p-3 xl:flex">
                <AssetPanel spaceId={space.id} />
              </div>
            )}
          </div>
        </div>

        <ResourceStrip spaceId={space.id} />
      </motion.div>
    </motion.div>
  )
}
