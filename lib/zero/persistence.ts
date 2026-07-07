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
  /**
   * Per-context custom sibling ORDER for the do-list (drag-and-drop reorder):
   * context space id → the ordered list of child ids the user arranged. Additive
   * and fully back-compat — a missing/empty entry means "use natural creation
   * order". Ids not present fall to the end in creation order, so newly created
   * items keep appending at the bottom. Scoped per-context (like pins) so a
   * tagged item can sit in a different position in each list it appears in.
   */
  order: Record<string, string[]>
  /**
   * Tombstones — ids of SEEDED entities the user deleted. (User-created
   * entities are removed simply by not serializing them.) Applied on hydrate
   * so deletions of demo data also survive refreshes.
   */
  deletedIds: string[]
  /**
   * Partial overrides for SEEDED entities the user mutated in place (e.g.
   * cancelling an event). Keyed by id; merged onto the seeded entity on
   * hydrate. User-created entities carry their full state in `entities`.
   */
  overrides: Record<string, Partial<Entity>>
}

export const emptyUserItems = (): UserItems => ({
  entities: [],
  pins: {},
  order: {},
  deletedIds: [],
  overrides: {},
})

export function readUserItems(): UserItems {
  if (typeof window === "undefined") return emptyUserItems()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyUserItems()
    const parsed = JSON.parse(raw) as Partial<UserItems>
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      pins: parsed.pins && typeof parsed.pins === "object" ? parsed.pins : {},
      order: parsed.order && typeof parsed.order === "object" ? parsed.order : {},
      deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [],
      overrides:
        parsed.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {},
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

/**
 * Wipe ALL persisted user items (created entities + pins + tombstones +
 * overrides) for THIS browser only. localStorage is per-browser/per-origin, so
 * this never touches another device's store (e.g. the Electron dogfooding app).
 * Used by the `§ 0` dev "reset preview data" chord to return the web preview to
 * pure seed data — chiefly to drop accumulated seed-deletion tombstones that
 * were hiding the seeded spaces/tasks. Does NOT touch other keys (theme, etc.).
 */
export function clearUserItems(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore — nothing more we can do if storage is unavailable.
  }
}
