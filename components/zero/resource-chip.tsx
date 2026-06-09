"use client"

import { motion } from "motion/react"
import type { Resource } from "@/lib/zero/types"
import { contentTransition } from "@/lib/zero/motion"

export function ResourceChip({
  resource,
  index = 0,
}: {
  resource: Resource
  index?: number
}) {
  const tint = resource.tint ?? "var(--muted-foreground)"

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ ...contentTransition, delay: index * 0.02 }}
      title={`${resource.name} — ${resource.description}`}
      className="group flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card/70 py-1.5 pl-1.5 pr-3 transition-colors hover:border-foreground/20 hover:bg-card"
    >
      <span
        className="flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-medium text-background"
        style={{ backgroundColor: tint }}
      >
        {resource.icon}
      </span>
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[12px] tracking-tight text-foreground">{resource.name}</span>
        <span className="text-[10px] capitalize text-muted-foreground/70">{resource.kind}</span>
      </span>
    </motion.button>
  )
}
