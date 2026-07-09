"use client"

import { useRef, useState } from "react"
import Image from "next/image"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "motion/react"
import { currentUser } from "@/lib/zero-002/data"
import { cn } from "@/lib/utils"

// Avatar diameter. The handle is no longer an in-flow element (it shows as a hover
// tooltip), so the name sits alone vertically centered on the avatar — the avatar is
// sized for that single line so it doesn't look oversized.
const AVATAR = 28

/**
 * The identity of Space 0 — the user. Lives permanently in the top-left of the shell
 * header: an avatar + name. The @handle is REVEALED AS A HOVER TOOLTIP (no element
 * animation on the identity itself), styled + animated like the peek-resources hover
 * label — a popover with a left→right clip-path wipe.
 */
export function UserIdentity({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null)

  const show = () => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // Anchor just below the identity, aligned to the avatar's horizontal center.
    setTip({ top: r.bottom + 6, left: r.left + AVATAR / 2 })
  }

  return (
    <div
      ref={ref}
      className={cn("flex min-w-0 items-center gap-2.5", className)}
      onMouseEnter={show}
      onMouseLeave={() => setTip(null)}
    >
      <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full border border-border">
        <Image
          src={currentUser.avatarUrl ?? "/loris-avatar.png"}
          alt={`${currentUser.name} avatar`}
          fill
          sizes="44px"
          className="object-cover"
        />
      </span>
      <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">
        {currentUser.name}
      </span>

      {/* Handle tooltip — same visual + clip-wipe animation as the peek-resources label.
          Portaled to the body so it's never clipped by the header chrome. */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {tip && (
              <motion.div
                data-handle-tip
                initial={{ clipPath: "inset(0 100% 0 0)", opacity: 0 }}
                animate={{ clipPath: "inset(0 0% 0 0)", opacity: 1 }}
                exit={{ clipPath: "inset(0 100% 0 0)", opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-none fixed z-[200] whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] leading-none text-popover-foreground shadow-md"
                style={{ top: tip.top, left: tip.left }}
              >
                @{currentUser.handle}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  )
}
