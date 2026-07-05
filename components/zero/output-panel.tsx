"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "motion/react"
import { Plus, FileOutput } from "lucide-react"
import { panelSlideTransition, MORPH_SECONDS, MORPH_EASE } from "@/lib/zero/motion"
import { cn } from "@/lib/utils"

interface Output {
  id: string
  title: string
}

const MORPH = { duration: MORPH_SECONDS, ease: MORPH_EASE }
/** Shrunk peek-title size == the floating hover-label size. */
const PEEK_LABEL_PX = 11
/** Distance from a row's left edge to its glyph-tile center: scroll px-2 (8) + row px-2
 *  (8) + half the 28px tile (14). Used to offset the losange onto the right peek strip. */
const GLYPH_CENTER = 30
/** Publications carry no tint; the pure peek glyph uses a neutral fill. */
const NEUTRAL_TINT = "#8A8A8A"

type PeekHover = { title: string; top: number; left: number } | null

/**
 * Publications produced from the current space (stuff that goes OUT: publications,
 * output, results). Empty by default — the user can create one, which appears as a
 * vertical list entry.
 *
 * PEEK MODE mirrors AssetPanel: when this panel is open but its entity becomes a covered
 * ancestor, each publication morphs into a small filled losange on the window's RIGHT
 * peek strip (usually there are none, so nothing shows — wired for symmetry). Hovering a
 * peek losange from the focused child shows its title as a floating label to its left.
 */
export function OutputPanel({
  spaceId,
  peek = false,
  spineWidth = 48,
  panelWidth = 230,
}: {
  spaceId: string
  /** Collapse publications into peek losanges on the window's right peek strip. */
  peek?: boolean
  /** Width of the peek strip the losanges center on (the window's visible bleed). */
  spineWidth?: number
  /** Panel body width beyond the spine — needed to offset a losange onto the right edge. */
  panelWidth?: number
}) {
  const [outputs, setOutputs] = useState<Output[]>([])
  const [hover, setHover] = useState<PeekHover>(null)

  // Publications are per-space; reset when context changes.
  useEffect(() => setOutputs([]), [spaceId])

  const createOutput = () =>
    setOutputs((prev) => [...prev, { id: `o_${Date.now()}`, title: `Untitled publication ${prev.length + 1}` }])

  // Slide right so the glyph lands centered on the right peek strip (whose center sits at
  // panelWidth + spineWidth/2 from the panel's left edge).
  const peekX = panelWidth + spineWidth / 2 - GLYPH_CENTER

  return (
    <div className="flex min-h-0 flex-col">
      {outputs.length > 0 && (
        <AnimatePresence initial={false}>
          {outputs.map((o) => (
            <PublicationRow key={o.id} output={o} peek={peek} peekX={peekX} onHover={setHover} />
          ))}
        </AnimatePresence>
      )}

      <motion.button
        type="button"
        onClick={createOutput}
        initial={false}
        animate={{ opacity: peek ? 0 : 1 }}
        transition={peek ? { duration: 0.25, ease: "easeOut" } : MORPH}
        className={cn(
          "flex items-center gap-1.5 self-end rounded-sm px-1.5 py-1 text-[11px] text-muted-foreground/80 transition-colors hover:text-foreground",
          peek && "pointer-events-none",
        )}
      >
        <Plus className="h-3 w-3" />
        Create publication
      </motion.button>

      {/* Floating hover label — to the LEFT of a right-peek losange. PORTALED to <body>
          to escape the panel's transformed + overflow-hidden clip container (a fixed child
          there gets clipped/mis-anchored). z-[200] paints above the focused child window.
          Shows the publication ICON beside the title and REVEALS right→left (mirror of the
          left panel) so it grows out of the losange sitting to its right.
          AnimatePresence lives INSIDE the portal — see AssetPanel note: wrapping the
          createPortal call hides the motion.div, leaving it stuck fully clipped/invisible. */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {hover && (
              <motion.div
                key={hover.title}
                data-peek-label
                initial={{ clipPath: "inset(0 0 0 100%)", opacity: 0 }}
                animate={{ clipPath: "inset(0 0 0 0%)", opacity: 1 }}
                exit={{ clipPath: "inset(0 0 0 100%)", opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-none fixed z-[200] flex -translate-x-full -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-popover py-1 pl-2 pr-1.5 leading-none text-popover-foreground shadow-md"
                style={{ top: hover.top, left: hover.left, fontSize: PEEK_LABEL_PX }}
              >
                {hover.title}
                <FileOutput style={{ width: 13, height: 13 }} className="text-muted-foreground" />
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  )
}

function PublicationRow({
  output,
  peek,
  peekX,
  onHover,
}: {
  output: Output
  peek: boolean
  peekX: number
  onHover: (h: PeekHover) => void
}) {
  const tileRef = useRef<HTMLSpanElement>(null)

  const showLabel = () => {
    const el = tileRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    onHover({ title: output.title, top: r.top + r.height / 2, left: r.left - 10 })
  }

  return (
    <motion.button
      type="button"
      initial={false}
      animate={{ x: peek ? peekX : 0, marginBottom: peek ? 2 : 4, paddingTop: peek ? 3 : 8, paddingBottom: peek ? 3 : 8 }}
      transition={MORPH}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-sm border border-transparent px-2 text-left",
        peek ? "pointer-events-none" : "pointer-events-auto transition-colors hover:border-border hover:bg-card",
      )}
    >
      <motion.span
        ref={tileRef}
        initial={false}
        animate={{
          width: peek ? 8 : 28,
          height: peek ? 8 : 28,
          borderRadius: peek ? 0 : 3,
          rotate: peek ? 45 : 0,
          backgroundColor: peek ? NEUTRAL_TINT : "rgba(0,0,0,0)",
          borderColor: peek ? NEUTRAL_TINT : "var(--border)",
        }}
        transition={MORPH}
        onPointerEnter={peek ? showLabel : undefined}
        onPointerLeave={peek ? () => onHover(null) : undefined}
        onClick={peek ? (e) => e.stopPropagation() : undefined}
        className={cn(
          "flex shrink-0 items-center justify-center border text-muted-foreground",
          peek && "pointer-events-auto",
        )}
        style={peek ? { position: "relative", zIndex: 30 } : undefined}
      >
        <motion.span initial={false} animate={{ opacity: peek ? 0 : 1 }} transition={MORPH} className="flex">
          <FileOutput className="h-3.5 w-3.5" />
        </motion.span>
      </motion.span>
      <motion.span
        initial={false}
        animate={{ opacity: peek ? 0 : 1, fontSize: peek ? PEEK_LABEL_PX : 12.5, y: peek ? 4 : 0 }}
        transition={MORPH}
        className="truncate tracking-tight text-foreground"
      >
        {output.title}
      </motion.span>
    </motion.button>
  )
}
