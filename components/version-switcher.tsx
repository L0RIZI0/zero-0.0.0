"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

// Tiny monospace pill that lets you hop between the live build at `/` and the
// frozen pre-ribbon snapshot at `/1`. It reads the current route, highlights
// the active version, and links to the other — a discrete way to A/B the two
// builds inside one app instead of separate Electron builds or retyping URLs.
//
// Lives outside both the `zero` and `zero-000` trees on purpose: it is shared
// navigation chrome, not part of either frozen/live app's logic, so a single
// copy can sit in both headers.
const VERSIONS = [
  { href: "/", label: "0" },
  { href: "/1", label: "/1" },
] as const

export function VersionSwitcher() {
  const pathname = usePathname()
  // `/1` (and anything nested under it) is the snapshot; everything else is live.
  const active = pathname?.startsWith("/1") ? "/1" : "/"

  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-border bg-card/60 p-0.5 font-mono text-[10px] leading-none"
      role="group"
      aria-label="Zero version"
    >
      {VERSIONS.map((v) => {
        const isActive = active === v.href
        return (
          <Link
            key={v.href}
            href={v.href}
            aria-current={isActive ? "page" : undefined}
            title={v.href === "/" ? "Live version" : "Frozen pre-ribbon snapshot"}
            className={cn(
              "rounded-full px-1.5 py-1 transition-colors",
              isActive
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </Link>
        )
      })}
    </div>
  )
}
