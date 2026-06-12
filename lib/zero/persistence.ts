import type { Entity } from "./types"

/**
 * localStorage persistence for user-created entities. Only entities the user
 * creates are stored — the seeded demo data lives in code.
 *
 * Hydration is deliberately effect-driven (see `hydrateFromStorage` in data.ts
 * being called from a client effect): the first client render must match the
 * server render (seed data only), then stored entities are merged in after
 * mount to avoid hydration mismatches.
 *
 * The key is versioned (v2 = unified Entity model). Bumping it cleanly retires
 * any data written under the old three-type shape.
 */

const STORAGE_KEY = "zero:user-items:v2"

export interface UserItems {
  entities: Entity[]
  /** Per-context pin map: context space id → ordered list of pinned item ids. */
  pins: Record<string, string[]>
}

export const emptyUserItems = (): UserItems => ({ entities: [], pins: {} })

export function readUserItems(): UserItems {
  if (typeof window === "undefined") return emptyUserItems()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyUserItems()
    const parsed = JSON.parse(raw) as Partial<UserItems>
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      pins: parsed.pins && typeof parsed.pins === "object" ? parsed.pins : {},
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
