"use client"

import { useEffect } from "react"
import { resyncFromStorage } from "./data"
import { USER_ITEMS_STORAGE_KEY } from "./persistence"

/**
 * TIER-2 cross-window sync (same browser / same origin). Installs a `storage` listener
 * that fires ONLY in OTHER windows/tabs when our user-items key changes — the window that
 * made the write never receives its own `storage` event, so there is no echo loop. On a
 * relevant change we rebuild the in-memory store from localStorage ({@link resyncFromStorage})
 * and, if anything actually changed, invoke `onChange` (the canvas's re-render bump).
 *
 * `e.key === null` means localStorage was CLEARED wholesale (e.g. the dev reset) — treat as
 * a change. Scoped to ENTITY data (entities + pins + order + seed overrides + tombstones);
 * presence/activity is intentionally left PER-WINDOW, since two windows continuously
 * recording presence to one key would thrash each other under last-write-wins.
 *
 * Caveat (documented, acceptable for browse-in-one / work-in-another): last-write-wins on
 * the whole blob — simultaneous edits to the SAME entity in both windows can lose one side.
 */
export function useZeroCrossWindowSync(onChange: () => void): void {
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      // Ignore unrelated keys; null key = full clear, which we do want to react to.
      if (e.key !== null && e.key !== USER_ITEMS_STORAGE_KEY) return
      if (resyncFromStorage()) onChange()
    }
    window.addEventListener("storage", handler)
    return () => window.removeEventListener("storage", handler)
  }, [onChange])
}
