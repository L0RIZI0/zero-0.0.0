// RESOURCES model — the "stuff that flows IN" to an entity (the Resources panel).
//
// ── The concept ────────────────────────────────────────────────────────────
// Every entity has a set of RESOURCES (inputs it works with) and, symmetrically,
// a set of PUBLISHED items (its outputs — modelled separately by the Output/
// Published panel). This file models the INPUT side.
//
// A resource is a real thing in the world — money, an asset (photos, files), or a
// tool/app subscription (Figma, Linear…). It ENTERS the entity graph through a
// CONNECTOR from the outside world (rendered as the hairline in the panel):
//   • financial → money / accounts (a bank).
//   • cloud     → hosted storage (the camera roll's photo service).
//   • local     → the user's own device (Files live on-disk, no internet).
//   • internet  → a hosted SaaS the user subscribes to (Figma, Linear, Notion…).
//
// entity0 (the user's Individual / home, `ROOT_ENTITY_ID`) is where the person's
// resources first plug in from the world — so on entity0 they are INPUTS. The user
// then creates child spaces and FORWARDS resources down into them (the future drag-
// and-drop from a parent's peek losange onto an open child). A child can also plug
// in NEW resources directly at its own level (inputs that don't exist at the root).
// A forwarded resource can be forwarded again further down (chains).
//
// So each entity holds a set of RESOURCE HOLDINGS, each of which is either:
//   • "input"    — enters directly from the outside world at THIS entity (the
//                  connector/hairline). entity0's money/assets/apps are inputs; a
//                  child that adds its own resource also gets an input holding.
//   • "imported" — forwarded down from an ancestor (`fromId` = who forwarded it).
//                  The underlying resource is shared; only the holding is new.
//
// Money is special: forwarding it ALLOCATES a budget — an imported money holding
// carries an `amount` (a slice of the source), e.g. dragging money onto "Home &
// Family" to establish that project's budget.
//
// ── Status ─────────────────────────────────────────────────────────────────
// This is a presentational MOCKUP layer (in-memory, no persistence), mirroring the
// seed graph. entity0's inputs are seeded here. Child import holdings are added as
// mockups on request (see RESOURCE_HOLDINGS). The drag-and-drop that CREATES an
// imported holding is NOT built yet — `forwardResource` is the pure seam for it.

import { FileText, ImageIcon, type LucideIcon } from "lucide-react"

/** The user's Individual / home entity — where the world's resources first plug in. */
export const ROOT_ENTITY_ID = "s_root"

/** The three families of resource shown in the panel (money figure, assets, apps). */
export type ResourceClass = "money" | "asset" | "app"

/** The outside-world connector a resource flows in through (drives the hairline). */
export type ResourceOrigin = "financial" | "cloud" | "local" | "internet"

/**
 * A RESOURCE DEFINITION — the real thing itself, independent of any entity. The
 * catalog of what CAN flow into the graph. An entity references one of these by id
 * through a {@link ResourceHolding}.
 */
export interface ResourceDef {
  id: string
  name: string
  class: ResourceClass
  /** One-line descriptor under the title (e.g. "1,284 photos", "Pro · $20/mo"). */
  detail: string
  /** Brand-ish tint for the diamond/losange tile. */
  tint: string
  /** The outside-world connector this resource enters from. */
  origin: ResourceOrigin
  /** Assets render a lucide icon in the tile… */
  icon?: LucideIcon
  /** …apps render a real favicon resolved from this domain instead. */
  domain?: string
  /** Money: the total balance available at the source (before any allocation). */
  amount?: number
  /** Money: ISO currency for the balance / allocations. */
  currency?: string
}

/** How an entity comes to hold a resource. See the file header. */
export type ResourceProvision = "input" | "imported"

/**
 * A resource's presence ON one entity — an edge in the resource graph. The same
 * {@link ResourceDef} can be held by many entities via many holdings (entity0 as an
 * input; each child it was forwarded to as an "imported" holding).
 */
export interface ResourceHolding {
  entityId: string
  resourceId: string
  provision: ResourceProvision
  /**
   * IMPORTED only: the entity this holding was forwarded FROM (its immediate
   * upstream — usually the parent). Undefined for inputs (they enter from the
   * outside world, not from another entity).
   */
  fromId?: string
  /**
   * Whether this entity re-forwards the resource further down. Prepares the
   * "forwarded along" chains; defaults to true so anything held can be passed on.
   */
  forwardable?: boolean
  /**
   * MONEY only: the amount ALLOCATED to this entity (its budget) — a slice of the
   * source balance carved off when the money was forwarded here.
   */
  amount?: number
  /**
   * Draw the outside-world CONNECTOR hairline for this holding. True for direct
   * inputs that visibly wire to the world (assets/apps on entity0); money and some
   * inputs omit it.
   */
  connector?: boolean
}

/**
 * A holding RESOLVED against its definition — the flat shape the panel renders. It
 * is a def plus the facts of how THIS entity holds it (provision, source, budget,
 * whether to draw the connector).
 */
export interface EntityResource extends ResourceDef {
  provision: ResourceProvision
  fromId?: string
  connector: boolean
  /** Effective amount for this entity: the allocated budget if imported, else the
   *  source balance (money only). */
  amount?: number
}

const faviconDomain = (d: string) => d

/**
 * The catalog of resource definitions. entity0's mockup set: one money balance, two
 * assets (Camera Roll, Files) and four app subscriptions (Figma, Linear, Notion,
 * Vercel). Notion & Vercel are grayscale brands whose near-white tints make the
 * low-alpha tile vanish on the light panel, so they use a mid neutral gray.
 */
export const RESOURCE_DEFS: ResourceDef[] = [
  {
    id: "money",
    name: "Money",
    class: "money",
    detail: "Checking · available",
    tint: "#4CA36B",
    origin: "financial",
    amount: 4426.8,
    currency: "USD",
  },
  {
    id: "camera-roll",
    name: "Camera Roll",
    class: "asset",
    detail: "1,284 photos · 42 videos",
    tint: "#E5A663",
    origin: "cloud",
    icon: ImageIcon,
  },
  {
    id: "files",
    name: "Files",
    class: "asset",
    detail: "312 documents · 4.2 GB",
    tint: "#6C8FE5",
    origin: "local",
    icon: FileText,
  },
  { id: "figma", name: "Figma", class: "app", detail: "Professional · $16/mo", tint: "#A259FF", origin: "internet", domain: faviconDomain("figma.com") },
  { id: "linear", name: "Linear", class: "app", detail: "Standard · $8/mo", tint: "#5E6AD2", origin: "internet", domain: faviconDomain("linear.app") },
  { id: "notion", name: "Notion", class: "app", detail: "Plus · $10/mo", tint: "#8A8A8A", origin: "internet", domain: faviconDomain("notion.so") },
  { id: "vercel", name: "Vercel", class: "app", detail: "Pro · $20/mo", tint: "#8A8A8A", origin: "internet", domain: faviconDomain("vercel.com") },
]

const DEF_BY_ID = new Map(RESOURCE_DEFS.map((d) => [d.id, d]))
const DEF_ORDER = new Map(RESOURCE_DEFS.map((d, i) => [d.id, i]))

/**
 * The resource GRAPH — who holds what. entity0 (`ROOT_ENTITY_ID`) holds every
 * catalog resource as a direct INPUT from the world; assets/apps draw the connector
 * hairline (money doesn't). Child IMPORT holdings (resources the user forwarded from
 * a parent) are mocked in here on request — see the commented example.
 */
export const RESOURCE_HOLDINGS: ResourceHolding[] = [
  // ── entity0 (the Individual / home): the world plugs in here ──────────────
  { entityId: ROOT_ENTITY_ID, resourceId: "money", provision: "input", connector: false },
  { entityId: ROOT_ENTITY_ID, resourceId: "camera-roll", provision: "input", connector: true },
  { entityId: ROOT_ENTITY_ID, resourceId: "files", provision: "input", connector: false },
  { entityId: ROOT_ENTITY_ID, resourceId: "figma", provision: "input", connector: true },
  { entityId: ROOT_ENTITY_ID, resourceId: "linear", provision: "input", connector: true },
  { entityId: ROOT_ENTITY_ID, resourceId: "notion", provision: "input", connector: true },
  { entityId: ROOT_ENTITY_ID, resourceId: "vercel", provision: "input", connector: true },

  // ── Child imports (mockups) — added on request. Shape, for reference: ─────
  // Forward Figma from home down to the Zero space, and allocate a $2,000 budget
  // to Home & Family from the money resource:
  //   { entityId: "s_zero",   resourceId: "figma", provision: "imported", fromId: ROOT_ENTITY_ID, connector: true },
  //   { entityId: "s_family", resourceId: "money", provision: "imported", fromId: ROOT_ENTITY_ID, amount: 2000, connector: false },
]

/** Look up a resource definition by id. */
export function getResourceDef(id: string): ResourceDef | undefined {
  return DEF_BY_ID.get(id)
}

/**
 * Per-entity custom resource ORDER from drag-and-drop reordering in the panel.
 * IN-MEMORY only (session-scoped) — this whole layer is a presentational mockup with
 * no persistence, so the reorder deliberately isn't written to localStorage. Ranked
 * ids sort first (in this order); anything unranked keeps catalog order at the end.
 */
const resourceOrder: Record<string, string[]> = {}

/** Record a new resource order for an entity (the full arranged id sequence). */
export function reorderEntityResources(entityId: string, orderedIds: string[]): void {
  resourceOrder[entityId] = [...orderedIds]
}

/**
 * All resources HELD by an entity, resolved to their definitions and returned in
 * catalog order. Empty for any entity with no holdings (an untouched child) — the
 * panel then shows only the "+ Add resource" affordance.
 */
export function getEntityResources(entityId: string): EntityResource[] {
  const custom = resourceOrder[entityId]
  const rank = custom ? new Map(custom.map((id, i) => [id, i])) : null
  // Ordering: a user-arranged order (if any) ranks first, then catalog order for
  // anything unranked. With no custom order this is exactly the catalog order.
  const orderKey = (id: string) => {
    if (rank) {
      const r = rank.get(id)
      if (r != null) return r
      return custom!.length + (DEF_ORDER.get(id) ?? 0)
    }
    return DEF_ORDER.get(id) ?? 0
  }
  return RESOURCE_HOLDINGS.filter((h) => h.entityId === entityId)
    .flatMap<EntityResource>((h) => {
      const def = DEF_BY_ID.get(h.resourceId)
      if (!def) return []
      const resolved: EntityResource = {
        ...def,
        provision: h.provision,
        fromId: h.fromId,
        connector: h.connector ?? false,
        // Imported money shows its allocated budget; otherwise the source balance.
        amount: h.provision === "imported" && h.amount != null ? h.amount : def.amount,
      }
      return [resolved]
    })
    .sort((a, b) => orderKey(a.id) - orderKey(b.id))
}

/** How many resources an entity holds (drives the rail's "RESOURCES (n)" counter). */
export function getEntityResourceCount(entityId: string): number {
  return RESOURCE_HOLDINGS.reduce((n, h) => (h.entityId === entityId ? n + 1 : n), 0)
}

/** Split resolved resources into the panel's three families, preserving order. */
export function groupResources(resources: EntityResource[]): {
  money: EntityResource[]
  assets: EntityResource[]
  apps: EntityResource[]
} {
  return {
    money: resources.filter((r) => r.class === "money"),
    assets: resources.filter((r) => r.class === "asset"),
    apps: resources.filter((r) => r.class === "app"),
  }
}

/**
 * PURE seam for the future drag-and-drop. Given a resource held by `fromId`,
 * produce the "imported" holding that would appear on `toId` (optionally carrying a
 * money `amount` budget). Does NOT mutate `RESOURCE_HOLDINGS` or persist anything —
 * the interaction layer will decide when/whether to commit it. Returns null if the
 * source doesn't actually hold the resource (can't forward what you don't have).
 */
export function forwardResource(fromId: string, toId: string, resourceId: string, amount?: number): ResourceHolding | null {
  const source = RESOURCE_HOLDINGS.find((h) => h.entityId === fromId && h.resourceId === resourceId)
  if (!source || source.forwardable === false) return null
  return {
    entityId: toId,
    resourceId,
    provision: "imported",
    fromId,
    forwardable: true,
    ...(amount != null ? { amount } : {}),
    connector: source.connector,
  }
}
