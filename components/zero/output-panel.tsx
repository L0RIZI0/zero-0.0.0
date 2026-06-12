"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Plus, FileOutput } from "lucide-react"

interface Output {
  id: string
  title: string
}

/**
 * Outputs produced from the current space. Empty by default — the user can
 * create an output, which appears as a vertical list entry.
 */
export function OutputPanel({ spaceId }: { spaceId: string }) {
  const [outputs, setOutputs] = useState<Output[]>([])

  // Outputs are per-space; reset when context changes.
  useEffect(() => setOutputs([]), [spaceId])

  const createOutput = () =>
    setOutputs((prev) => [
      ...prev,
      { id: `o_${Date.now()}`, title: `Untitled output ${prev.length + 1}` },
    ])

  return (
    <div className="flex min-h-0 flex-col">
      {outputs.length > 0 && (
        <AnimatePresence initial={false}>
          {outputs.map((o, i) => (
            <motion.button
              key={o.id}
              type="button"
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: i * 0.02 }}
              className="group mb-1 flex w-full items-center gap-2.5 rounded-sm border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-card"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border text-muted-foreground">
                <FileOutput className="h-3.5 w-3.5" />
              </span>
              <span className="truncate text-[12.5px] tracking-tight text-foreground">
                {o.title}
              </span>
            </motion.button>
          ))}
        </AnimatePresence>
      )}

      <button
        type="button"
        onClick={createOutput}
        className="flex items-center gap-1.5 self-end rounded-sm px-1.5 py-1 text-[11px] text-muted-foreground/80 transition-colors hover:text-foreground"
      >
        <Plus className="h-3 w-3" />
        Create output
      </button>
    </div>
  )
}
