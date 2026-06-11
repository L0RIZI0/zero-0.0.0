import type { Space, Task, ZeroEvent } from "./types"

/**
 * localStorage persistence for user-created items. Only items the user creates
 * (tasks / spaces / events) are stored — the seeded demo data lives in code.
 *
 * Hydration is deliberately effect-driven (see `hydrateFromStorage` in data.ts
 * being called from a client effect): the first client render must match the
 * server render (seed data only), then stored items are merged in after mount
 * to avoid hydration mismatches.
 */

const STORAGE_KEY = "zero:user-items:v1"

export interface UserItems {
  tasks: Task[]
  spaces: Space[]
  events: ZeroEvent[]
}

export const emptyUserItems = (): UserItems => ({ tasks: [], spaces: [], events: [] })

export function readUserItems(): UserItems {
  if (typeof window === "undefined") return emptyUserItems()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyUserItems()
    const parsed = JSON.parse(raw) as Partial<UserItems>
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      spaces: Array.isArray(parsed.spaces) ? parsed.spaces : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
    }
  } catch {
    return emptyUserItems()
  }
}

export function writeUserItems(items: UserItems): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // Storage unavailable (private mode / quota) — fail quietly, items remain
    // in memory for the session.
  }
}
