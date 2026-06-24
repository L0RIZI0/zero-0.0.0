"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { X } from "lucide-react"
import { getEntity, getSpace } from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { MORPH_EASE } from "@/lib/zero/motion"
import { NodeGlyph } from "./node-glyph"
import { EntityBody } from "./entity-body"
import type { NodeKind } from "./node-glyph"

// The spotlight is deliberately SNAPPIER than the in-place window morph (which
// runs on the heavy 2s telescopic beat). A standalone overlay that grows from a
// point wants a crisp, lively pop — long enough to read as "emerging from behind
// the chip", short enough to feel instant.
const ENTER_S = 0.42
const EXIT_S = 0.3

/** Comfortable centered footprint for the overlay card, clamped to the viewport. */
function useTargetRect() {
  const [vp, setVp] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const measure = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [])
  return useMemo(() => {
    const w = Math.min(560, vp.w - 32)
    const h = Math.min(620, vp.h - 96)
    const left = (vp.w - w) / 2
    const top = (vp.h - h) / 2
    return { left, top, width: w, height: h, ready: vp.w > 0 }
  }, [vp])
}

/**
 * SPOTLIGHT OVERLAY — opens a single entity (e.g. from a timeline chip) as a
 * standalone card floating ON TOP of the current view, rather than nesting it in
 * the navigation stack. It grows from a point behind the launching chip
 * (`spotlight.originRect`) and shrinks back toward it on close, while the view
 * beneath stays exactly as the user left it.
 *
 * It reuses the real `EntityBody`, so the checklist, Inputs/Outputs rails and
 * task toggles are fully live — this is the same working surface a nested window
 * shows, just presented as a self-contained sheet.
 */
export function SpotlightWindow() {
  const { spotlight, closeSpotlight } = useZeroNav()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Close on Escape (pointer dismissal is handled by the backdrop below).
  useEffect(() => {
    if (!spotlight) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSpotlight()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [spotlight, closeSpotlight])

  const target = useTargetRect()
  const entity = spotlight ? getEntity(spotlight.id) : undefined

  if (!mounted) return null

  // transformOrigin (relative to the card's own box) placed at the launching
  // chip's CENTER, so the scale animation reads as the card emerging from /
  // collapsing back toward the point the chip occupies — without ever touching
  // the chip itself.
  let originX = "50%"
  let originY = "50%"
  if (spotlight && target.ready) {
    const cx = spotlight.originRect.left + spotlight.originRect.width / 2
    const cy = spotlight.originRect.top + spotlight.originRect.height / 2
    originX = `${cx - target.left}px`
    originY = `${cy - target.top}px`
  }

  const accent = entity ? (getSpace(entity.id)?.accent ?? entity.accent) : undefined
  const isSpace = entity?.kind === "space"

  return createPortal(
    <AnimatePresence>
      {spotlight && entity && target.ready && (
        <div className="fixed inset-0 z-[90]">
          {/* Scrim — a faint dim so the overlay reads as lifted above the prior
              view; clicking it dismisses the spotlight. */}
          <motion.div
            className="absolute inset-0 bg-background/55 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: EXIT_S, ease: MORPH_EASE }}
            onPointerDown={closeSpotlight}
          />

          {/* The card. Grows from behind the chip via transformOrigin + scale. */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={entity.title}
            className="absolute flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)]"
            style={{
              left: target.left,
              top: target.top,
              width: target.width,
              height: target.height,
              transformOrigin: `${originX} ${originY}`,
            }}
            initial={{ opacity: 0, scale: 0.08 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.08 }}
            transition={{
              scale: { duration: ENTER_S, ease: MORPH_EASE },
              opacity: { duration: ENTER_S * 0.5, ease: "easeOut" },
            }}
          >
            {/* Header — glyph + title, mirroring the leaf-window header, with a
                close button in the top-right. */}
            <div className="flex items-center gap-2.5 px-5 pb-2 pt-4">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center"
                style={accent ? { color: accent } : undefined}
              >
                <NodeGlyph kind={entity.kind as NodeKind} strokeWidth={1.75} />
              </span>
              <h2 className="flex-1 truncate text-[18px] font-semibold tracking-tight text-foreground">
                {entity.title}
              </h2>
              <button
                type="button"
                onClick={closeSpotlight}
                aria-label={`Close ${entity.title}`}
                className="flex size-6 items-center justify-center text-muted-foreground opacity-50 transition-all ease-out hover:text-foreground hover:opacity-100"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>

            {/* The real working surface — live do-list, dock and rails. */}
            <div className="flex min-h-0 flex-1 flex-col">
              <EntityBody entityId={entity.id} active centerList floatDock={isSpace} />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
