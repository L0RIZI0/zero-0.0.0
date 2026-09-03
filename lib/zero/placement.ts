/**
 * PLACEMENT REGISTRY (presentation-only)
 * ======================================
 *
 * One `entityId` historically did three jobs: identity, on-screen *placement*,
 * and open-window position. Conflating identity with placement is what bred the
 * old "duplicate window" bug (e.g. Workout shown in the timeline AND a do-list,
 * so a bare `[data-morph-source="s_workout"]` matched two rects).
 *
 * A **placement** is a single on-screen *appearance* of an entity:
 *   { entityId, source, hostId }
 * encoded into one DOM attribute `data-placement = "<source>:<hostId>:<entityId>"`.
 * The same entity can have many placements (a do-list row, a dock card, a
 * timeline chip, a search hit) — each is a distinct, disposable alias of the one
 * global entity. Placement is pure presentation; it never touches entity data.
 *
 * This module is the registry's read side: given an entity (and optionally the
 * placement the user actually clicked), resolve the viewport rect the window
 * should morph **from**. Opening with a resolvable origin grows the window out of
 * that placement; opening with none (search, deep-link, programmatic) falls back
 * to center — the single uniform morph law the nav layer applies everywhere.
 *
 * Stage B introduces the types + resolver as pure additions (no caller yet).
 * Stage C consumes `OpenOrigin` to drive the leaf morph; Stage D tags real
 * placements and wires launchers.
 */

/** Where an on-screen appearance of an entity lives. `dayline` is the header's
 *  second-row day lane (its ticks/bars); kept distinct from `timeline` (the
 *  in-View lifelane strip) so the two can't collide on a shared placement key
 *  if both are on screen for the same entity. */
export type PlacementSource = "dolist" | "dock" | "timeline" | "dayline" | "search"

/**
 * How the morph should interpret the origin rect:
 *   - "space-hex": the source is a Space hexagon (dock card / leaf) — keep the
 *     clip rectangle⇄hexagon shape tween.
 *   - "generic": a plain rectangular source (row, timeline chip) or center —
 *     scale + translate only.
 */
export type OriginKind = "space-hex" | "generic"

/** Viewport rect (top/left/width/height in px) — a plain, serialisable subset of
 *  DOMRect so origins can be stored, compared and recomputed freely. */
export interface OriginRect {
  top: number
  left: number
  width: number
  height: number
}

/** The visual origin a window grows from / shrinks back toward. */
export interface OpenOrigin {
  rect: OriginRect
  kind: OriginKind
  /** The placement key this origin was resolved from, when known — lets the
   *  close morph target the SAME appearance if it is still on screen. */
  placement?: string
}

const ATTR = "data-placement"

/** Build a placement key for tagging an appearance: `<source>:<hostId>:<entityId>`. */
export function placementKey(source: PlacementSource, hostId: string, entityId: string): string {
  return `${source}:${hostId}:${entityId}`
}

/** Parse a placement key back into its parts (null if malformed). */
export function parsePlacement(
  key: string,
): { source: PlacementSource; hostId: string; entityId: string } | null {
  const parts = key.split(":")
  if (parts.length < 3) return null
  const [source, hostId, ...rest] = parts
  return { source: source as PlacementSource, hostId, entityId: rest.join(":") }
}

function toRect(el: Element): OriginRect {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

/** Classify an element's morph kind from its tags (defaults to generic). */
function kindOf(el: Element): OriginKind {
  return el.getAttribute("data-morph-kind") === "space-hex" ? "space-hex" : "generic"
}

/**
 * Resolve the viewport origin for opening `entityId`.
 *
 * Lookup order:
 *   1. The exact placement key, if the caller knows it (`opts.placement`).
 *   2. Any visible appearance of the entity, preferring `opts.preferSource`.
 *   3. `null` — caller should fall back to center.
 *
 * DOM-only and read-only: safe to call right before a morph to get a fresh rect.
 * Returns null on the server.
 */
export function resolveOriginRect(
  entityId: string,
  opts: { placement?: string; preferSource?: PlacementSource } = {},
): OpenOrigin | null {
  if (typeof document === "undefined") return null

  // 1. Exact placement.
  if (opts.placement) {
    const exact = document.querySelector(`[${ATTR}="${CSS.escape(opts.placement)}"]`)
    if (exact) return { rect: toRect(exact), kind: kindOf(exact), placement: opts.placement }
  }

  // 2. Any appearance of this entity, preferring the requested source.
  const all = Array.from(
    document.querySelectorAll<HTMLElement>(`[${ATTR}$=":${CSS.escape(entityId)}"]`),
  ).filter((el) => {
    const parsed = parsePlacement(el.getAttribute(ATTR) ?? "")
    return parsed?.entityId === entityId
  })
  if (all.length === 0) return null

  const preferred =
    (opts.preferSource &&
      all.find((el) => parsePlacement(el.getAttribute(ATTR) ?? "")?.source === opts.preferSource)) ||
    all[0]

  return {
    rect: toRect(preferred),
    kind: kindOf(preferred),
    placement: preferred.getAttribute(ATTR) ?? undefined,
  }
}
