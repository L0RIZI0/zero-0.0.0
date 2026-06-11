"use client"

import { motion } from "motion/react"
import type { ContextItem } from "@/lib/zero/data"
import { layerTransition } from "@/lib/zero/motion"
import { NodeGlyph } from "./node-glyph"

/**
 * A pinned task or event in the SPACES row. Matches the SpaceButton footprint
 * (height + reduced width) so the row reads as one cohesive dock, with the
 * item's kind glyph and title.
 */
export function PinnedCard({
  item,
  onOpen,
  onContextMenu,
}: {
  item: ContextItem
  onOpen: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      style={{ borderRadius: 4 }}
      whileHover={{ scale: 1.03, boxShadow: "0 14px 32px -12px rgba(0,0,0,0.3)" }}
      transition={layerTransition}
      className="group relative flex h-[64px] w-[112px] shrink-0 flex-col justify-between overflow-hidden border border-border bg-card-solid px-2.5 py-2 text-left"
    >
      <span className="flex h-4 w-4 items-center justify-center text-foreground">
        <NodeGlyph kind={item.kind === "task" ? "task" : "event"} strokeWidth={item.kind === "task" ? 2 : 1.75} />
      </span>
      <h3 className="truncate text-[12px] font-medium leading-tight tracking-tight text-foreground">
        {item.title}
      </h3>
    </motion.button>
  )
}
