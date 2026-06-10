"use client"

import { ShellHeader } from "./shell-header"
import { PathStack } from "./breadcrumb-path"
import { SpaceLayerStack } from "./space-layer-stack"
import { ZeroNavProvider } from "@/lib/zero/nav-store"

export function ZeroShell({ dateLabel }: { dateLabel: string }) {
  return (
    <ZeroNavProvider>
      <main className="flex h-dvh w-full flex-col overflow-hidden bg-background">
        <ShellHeader dateLabel={dateLabel} />
        <PathStack />
        <div className="relative min-h-0 flex-1 px-2 pb-2 sm:px-3 sm:pb-3">
          <div className="relative h-full w-full overflow-hidden rounded-md bg-secondary/40">
            <SpaceLayerStack />
          </div>
        </div>
      </main>
    </ZeroNavProvider>
  )
}
