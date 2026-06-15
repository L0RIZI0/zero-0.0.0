"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { getEntity, hydrateFromStorage } from "./data"
import { captureSourceRect, type Rect } from "./motion"
import { captureHeaders, playHeaderMorph, gsap, MORPH_DURATION } from "./flip-stage"
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
  /** Push any entity onto the stack (dive deeper). Every entity opens as a
   *  framed window (events resolve to their parent at the call site).
   *  `source` records whether an event/instant was opened from its timeline
   *  marker or its DO-list row, so the frame can morph to/from the right one. */
  open: (id: string, source?: OpenSource) => void
  /** Pop the top entity (close the frontmost window). */
  close: () => void
  /** Close the window at absolute stack index `depth`. ONLY that window animates
   *  its shrink-back-to-source; any deeper children are removed instantly (they
   *  vanish without their own close animation). Used by every window's header
   *  close button — clicking an ancestor's peeking header collapses everything
   *  above it in one motion. */
  closeWindow: (depth: number) => void
  /** The window currently playing its close (shrink-to-source) animation, kept
   *  mounted as an overlay until it finishes. `null` when nothing is closing. */
  closing: { id: string; depth: number } | null
  /** Called by the closing overlay once its shrink animation settles, so the
   *  store can drop it from the render tree. */
  finishClosing: (id: string) => void
  /** True for the duration of any window morph (open or close). Frames use it to
   *  drop body clipping mid-resize (so a descendant window isn't cropped) and to
   *  gate hover affordances while a frame is animating. */
  animating: boolean
  /** A SPACE that is open but NOT the frontmost window — i.e. one of its own
   *  children is open in front of it — collapses its header into a vertical left
   *  spine. True only for such spaces; tasks/events never spine, and the root
   *  backdrop (index 0) is never a frame so never a spine. */
  isSpine: (id: string) => boolean
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
  /** The viewport rect of the row/card/marker this entity was opened from,
   *  captured at click time and retained so the window can shrink back into it
   *  on close even though the source is unmounted while the window is open.
   *  Null when it was never captured (e.g. opened programmatically). */
  sourceRectOf: (id: string) => Rect | null

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

const ZeroNavContext = createContext<ZeroNavContextValue | null>(null)

export function ZeroNavProvider({
  children,
  rootSpaceId = "s_root",
}: {
  children: React.ReactNode
  rootSpaceId?: string
}) {
  const [stack, setStack] = useState<string[]>([rootSpaceId])
  // A live mirror of the stack so event handlers + morph orchestrators read the
  // committed stack synchronously without stale-closure risk.
  const stackRef = useRef(stack)
  useEffect(() => {
    stackRef.current = stack
  }, [stack])
  // The window currently shrinking back to its source on close. Rendered as a
  // standalone overlay by the layer stack so ONLY it animates while the deeper
  // children it closed over are dropped instantly.
  const [closing, setClosing] = useState<{ id: string; depth: number } | null>(null)
  // True while any window morph is in flight. A ref mirrors it so the morph
  // orchestrators can schedule the "settle" without stale-closure risk.
  const [animating, setAnimating] = useState(false)
  const settleTimer = useRef<ReturnType<typeof gsap.delayedCall> | null>(null)
  const [dataVersion, setDataVersion] = useState(0)
  const [pulse, setPulse] = useState<{ id: string; n: number } | null>(null)
  // Per-entity record of how its window was opened (timeline marker vs DO-list
  // row). Only meaningful for events/instants; spaces/tasks ignore it.
  const [sources, setSources] = useState<Record<string, OpenSource>>({})
  // Per-entity viewport rect of the element the window was opened from, captured
  // at click time. A ref (not state) because the morph reads it imperatively and
  // it must never trigger a re-render. Reused for the close shrink.
  const sourceRectsRef = useRef<Record<string, Rect>>({})

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

  // Mark a morph as in flight and (re)schedule its settle. Re-enabling happens
  // exactly one MORPH_DURATION after the latest gesture, so rapid dives keep the
  // animating guard (overflow-visible, no hover) up until everything lands.
  const beginMorph = useCallback(() => {
    setAnimating(true)
    settleTimer.current?.kill()
    settleTimer.current = gsap.delayedCall(MORPH_DURATION, () => setAnimating(false))
  }, [])

  const open = useCallback(
    (id: string, source: OpenSource = "timeline") => {
      // Re-clicking the already-open top is a no-op morph.
      if (stackRef.current[stackRef.current.length - 1] === id) return
      // Capture the source element's box NOW, while it is still on screen — the
      // window grows out of it, and shrinks back into it on close (by which point
      // the source is unmounted, so this stored rect is the only reference).
      const rect = captureSourceRect(id, source) ?? captureSourceRect(id)
      if (rect) sourceRectsRef.current[id] = rect
      // Snapshot the resident ancestor headers BEFORE the stack changes, so the
      // soon-to-be-spine space can Flip from its current horizontal header.
      const headers = captureHeaders()
      flushSync(() => {
        setSources((prev) => (prev[id] === source ? prev : { ...prev, [id]: source }))
        setStack((prev) => (prev[prev.length - 1] === id ? prev : [...prev, id]))
      })
      // After commit: morph the resident headers (new window grows via its own
      // gsap.fromTo in EntityFrame, on the same duration/ease).
      playHeaderMorph(headers)
      beginMorph()
    },
    [beginMorph],
  )

  const openSourceOf = useCallback(
    (id: string): OpenSource => sources[id] ?? "timeline",
    [sources],
  )

  const sourceRectOf = useCallback((id: string): Rect | null => sourceRectsRef.current[id] ?? null, [])

  // Close the window at absolute index `depth`. We remove it AND everything
  // above it from the stack in one update (deeper children vanish instantly),
  // then mark it as `closing` so the layer stack mounts it once more as a
  // standalone overlay that shrinks back into its source row/card. This is the
  // whole "only the clicked window animates" behavior: the deeper levels are
  // already gone, so they never play their own close.
  const closeWindow = useCallback(
    (depth: number) => {
      const cur = stackRef.current
      if (depth < 1 || depth >= cur.length) return
      // Snapshot resident headers BEFORE the stack shrinks, so an ancestor space
      // that is about to un-spine can Flip from its current vertical rail back to
      // a horizontal header.
      const headers = captureHeaders()
      flushSync(() => {
        setClosing({ id: cur[depth], depth })
        setStack(cur.slice(0, depth))
      })
      playHeaderMorph(headers)
      beginMorph()
    },
    [beginMorph],
  )

  // The closing overlay reports back here when its shrink settles so we can drop
  // it. Guarded by id so a newer close (which replaced `closing`) isn't cleared
  // by a stale completion from the previous one.
  const finishClosing = useCallback((id: string) => {
    setClosing((c) => (c && c.id === id ? null : c))
  }, [])

  // Escape / generic "close current" closes the frontmost window.
  const close = useCallback(() => {
    closeWindow(stackRef.current.length - 1)
  }, [closeWindow])

  // Pressing Escape closes the current focus window (pops the top child),
  // mirroring the close button. No-op at the root since there is nothing to
  // collapse. We skip it while the user is mid-typing in a field so Escape can
  // still serve its native role there.
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
    // Every opened entity is its OWN context: the timeline / dock / lists filter
    // to the active entity's own children + tagged items. A leaf task or event
    // simply has none, so its context is empty.
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

    // A space is a spine when it sits in the stack ABOVE the root backdrop
    // (index >= 1) and BELOW the frontmost window (a child is open in front of
    // it). The root (index 0) is the home backdrop, never a frame, so never a
    // spine even though it is a space.
    const isSpine = (id: string) => {
      const idx = stack.indexOf(id)
      return idx >= 1 && idx < stack.length - 1 && getEntity(id)?.kind === "space"
    }

    return {
      stack,
      activeId,
      activeEntity,
      open,
      close,
      closeWindow,
      closing,
      finishClosing,
      animating,
      isSpine,
      sourceRectOf,
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
    close,
    closeWindow,
    closing,
    finishClosing,
    animating,
    sourceRectOf,
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
 * `box-shadow`. `HIGHLIGHT_SHADOW_NONE` mirrors the same two-shadow structure
 * (ring + drop) so Motion interpolates cleanly between the rest and active
 * states. Rows/cards are plain morph SOURCES now (no shared `layoutId`), so a
 * `scale` lift on them is perfectly safe and never disturbs the window morph.
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

  // `lift` drives the transform-scale part of the highlight. With the new
  // single-tree layer model there is no `transform: scale` on the frames (the
  // recede is pure inset), and exiting frames drop their shared layoutIds, so a
  // scale on the row is safe and does not corrupt the close morph. Kept as a
  // distinct flag so it can be decoupled from the paint-only shadow if needed.
  const lift = showHighlight

  return { selected, showHighlight, lift, hoverProps, ref }
}
