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
 * The key is versioned. `zero:root-items:v1` is the ROOT canvas's OWN namespace,
 * isolated from the frozen `/2` app (which persists under `zero:user-items:v2` via
 * its vendored `lib/zero-002` copy). This isolation means the root canvas starts
 * from a clean, independent dataset and can never read or clobber the dogfooding
 * data behind `/2`.
 */

const STORAGE_KEY = "zero:root-items:v1"

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

/**
 * Per-resource "resume where I left off" — remembers the LAST url a resource task
 * was navigated to (desktop native web view only tracks this), so reopening a
 * closed resource lands on the page you were on rather than its original webUrl.
 *
 * Stored under its OWN dedicated key (NOT folded into the entity), so it never
 * mutates persisted entity data or its shape: a plain `{ [entityId]: url }` map.
 * Fully additive + disposable — wiping the key just resets every resource to its
 * seed/origin url. Keyed by entity id, so it survives title/URL edits.
 */
const RESOURCE_LAST_URL_KEY = "zero:resource-last-url:v1"

export function readResourceLastUrls(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(RESOURCE_LAST_URL_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** Last remembered url for one resource, or null if none stored yet. */
export function readResourceLastUrl(id: string): string | null {
  const url = readResourceLastUrls()[id]
  return typeof url === "string" && url ? url : null
}

/** Remember the last url for a resource (no-op if unchanged). */
export function writeResourceLastUrl(id: string, url: string): void {
  if (typeof window === "undefined" || !id || !url) return
  try {
    const all = readResourceLastUrls()
    if (all[id] === url) return
    all[id] = url
    window.localStorage.setItem(RESOURCE_LAST_URL_KEY, JSON.stringify(all))
  } catch {
    // Storage unavailable — fail quietly (resume just won't persist this session).
  }
}

/** Wipe all remembered resource urls (THIS browser only). Part of the `§ 0` reset. */
export function clearResourceLastUrls(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(RESOURCE_LAST_URL_KEY)
  } catch {
    // Ignore.
  }
}
