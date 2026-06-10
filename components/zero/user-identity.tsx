"use client"

import Image from "next/image"
import { currentUser } from "@/lib/zero/data"
import { cn } from "@/lib/utils"

/**
 * The identity of Space 0 — the user. Used as the root space title and, when a
 * layer is open, promoted into the header in place of the Zero logo.
 */
export function UserIdentity({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const avatar = {
    sm: "h-7 w-7",
    md: "h-9 w-9",
    lg: "h-11 w-11",
  }[size]
  const name = {
    sm: "text-[15px]",
    md: "text-[17px]",
    lg: "text-[22px]",
  }[size]
  const handle = {
    sm: "text-[11px]",
    md: "text-[12px]",
    lg: "text-[13px]",
  }[size]

  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className={cn("relative shrink-0 overflow-hidden rounded-full border border-border", avatar)}>
        <Image
          src={currentUser.avatarUrl ?? "/avatar-loris.png"}
          alt={`${currentUser.name} avatar`}
          fill
          sizes="44px"
          className="object-cover"
        />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={cn("truncate font-semibold tracking-tight text-foreground", name)}>
          {currentUser.name}
        </span>
        <span className={cn("truncate text-muted-foreground/70", handle)}>@{currentUser.handle}</span>
      </span>
    </div>
  )
}
