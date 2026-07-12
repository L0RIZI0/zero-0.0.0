// SHARED right-click MENU MODEL for the root canvas.
//
// One source of truth for the entity context-menu, consumed by BOTH:
//   • the in-DOM menu (`Zero0DomMenu`), used when nothing occludes it, and
//   • the NATIVE overlay window (`/desktop/context-menu`), used on desktop when a web
//     Resource is open — a DOM menu can't paint over a native WebContentsView, so the
//     menu is drawn in a transparent child window floating ABOVE the site (the site
//     stays put; no parking/blanking).
//
// The overlay runs in its OWN renderer process with its own in-memory data, so it must
// NOT mutate directly — it renders a generic item tree, reports the chosen action id,
// and the MAIN window (which owns the live dataset) executes it via
// `applyEntityMenuAction`. Keeping the item list + the resolver here guarantees both
// paths show and do the exact same thing.

import {
  deleteEntity,
  setEntityCompleted,
  setEntityClosed,
  setEntityCancelled,
  setEntityRequested,
  setEntityScheduleField,
  reopenEntity,
  changeEntityKind,
} from "@/lib/zero/data"
import { isClosed, KIND_META } from "@/lib/zero/kinds"
import { isDone } from "@/lib/zero/entity-log"
import type { Entity, EntityKind } from "@/lib/zero/types"

// A generic, serialisable menu tree. `submenu` is an inline expander (the overlay and
// the DOM menu both expand it locally; only the final leaf action id crosses IPC).
export type MenuItem =
  | { type: "divider" }
  | { type: "item"; id: string; label: string; danger?: boolean; glyphKind?: EntityKind; current?: boolean }
  | { type: "submenu"; label: string; items: MenuItem[] }

// The kinds an entity can be turned INTO — the creatable set only (identity kinds
// `individual`/`soul` are excluded: not user-creatable, and changing them would break
// root-scoping).
const CHANGE_KINDS: EntityKind[] = ["task", "space", "resource", "moment", "instant", "community", "organism"]

/**
 * Build the entity menu as a pure function of the entity's kind + STATE model. Mirrors
 * the lifecycle rules: Mark Done/Undone (tasks only), Close/Retire/End, Cancel (not for
 * individuals) when live; Reopen when ended; Send/Unsend request (tasks); Change into…;
 * Delete. Action ids are resolved by {@link applyEntityMenuAction}.
 */
export function buildEntityMenuItems(entity: Entity): MenuItem[] {
  const meta = KIND_META[entity.kind]
  const closeable = meta.fillsWhenClosed || meta.terminal != null
  const ended = isClosed(entity)
  const done = isDone(entity)
  const requested = entity.kind === "task" && !!entity.requested
  const closeLabel = meta.terminal === "retire" ? "Retire" : meta.terminal === "death" ? "End" : "Close"

  const items: MenuItem[] = []

  if (closeable) {
    if (ended) {
      items.push({ type: "item", id: "reopen", label: "Reopen" })
    } else {
      if (meta.hasDoneState) {
        items.push({ type: "item", id: done ? "undone" : "done", label: done ? "Mark as Undone" : "Mark as Done" })
      }
      items.push({ type: "item", id: "close", label: closeLabel })
      if (entity.kind !== "individual") {
        items.push({ type: "item", id: "cancel", label: "Cancel" })
      }
    }
  }

  if (entity.kind === "task") {
    items.push({
      type: "item",
      id: requested ? "unrequest" : "request",
      label: requested ? "Unsend request" : "Send as request",
    })
  }

  // NOW-stamps (quick lifecycle, temporary): let the user set a moment's start/end — or an
  // instant's point — to the current instant WITHOUT drilling into the entity. Only offered
  // while live (an ended entity's times are historical). Simple: stamps `Date.now()` with no
  // cross-midnight adjustment (the create bar's `--start:now` etc. is the fuller path).
  if (!ended) {
    if (entity.kind === "moment") {
      items.push({ type: "item", id: "start-now", label: "Start now" })
      items.push({ type: "item", id: "end-now", label: "End now" })
    } else if (entity.kind === "instant") {
      items.push({ type: "item", id: "set-now", label: "Set to now" })
    }
  }

  items.push({
    type: "submenu",
    label: "Change into…",
    items: CHANGE_KINDS.filter((k) => k !== entity.kind).map((k) => ({
      type: "item" as const,
      id: `change:${k}`,
      label: KIND_META[k].label,
      glyphKind: k,
    })),
  })

  items.push({ type: "divider" })
  items.push({ type: "item", id: "delete", label: "Delete", danger: true })

  return items
}

/**
 * Execute a chosen entity-menu action id against the LIVE dataset. Called only in the
 * main window (which owns the in-memory data); the caller is responsible for bumping the
 * render revision afterward. Returns true if the id matched an entity action.
 */
export function applyEntityMenuAction(entity: Entity, actionId: string): boolean {
  const id = entity.id
  if (actionId.startsWith("change:")) {
    changeEntityKind(id, actionId.slice("change:".length) as EntityKind)
    return true
  }
  switch (actionId) {
    case "done":
      setEntityCompleted(id, true)
      return true
    case "undone":
      setEntityCompleted(id, false)
      return true
    case "close":
      setEntityClosed(id, true)
      return true
    case "cancel":
      setEntityCancelled(id, true)
      return true
    case "reopen":
      reopenEntity(id)
      return true
    case "start-now":
      setEntityScheduleField(id, "startAt", Date.now())
      return true
    case "end-now":
      setEntityScheduleField(id, "endAt", Date.now())
      return true
    case "set-now":
      setEntityScheduleField(id, "at", Date.now())
      return true
    case "request":
      setEntityRequested(id, true)
      return true
    case "unrequest":
      setEntityRequested(id, false)
      return true
    case "delete":
      deleteEntity(id)
      return true
    default:
      return false
  }
}
