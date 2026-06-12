"use client"

import { motion, AnimatePresence } from "motion/react"
import { getEntity } from "@/lib/zero/data"
import { isTaskId, useZeroNav } from "@/lib/zero/nav-store"
import {
  contentTransition,
  layerTransition,
  spaceTitleId,
  taskTitleId,
  eventTitleId,
  instantTitleId,
  eventRowTitleId,
  instantRowTitleId,
} from "@/lib/zero/motion"
import { NodeGlyph } from "./node-glyph"

/**
 * The navigation path, shown as a vertical indented stack directly under the
 * user identity in the top-left. Only *ancestor* titles live here, small and
 * indented one step per depth — the active (deepest) layer renders its own
 * title big inside its frame. The shared title `layoutId` morphs each title
 * from "big inside frame" to "small in this stack" as the user dives deeper.
 */
export function PathStack() {
  const { stack, goToDepth, openSourceOf } = useZeroNav()

  // Depth 0 is Space 0 (the user identity itself, shown in the header). The
  // active (last) layer's title lives inside its own frame, so it is excluded.
  const activeDepth = stack.length - 1
  if (activeDepth < 1) return null

  return (
    <nav aria-label="Open path" className="flex flex-col gap-0.5 px-5 pb-2 pt-0.5">
      <AnimatePresence initial={false}>
        {stack.map((nodeId, depth) => {
          if (depth === 0 || depth === activeDepth) return null
          const isTask = isTaskId(nodeId)
          const node = getEntity(nodeId)
          const label = node?.title
          if (!label) return null
          const accent = node?.accent
          // Title morph id must match the kind so the label travels from the
          // frame title into this crumb (space / task / event / instant). For
          // events/instants it must also match the SOURCE the frame adopted
          // (row vs timeline), or the label won't travel.
          const fromRow = openSourceOf(nodeId) === "row"
          const titleLayoutId =
            node?.kind === "event"
              ? fromRow
                ? eventRowTitleId(nodeId)
                : eventTitleId(nodeId)
              : node?.kind === "instant"
                ? fromRow
                  ? instantRowTitleId(nodeId)
                  : instantTitleId(nodeId)
                : isTask
                  ? taskTitleId(nodeId)
                  : spaceTitleId(nodeId)

          return (
            <motion.div
              key={nodeId}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={contentTransition}
              style={{ paddingLeft: (depth - 1) * 16 }}
              className="flex items-center overflow-hidden"
            >
              <span
                aria-hidden
                className="mr-2 h-3 w-[3px] shrink-0 rounded-full"
                style={{ backgroundColor: accent ?? "var(--border)" }}
              />
              {node && (
                <span
                  aria-hidden
                  className="mr-1.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground"
                >
                  <NodeGlyph kind={node.kind} strokeWidth={node.kind === "task" ? 2 : 1.75} />
                </span>
              )}
              <motion.button
                type="button"
                layoutId={titleLayoutId}
                transition={layerTransition}
                onClick={() => goToDepth(depth)}
                className="max-w-[240px] truncate rounded-md py-0.5 text-left text-[12.5px] tracking-tight text-muted-foreground transition-colors hover:text-foreground"
              >
                {label}
              </motion.button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </nav>
  )
}
