"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { getSpace, getTask, hydrateFromStorage } from "./data"

export interface ActiveNode {
  id: string
  /** Depth in the stack — 0 is root (Space 0). */
  depth: number
  kind: "space" | "task"
  /** True for any node below the root, i.e. a framed child window is open. */
  isChild: boolean
  /** The space id used for context filtering (a task resolves to its space). */
  contextSpaceId: string
  title: string
  /** Present for spaces (and, later, tasks/events). Empty string when none. */
  description: string
}

interface ZeroNavContextValue {
  /** Stack of node ids. stack[0] is always the root, "s_root". Entries are
   *  space ids (prefixed "s_") or task ids (prefixed "t"). */
  stack: string[]
  /** The currently focused (top of stack) node id. */
  activeSpaceId: string
  /** Rich description of the focused node — drives filtering + timeline offset. */
  activeNode: ActiveNode
  /** Push a child space onto the stack (dive deeper). */
  openSpace: (spaceId: string) => void
  /** Push a task onto the stack — tasks open as windows like spaces do. */
  openTask: (taskId: string) => void
  /** Pop the top node (close current layer). */
  closeSpace: () => void
  /** Jump to a specific depth in the stack (used by breadcrumb). */
  goToDepth: (depth: number) => void
  /** Bumps on any in-memory data mutation so selectors re-read fresh data. */
  dataVersion: number
  /** Signal that the underlying data arrays changed (task/space/event added). */
  notifyDataChanged: () => void
}

/** Task ids are prefixed "t", space ids "s_". */
export const isTaskId = (id: string) => id.startsWith("t")

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

  const notifyDataChanged = useCallback(() => setDataVersion((v) => v + 1), [])

  // Merge any localStorage-persisted user items in after mount. Doing this in
  // an effect (not during render) keeps the first client render identical to
  // the server render, then bumps dataVersion so selectors re-read with the
  // restored items.
  useEffect(() => {
    if (hydrateFromStorage()) setDataVersion((v) => v + 1)
  }, [])

  const openSpace = useCallback((spaceId: string) => {
    setStack((prev) => {
      if (prev[prev.length - 1] === spaceId) return prev
      return [...prev, spaceId]
    })
  }, [])

  const openTask = useCallback((taskId: string) => {
    setStack((prev) => {
      if (prev[prev.length - 1] === taskId) return prev
      return [...prev, taskId]
    })
  }, [])

  const closeSpace = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }, [])

  const goToDepth = useCallback((depth: number) => {
    setStack((prev) => prev.slice(0, Math.max(1, depth + 1)))
  }, [])

  const value = useMemo<ZeroNavContextValue>(() => {
    const activeId = stack[stack.length - 1]
    const depth = stack.length - 1
    const kind: ActiveNode["kind"] = isTaskId(activeId) ? "task" : "space"

    let title = ""
    let description = ""
    let contextSpaceId = activeId
    if (kind === "task") {
      const task = getTask(activeId)
      title = task?.title ?? ""
      // A task resolves to its primary (deepest) space for context filtering.
      contextSpaceId = task?.spaceIds[task.spaceIds.length - 1] ?? "s_root"
    } else {
      const space = getSpace(activeId)
      title = space?.name ?? ""
      description = space?.description ?? ""
      contextSpaceId = activeId
    }

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
      openSpace,
      openTask,
      closeSpace,
      goToDepth,
      dataVersion,
      notifyDataChanged,
    }
    // dataVersion is included so title/description re-read after edits/hydration.
  }, [stack, openSpace, openTask, closeSpace, goToDepth, dataVersion, notifyDataChanged])

  return <ZeroNavContext.Provider value={value}>{children}</ZeroNavContext.Provider>
}

export function useZeroNav() {
  const ctx = useContext(ZeroNavContext)
  if (!ctx) throw new Error("useZeroNav must be used within ZeroNavProvider")
  return ctx
}
