"use client"

import Image from "next/image"
import { currentUser } from "@/lib/zero/data"
import { cn } from "@/lib/utils"

/**
 * The identity of Space 0 — the user. Lives permanently in the top-left of the
 * shell header: a 36px avatar + name + @handle. entity0's header no longer
 * compacts on dive (it's a constant-height full-bleed backdrop chrome), so this
 * renders a single fixed size.
 */
export function UserIdentity({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border">
        <Image
          src={currentUser.avatarUrl ?? "/loris-avatar.png"}
          alt={`${currentUser.name} avatar`}
          fill
          sizes="44px"
          className="object-cover"
        />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">
          {currentUser.name}
        </span>
        <span className="truncate text-[12px] text-muted-foreground/70">
          @{currentUser.handle}
        </span>
      </span>
    </div>
  )
}
