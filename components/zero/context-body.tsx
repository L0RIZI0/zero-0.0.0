"use client"

import { TimelineStrip } from "./timeline-strip"
import { TaskList } from "./task-list"
import { AssetPanel } from "./asset-panel"
import { OutputPanel } from "./output-panel"
import { CollapsibleColumn } from "./collapsible-column"
import { getSpaceAssets } from "@/lib/zero/data"

/**
 * The shared working surface used by both Spaces and Tasks: a timeline, an
 * optional inset (e.g. the child-spaces row), and a three-column Inputs · Tasks
 * · Outputs area. Side slots are a fixed width so the center Tasks column — and
 * its centered heading — never shifts when a panel expands or collapses.
 */
export function ContextBody({
  nodeId,
  accent,
  children,
}: {
  nodeId: string
  accent?: string
  children?: React.ReactNode
}) {
  const assetCount = getSpaceAssets(nodeId).length

  return (
    <>
      <TimelineStrip spaceId={nodeId} accent={accent} />

      {children}

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Body-centered Tasks heading — unaffected by panel widths. */}
        <div className="mb-1 flex items-center justify-center">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Tasks
          </h2>
        </div>

        <div className="flex min-h-[180px] flex-1 gap-4">
          <div className="hidden w-[230px] shrink-0 md:flex">
            <CollapsibleColumn title="Inputs" side="left" count={assetCount}>
              <AssetPanel spaceId={nodeId} />
            </CollapsibleColumn>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center">
            <div className="flex min-h-0 w-full max-w-[80%] flex-1 flex-col rounded-sm border border-border bg-card/30 p-2">
              <TaskList spaceId={nodeId} />
            </div>
          </div>

          <div className="hidden w-[230px] shrink-0 md:flex">
            <CollapsibleColumn title="Outputs" side="right" count={0}>
              <OutputPanel spaceId={nodeId} />
            </CollapsibleColumn>
          </div>
        </div>
      </div>
    </>
  )
}
