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
    }
    // dataVersion is included so title/description re-read after edits/hydration.
  }, [stack, open, closeSpace, goToDepth, dataVersion, notifyDataChanged, pulse, requestPulse, openSourceOf])

  return <ZeroNavContext.Provider value={value}>{children}</ZeroNavContext.Provider>
}

export function useZeroNav() {
  const ctx = useContext(ZeroNavContext)
  if (!ctx) throw new Error("useZeroNav must be used within ZeroNavProvider")
  return ctx
}
