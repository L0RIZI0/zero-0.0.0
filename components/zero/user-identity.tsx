"use client"

import Image from "next/image"
import { motion, AnimatePresence } from "motion/react"
import { currentUser } from "@/lib/zero/data"
import { layerTransition } from "@/lib/zero/motion"
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
  // 36px at rest, 24px (~a third smaller) when compact.
  const avatarSize = compact ? 24 : 36

  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
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
          className="truncate font-semibold tracking-tight text-foreground"
          initial={false}
          animate={{ fontSize: compact ? 15 : 17 }}
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
    </div>
  )
}
