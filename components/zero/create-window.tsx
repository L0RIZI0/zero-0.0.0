"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { Check, ChevronDown, X } from "lucide-react"
import { NodeGlyph, NODE_KIND_META, type NodeKind } from "./node-glyph"
import { addTask, addSpace, addEvent, addInstant } from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { contentTransition } from "@/lib/zero/motion"
import { CaretTextInput } from "./caret-text-input"
import { cn } from "@/lib/utils"

const KIND_ORDER: NodeKind[] = ["task", "space", "event", "instant"]

/**
 * A focused window for creating a new task / space / event in the current
 * context. The glyph on the left of the title is a dropdown that picks the
 * node kind (square / hexagon / triangle), and the user types a title then
 * saves or discards.
 */
export function CreateWindow({
  spaceId,
  defaultKind = "task",
  onClose,
}: {
  spaceId: string
  defaultKind?: NodeKind
  onClose: () => void
}) {
  const { notifyDataChanged } = useZeroNav()
  const [kind, setKind] = useState<NodeKind>(defaultKind)
  const [title, setTitle] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Esc discards; Cmd/Ctrl+Enter saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const canSave = title.trim().length > 0

  const handleSave = () => {
    const name = title.trim()
    if (!name) return
    // Create the entity in the CURRENT context and just close — the new item
    // lands in the DO list (or timeline, for events) where the user already is,
    // rather than yanking focus by wide-opening the new entity's own window.
    if (kind === "task") {
      addTask({ title: name, spaceId })
    } else if (kind === "space") {
      addSpace({ name, parentId: spaceId })
    } else if (kind === "event") {
      addEvent({ title: name, spaceId })
    } else {
      addInstant({ title: name, spaceId })
    }
    notifyDataChanged()
    onClose()
  }

  if (!mounted) return null

  // Portal to <body> so the fixed overlay escapes the transformed window-frame
  // ancestors (motion's transforms trap `position: fixed` and stacking).
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[150] flex items-start justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={contentTransition}
    >
      {/* scrim */}
      <button
        type="button"
        aria-label="Discard"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/20 backdrop-blur-[2px]"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Create new"
        initial={{ opacity: 0, y: -10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={contentTransition}
        style={{ borderRadius: 6 }}
        className="relative mt-[14vh] w-full max-w-[440px] border border-border bg-card-solid text-card-foreground shadow-[0_28px_90px_-30px_rgba(0,0,0,0.65)]"
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            New {NODE_KIND_META[kind].label}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Discard"
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Title row: glyph dropdown → title input. (No continuity rail here —
            that rail belongs only to the Inputs list inside a window.) */}
        <div className="relative mt-3 flex items-center gap-3 px-5 py-3">
          <div className="relative shrink-0">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              aria-label={`Type: ${NODE_KIND_META[kind].label}. Change type`}
              onClick={() => setMenuOpen((o) => !o)}
              className={cn(
                "flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1 text-foreground transition-colors hover:border-foreground/30",
                menuOpen && "border-foreground/40",
              )}
            >
              <span className="flex h-5 w-5 items-center justify-center text-foreground">
                <NodeGlyph kind={kind} />
              </span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.ul
                  role="listbox"
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.14, ease: [0.22, 0.61, 0.36, 1] }}
                  style={{ borderRadius: 6 }}
                  className="absolute left-0 top-[calc(100%+6px)] z-10 w-[200px] overflow-hidden border border-border bg-popover p-1 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.55)]"
                >
                  {KIND_ORDER.map((k) => {
                    const selected = k === kind
                    return (
                      <li key={k}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setKind(k)
                            setMenuOpen(false)
                            inputRef.current?.focus()
                          }}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-[4px] px-2 py-1.5 text-left transition-colors",
                            selected ? "bg-secondary" : "hover:bg-secondary/60",
                          )}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-foreground">
                            <NodeGlyph kind={k} />
                          </span>
                          <span className="flex min-w-0 flex-col">
                            <span className="text-[13px] font-medium leading-tight text-foreground">
                              {NODE_KIND_META[k].label}
                            </span>
                            <span className="truncate text-[11px] text-muted-foreground">
                              {NODE_KIND_META[k].description}
                            </span>
                          </span>
                          {selected && <Check className="ml-auto h-3.5 w-3.5 text-foreground" />}
                        </button>
                      </li>
                    )
                  })}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>

          <CaretTextInput
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) handleSave()
            }}
            placeholder={`New ${NODE_KIND_META[kind].label.toLowerCase()}…`}
            wrapperClassName="flex-[3]"
            className="bg-transparent text-[15px] tracking-tight text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              canSave
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "cursor-not-allowed bg-secondary text-muted-foreground/60",
            )}
          >
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
