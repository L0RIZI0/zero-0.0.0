"use client"

import { ShellHeader } from "./shell-header"
import { WorkSurface } from "./work-surface"
import { ThemeToggle } from "./theme-toggle"
import { ZeroNavProvider } from "@/lib/zero/nav-store"

export function ZeroShell() {
  return (
    <ZeroNavProvider>
      <main className="flex h-dvh w-full flex-col overflow-hidden bg-background">
        <ShellHeader />
        <div className="relative min-h-0 flex-1 px-2 pb-2 sm:px-3 sm:pb-3">
          <WorkSurface />
        </div>
      </main>
      <ThemeToggle />
    </ZeroNavProvider>
  )
}
