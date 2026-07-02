"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { getEntity, hydrateFromStorage, isDetachedChild } from "./data"
  import { stackTargetRect, octagonLeafInside, spaceLeafInsets } from "./motion"
import { shellStageFor, WINDOW_TOP_LIFT } from "./layout"
import {
  captureStage,
  playStage,
  clearFadingProps,
  getRegionRect,
  gsap,
  MORPH_DURATION,
  morphDetached,
} from "./flip-stage"
import type { EntityKind } from "./types"
import type { OpenOrigin } from "./placement"
import { resolveOriginRect } from "./placement"

// `OpenOrigin` (imported from ./placement) carries the viewport rect + kind the
// window should morph FROM when an entity is opened from a placement that has no
// in-place owning node (e.g. a timeline chip, or search). When omitted, the open
// uses the legacy in-place morph (window IS the row) where available, else center.

/** The two navigable regions: the DO list and the pinned SPACES dock. */
export type SelectionRegion = "list" | "dock"

/** A single selected cell. `key` is an entity id, or `ADD_KEY` for the DO
 *  list's terminal "+ADD" birther row. */
export type Selection = { region: SelectionRegion; key: string } | null

/** What last drove the selection. Governs whether a selected-but-unhovered item
 *  renders its highlight: persistent for keyboard, pointer-bound for mouse. */
export type InputMode = "mouse" | "keyboard"

/** Sentinel key for the DO list's permanent terminal "+ADD" row. */
export const ADD_KEY = "__add__"

/** The ordered, navigable keys each region publishes for arrow-key math. The
 *  list always ends with `ADD_KEY`. */
type NavOrder = { list: string[]; dock: string[] }

/** A window node in the stack, identified by entity id + its absolute depth, plus
 *  the id of the PARENT context it was opened from. `parent` disambiguates the
 *  same entity referenced in multiple contexts: only the instance rendered inside
 *  `parent` owns (and morphs into) the window. */
export type WindowKey = { id: string; depth: number; parent: string }

/** Viewport rect of the focus-window region; the origin for fixed window geometry. */
type RegionRect = { top: number; left: number; width: number; height: number }

export interface ActiveEntity {
  id: string
  /** Depth in the stack — 0 is root. */
  depth: number
  kind: EntityKind
  /** True for any entity below the root, i.e. a framed child window is open. */
  isChild: boolean
  /** The id used for context filtering. Every entity is its own context. */
  contextId: string
  title: string
  /** Entity description. Empty string when none. */
  description: string
}

interface ZeroNavContextValue {
  /** Stack of entity ids. stack[0] is always the root, "s_root". */
  stack: string[]
  /** The currently focused (top of stack) entity id. */
  activeId: string
  /** Rich descriptor of the focused entity — drives filtering + timeline offset. */
  activeEntity: ActiveEntity
  /** Push any entity onto the stack (dive deeper). `source` is accepted for
   *  backward compatibility (timeline markers) but no longer affects the morph. */
  open: (id: string, origin?: OpenOrigin) => void
  /** Pop the top entity (close the frontmost window). */
  close: () => void
  /** Close the window at absolute stack index `depth`: that window morphs back
   *  into its row/card while any deeper children telescope away. */
  closeWindow: (depth: number) => void
  /** The window currently morphing back into its row on close (kept rendered in
   *  its parent's list through the morph). `null` when nothing is closing. */
  closing: WindowKey | null
  /** Deeper windows removed in the same close gesture — they stay mounted as
   *  windows and telescope out rather than vanishing instantly. */
  fading: WindowKey[]
  /** True for the duration of any window morph (open or close). */
  animating: boolean
  /** Fixed-position geometry for an OPEN window at the given absolute depth,
   *  measured from the focus-window region. `opts.forceLeaf` computes the LEAF
   *  (octagon) geometry even when the entry is no longer the top of the stack —
   *  used by a DETACHED window shrinking closed, which has already been popped
   *  but must keep its leaf shape; `opts.selfKind` supplies that popped entry's
   *  kind since it can't be read back from the stack. */
  styleFor: (depth: number, opts?: { forceLeaf?: boolean; selfKind?: EntityKind }) => React.CSSProperties
  /** Depth-only fixed geometry for a telescoping (fading) window. */
  fadingStyleFor: (depth: number) => React.CSSProperties
  /** Bumps on any in-memory data mutation so selectors re-read fresh data. */
  dataVersion: number
  /** Signal that the underlying data arrays changed (entity added). */
  notifyDataChanged: () => void
  /** Run a data mutation (e.g. pin/unpin) AS a stage morph: snapshot the layout,
   *  commit synchronously with the `animating` gate raised so framer stands down,
   *  then play one Flip.from. Rows ⇄ dock cards glide because they share a
   *  data-flip-id across the two subtrees. */
  morphCommit: (mutate: () => void, key?: string) => void
  /** Flip-id of the entity whose right-click context menu is open, or null.
   *  That entity renders its hover/highlight look while the menu is up. */
  menuKey: string | null
  /** Set/clear the entity whose context menu is open (its flip-id). */
  setMenuKey: (key: string | null) => void
  /** Flip-id of the entity currently flying between the do-list and dock during
   *  a pin/unpin morph, or null. Kept lit for the whole flight. */
  morphKey: string | null
  /** Register the focus-window region's current viewport rect (WorkSurface). */
  setRegionRect: (rect: RegionRect) => void
  /** A transient "attention" ping for an already-open entity. */
  pulse: { id: string; n: number } | null
  /** Ask the open window for `id` to bounce (re-clicked its timeline chip). */
  requestPulse: (id: string) => void

  // --- Selection + keyboard navigation ---------------------------------------
  selection: Selection
  inputMode: InputMode
  select: (region: SelectionRegion, key: string, mode?: InputMode) => void
  clearSelection: () => void
  setInputMode: (mode: InputMode) => void
  publishNavOrder: (region: SelectionRegion, keys: string[]) => void
  moveSelection: (dir: "up" | "down" | "left" | "right") => void
}

const ZeroNavContext = createContext<ZeroNavContextValue | null>(null)

export function ZeroNavProvider({
  children,
  rootSpaceId = "s_root",
}: {
  children: React.ReactNode
  rootSpaceId?: string
}) {
  const [stack, setStack] = useState<string[]>([rootSpaceId])
  // A live mirror of the stack so event handlers + the morph orchestrator read
  // the committed stack synchronously without stale-closure risk.
  const stackRef = useRef(stack)
  useEffect(() => {
    stackRef.current = stack
  }, [stack])

  // The window morphing back into its row on close, and any deeper windows
  // telescoping out with it. Both stay mounted (rendered by their still-open
  // parent's body) through the morph, then are dropped on settle.
  const [closing, setClosing] = useState<WindowKey | null>(null)
  const [fading, setFading] = useState<WindowKey[]>([])
  const [animating, setAnimating] = useState(false)
  const settleTimer = useRef<ReturnType<typeof gsap.delayedCall> | null>(null)

  // The explicit visual origin for the CURRENT open, set by `open(id, origin)`
  // right before it commits and consumed by the morph (Stage C). Used only when
  // an entity is opened from a placement that has no in-place owning node (e.g. a
  // timeline chip / search). `null` => use the legacy in-place morph, else center.
  const pendingOriginRef = useRef<OpenOrigin | null>(null)

  // Origin remembered PER detached open id, so the close morph can shrink the
  // window back toward the SAME point it grew from (the launching chip's rect, or
  // null = region center). Set when a detached window opens; read + deleted on its
  // close. Detached windows have no persistent row, so this is the only record.
  const detachedOrigins = useRef<Map<string, OpenOrigin | null>>(new Map())

  // Flip-id (`${contextId}:${entityId}`) of the entity that should render its
  // hover/highlight look even though the pointer may not be over it: `menuKey`
  // while its right-click context menu is open, `morphKey` while it is flying
  // between the do-list and the dock. Keying by flip-id (not region) means the
  // held look carries across the row→card swap, since the row and the card
  // share the same key — the landed node stays lit through the whole morph.
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const [morphKey, setMorphKey] = useState<string | null>(null)

  const [dataVersion, setDataVersion] = useState(0)
  const [pulse, setPulse] = useState<{ id: string; n: number } | null>(null)

  // Viewport rect of the focus-window region, kept in state so window geometry
  // recomputes on resize. Seeded lazily from the live element.
  const [regionRect, setRegionRectState] = useState<RegionRect>({ top: 0, left: 0, width: 0, height: 0 })
  const setRegionRect = useCallback((rect: RegionRect) => {
    setRegionRectState((prev) =>
      prev.top === rect.top && prev.left === rect.left && prev.width === rect.width && prev.height === rect.height
        ? prev
        : rect,
    )
  }, [])

  // --- Selection + keyboard navigation state ---------------------------------
  const [selection, setSelection] = useState<Selection>(null)
  const [inputMode, setInputModeState] = useState<InputMode>("mouse")
  const navOrderRef = useRef<NavOrder>({ list: [], dock: [] })
  const inputModeRef = useRef<InputMode>("mouse")

  const select = useCallback((region: SelectionRegion, key: string, mode?: InputMode) => {
    if (mode) {
      inputModeRef.current = mode
      setInputModeState(mode)
    }
    setSelection({ region, key })
  }, [])

  const clearSelection = useCallback(() => setSelection(null), [])

  const setInputMode = useCallback((mode: InputMode) => {
    if (inputModeRef.current === mode) return
    inputModeRef.current = mode
    setInputModeState(mode)
  }, [])

  const publishNavOrder = useCallback((region: SelectionRegion, keys: string[]) => {
    navOrderRef.current = { ...navOrderRef.current, [region]: keys }
  }, [])

  // Spatial arrow-key navigation. Dock sits BELOW the list (it was moved under the
  // do-list), so the two regions connect at the list's BOTTOM: pressing DOWN from the
  // last list entry (the CREATE-INPUT row) enters the dock, and pressing UP from a dock
  // card returns to that last list entry.
  const moveSelection = useCallback((dir: "up" | "down" | "left" | "right") => {
    const { list, dock } = navOrderRef.current
    setSelection((cur) => {
      if (!cur) {
        if (list.length) return { region: "list", key: list[0] }
        if (dock.length) return { region: "dock", key: dock[0] }
        return cur
      }
      if (cur.region === "list") {
        const i = list.indexOf(cur.key)
        if (i === -1) return list.length ? { region: "list", key: list[0] } : cur
        if (dir === "down") {
          // Past the last list entry (CREATE-INPUT row), drop into the dock below.
          if (i === list.length - 1) return dock.length ? { region: "dock", key: dock[0] } : cur
          return { region: "list", key: list[i + 1] }
        }
        if (dir === "up") return { region: "list", key: list[Math.max(i - 1, 0)] }
        return cur
      }
      const j = dock.indexOf(cur.key)
      if (j === -1) return dock.length ? { region: "dock", key: dock[0] } : cur
      if (dir === "left") return { region: "dock", key: dock[Math.max(j - 1, 0)] }
      if (dir === "right") return { region: "dock", key: dock[Math.min(j + 1, dock.length - 1)] }
      // Up from the dock returns to the LAST list entry (CREATE-INPUT row) above it.
      if (dir === "up") return list.length ? { region: "list", key: list[list.length - 1] } : cur
      return cur
    })
    inputModeRef.current = "keyboard"
    setInputModeState("keyboard")
  }, [])

  const notifyDataChanged = useCallback(() => setDataVersion((v) => v + 1), [])

  const requestPulse = useCallback((id: string) => {
    setPulse((prev) => ({ id, n: (prev?.n ?? 0) + 1 }))
  }, [])

  useEffect(() => {
    if (hydrateFromStorage()) setDataVersion((v) => v + 1)
  }, [])

  // Any real mouse movement returns us to "mouse" mode.
  useEffect(() => {
    const onPointerMove = () => {
      if (inputModeRef.current !== "mouse") {
        inputModeRef.current = "mouse"
        setInputModeState("mouse")
      }
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true })
    return () => window.removeEventListener("pointermove", onPointerMove)
  }, [])

  /**
   * THE single entry point for every open/close. Captures one Flip snapshot of
   * the whole stage BEFORE the stack change, commits the new stack + closing/
   * fading bookkeeping synchronously, then plays one Flip.from so every
   * persistent node (rows ⇄ windows, headers ⇄ spines) morphs together.
   */
  const transition = useCallback((nextStack: string[]) => {
    const prev = stackRef.current
    if (nextStack.length === prev.length && nextStack.every((v, i) => v === prev[i])) return

    const opening = nextStack.length > prev.length
    // `parent` is read from the PRE-truncation stack so each closing/fading
    // window knows which context instance owns it, even after the live stack has
    // been shortened below it.
    const closingDepth = nextStack.length
    const closingEntity: WindowKey | null =
      nextStack.length < prev.length
        ? { id: prev[closingDepth], depth: closingDepth, parent: prev[closingDepth - 1] }
        : null
    const fadingList: WindowKey[] =
      nextStack.length < prev.length
        ? prev.slice(nextStack.length + 1).map((id, i) => {
            const d = nextStack.length + 1 + i
            return { id, depth: d, parent: prev[d - 1] }
          })
        : []
    const topDepth = nextStack.length - 1
    const topKey: WindowKey | null = opening
      ? { id: nextStack[topDepth], depth: topDepth, parent: nextStack[topDepth - 1] }
      : null

    // Keep the region rect fresh at the moment of the morph.
    setRegionRect(getRegionRect())

    // DETACHED CLOSE — the closing top has no in-place row under it (its host is
    // not its parent/tag), so there is nothing for a Flip morph to shrink it back
    // into; we shrink its frame toward its remembered origin with morphDetached
    // instead. CRUCIALLY this still commits the stack IMMEDIATELY (flushSync), the
    // same as the normal path — the logical pop happens now (so stackRef is fresh
    // and any subsequent click is correct), and the window is kept MOUNTED purely
    // for the exit animation by putting it in `fading` (which keeps EntityNode
    // rendering it as a full window; see work-surface, which mounts detached
    // fading entries). The settle timer then only does cosmetic cleanup, exactly
    // like the normal path — so a follow-up transition that kills it is harmless.
    if (
      !opening &&
      closingEntity &&
      fadingList.length === 0 &&
      isDetachedChild(closingEntity.id, closingEntity.parent)
    ) {
      // Prefer the LIVE rect of the original placement (the timeline stays pinned
      // on top while a window is open, so the launching chip is usually still
      // visible and may have shifted) — fall back to the rect captured at open.
      const stored = detachedOrigins.current.get(closingEntity.id) ?? null
      const live = stored?.placement
        ? resolveOriginRect(closingEntity.id, { placement: stored.placement })
        : null
      const originRect = (live ?? stored)?.rect ?? null
      detachedOrigins.current.delete(closingEntity.id)
      flushSync(() => {
        setStack(nextStack)
        setFading([closingEntity])
        setClosing(null)
        setAnimating(true)
      })
      morphDetached(closingEntity, originRect, false)
      settleTimer.current?.kill()
      settleTimer.current = gsap.delayedCall(MORPH_DURATION, () => {
        clearFadingProps([closingEntity])
        setFading([])
        setAnimating(false)
      })
      return
    }

    // DETACHED OPEN — the new top is not a member of the window below it, so it
    // will be rendered standalone (see work-surface) and grown from an explicit
    // origin rather than an in-place row. Remember that origin so its eventual
    // close can shrink back to the same point.
    const detachedTop = !!(topKey && isDetachedChild(topKey.id, topKey.parent))
    const topOrigin = detachedTop ? pendingOriginRef.current : null
    if (detachedTop && topKey) detachedOrigins.current.set(topKey.id, topOrigin)
    pendingOriginRef.current = null

    const state = captureStage()
    flushSync(() => {
      setStack(nextStack)
      setClosing(closingEntity)
      setFading(fadingList)
      setAnimating(true)
    })
    playStage(state, {
      opening,
      top: topKey,
      closing: closingEntity,
      fading: fadingList,
      detachedTop: detachedTop ? { origin: topOrigin?.rect ?? null } : undefined,
    })

    settleTimer.current?.kill()
    settleTimer.current = gsap.delayedCall(MORPH_DURATION, () => {
      clearFadingProps(fadingList)
      setFading([])
      setClosing((c) =>
        c && closingEntity && c.id === closingEntity.id && c.depth === closingEntity.depth ? null : c,
      )
      setAnimating(false)
    })
  }, [setRegionRect])

  /**
   * Morph an arbitrary data mutation (no stack change) — used by pin/unpin to
   * fly a DO-list row into its dock card and back. Mirrors `transition`: snapshot
   * → commit synchronously WITH `animating` raised (so framer's row layout/exit
   * and dock enter stand down and GSAP Flip alone drives every node) → one
   * Flip.from. The row and card share `${context}:${id}-frame`, so Flip matches
   * them across the two subtrees and the frame + glyph + title glide as one
   * (Spaces also morph their clip rectangle⇄hexagon). Falls back to a plain
   * mutation under reduced motion / before the stage mounts, so the data change
   * is never lost.
   */
  const morphCommit = useCallback((mutate: () => void, key?: string) => {
    const reduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (reduced) {
      mutate()
      return
    }
    setRegionRect(getRegionRect())

    // Snapshot the nodes that carry a flip-id BEFORE the commit. After the
    // commit, framer's AnimatePresence keeps the just-removed source node alive
    // for a couple hundred ms to play its exit — so for a beat there are TWO
    // live nodes with the SAME data-flip-id (the dying source + the freshly
    // mounted destination). GSAP Flip's id-lookup can only hold one element per
    // id, so the collision makes it grab the wrong (dying) node and the real
    // one teleports. We record the pre-commit nodes here so we can neutralize
    // those exact stale ghosts immediately after the commit.
    const before = new Map<string, Element>()
    if (typeof document !== "undefined") {
      document.querySelectorAll("[data-flip-id]").forEach((el) => {
        const id = el.getAttribute("data-flip-id")
        if (id) before.set(id, el)
      })
    }

    const state = captureStage()
    flushSync(() => {
      mutate()
      setAnimating(true)
      // Keep the morphing entity lit for the whole flight, regardless of where
      // the pointer is. Set inside the same commit so the freshly-mounted
      // destination node (row→card or card→row) renders highlighted on its very
      // first frame instead of flashing to rest.
      if (key) setMorphKey(key)
    })

    // Kill the collision: for any flip-id now owned by more than one node, the
    // stale ghost is the pre-commit node (the one framer is exiting). Strip its
    // id and hide it so Flip's rematch query sees exactly one node per id and
    // flies the real source→destination element. Framer still owns the ghost's
    // unmount, so we only mutate presentation, never the tree.
    if (typeof document !== "undefined") {
      const byId = new Map<string, Element[]>()
      document.querySelectorAll("[data-flip-id]").forEach((el) => {
        const id = el.getAttribute("data-flip-id")
        if (!id) return
        const list = byId.get(id) ?? []
        list.push(el)
        byId.set(id, list)
      })
      byId.forEach((nodes, id) => {
        if (nodes.length < 2) return
        const stale = before.get(id)
        if (stale && nodes.includes(stale)) {
          ;(stale as HTMLElement).style.visibility = "hidden"
          stale.removeAttribute("data-flip-id")
        }
      })
    }

    playStage(state, { opening: false, top: null, closing: null, fading: [], rematch: true })
    settleTimer.current?.kill()
    settleTimer.current = gsap.delayedCall(MORPH_DURATION, () => {
      setAnimating(false)
      setMorphKey(null)
    })
  }, [setRegionRect])

  const open = useCallback(
    (id: string, origin?: OpenOrigin) => {
      const cur = stackRef.current
      if (cur[cur.length - 1] === id) return // re-opening the top is a no-op
      // An entity can appear at most once in a path. If it is already open
      // somewhere in this stack (e.g. the user clicked a second, collapsed
      // reference of it in another context), don't push a duplicate entry.
      if (cur.includes(id)) return
      // Stash the explicit origin for the morph to consume on this commit (Stage
      // C). Cleared by the morph once read; harmless if unread (legacy in-place
      // morph is used whenever an owning node exists).
      pendingOriginRef.current = origin ?? null
      // NOTE: we intentionally DO NOT fold the parent's IN/OUT panels when diving into a
      // child anymore — per user, an open parent's panels should stay open behind the
      // child instead of auto-collapsing. (collapseEntityPanels still exists for explicit
      // use, but the dive no longer triggers it.)
      transition([...cur, id])
    },
    [transition],
  )

  // Close the window at absolute index `depth` (and everything above it).
  const closeWindow = useCallback(
    (depth: number) => {
      const cur = stackRef.current
      if (depth < 1 || depth >= cur.length) return
      transition(cur.slice(0, depth))
    },
    [transition],
  )

  const close = useCallback(() => {
    closeWindow(stackRef.current.length - 1)
  }, [closeWindow])

  // Escape closes the current focus window (unless typing in a field).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      close()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [close])

  const value = useMemo<ZeroNavContextValue>(() => {
    const activeId = stack[stack.length - 1]
    const depth = stack.length - 1
    const entity = getEntity(activeId)
    const kind: EntityKind = entity?.kind ?? "space"
    const title = entity?.title ?? ""
    const description = entity?.description ?? ""
    const contextId = activeId

    const activeEntity: ActiveEntity = {
      id: activeId,
      depth,
      kind,
      isChild: depth > 0,
      contextId,
      title,
      description,
    }

    // As the shell compacts the open windows grow UPWARD: their top rises by
    // WINDOW_TOP_LIFT[stage] while their bottom stays put. We realize this by
    // measuring against an "effective" region whose top is lifted and whose height
    // is grown by the same amount — every window (parent + children) then shares
    // the higher top and unchanged bottom. Driven by the leaf depth so all stacked
    // windows lift together in one morph.
    const lift = WINDOW_TOP_LIFT[shellStageFor(activeEntity)]
    const liftedRegion = {
      top: regionRect.top - lift,
      left: regionRect.left,
      width: regionRect.width,
      height: regionRect.height + lift,
    }

    // Fixed geometry for an open window: walk the in-stack ancestors (above the
    // root backdrop, below this window) and let each reserve space by its kind.
    const styleFor = (
      windowDepth: number,
      opts?: { forceLeaf?: boolean; selfKind?: EntityKind },
    ): React.CSSProperties => {
      const leafDepth = stack.length - 1
      const ancestorKinds = stack.slice(1, windowDepth).map((sid) => getEntity(sid)?.kind ?? "task")
      // ancestorKinds[i] is the window at depth (1 + i). ONLY a Space renders as a
      // vertical SPINE — and therefore reserves no top peek — and it does so the
      // instant it becomes an ancestor, never showing as a rectangle. Non-Space
      // ancestors NEVER spine; they stay nested-doll rectangles at every depth. Keep
      // this rule identical to entity-node's `isSpine`.
      const ancestorVertical = ancestorKinds.map((k) => k === "space")
      // A Space window (at any depth, leaf or ancestor) overlaps its immediate
      // parent's top/header, so stackTargetRect skips the last ancestor's top peek.
      // A detached window being measured after its pop is no longer in `stack`, so
      // fall back to the explicitly-passed `selfKind`.
      const selfKind = opts?.selfKind ?? getEntity(stack[windowDepth])?.kind ?? "task"
      const selfIsSpace = selfKind === "space"
      let rect = stackTargetRect(
        ancestorKinds,
        { w: liftedRegion.width, h: liftedRegion.height },
        ancestorVertical,
        selfIsSpace,
      )
      // A frontmost LEAF Space fills its WHOLE box (full width minus side peeks,
      // full height) and the clip carves a wide OCTAGON from it — flat top/bottom
      // edges with true-120° corner brackets and full-height vertical sides — for
      // maximum content width with no giant off-screen shape. The moment a child
      // opens it stops being the leaf and the clip flattens octagon → rectangle in
      // the same Flip pass (brackets ride to the corners, flat edges spread to full
      // width). The expanded ancestor is then a plain, cheap rectangle (no inset,
      // no drop-shadow filter), which is also why opening/closing stays snappy.
      const isLeaf = opts?.forceLeaf || windowDepth === stack.length - 1
      const isSpaceLeaf = selfIsSpace && isLeaf
      let hexInsetY = 0
      // Distance from the hexagon's TOP POINT down to its upper side corners — i.e.
      // the top of the central horizontal rectangle (the band between the four side
      // corners). For a regular pointy-top hexagon that is exactly 1/4 of its height.
      // This is the line the leaf header bottom-aligns to and the body insets to, so
      // the glyph+title sit in the top wedge and the do-list lives in the central
      // rectangle. NOTE this differs from `hexInsetY` (the hexagon's OVERFLOW past the
      // visible box); on wide screens the overflow is smaller than the corner line,
      // which is why anchoring to the overflow left the title floating too high.
      let hexCornerInsetY = 0
      // The leaf octagon's flat-edge inset (%), the only knob distinguishing the wide
      // leaf octagon from the dock hexagon (50) and ancestor rectangle (0). Passed to
      // the frame as `--space-ax`.
      let spaceAx = 0
      let spaceAy = 0
      if (isSpaceLeaf) {
        // The octagon fills the whole box (full width minus side peeks, full height),
        // so there is NO off-screen bleed → content top inset is 0. Corner brackets are
        // a FIXED pixel height (LEAF_BRACKET_PX): they hug the top/bottom edges and the
        // central rectangle the header/body inset to (`--hex-corner-inset-y`) gets all
        // the remaining height — instead of the corners eating ~25% per side.
        rect = octagonLeafInside(rect)
        hexInsetY = 0
        const insets = spaceLeafInsets(rect.width, rect.height)
        spaceAx = insets.ax
        spaceAy = insets.hy
        // Px height of the top/bottom wedge = bracket height = hy% of the frame.
        hexCornerInsetY = (insets.hy / 100) * rect.height
      }
      return {
        position: "fixed",
        top: liftedRegion.top + rect.top,
        left: liftedRegion.left + rect.left,
        width: rect.width,
        height: rect.height,
        zIndex: 20 + windowDepth * 10,
        // Every window has SQUARE corners — the simplest rule that keeps all
        // entities harmonious. The only non-rectangular window is a Space LEAF (a
        // hexagon, via clip-path); an expanded ancestor Space is a sharp full-box
        // rectangle clip, so with square corners it is visually identical to any
        // other window. No CSS-radius vs clip-path corner matching to reconcile.
        borderRadius: "0",
        // Only the leaf hexagon overflows the box and pads its content into the
        // visible band; an expanded ancestor rectangle fills its box normally.
        ...(isSpaceLeaf
          ? ({
              ["--hex-inset-y"]: `${hexInsetY}px`,
              // Top edge → upper side corners (top of the central rectangle). The leaf
              // header bottom-aligns here and the body insets to it, so glyph+title sit
              // in the top wedge and the do-list lives in the central rectangle.
              ["--hex-corner-inset-y"]: `${hexCornerInsetY}px`,
              // Drive the octagon clip + SVG outline in entity-node (true-120° corner):
              // ax = flat top/bottom inset, ay = bracket height. Unitless percents;
              // entity-node reads both and rebuilds the polygon.
              ["--space-ax"]: `${spaceAx}`,
              ["--space-ay"]: `${spaceAy}`,
            } as React.CSSProperties)
          : null),
      }
    }

    // Telescoping windows are leaving, so exact resting geometry is irrelevant —
    // a depth-stepped box (treating ancestors as plain top-peeks) is enough.
    const fadingStyleFor = (windowDepth: number): React.CSSProperties => {
      const ancestorKinds = Array(Math.max(0, windowDepth - 1)).fill("task") as EntityKind[]
      const rect = stackTargetRect(ancestorKinds, { w: liftedRegion.width, h: liftedRegion.height })
      return {
        position: "fixed",
        top: liftedRegion.top + rect.top,
        left: liftedRegion.left + rect.left,
        width: rect.width,
        height: rect.height,
        zIndex: 20 + windowDepth * 10,
        // Square corners — every window is square (see styleFor).
        borderRadius: "0",
      }
    }

    return {
      stack,
      activeId,
      activeEntity,
      open,
      close,
      closeWindow,
    closing,
    fading,
    animating,
    styleFor,
      fadingStyleFor,
      dataVersion,
      notifyDataChanged,
      morphCommit,
      menuKey,
      setMenuKey,
      morphKey,
      setRegionRect,
      pulse,
      requestPulse,
      selection,
      inputMode,
      select,
      clearSelection,
      setInputMode,
      publishNavOrder,
      moveSelection,
    }
  }, [
    stack,
    open,
    close,
    closeWindow,
    closing,
    fading,
    animating,
    regionRect,
    dataVersion,
    notifyDataChanged,
    morphCommit,
    menuKey,
    morphKey,
    setRegionRect,
    pulse,
    requestPulse,
    selection,
    inputMode,
    select,
    clearSelection,
    setInputMode,
    publishNavOrder,
    moveSelection,
  ])

  return <ZeroNavContext.Provider value={value}>{children}</ZeroNavContext.Provider>
}

export function useZeroNav() {
  const ctx = useContext(ZeroNavContext)
  if (!ctx) throw new Error("useZeroNav must be used within ZeroNavProvider")
  return ctx
}

/**
 * Wires a DO-list row or dock card into the shared selection model.
 *
 * `showHighlight` is the single source of truth for the highlighted look, and is
 * KEYBOARD-ONLY: keyboard nav paints the cell with the same filled background it
 * gets on hover (there is no separate selection ring). Mouse hover doesn't set it
 * — it just moves the selection cursor here (via `hoverProps`) so a subsequent
 * keystroke acts on whatever the pointer is over.
 */
export function useRowSelection(region: SelectionRegion, key: string) {
  const { selection, inputMode, select } = useZeroNav()
  const ref = useRef<HTMLElement | null>(null)
  const selected = selection?.region === region && selection.key === key
  const showHighlight = selected && inputMode === "keyboard"

  useEffect(() => {
    if (showHighlight) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [showHighlight])

  const hoverProps = {
    onPointerEnter: () => select(region, key, "mouse"),
  }

  return { showHighlight, hoverProps, ref }
}
