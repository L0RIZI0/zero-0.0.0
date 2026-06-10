"use client"

import { motion } from "motion/react"
import { X } from "lucide-react"
import type { Space } from "@/lib/zero/types"
import { layerTransition, spaceLayoutId, spaceTitleId, contentTransition } from "@/lib/zero/motion"
import { SpaceButton } from "./space-button"
import { ContextBody } from "./context-body"
import { getChildSpaces } from "@/lib/zero/data"

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
      style={{ borderRadius: 4 }}
      className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-background shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
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

      {/* Frame header. The root identity now lives in the global shell header,
          so Space 0 needs no title row — only child layers show a title. */}
      {!isRoot && (
        <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3">
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

          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${space.name}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Frame body — fades/translates in independently of the morph */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...contentTransition, delay: 0.1 }}
        className={`flex min-h-0 flex-1 flex-col gap-4 px-6 pb-4 ${isRoot ? "pt-5" : ""}`}
      >
        <ContextBody nodeId={space.id} accent={typeof accent === "string" ? accent : undefined}>
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
        </ContextBody>
      </motion.div>
    </motion.div>
  )
}
