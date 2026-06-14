"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { getEntity, hydrateFromStorage } from "./data"
import type { EntityKind } from "./types"

/**
 * Where an entity's window was opened FROM. Events/instants exist in two places
 * at once (their DO-list row and their timeline marker), so the window should
 * grow from — and collapse back to — whichever the user actually used.
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

export interface ActiveNode {
  id: string
  /** Depth in the stack — 0 is root (Space 0). */
  depth: number
  kind: EntityKind
  /** True for any node below the root, i.e. a framed child window is open. */
  isChild: boolean
  /** The space id used for context filtering (a task resolves to its parent). */
  contextSpaceId: string
  title: string
  /** Present for spaces (and, later, tasks/events). Empty string when none. */
  description: string
}

interface ZeroNavContextValue {
  /** Stack of entity ids. stack[0] is always the root, "s_root". */
  stack: string[]
  /** The currently focused (top of stack) node id. */
  activeSpaceId: string
  /** Rich description of the focused node — drives filtering + timeline offset. */
  activeNode: ActiveNode
  /** Push any entity onto the stack (dive deeper). Spaces and tasks open as
   *  framed windows; events resolve to their parent space at the call site.
   *  `source` records whether an event/instant was opened from its timeline
   *  marker or its DO-list row, so the frame can morph to/from the right one. */
  open: (id: string, source?: OpenSource) => void
  /** Alias of `open`, kept for call sites that read as "open this space". */
  openSpace: (spaceId: string) => void
  /** Alias of `open`, kept for call sites that read as "open this task". */
  openTask: (taskId: string) => void
  /** Pop the top node (close current layer). */
  closeSpace: () => void
  /** Jump to a specific depth in the stack (used by breadcrumb). */
  goToDepth: (depth: number) => void
  /** Bumps on any in-memory data mutation so selectors re-read fresh data. */
  dataVersion: number
  /** Signal that the underlying data arrays changed (entity added). */
  notifyDataChanged: () => void
  /** A transient "attention" ping for an already-open entity. `n` increments on
   *  every request so frames can re-trigger the bounce even for the same id. */
  pulse: { id: string; n: number } | null
  /** Ask the open frame for `id` to bounce (e.g. user re-clicked its timeline
   *  chip while its window is already open). */
  requestPulse: (id: string) => void
  /** How the entity at `id` was opened (defaults to "timeline" for events/
   *  instants when unknown). Lets a frame pick its morph source. */
  openSourceOf: (id: string) => OpenSource

  // --- Selection + keyboard navigation ---------------------------------------
  /** The single selected cell (DO-list row or dock card), or null. */
  selection: Selection
  /** What last drove the selection — gates highlight persistence. */
  inputMode: InputMode
  /** Select a cell. Pass `mode` to also set the input mode (mouse hover passes
   *  "mouse", arrows pass "keyboard"); omit it to keep the current mode (used for
   *  default selection on context change, which shouldn't force a highlight). */
  select: (region: SelectionRegion, key: string, mode?: InputMode) => void
  /** Clear the selection entirely. */
  clearSelection: () => void
  /** Force the input mode (the provider also flips it to "mouse" on pointermove). */
  setInputMode: (mode: InputMode) => void
  /** Components publish their current navigable key order (in an effect) so the
   *  store can do arrow-key math centrally. */
  publishNavOrder: (region: SelectionRegion, keys: string[]) => void
  /** Move the selection spatially. Always switches to keyboard input mode. */
  moveSelection: (dir: "up" | "down" | "left" | "right") => void
}

/**
 * Whether a node id refers to a task. Derived from the entity model; falls back
 * to the id prefix ("t") for ids not yet hydrated into the store.
 */
export const isTaskId = (id: string) => {
  const kind = getEntity(id)?.kind
  return kind ? kind === "task" : id.startsWith("t")
}

/**
 * Whether a node id refers to an event. Derived from the entity model; falls
 * back to the id prefix ("e") for ids not yet hydrated into the store.
 */
export const isEventId = (id: string) => {
  const kind = getEntity(id)?.kind
  return kind ? kind === "event" : id.startsWith("e")
}

/**
 * Whether a node id refers to an instant. Derived from the entity model; falls
 * back to the id prefix ("i") for ids not yet hydrated into the store.
 */
export const isInstantId = (id: string) => {
  const kind = getEntity(id)?.kind
  return kind ? kind === "instant" : id.startsWith("i")
}

/**
 * Minimum spacing between consecutive layer closes. Tuned just under the layer
 * morph's perceived settle time so queued closes feel snappy yet never overlap
 * into a multi-frame flash.
 */
const CLOSE_STAGGER_MS = 240

const ZeroNavContext = createContext<ZeroNavContextValue | null>(null)

export function ZeroNavProvider({
  children,
  rootSpaceId = "s_root",
}: {
  children: React.ReactNode
  rootSpaceId?: string
}) {
  const [stack, setStack] = useState<string[]>([rootSpaceId])
  const [dataVersion, setDataVersion] = useState(0)
  const [pulse, setPulse] = useState<{ id: string; n: number } | null>(null)
  // Per-entity record of how its window was opened (timeline marker vs DO-list
  // row). Only meaningful for events/instants; spaces/tasks ignore it.
  const [sources, setSources] = useState<Record<string, OpenSource>>({})

  // --- Selection + keyboard navigation state ---------------------------------
  const [selection, setSelection] = useState<Selection>(null)
  const [inputMode, setInputModeState] = useState<InputMode>("mouse")
  // Published navigable order per region. A ref (not state) since it changes on
  // every list render but only ever needs to be *read* lazily by moveSelection —
  // keeping it out of React state avoids a render loop.
  const navOrderRef = useRef<NavOrder>({ list: [], dock: [] })
  // Mirror inputMode in a ref so the global pointermove listener can read the
  // current mode without re-subscribing on every change.
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

  // Spatial arrow-key navigation. Dock sits ABOVE the list:
  //  - list: Down/Up move within; Up on the first row crosses up into the dock.
  //  - dock: Left/Right move between cards; Down returns to the list's first row.
  const moveSelection = useCallback((dir: "up" | "down" | "left" | "right") => {
    const { list, dock } = navOrderRef.current
    setSelection((cur) => {
      // Nothing selected yet: arrow keys seed a sensible default.
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
        return cur // left/right are no-ops within the vertical list
      }
      // cur.region === "dock"
      const j = dock.indexOf(cur.key)
      if (j === -1) return dock.length ? { region: "dock", key: dock[0] } : cur
      if (dir === "left") return { region: "dock", key: dock[Math.max(j - 1, 0)] }
      if (dir === "right") return { region: "dock", key: dock[Math.min(j + 1, dock.length - 1)] }
      if (dir === "down") return list.length ? { region: "list", key: list[0] } : cur
      return cur // up is a no-op at the top region
    })
    inputModeRef.current = "keyboard"
    setInputModeState("keyboard")
  }, [])

  const notifyDataChanged = useCallback(() => setDataVersion((v) => v + 1), [])

  const requestPulse = useCallback((id: string) => {
    setPulse((prev) => ({ id, n: (prev?.n ?? 0) + 1 }))
  }, [])

  // Merge any localStorage-persisted user items in after mount. Doing this in
  // an effect (not during render) keeps the first client render identical to
  // the server render, then bumps dataVersion so selectors re-read with the
  // restored items.
  useEffect(() => {
    if (hydrateFromStorage()) setDataVersion((v) => v + 1)
  }, [])

  // Any real mouse movement returns us to "mouse" mode, which collapses the
  // persistent keyboard highlight (a selected row only stays lit under the
  // pointer). Guarded by the ref so we don't setState on every pixel of motion.
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

  const open = useCallback((id: string, source: OpenSource = "timeline") => {
    setSources((prev) => (prev[id] === source ? prev : { ...prev, [id]: source }))
    setStack((prev) => {
      if (prev[prev.length - 1] === id) return prev
      return [...prev, id]
    })
  }, [])

  const openSourceOf = useCallback(
    (id: string): OpenSource => sources[id] ?? "timeline",
    [sources],
  )

  // Closing is serialized. Each layer collapse is a shared-element morph (~0.4s)
  // kept mounted by AnimatePresence while it animates out. Firing several closes
  // at once (rapid Escape / clicks) left multiple layers mid-exit and visible
  // simultaneously, reading as a brief "all children open" overlap flash. We
  // pop at most one layer per stagger window and queue any extra requests, so
  // each layer exits cleanly on its own before the next begins.
  const closeLockRef = useRef(false)
  const pendingCloseRef = useRef(0)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const closeSpace = useCallback(() => {
    if (closeLockRef.current) {
      // A close is already animating — remember this request and run it next.
      pendingCloseRef.current += 1
      return
    }
    closeLockRef.current = true
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))

    const release = () => {
      if (pendingCloseRef.current > 0) {
        pendingCloseRef.current -= 1
        setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
        closeTimerRef.current = setTimeout(release, CLOSE_STAGGER_MS)
      } else {
        closeLockRef.current = false
      }
    }
    closeTimerRef.current = setTimeout(release, CLOSE_STAGGER_MS)
  }, [])

  // Clear any pending stagger timer on unmount.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  // Pressing Escape closes the current focus window (pops the top child),
  // mirroring the close button — and routes through the same serialized
  // closeSpace so rapid presses don't overlap. No-op at the root since there is
  // nothing to collapse. We skip it while the user is mid-typing in a field so
  // Escape can still serve its native role there.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      const el = e.target as HTMLElement | null
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return
      closeSpace()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [closeSpace])

  const goToDepth = useCallback((depth: number) => {
    setStack((prev) => prev.slice(0, Math.max(1, depth + 1)))
  }, [])

  const value = useMemo<ZeroNavContextValue>(() => {
    const activeId = stack[stack.length - 1]
    const depth = stack.length - 1
    const entity = getEntity(activeId)
    const kind: EntityKind = entity?.kind ?? "space"

    const title = entity?.title ?? ""
    const description = entity?.description ?? ""
    // Every opened entity is its OWN context: the timeline / spaces row / lists
    // filter to the active node's own children + tagged items. A leaf task or
    // event simply has none, so its context is empty (rather than wrongly
    // showing the parent's children, which also left the opened row as a gap).
    const contextSpaceId = activeId

    const activeNode: ActiveNode = {
      id: activeId,
      depth,
      kind,
      isChild: depth > 0,
      contextSpaceId,
      title,
      description,
    }

    return {
      stack,
      activeSpaceId: activeId,
      activeNode,
      open,
      openSpace: open,
      openTask: open,
      closeSpace,
      goToDepth,
      dataVersion,
      notifyDataChanged,
      pulse,
      requestPulse,
      openSourceOf,
      selection,
      inputMode,
      select,
      clearSelection,
      setInputMode,
      publishNavOrder,
      moveSelection,
    }
    // dataVersion is included so title/description re-read after edits/hydration.
  }, [
    stack,
    open,
    closeSpace,
    goToDepth,
    dataVersion,
    notifyDataChanged,
    pulse,
    requestPulse,
    openSourceOf,
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
 * `box-shadow`. CRITICAL: this is PAINT-ONLY (no `scale`/transform). These rows
 * and dock cards own a shared `layoutId`, and Framer drives its open/close morph
 * by writing `transform` on that same node. Animating `scale` here (as an
 * earlier version did) clobbers that projection transform and strands stretched,
 * low-opacity "ghosts" of the title/frame during the morph. `box-shadow` never
 * touches `transform`, so the lift is safe to keep on a morphing node.
 *
 * `HIGHLIGHT_SHADOW_NONE` mirrors the same two-shadow structure (ring + drop) so
 * Motion interpolates cleanly between the rest and active states.
 */
export const HIGHLIGHT_SHADOW = "0 0 0 1.5px var(--ring), 0 12px 28px -10px rgba(0,0,0,0.28)"
export const HIGHLIGHT_SHADOW_NONE = "0 0 0 0px rgba(0,0,0,0), 0 0px 0px 0px rgba(0,0,0,0)"

/**
 * Wires a DO-list row or dock card into the shared selection model. Returns the
 * single source of truth (`showHighlight`) for the lifted look:
 *  - **mouse** mode: true only while the pointer is physically over the cell
 *    (`hovered`), so leaving onto empty space highlights nothing.
 *  - **keyboard** mode: true whenever this cell is the selection, so the
 *    highlight persists with no pointer present.
 * `hoverProps` records the selection on pointer-enter (mouse mode) so a follow-up
 * Enter targets the hovered cell; the cell is scrolled into view when it becomes
 * the keyboard selection.
 */
export function useRowSelection(region: SelectionRegion, key: string) {
  const { selection, inputMode, select } = useZeroNav()
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLElement | null>(null)
  const selected = selection?.region === region && selection.key === key
  const showHighlight = hovered || (selected && inputMode === "keyboard")

  useEffect(() => {
    if (selected && inputMode === "keyboard") {
      ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
    }
  }, [selected, inputMode])

  const hoverProps = {
    onPointerEnter: () => {
      setHovered(true)
      select(region, key, "mouse")
    },
    onPointerLeave: () => setHovered(false),
  }

  return { selected, showHighlight, hoverProps, ref }
}
