"use client"

import Image from "next/image"
import { motion, AnimatePresence } from "motion/react"
import { currentUser } from "@/lib/zero-000/data"
import { layerTransition } from "@/lib/zero-000/motion"
import { cn } from "@/lib/utils"

/**
 * The identity of Space 0 — the user. Lives permanently in the top-left of the
 * shell header. When `compact` (deep dives, shell stage 2+) the avatar shrinks
 * by ~a third and the @handle is dropped, leaving a tidy avatar + name so the
 * chrome stays discrete while the focus window gets more room.
 */
export function UserIdentity({
  compact = false,
  className,
}: {
  compact?: boolean
  className?: string
}) {
  // 36px at rest, 21px when compact (a touch smaller than before).
  const avatarSize = compact ? 21 : 36

  return (
    <motion.div
      className={cn("flex min-w-0 items-center", className)}
      initial={false}
      // Pull the name a touch closer to the avatar when compact (8px vs 10px).
      animate={{ gap: compact ? 8 : 10 }}
      transition={layerTransition}
    >
      <motion.span
        className="relative shrink-0 overflow-hidden rounded-full border border-border"
        initial={false}
        animate={{ width: avatarSize, height: avatarSize }}
        transition={layerTransition}
      >
        <Image
          src={currentUser.avatarUrl ?? "/loris-avatar.png"}
          alt={`${currentUser.name} avatar`}
          fill
          sizes="44px"
          className="object-cover"
        />
      </motion.span>
      <span className="flex min-w-0 flex-col leading-tight">
        <motion.span
          // Less prominent when compact: slightly smaller, lighter weight, and a
          // dimmer color so the identity recedes as the focus window takes over.
          className={cn(
            "truncate tracking-tight transition-colors",
            compact ? "font-medium text-foreground/65" : "font-semibold text-foreground",
          )}
          initial={false}
          animate={{ fontSize: compact ? 12.5 : 15 }}
          transition={layerTransition}
        >
          {currentUser.name}
        </motion.span>
        <AnimatePresence initial={false}>
          {!compact && (
            <motion.span
              key="handle"
              className="truncate text-[12px] text-muted-foreground/70"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={layerTransition}
            >
              @{currentUser.handle}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.div>
  )
}
