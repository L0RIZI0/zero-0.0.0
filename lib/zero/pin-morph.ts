"use client"

import { flushSync } from "react-dom"
import { captureStage, playStage, gsap } from "./flip-stage"

/**
 * The PIN morph — a smooth row ⇄ dock-card transition.
 *
 * Pinning/unpinning moves an entity between two SEPARATE React subtrees (the
 * DO-list `<ul>` and the Dock), so there is no single persistent DOM node to
 * grow in place. But the row and the dock card BOTH carry the same
 * `data-flip-id` (`${contextId}:${entityId}-frame`, plus matching ids on their
 * nested glyph/title) and BOTH live inside the focus-window region (the GSAP
 * Flip "stage"). That is all GSAP Flip needs: matching by flip-id, it animates
 * the just-mounted card FROM the just-unmounted row's recorded position — the
 * exact same engine the window open/close morph uses (`captureStage` → commit →
 * `playStage`). The frame glides, the glyph + title ride along (`nested`), and
 * Spaces morph their clip rectangle⇄hexagon — no clone, all real elements.
 *
 * THE ONE WRINKLE: the DO-list animates a removed row out with a short framer
 * `exit` (AnimatePresence `popLayout`). So for the ~0.18s after we commit a pin,
 * the OLD row is still in the DOM, mid-exit, carrying the SAME flip-id as the
 * brand-new dock card — a duplicate that would make `Flip.from` match two nodes
 * for one id and animate the wrong one. We defuse this generically: right after
 * the synchronous commit, any element that existed BEFORE the commit yet now
 * shares its flip-id with a freshly-mounted twin is "neutralised" — its flip
 * identity is stripped (so Flip ignores it) and it is hidden (so there is no
 * faint double image while framer finishes fading it). The new card is then the
 * sole match and morphs cleanly from the captured row position.
 */
type PinMorphOpts = {
  /** Commit the store change (pin/unpin + notifyDataChanged). Run inside
   *  `flushSync` so the row→card swap paints before we measure + animate. */
  mutate: () => void
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  )
}

/** Strip every flip identity inside (and on) a node so GSAP Flip cannot match
 *  it, then hide it — used to retire a framer-exiting duplicate of a node that
 *  has just been re-mounted elsewhere. */
function neutralize(el: Element) {
  const parts = [el, ...el.querySelectorAll("[data-flip-id]")]
  for (const p of parts) {
    p.removeAttribute("data-flip-id")
    p.removeAttribute("data-flip-role")
  }
  gsap.set(el, { opacity: 0 })
}

/**
 * Run a pin/unpin with the shared Flip-stage morph. Falls back to a plain
 * synchronous mutation (no animation) under reduced motion or before the stage
 * has mounted — so the data change always happens regardless.
 */
export function pinMorph({ mutate }: PinMorphOpts) {
  if (typeof document === "undefined" || prefersReducedMotion()) {
    mutate()
    return
  }

  // Remember every flip node that exists BEFORE the commit, so we can recognise
  // post-commit duplicates as the stale (framer-exiting) originals.
  const before = new Set<Element>(document.querySelectorAll("[data-flip-id]"))

  // Snapshot the pre-pin layout, commit synchronously, then morph from the
  // snapshot to the freshly-committed layout. `playStage` no-ops safely when the
  // capture is null (stage not mounted yet), so the mutation is never lost.
  const state = captureStage()
  flushSync(() => {
    mutate()
  })

  // Retire any stale duplicate: a flip-id now shared by an old (exiting) node and
  // a new one. Keep the new node; neutralise the old so Flip matches exactly one.
  const byId = new Map<string, Element[]>()
  for (const el of document.querySelectorAll("[data-flip-id]")) {
    const id = el.getAttribute("data-flip-id")
    if (!id) continue
    const list = byId.get(id)
    if (list) list.push(el)
    else byId.set(id, [el])
  }
  for (const els of byId.values()) {
    if (els.length < 2) continue
    for (const el of els) if (before.has(el)) neutralize(el)
  }

  playStage(state, { opening: false, top: null, closing: null, fading: [] })
}
