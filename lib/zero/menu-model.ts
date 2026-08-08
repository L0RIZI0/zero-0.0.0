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
  setTaskDone,
  setEntityClosed,
  setEntityCancelled,
  setEntityPublished,
  setEntityRequested,
  setEntityScheduleField,
  setEntityAccent,
  setEntityHidden,
  reopenEntity,
  changeEntityKind,
  markInstant,
  openSession,
  closeSession,
} from "@/lib/zero/data"
import {
  isClosed,
  KIND_META,
  hasOpenSession,
  isPlayable,
  canDeleteEntity,
  canCancelEntity,
  entityHiddenState,
} from "@/lib/zero/kinds"
import { isDone } from "@/lib/zero/entity-log"
import { FACE_SIZES, faceSizeLabel, FACE_MAKES, faceMakeLabel, type FaceSize, type FaceMake } from "@/lib/zero/face-model"
import type { Entity, EntityKind } from "@/lib/zero/types"

// A generic, serialisable menu tree. `submenu` is an inline expander (the overlay and
// the DOM menu both expand it locally; only the final leaf action id crosses IPC).
export type MenuItem =
  | { type: "divider" }
  | {
      type: "item"
      id: string
      label: string
      danger?: boolean
      glyphKind?: EntityKind
      current?: boolean
      /** Rendered faded + non-interactive; selecting it is a no-op. Used for
          present-but-not-yet-wired affordances (e.g. the occurrence "Edit" placeholder). */
      disabled?: boolean
      /** A `#rrggbb` swatch drawn as a leading dot (the color picker rows). */
      swatch?: string
    }
  | { type: "submenu"; label: string; items: MenuItem[]; glyphKind?: EntityKind }
  // The unified color entry: the renderer draws the shared swatch ramp + a "hex or name…" input
  // (which reveals the HSV picker on focus). All paths report back through the `color:<hex>`
  // action id. `current` seeds the field/dot with the entity's existing accent, if any.
  | { type: "colorInput"; current?: string }

/** Build the "Set color…" submenu for an entity. v0.2.149: unified with the create-field picker
 *  — a SINGLE `colorInput` row renders the shared swatch ramp + "hex or name…" field (focus opens
 *  the HSV picker), seeded with the current accent; then a Clear row. All paths resolve to the
 *  `color:<hex>` action id via {@link applyEntityMenuAction} (`setEntityAccent`); `color:clear`
 *  removes the accent. Kept here so the DOM menu + native overlay share it. */
function buildColorSubmenu(entity: Entity): MenuItem {
  const current = entity.color?.toLowerCase()
  const items: MenuItem[] = [
    { type: "colorInput", current },
    { type: "divider" },
    { type: "item", id: "color:clear", label: "Clear color", current: !current },
  ]
  return { type: "submenu", label: "Set color", items }
}

// The kinds an entity can be turned INTO — the creatable set. `entity` (the raw idea) is
// included so a specialized entity can be DE-specialized back to a bare idea. Identity kinds
// `individual`/`soul` are excluded: not user-creatable, and changing them would break root-scoping.
const CHANGE_KINDS: EntityKind[] = ["entity", "task", "space", "resource", "moment", "instant", "community", "organism"]

/**
 * Build the entity menu as a pure function of the entity's kind + STATE model. Mirrors
 * the lifecycle rules: Mark Done/Undone (tasks only), Close/Retire/End, Cancel (not for
 * individuals) when live; Reopen when ended; Send/Unsend request (tasks); Change into…;
 * Delete. Action ids are resolved by {@link applyEntityMenuAction}.
 */
export function buildEntityMenuItems(
  entity: Entity,
  opts?: {
    showHidden?: boolean
    currentSize?: FaceSize
    currentMake?: FaceMake
    starterPinned?: boolean
    /** The soft-deleted children AT THIS context (from getDeletedChildren). When non-empty a
     *  "Deleted (N)" submenu is shown; picking one reports `restore:<id>` (the caller undeletes). */
    deletedChildren?: { id: string; title: string; kind: EntityKind }[]
  },
): MenuItem[] {
  const meta = KIND_META[entity.kind]
  const closeable = meta.fillsWhenClosed || meta.terminal != null
  const ended = isClosed(entity)
  const done = isDone(entity)
  const requested = entity.kind === "task" && !!entity.requested
  const closeLabel = meta.terminal === "retire" ? "Retire" : meta.terminal === "death" ? "End" : "Close"

  const items: MenuItem[] = []

  // PIN — a top-level toggle adding/removing this entity from the §4 PINS band, so its chip
  // stays listed there even when it isn't ongoing. Only offered when the caller tracks pin
  // state (`starterPinned` passed); `starter-pin` / `starter-unpin` are VIEW-ish actions
  // handled by that caller, not `applyEntityMenuAction` (which returns false for them). A
  // divider separates it from the lifecycle actions below. (Action ids keep the legacy
  // `starter-` prefix for stored/back-compat; the label is just "Pin"/"Unpin" now.)
  if (opts?.starterPinned !== undefined) {
    items.push({
      type: "item",
      id: opts.starterPinned ? "starter-unpin" : "starter-pin",
      label: opts.starterPinned ? "Unpin" : "Pin",
    })
    items.push({ type: "divider" })
  }

  if (closeable) {
    if (ended) {
      items.push({ type: "item", id: "reopen", label: "Reopen" })
    } else {
      if (meta.hasDoneFlag) {
        items.push({ type: "item", id: done ? "undone" : "done", label: done ? "Mark as Undone" : "Mark as Done" })
      }
      items.push({ type: "item", id: "close", label: closeLabel })
      // CANCEL — void the entity. Guarded by canCancelEntity: an Individual may only be cancelled
      // while not-yet-lived (open/scheduled) — once alive it's ended by Close (death), never
      // cancelled; other kinds keep the prior "cancel while live" behaviour.
      if (canCancelEntity(entity)) {
        items.push({ type: "item", id: "cancel", label: "Cancel" })
      }
    }
  }

  // PUBLISH / UNPUBLISH — offered on EVERY kind except Soul. For an Organism/Community this is the
  // ALIVE toggle (published ⇒ state `alive`, undeletable); for other kinds it's a simple published
  // flag. Label reflects current state via `publishedAt`. Resolved by applyEntityMenuAction.
  if (entity.kind !== "soul") {
    const published = entity.publishedAt != null
    items.push({ type: "item", id: published ? "unpublish" : "publish", label: published ? "Unpublish" : "Publish" })
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
    if (isPlayable(entity)) {
      // PLAYABLE kinds (idea·task·resource·moment·space). Play/Stop is a MANUAL PLAY: a `via:"play"`
      // session on the BOTTOM (recorded) rail, NOT a top-rail occurrence (the scalar start/end is
      // PLANNED-only) and NOT the auto focus/presence spine. Label reflects the running MANUAL PLAY
      // specifically (`via==="play"`), so merely VIEWING (which opens a focus session) still reads
      // "Play", and Stop only appears when a manual play is actually running.
      // v0.2.288: the TASK is NO LONGER excluded here (was `&& !meta.hasDoneFlag`). A task's DONE
      // glyph and an explicit stopwatch are ORTHOGONAL — Loris wants a right-click Play to time a
      // task without marking it done. The two coexist: Play opens a recorded span, Mark as Done sets
      // the done flag; neither implies the other.
      const playing = hasOpenSession(entity, "play")
      items.push({ type: "item", id: playing ? "stop" : "play", label: playing ? "Stop" : "Play" })
    }
    if (entity.kind === "instant") {
      // MARKABLE instant: Mark records an OCCURRENCE (a timestamp) — the same action as clicking
      // its glyph. `set-now` (re-place the lone scheduled point) stays as a secondary.
      items.push({ type: "item", id: "mark", label: "Mark" })
      items.push({ type: "item", id: "set-now", label: "Set to now" })
    }
  }

  // PLAN… — open the rich scheduling dialog (v0.2.269) for this entity: a one-off date/time,
  // end/duration or single point, a due deadline, or (with a past start) a recorded/ongoing session.
  // Offered on every kind except the Soul (matching the §0 occurrences block's reach). This is a
  // VIEW action (it opens UI and mutates nothing directly), so `applyEntityMenuAction` returns false
  // for "plan" and the canvas intercepts it to open <Zero0PlanDialog>.
  if (entity.kind !== "soul") {
    items.push({ type: "item", id: "plan", label: "Plan…" })
  }

  // SIZE — the rung this entity is shown at HERE (a VIEW override, not stored data). Only
  // offered when the caller passes `currentSize` (i.e. a surface that actually tracks per-
  // entity size, like the ENTITY CONTENT rows); `size:<value>` ids are handled by that
  // caller, not `applyEntityMenuAction` (which returns false for them, like the view toggles).
  if (opts?.currentSize) {
    items.push({
      type: "submenu",
      label: "Size",
      items: FACE_SIZES.map((s) => ({
        type: "item" as const,
        id: `size:${s}`,
        label: faceSizeLabel(s),
        current: s === opts.currentSize,
      })),
    })
  }

  // MAKE — the axis orthogonal to Size: how this Face READS (itself vs an aggregator of
  // its content). Same view-override contract as Size: only offered when the caller tracks
  // a per-entity make, and `make:<value>` is handled by that caller, not applyEntityMenuAction.
  if (opts?.currentMake) {
    items.push({
      type: "submenu",
      label: "Make",
      items: FACE_MAKES.map((m) => ({
        type: "item" as const,
        id: `make:${m}`,
        label: faceMakeLabel(m),
        current: m === opts.currentMake,
      })),
    })
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

  // Set the entity's accent color (paints its dayline tick + row). A swatch picker.
  items.push(buildColorSubmenu(entity))

  items.push({ type: "divider" })
  // HIDE / SHOW HIDDEN. "Hide" drops THIS entity from its parent's ENTITY CONTENT (a stored
  // display flag). "Show hidden" is a VIEW toggle on the current list (revealing both
  // manually-hidden and auto-hidden-closed children with a "(hidden)" prefix); it is NOT a
  // data mutation, so `applyEntityMenuAction` returns false for it and the canvas handles it.
  // Label from the EFFECTIVE hide state (manual OR derived auto-hide), not the raw flag — so an
  // auto-hidden row correctly offers "Unhide" (which pins it visible), fixing the stale-label bug.
  const hiddenNow = entityHiddenState(entity) != null
  items.push({ type: "item", id: hiddenNow ? "unhide" : "hide", label: hiddenNow ? "Unhide" : "Hide" })
  items.push({
    type: "item",
    id: opts?.showHidden ? "hide-hidden" : "show-hidden",
    label: opts?.showHidden ? "Hide hidden" : "Show hidden",
  })

  // DELETED (restore list) — the container view of soft-deleted children at THIS level. Each row
  // reports `restore:<id>`; the caller (canvas) undeletes it. Only shown when there ARE deleted
  // children here, so it's contextual and unobtrusive (chiefly the ENTITY CONTENT right-click).
  const deleted = opts?.deletedChildren ?? []
  if (deleted.length > 0) {
    items.push({
      type: "submenu",
      label: `Restore deleted (${deleted.length})`,
      // Each trashed child expands to its OWN submenu: Restore (undelete in place) OR Delete
      // permanently (the industry-standard second, irreversible delete — a hard removal of the
      // whole subtree from the store). Two deliberate actions (trash, then delete-again) are the
      // only safeguard; no confirm dialog, matching the app's dialog-free menu style.
      items: deleted.map((d) => ({
        type: "submenu" as const,
        label: d.title || "(untitled)",
        glyphKind: d.kind,
        items: [
          { type: "item" as const, id: `restore:${d.id}`, label: "Restore" },
          { type: "item" as const, id: `purge:${d.id}`, label: "Delete permanently", danger: true },
        ],
      })),
    })
  }

  // DELETE — soft + reversible (stamps deletedAt; the trashed row then lives under the container's
  // "Restore deleted" submenu, where a SECOND delete is permanent). Offered for any deletable kind;
  // non-life-beings are deletable in ANY state (so a hidden/closed task/moment/space CAN be deleted —
  // the bug fix), while life-beings stay protected once alive/on-the-record (see canDeleteEntity).
  if (canDeleteEntity(entity)) {
    items.push({ type: "item", id: "delete", label: "Delete", danger: true })
  }

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
  if (actionId.startsWith("color:")) {
    const val = actionId.slice("color:".length)
    setEntityAccent(id, val === "clear" ? null : val)
    return true
  }
  switch (actionId) {
    case "done":
      setTaskDone(id, true)
      return true
    case "undone":
      setTaskDone(id, false)
      return true
    case "close":
      setEntityClosed(id, true)
      return true
    case "cancel":
      setEntityCancelled(id, true)
      return true
    case "publish":
      setEntityPublished(id, true)
      return true
    case "unpublish":
      setEntityPublished(id, false)
      return true
    case "reopen":
      // v0.6.26: Reopen just UN-CLOSES, for every kind (a moment/space is no longer "complete" via
      // an elapsed occurrence — Play never sets the scalar start/end anymore, so there's nothing to
      // archive). PLANNED start/end are left intact (they're pure planning).
      reopenEntity(id)
      return true
    case "set-now":
      setEntityScheduleField(id, "at", Date.now())
      return true
    case "play":
      // MOMENT/SPACE (v0.6.26): Play OPENS a MANUAL PLAY session (`via:"play"` → BOTTOM rail), never
      // a top-rail occurrence and never the auto focus/presence spine. NOTE: the canvas intercepts
      // moment/space play/stop BEFORE this dispatcher (routes to togglePlaySession); this branch is
      // the fallback for any non-canvas caller.
      openSession(id, "play")
      return true
    case "stop":
      closeSession(id, "play") // v0.6.32: Stop ends the PLAY (ongoing) session, keeps focus/presence
      return true
    case "mark":
      markInstant(id)
      return true
    case "request":
      setEntityRequested(id, true)
      return true
    case "unrequest":
      setEntityRequested(id, false)
      return true
    case "hide":
      setEntityHidden(id, true)
      return true
    case "unhide":
      setEntityHidden(id, false)
      return true
    case "delete":
      deleteEntity(id)
      return true
    // "show-hidden" / "hide-hidden", "size:<value>", "make:<value>" and the starter-pin
    // toggle ("starter-pin" / "starter-unpin") are VIEW/curation actions, not entity data
    // mutations — the canvas intercepts them before delegating here, so they fall through
    // to false.
    default:
      return false
  }
}
