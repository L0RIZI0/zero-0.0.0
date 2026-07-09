"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

// Tiny monospace pill that lets you hop between the routes: the live root canvas
// at `/` (label "0"), the frozen pre-ribbon snapshot at `/1`, and the frozen
// log-model app at `/2`. It reads the current route, highlights the active
// version, and links to the others — a discrete way to A/B the builds inside one
// app instead of separate Electron builds or retyping URLs.
//
// Lives outside the `zero`, `zero-000`, and `zero-002` trees on purpose: it is
// shared navigation chrome, not part of any frozen/live app's logic, so a single
// copy can sit in every header.
const VERSIONS = [
  { href: "/", label: "0", title: "Live root canvas" },
  { href: "/1", label: "/1", title: "Frozen pre-ribbon snapshot" },
  { href: "/2", label: "/2", title: "Frozen log-model app" },
] as const

export function VersionSwitcher() {
  const pathname = usePathname()
  // `/1` and `/2` (and anything nested) are the frozen snapshots; the exact root
  // `/` is the live canvas.
  const active = pathname?.startsWith("/1") ? "/1" : pathname?.startsWith("/2") ? "/2" : "/"

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
            title={v.title}
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
