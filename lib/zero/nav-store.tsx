"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { getEntity, hydrateFromStorage } from "./data"
import { collapseEntityPanels } from "./panel-store"
import { stackTargetRect } from "./motion"
import {
  captureStage,
  playStage,
  clearFadingProps,
  getRegionRect,
  gsap,
  MORPH_DURATION,
} from "./flip-stage"
import type { EntityKind } from "./types"

/**
 * Where an entity's window was opened FROM. Events/instants exist in two places
 * at once (their DO-list row and their timeline marker). Retained so callers
 * (the timeline) can keep their existing signature; the single-node morph itself
 * no longer needs it — the window IS the row, so it always morphs from the right
 * element automatically.
 */
export type OpenSource = "timeline" | "row"

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
  open: (id: string, source?: OpenSource) => void
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
  /** A SPACE that is open but NOT the frontmost window collapses its header into
   *  a vertical left spine. */
  isSpine: (id: string) => boolean
  /** Fixed-position geometry for an OPEN window at the given absolute depth,
   *  measured from the focus-window region. */
  styleFor: (depth: number) => React.CSSProperties
  /** Depth-only fixed geometry for a telescoping (fading) window. */
  fadingStyleFor: (depth: number) => React.CSSProperties
  /** Bumps on any in-memory data mutation so selectors re-read fresh data. */
  dataVersion: number
  /** Signal that the underlying data arrays changed (entity added). */
  notifyDataChanged: () => void
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

  // Spatial arrow-key navigation. Dock sits ABOVE the list.
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
        if (dir === "down") return { region: "list", key: list[Math.min(i + 1, list.length - 1)] }
        if (dir === "up") {
          if (i === 0) return dock.length ? { region: "dock", key: dock[0] } : cur
          return { region: "list", key: list[i - 1] }
        }
        return cur
      }
      const j = dock.indexOf(cur.key)
      if (j === -1) return dock.length ? { region: "dock", key: dock[0] } : cur
      if (dir === "left") return { region: "dock", key: dock[Math.max(j - 1, 0)] }
      if (dir === "right") return { region: "dock", key: dock[Math.min(j + 1, dock.length - 1)] }
      if (dir === "down") return list.length ? { region: "list", key: list[0] } : cur
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

    const state = captureStage()
    flushSync(() => {
      setStack(nextStack)
      setClosing(closingEntity)
      setFading(fadingList)
      setAnimating(true)
    })
    playStage(state, { opening, top: topKey, closing: closingEntity, fading: fadingList })

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

  const open = useCallback(
    (id: string) => {
      const cur = stackRef.current
      if (cur[cur.length - 1] === id) return // re-opening the top is a no-op
      // An entity can appear at most once in a path. If it is already open
      // somewhere in this stack (e.g. the user clicked a second, collapsed
      // reference of it in another context), don't push a duplicate entry.
      if (cur.includes(id)) return
      // Opening a child folds the parent's IN/OUT panels so the parent reflows
      // clean behind/around the child (and returns collapsed).
      collapseEntityPanels(cur[cur.length - 1])
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

    const isSpine = (id: string) => {
      const idx = stack.indexOf(id)
      return idx >= 1 && idx < stack.length - 1 && getEntity(id)?.kind === "space"
    }

    // Fixed geometry for an open window: walk the in-stack ancestors (above the
    // root backdrop, below this window) and let each reserve space by its kind.
    const styleFor = (windowDepth: number): React.CSSProperties => {
      const ancestorKinds = stack.slice(1, windowDepth).map((sid) => getEntity(sid)?.kind ?? "task")
      const rect = stackTargetRect(ancestorKinds, { w: regionRect.width, h: regionRect.height })
      // The frontmost child (current leaf / focus) extends a bit BELOW the region
      // bottom so it covers the stacked drop-shadows the ancestors pile up there.
      // All windows share the same bottom edge, so only the leaf needs this; the
      // region's clip-path already leaves −120px of room beneath for shadows.
      const isLeaf = windowDepth === stack.length - 1
      const LEAF_BOTTOM_OVERHANG = 24
      return {
        position: "fixed",
        top: regionRect.top + rect.top,
        left: regionRect.left + rect.left,
        width: rect.width,
        height: rect.height + (isLeaf ? LEAF_BOTTOM_OVERHANG : 0),
        zIndex: 20 + windowDepth * 10,
        // Square top corners; bottom two stay rounded at 8px. (TL TR BR BL)
        borderRadius: "0 0 8px 8px",
      }
    }

    // Telescoping windows are leaving, so exact resting geometry is irrelevant —
    // a depth-stepped box (treating ancestors as plain top-peeks) is enough.
    const fadingStyleFor = (windowDepth: number): React.CSSProperties => {
      const ancestorKinds = Array(Math.max(0, windowDepth - 1)).fill("task") as EntityKind[]
      const rect = stackTargetRect(ancestorKinds, { w: regionRect.width, h: regionRect.height })
      return {
        position: "fixed",
        top: regionRect.top + rect.top,
        left: regionRect.left + rect.left,
        width: rect.width,
        height: rect.height,
        zIndex: 20 + windowDepth * 10,
        // Square top corners; bottom two stay rounded at 8px. (TL TR BR BL)
        borderRadius: "0 0 8px 8px",
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
      isSpine,
      styleFor,
      fadingStyleFor,
      dataVersion,
      notifyDataChanged,
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
 * The active-cell highlight — a selection ring + drop shadow, both expressed as
 * `box-shadow` so Motion interpolates cleanly between rest and active states.
 */
export const HIGHLIGHT_SHADOW = "0 0 0 1.5px var(--ring), 0 12px 28px -10px rgba(0,0,0,0.28)"
export const HIGHLIGHT_SHADOW_NONE = "0 0 0 0px rgba(0,0,0,0), 0 0px 0px 0px rgba(0,0,0,0)"

/**
 * Wires a DO-list row or dock card into the shared selection model. Returns the
 * single source of truth (`showHighlight` / `lift`) for the lifted look.
 */
export function useRowSelection(region: SelectionRegion, key: string) {
  const { selection, inputMode, select } = useZeroNav()
  const ref = useRef<HTMLElement | null>(null)
  const selected = selection?.region === region && selection.key === key
  // The accent ring/lift is now KEYBOARD-ONLY. Mouse hover no longer paints the
  // orange ring (it felt heavy and noisy on every pointer move); hovered rows get
  // only the subtle `hover:bg-foreground/5` tint applied in the markup. Arrow-key
  // navigation still shows the ring so the focused cell is locatable.
  const showHighlight = selected && inputMode === "keyboard"

  useEffect(() => {
    if (selected && inputMode === "keyboard") {
      ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
    }
  }, [selected, inputMode])

  // Hovering still moves the selection cursor to this cell (so a subsequent
  // keystroke acts on what the mouse is over) — it just no longer paints a ring.
  const hoverProps = {
    onPointerEnter: () => select(region, key, "mouse"),
  }

  const lift = showHighlight

  return { selected, showHighlight, lift, hoverProps, ref }
}
