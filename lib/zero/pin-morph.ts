"use client"

import { gsap } from "./flip-stage"
import { spaceMorphPoints, type SpaceKind } from "./motion"

/**
 * The PIN morph — a smooth row ⇄ dock-card transition.
 *
 * Pinning/unpinning moves an entity between two SEPARATE React subtrees (the
 * DO-list `<ul>` and the Dock `<div>`), so the single-persistent-node technique
 * the window morph relies on does NOT apply here: on pin the source row is
 * unmounted and a brand-new card is mounted elsewhere. There is no shared DOM
 * node to grow in place.
 *
 * Instead we fly a SELF-CONTAINED CLONE of the source node across the gap on a
 * fixed overlay (document.body, above everything), then cross-fade it into the
 * freshly-committed destination node. This is deliberately decoupled from the
 * GSAP Flip window engine: the clone carries NO `data-flip-*` identity, lives
 * OUTSIDE the focus-window stage, and is fully removed on completion — so it can
 * never be captured by `captureStage`/`playStage` or leave a stray inline style
 * that would corrupt the next window morph.
 *
 * Continuity comes from three things tweening together: the frame's
 * position+size (a manual FLIP), the glyph+title riding along inside the clone,
 * and — for Spaces — the clip-path morphing rectangle⇄hexagon via the very same
 * `spaceMorphPoints` driver the window morph uses (so the corner stays a true
 * 120° and the hexagon forms/dissolves cleanly).
 */

/** Quick, deliberate beat — much faster than the 2s window morph (a pin is a
 *  light, frequent gesture) but on the shared `zeroLand` curve so it reads as the
 *  same calm motion language. */
const PIN_MORPH_S = 0.52

type Direction = "pin" | "unpin"

type PinMorphOpts = {
  /** The per-instance flip prefix `${contextId}:${entityId}`. The frame node is
   *  `${flip}-frame` — and crucially the row and the dock card BOTH carry this
   *  same id (they are mutually exclusive in the DOM), so one query resolves the
   *  source before the mutation and the destination after it. */
  flip: string
  /** Spaces clip to a hexagon as a card and a rectangle as a row, so their morph
   *  also drives the clip-path. Non-spaces just translate/scale + cross-fade. */
  isSpace: boolean
  /** `"pin"` flies row→card; `"unpin"` flies card→row. */
  direction: Direction
  /** Commit the store change (pin/unpin + notifyDataChanged). Invoked AFTER the
   *  source rect+clone are captured, so React can unmount the source and mount
   *  the destination while the clone stands in for the gap. */
  mutate: () => void
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * p

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  )
}

/**
 * Run a pin/unpin with a flying-clone morph. Falls back to a plain mutation (no
 * animation) when there is no source node to fly from or the user prefers
 * reduced motion — so the data change always happens regardless.
 */
export function pinMorph({ flip, isSpace, direction, mutate }: PinMorphOpts) {
  const sel = `[data-flip-id="${CSS.escape(`${flip}-frame`)}"][data-flip-role="frame"]`
  const source = typeof document !== "undefined" ? document.querySelector<HTMLElement>(sel) : null

  if (!source || prefersReducedMotion()) {
    mutate()
    return
  }

  const srcRect = source.getBoundingClientRect()

  // Build the flying ghost from the live source node so it carries the exact
  // glyph, title, fill and (for spaces) clip the user is looking at.
  const ghost = source.cloneNode(true) as HTMLElement
  // Strip identity so the window-morph engine can never pick it up, and so it
  // isn't a duplicate of any real node.
  ghost.removeAttribute("data-flip-id")
  ghost.removeAttribute("data-window")
  ghost.removeAttribute("id")
  ghost.setAttribute("data-pin-ghost", "")
  ghost.setAttribute("aria-hidden", "true")
  Object.assign(ghost.style, {
    position: "fixed",
    margin: "0",
    top: `${srcRect.top}px`,
    left: `${srcRect.left}px`,
    width: `${srcRect.width}px`,
    height: `${srcRect.height}px`,
    zIndex: "200",
    pointerEvents: "none",
    willChange: "top, left, width, height",
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(ghost)

  // Commit the data change: React unmounts the source row / mounts the dock card
  // (or vice-versa). The ghost covers the gap meanwhile.
  mutate()

  const sourceKind: SpaceKind = direction === "pin" ? "row" : "card"
  const targetKind: SpaceKind = direction === "pin" ? "card" : "row"

  const cleanup = () => ghost.remove()

  // Wait for React's commit to paint (two frames), then measure the destination
  // node — same flip-id, now the only match — and fly to it.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const dest = document.querySelector<HTMLElement>(sel)
      if (!dest) {
        // Destination never materialised (e.g. filtered out): just fade the ghost.
        gsap.to(ghost, { opacity: 0, duration: 0.2, ease: "power1.in", onComplete: cleanup })
        return
      }

      const dstRect = dest.getBoundingClientRect()
      // Hold the real destination invisible until the cross-fade, so the ghost
      // and the node never double-image.
      gsap.set(dest, { opacity: 0 })

      const driver = { p: 0 }
      gsap.to(driver, {
        p: 1,
        duration: PIN_MORPH_S,
        ease: "zeroLand",
        onUpdate: () => {
          const p = driver.p
          const w = lerp(srcRect.width, dstRect.width, p)
          const h = lerp(srcRect.height, dstRect.height, p)
          ghost.style.width = `${w}px`
          ghost.style.height = `${h}px`
          ghost.style.top = `${lerp(srcRect.top, dstRect.top, p)}px`
          ghost.style.left = `${lerp(srcRect.left, dstRect.left, p)}px`
          if (isSpace) {
            const pts = spaceMorphPoints(p, w, h, sourceKind, targetKind)
            ghost.style.clipPath = `polygon(${pts.map(([x, y]) => `${x}% ${y}%`).join(", ")})`
          }
        },
        onComplete: () => {
          gsap.set(dest, { clearProps: "opacity" })
          cleanup()
        },
      })

      // Cross-fade over the final stretch: the ghost dissolves as the real node
      // resolves in its place, hiding any glyph/title LAYOUT difference between a
      // horizontal row and a centered card.
      gsap.to(ghost, {
        opacity: 0,
        duration: PIN_MORPH_S * 0.4,
        delay: PIN_MORPH_S * 0.6,
        ease: "power1.in",
      })
      gsap.to(dest, {
        opacity: 1,
        duration: PIN_MORPH_S * 0.45,
        delay: PIN_MORPH_S * 0.55,
        ease: "power1.out",
      })
    }),
  )
}
