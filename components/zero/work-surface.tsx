"use client"

import { SpaceLayerStack } from "./space-layer-stack"
import { FrontContent } from "./front-content"

/**
 * The composed work surface, three stacked layers:
 *   A — borderless Space 0 background (the rounded secondary panel itself)
 *   B — SpaceLayerStack: bordered window frames for child spaces/tasks
 *   C — FrontContent: the single persistent timeline / tasks / inputs / outputs
 *
 * Layer C sits above B so the frontmost content reads in front of the child
 * window's border, while the frame still owns its title band and spaces dock.
 */
export function WorkSurface() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-md bg-background">
      {/* Layer B — window frames (root renders no frame, just transparent). */}
      <div className="absolute inset-0 z-10">
        <SpaceLayerStack />
      </div>

      {/* Layer C — persistent frontmost content. The wrapper is click-through;
          FrontContent re-enables pointer events on its interactive children so
          the window frame's spaces dock + header below stay clickable. */}
      <div className="pointer-events-none absolute inset-0 z-20">
        <FrontContent />
      </div>
    </div>
  )
}
