"use client"

import { Pin, PinOff, Trash2, Ban, RotateCcw, Archive, ArchiveRestore, Send, Shapes } from "lucide-react"
import {
  getEntity,
  isPinned,
  pinItem,
  unpinItem,
  deleteEntity,
  setEventCancelled,
  setEntityClosed,
  setEntityRequested,
  changeEntityKind,
} from "@/lib/zero/data"
import { isCompletable, isClosed } from "@/lib/zero/kinds"
import type { Entity } from "@/lib/zero/types"
import { useZeroNav } from "@/lib/zero/nav-store"
import { ContextMenu, type ContextMenuItem } from "./context-menu"
import { NodeGlyph, NODE_KIND_META, type NodeKind } from "./node-glyph"

// The kinds an entity can be turned INTO (order shown in the "Change into…" flyout).
const KIND_ORDER: NodeKind[] = ["task", "space", "resource", "event", "instant", "community", "organism"]

/** The slice of the nav store the menu actions need. */
interface MenuDeps {
  morphCommit: (mutate: () => void, key?: string) => void
  notifyDataChanged: () => void
}

/**
 * THE single source of truth for an entity's right-click menu. The menu is a pure
 * function of the ENTITY (its kind + state) and its CONTEXT (the `contextId` it is
 * shown in — which decides, e.g., whether it is pinned in THIS dock). It is
 * deliberately NOT specialised per surface: a do-list row, a dock card, and a
 * window header all build the exact same menu for the same entity+context. The
 * only context-driven difference is Pin ⇄ Unpin, derived from `isPinned`.
 */
export function buildEntityMenuItems(entity: Entity, contextId: string, deps: MenuDeps): ContextMenuItem[] {
  const { morphCommit, notifyDataChanged } = deps
  const id = entity.id
  const kind = entity.kind
  const pinned = isPinned(contextId, id)
  // Close (fill glyph) + Cancel (fill + strike + fade) apply to any COMPLETABLE kind
  // (task/space/event/instant/resource); terminal kinds retire/die instead.
  const canClose = isCompletable(kind)
  const closedNow = isClosed(entity)
  const isCancelled = !!entity.cancelled
  // Narrowed inline (the `&&` guards the TaskSpace field) — a captured local would
  // lose the discriminated-union narrowing.
  const isRequested = entity.kind === "task" && !!entity.requested

  return [
    // PIN ⇄ UNPIN. Pinning is per-context, so which one shows is pure entity+context
    // state. Both morph the row ⇄ dock card via the shared Flip stage (`morphCommit`
    // raises the animating gate); keyed by flip-id so the flying node stays lit. When
    // invoked from a window header there is no visible collapsed node to fly, so the
    // morph is a harmless no-op and only the pin membership changes.
    pinned
      ? {
          label: "Unpin from Dock",
          icon: <PinOff className="h-3.5 w-3.5" />,
          onSelect: () =>
            morphCommit(() => {
              unpinItem(contextId, id)
              notifyDataChanged()
            }, `${contextId}:${id}`),
        }
      : {
          label: "Pin to Dock",
          icon: <Pin className="h-3.5 w-3.5" />,
          onSelect: () =>
            morphCommit(() => {
              pinItem(contextId, id)
              notifyDataChanged()
            }, `${contextId}:${id}`),
        },

    // CLOSE / REOPEN + CANCEL / RESTORE — completable kinds only.
    ...(canClose
      ? [
          // "Close" fills the glyph; "Reopen" pulls it back open. Show "Close" only
          // when NOT closed, "Reopen" when closed. Reopen works for ANY closed entity
          // — manual OR derived (an event past its end, a done task past midnight) —
          // via setEntityClosed's `reopened` override. A CANCELLED entity is the
          // exception: it reopens through "Restore" below, so it shows neither here.
          ...(isCancelled
            ? []
            : !closedNow
              ? [
                  {
                    label: "Close",
                    icon: <Archive className="h-3.5 w-3.5" />,
                    onSelect: () => {
                      setEntityClosed(id, true)
                      notifyDataChanged()
                    },
                  },
                ]
              : [
                  {
                    label: "Reopen",
                    icon: <ArchiveRestore className="h-3.5 w-3.5" />,
                    onSelect: () => {
                      setEntityClosed(id, false)
                      notifyDataChanged()
                    },
                  },
                ]),
          // "Cancel" — fill the glyph AND strike through the title + fade the row.
          {
            label: isCancelled ? "Restore" : "Cancel",
            icon: isCancelled ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />,
            onSelect: () => {
              setEventCancelled(id, !isCancelled)
              notifyDataChanged()
            },
          },
        ]
      : []),

    // SEND — mock sending a task to someone as a request (tasks only). No transport
    // yet; it toggles `requested`, swinging the glyph's tilted "sent" edge out/in.
    ...(entity.kind === "task"
      ? [
          {
            label: isRequested ? "Unsend request" : "Send as request",
            icon: <Send className="h-3.5 w-3.5" />,
            onSelect: () => {
              setEntityRequested(id, !isRequested)
              notifyDataChanged()
            },
          },
        ]
      : []),

    // CHANGE INTO… — switch the entity's kind in place; the glyph morphs silhouettes.
    {
      label: "Change into…",
      icon: <Shapes className="h-3.5 w-3.5" />,
      submenu: KIND_ORDER.filter((k) => k !== kind).map((k) => ({
        label: NODE_KIND_META[k].label,
        icon: <NodeGlyph kind={k} className="text-foreground" />,
        onSelect: () => {
          changeEntityKind(id, k)
          notifyDataChanged()
        },
      })),
    },

    {
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      onSelect: () => {
        deleteEntity(id)
        notifyDataChanged()
      },
    },
  ]
}

/**
 * The lone, app-wide context-menu renderer. Mounted ONCE in ZeroShell. It reads the
 * shared `entityMenu` anchor from the nav store, resolves the entity, builds the menu
 * via `buildEntityMenuItems`, and renders the portaled `<ContextMenu>`. Every surface
 * opens it by calling `nav.openEntityMenu(entityId, contextId, x, y)` — there is no
 * per-component menu state or builder.
 */
export function EntityContextMenu() {
  const nav = useZeroNav()
  // `dataVersion` in deps keeps the built menu (pin/closed/cancelled state) fresh if
  // data mutates while it is open.
  void nav.dataVersion
  const anchor = nav.entityMenu
  const entity = anchor ? getEntity(anchor.entityId) : undefined
  const state =
    anchor && entity
      ? {
          x: anchor.x,
          y: anchor.y,
          items: buildEntityMenuItems(entity, anchor.contextId, nav),
        }
      : null
  return <ContextMenu state={state} onClose={nav.closeEntityMenu} />
}
