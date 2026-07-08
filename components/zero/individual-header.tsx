"use client"

import { ShellHeader } from "./shell-header"
import { Dayline } from "./dayline"

/**
 * entity0's KIND-SPECIFIC header — the header the recursive model renders for a
 * `kind: "individual"` entity (the user's homeview, `s_root`). It is the Individual
 * analogue of the window header every other entity gets, but wearing Individual
 * chrome instead of the generic glyph/title/close:
 *
 *   • glyph            → the user's AVATAR         (top-left, in ShellHeader → UserIdentity)
 *   • title            → the user's NAME + @handle (beside the avatar)
 *   • center           → the live TIME + DATE
 *   • "close" cluster  → SEARCH + the `zero` logo  (an Individual is never closed, so the
 *                        close-X slot is repurposed; window controls still stack over the logo)
 *   • lower row        → the DAYLINE — the Individual's at-a-glance day insight
 *
 * Unlike the old decoupled absolute overlay, this renders IN FLOW as the first child
 * of entity0's frame (see WorkSurface), so it is genuinely entity0's header: the
 * window-region below it starts at this header's bottom by natural flow — no
 * `marginTop` offset hack. Its height is intrinsic (ShellHeader `HEADER_H` + Dayline
 * `DAYLINE_ROW_H` = `HEADER_OVERLAY_H`) and CONSTANT across depth, so the region rect
 * never moves as the user dives (morph safety preserved).
 *
 * `pointer-events-none` on the stack so the empty gaps fall through to whatever is
 * beneath; ShellHeader / Dayline each re-enable pointer events on their interactive
 * clusters. `relative z-40` keeps the chrome painted above the region (z-10) exactly
 * as the overlay did.
 *
 * NOTE: entity0 itself is still rendered through the always-mounted `EntityBody`
 * backdrop rather than the full `EntityNode` window machinery. Routing it through
 * EntityNode (so this becomes a true kind-branch of the shared header renderer) is the
 * remaining unification step; this component captures the kind-specific header content
 * so that fold is a localized swap when we get there.
 */
export function IndividualHeader({
  surface,
  bgTransition,
  fullscreen = false,
}: {
  /** entity0's telescopic backdrop color (from WorkSurface). Painted as this header's
   *  own SOLID background so the chrome is opaque: the opened window bleeds UP behind
   *  the header (via the region's negative-top clip-path for morph shadows), and a
   *  transparent header let its hexagon diagonals show through. Using the exact
   *  `homeSurface` keeps the fill seamless with the surrounding canvas at every depth. */
  surface?: string
  /** Same background-color transition the frame uses, so the header's fill tracks the
   *  telescopic surface in lockstep during dives (no flash/seam). */
  bgTransition?: string
  /** When a window is fullscreen the app bar (avatar/time/logo) is HIDDEN and only the
   *  Dayline remains — pulled to the very top (y=0) so the fullscreen window can touch
   *  its bottom. The Dayline (planned entities + activity band) is the one piece of
   *  chrome a fullscreen entity always reserves space for. */
  fullscreen?: boolean
}) {
  return (
    <div
      className="pointer-events-none relative z-40 flex shrink-0 flex-col"
      style={{ backgroundColor: surface, transition: bgTransition } as React.CSSProperties}
    >
      {!fullscreen && <ShellHeader />}
      <Dayline />
    </div>
  )
}
