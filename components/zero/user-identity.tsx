"use client"

import { useState } from "react"
import Image from "next/image"
import { motion } from "motion/react"
import { currentUser } from "@/lib/zero/data"
import { cn } from "@/lib/utils"

// Avatar diameter at rest (handle hidden, name centered on avatar) vs on hover (handle
// revealed, two-line block — the avatar grows a touch to keep good proportions).
const AVATAR_REST = 32
const AVATAR_HOVER = 36

/**
 * The identity of Space 0 — the user. Lives permanently in the top-left of the shell
 * header: an avatar + name, with the @handle REVEALED ON HOVER.
 *
 * At rest the handle is hidden and the name sits alone, vertically centered on the avatar,
 * so the avatar is sized DOWN to stay proportional to a single line. On hover the handle row
 * expands (height 0→auto + fade), which grows the text column and — because the row is
 * `items-center` — pushes the name UP while the handle slides in beneath it; the avatar
 * simultaneously grows to keep good proportions against the now two-line block.
 *
 * Uses a JS hover state + motion rather than CSS `group-hover` because Tailwind v4 gates
 * hover utilities behind `@media (hover: hover)` (and the height:auto reveal needs a measured
 * animation anyway) — pointer events give a reliable, smoothly-animated reveal.
 */
export function UserIdentity({ className }: { className?: string }) {
  const [hovered, setHovered] = useState(false)
  const transition = { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const }

  return (
    <div
      className={cn("flex min-w-0 items-center gap-2.5", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <motion.span
        className="relative shrink-0 overflow-hidden rounded-full border border-border"
        initial={false}
        animate={{ width: hovered ? AVATAR_HOVER : AVATAR_REST, height: hovered ? AVATAR_HOVER : AVATAR_REST }}
        transition={transition}
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
        <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">
          {currentUser.name}
        </span>
        {/* Handle: collapsed to zero height + faded at rest, expands (measured height 0→auto)
            and fades in on hover, pushing the name up. overflow-hidden clips the collapse. */}
        <motion.span
          className="overflow-hidden"
          initial={false}
          animate={{ height: hovered ? "auto" : 0, opacity: hovered ? 1 : 0 }}
          transition={transition}
        >
          <span className="block truncate pt-0.5 text-[12px] text-muted-foreground/70">
            @{currentUser.handle}
          </span>
        </motion.span>
      </span>
    </div>
  )
}
