"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"

interface ZeroNavContextValue {
  /** Stack of node ids. stack[0] is always the root, "s_root". Entries are
   *  space ids (prefixed "s_") or task ids (prefixed "t"). */
  stack: string[]
  /** The currently focused (top of stack) node id. */
  activeSpaceId: string
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

  const value = useMemo<ZeroNavContextValue>(
    () => ({
      stack,
      activeSpaceId: stack[stack.length - 1],
      openSpace,
      openTask,
      closeSpace,
      goToDepth,
    }),
    [stack, openSpace, openTask, closeSpace, goToDepth],
  )

  return <ZeroNavContext.Provider value={value}>{children}</ZeroNavContext.Provider>
}

export function useZeroNav() {
  const ctx = useContext(ZeroNavContext)
  if (!ctx) throw new Error("useZeroNav must be used within ZeroNavProvider")
  return ctx
}
