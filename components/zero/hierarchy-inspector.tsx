"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useZeroNav } from "@/lib/zero/nav-store"
import { useDebugView } from "@/lib/zero/debug-view"
import { entities } from "@/lib/zero/data"
import { isClosed } from "@/lib/zero/kinds"
import { NODE_KIND_META, NodeGlyph } from "./node-glyph"
import type { Entity, EntityKind } from "@/lib/zero/types"

/**
 * Dev-only HIERARCHY inspector (`§ 4`).
 *
 * Renders the WHOLE containment tree of the logged user — from the root (the Soul,
 * `parentId: null`) down through the Individual (entity0 = home) and every space to
 * all the leaves (tasks / moments / instants). Unlike the do-list's `getChildren`
 * (which hides the structural soul/individual kinds), this walks the raw ORIGIN
 * tree via `parentId` so the identity triad and every leaf are visible — a debug
 * X-ray of the real structure, not a browsable listing.
 *
 * LAYOUT — a KIND-DIRECTIONAL force graph. A node's position relative to its parent
 * is decided by the NODE'S OWN KIND, expressed as a strong spring toward a
 * parent-relative target (physics only smooths + resolves overlaps):
 *   • `space`      → a horizontal ROW placed BELOW the parent, the row's CENTER OF
 *                    GRAVITY aligned on the parent's x (grows out symmetrically).
 *   • `individual` → straight DOWN, aligned on the parent's x → the Soul→Individual
 *                    identity spine stays vertical and centered.
 *   • everything else (task/event/instant/…) → DOWN and slightly right, stacked as
 *                    an indented column under the parent — whether or not it has its
 *                    own children (a branch task carries its subtree with it).
 * So containers expand the tree HORIZONTALLY while actions expand it VERTICALLY.
 * The right-offset is measured from the parent's actual label width, so glyph
 * centers align exactly (no stray padding).
 *
 * Sibling spacing is SUBTREE-EXTENT-AWARE: each node computes how far its whole
 * subtree reaches above/below itself, and siblings are stacked by those real
 * extents (a `place()` pass assigns every node a fixed offset `ox/oy` relative to
 * its parent). This is what stops a tall action column under one space from
 * crashing into the next space below it. The physics then just springs each node to
 * `parent + (ox,oy)`, smooths motion, allows dragging, and runs a label-aware
 * collision pass as a safety net for long labels.
 *
 * Each node is a bare GLYPH (its center = the node point) with a free-floating
 * label beside it — no box — so it reads like Obsidian's graph. The sim runs in a
 * LARGE virtual WORLD so nodes breathe; the graph BLEEDS past the window edges and
 * the whole thing is PANNABLE (drag empty space). Nodes are draggable (reheats the
 * sim). Recurrence occurrences (`seriesId`) are skipped.
 *
 * Read-only: re-seeds on `dataVersion`, never mutates. Renders nothing in
 * production. Mirrors the §3 inspector's chrome/style.
 */

const GLYPH = 16 // glyph box (px); its geometric center IS the node's (x,y)
const LABEL_GAP = 6 // gap between the glyph and its label text
// Large virtual world so the graph can spread out and be panned (not squished to fit).
const WORLD_W = 4000
const WORLD_H = 2600

// Directional offsets (see childDir): the target of a child relative to its parent.
const IH = 12 // intrinsic half-height of a node's own row (→ leaves ~2·IH apart)
const SPACE_GAP = 40 // vertical gap below the parent before its space row starts
const INDIVIDUAL_CHILD_DROP = 56 // extra drop for an Individual's space children (sit lower)
const INDIVIDUAL_ACTION_DX = 110 // extra rightward push for an Individual's non-space children
const SPACE_HGAP = 48 // horizontal gap between sibling-space SUBTREES in the row
const SPINE_DY = 132 // vertical gap for an `individual` child (identity spine)
const DR_DX = 26 // action children indent clearly right of the parent
const DR_TOP = 12 // first action child's subtree top sits this far below the parent
const ROW_GAP = 2 // gap between stacked action-child SUBTREES

// approx label rendering metrics (mono 11px) used for collision + truncation
const LABEL_MAX = 22 // chars before we ellipsize
const CHAR_W = 6.6 // px per mono char at 11px
const LINE_H = 15 // label line box height

type Dir = "right" | "down" | "downRight"

/** A child's placement direction is decided by ITS OWN kind (draft rules). */
function childDir(kind: EntityKind): Dir {
  if (kind === "individual") return "down" // identity spine, aligned under parent
  if (kind === "space") return "right" // containers expand horizontally
  return "downRight" // actions (task/event/instant/…) expand vertically
}

type SimNode = {
  id: string
  entity: Entity
  hasChildren: boolean
  parentId: string | null
  dir: Dir // this node's direction relative to its parent (from its kind)
  ox: number // fixed offset from the parent (x), assigned by place()
  oy: number // fixed offset from the parent (y), assigned by place()
  /** right extent from the node center = glyph half + gap + label width, so
   *  collision reserves room for the label and the space column clears the label. */
  rw: number
  x: number
  y: number
  vx: number
  vy: number
  fx: number | null // pinned position while dragging
  fy: number | null
  ax: number | null // fixed anchor (roots only) — springs hold the root in place
  ay: number | null
}

type Edge = { id: string; source: string; target: string }

/** Bounding reach of a subtree relative to its root node (all ≤0 on up/left, ≥0 on down/right). */
type Ext = { up: number; down: number; left: number; right: number }

/** Build the sim nodes + edges from the raw origin tree, then run an extent-aware
 *  `place()` pass to assign every node a fixed offset (`ox/oy`) from its parent.
 *  `tagEdges` = secondary (non parent→child) relationships, e.g. taggedSpaceIds;
 *  they are rendered dotted and DO NOT affect layout (the physics ignores them). */
function buildGraph(): { nodes: SimNode[]; edges: Edge[]; tagEdges: Edge[] } {
  const byParent = new Map<string | null, Entity[]>()
  for (const e of entities) {
    if (e.seriesId != null) continue
    const list = byParent.get(e.parentId)
    if (list) list.push(e)
    else byParent.set(e.parentId, [e])
  }

  const nodes: SimNode[] = []
  const edges: Edge[] = []
  const byId = new Map<string, SimNode>()
  const kids = new Map<string, SimNode[]>()

  const make = (entity: Entity) => {
    const children = byParent.get(entity.id) ?? []
    const shownLen = Math.min(entity.title.length, LABEL_MAX)
    const node: SimNode = {
      id: entity.id,
      entity,
      hasChildren: children.length > 0,
      parentId: entity.parentId,
      dir: childDir(entity.kind),
      ox: 0,
      oy: 0,
      rw: GLYPH / 2 + LABEL_GAP + shownLen * CHAR_W,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      ax: null,
      ay: null,
    }
    nodes.push(node)
    byId.set(node.id, node)
    for (const c of children) {
      edges.push({ id: `${entity.id}->${c.id}`, source: entity.id, target: c.id })
      make(c)
      const cn = byId.get(c.id)!
      const arr = kids.get(node.id)
      if (arr) arr.push(cn)
      else kids.set(node.id, [cn])
    }
  }
  for (const root of byParent.get(null) ?? []) make(root)

  // place(): assign each child an offset from its parent, returning the subtree's
  // vertical extent {up ≤ 0, down ≥ 0} relative to this node. Sibling spacing uses
  // these real extents so tall columns never crash into the next sibling.
  const place = (node: SimNode): Ext => {
    const children = kids.get(node.id) ?? []
    const right = children.filter((c) => c.dir === "right")
    const down = children.filter((c) => c.dir === "down")
    const dr = children.filter((c) => c.dir === "downRight")
    const ext = new Map<string, Ext>()
    for (const c of children) ext.set(c.id, place(c))

    let up = -IH
    let down_ = IH
    let left = -node.rw * 0 - IH // node's own left reach (glyph center → left is ~half glyph)
    let right_ = node.rw // own right reach = glyph + label

    // action children: stack their SUBTREES straight down, indented slightly right.
    // An Individual keeps its non-space children higher up (small drop) and pushes
    // them further RIGHT; the non-space↔space vertical gap is preserved regardless,
    // since everything below shifts with them (gap = SPACE_GAP + INDIVIDUAL_CHILD_DROP).
    const isIndividualNode = node.entity.kind === "individual"
    let cur = DR_TOP + (isIndividualNode ? INDIVIDUAL_CHILD_DROP : 0)
    for (const a of dr) {
      const e = ext.get(a.id)!
      a.ox = DR_DX + (isIndividualNode ? INDIVIDUAL_ACTION_DX : 0)
      a.oy = cur - e.up // subtree top aligns at `cur` below the node
      down_ = Math.max(down_, a.oy + e.down)
      left = Math.min(left, a.ox + e.left)
      right_ = Math.max(right_, a.ox + e.right)
      cur = a.oy + e.down + ROW_GAP
    }

    // individual child: straight down (identity spine), aligned x
    let dc = SPINE_DY
    for (const d of down) {
      const e = ext.get(d.id)!
      d.ox = 0
      d.oy = dc - e.up
      down_ = Math.max(down_, d.oy + e.down)
      left = Math.min(left, d.ox + e.left)
      right_ = Math.max(right_, d.ox + e.right)
      dc = d.oy + e.down + SPINE_DY
    }

    // space children: horizontal ROW BELOW the node, the row's CENTER OF GRAVITY
    // aligned with the node's x (glyph center) — grows out symmetrically from there.
    const rowW =
      right.reduce((sum, s) => {
        const e = ext.get(s.id)!
        return sum + (e.right - e.left)
      }, 0) + Math.max(0, right.length - 1) * SPACE_HGAP
    let rc = -rowW / 2
    // clear the node's own down-extent first; an Individual drops its children lower
    const spaceTop =
      down_ + SPACE_GAP + (node.entity.kind === "individual" ? INDIVIDUAL_CHILD_DROP : 0)
    for (const s of right) {
      const e = ext.get(s.id)!
      s.ox = rc - e.left // subtree left aligns at `rc`
      s.oy = spaceTop - e.up // subtree top aligns just below the node
      left = Math.min(left, s.ox + e.left)
      right_ = Math.max(right_, s.ox + e.right)
      down_ = Math.max(down_, s.oy + e.down)
      rc = s.ox + e.right + SPACE_HGAP
    }

    return { up, down: down_, left, right: right_ }
  }
  for (const root of byParent.get(null) ?? []) place(byId.get(root.id)!)

  // Seed absolute positions from the offsets, root at origin.
  const seed = (n: SimNode, x: number, y: number) => {
    n.x = x
    n.y = y
    for (const c of kids.get(n.id) ?? []) seed(c, x + c.ox, y + c.oy)
  }
  for (const root of byParent.get(null) ?? []) seed(byId.get(root.id)!, 0, 0)

  // Center the whole seeded tree in the world, then pin roots to that spot.
  if (nodes.length) {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      if (n.x < minX) minX = n.x
      if (n.x > maxX) maxX = n.x
      if (n.y < minY) minY = n.y
      if (n.y > maxY) maxY = n.y
    }
    const dx = WORLD_W / 2 - (minX + maxX) / 2
    const dy = WORLD_H / 2 - (minY + maxY) / 2
    for (const n of nodes) {
      n.x += dx
      n.y += dy
    }
    for (const root of byParent.get(null) ?? []) {
      const rn = byId.get(root.id)!
      rn.ax = rn.x
      rn.ay = rn.y
    }
  }

  // Secondary relationships (dotted, layout-neutral): every taggedSpaceIds link
  // is an edge from the entity to each space it is ALSO displayed in. De-duped
  // and skipped if it merely restates the parent edge or a node is missing.
  const tagEdges: Edge[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    const tags = node.entity.taggedSpaceIds
    if (!tags) continue
    for (const spaceId of tags) {
      if (spaceId === node.parentId) continue
      if (!byId.has(spaceId)) continue
      const id = `${node.id}~${spaceId}`
      if (seen.has(id)) continue
      seen.add(id)
      tagEdges.push({ id, source: spaceId, target: node.id })
    }
  }

  return { nodes, edges, tagEdges }
}

/** Target position of child `c` = parent position + c's fixed offset. */
function targetX(p: SimNode, c: SimNode): number {
  return p.x + c.ox
}
function targetY(p: SimNode, c: SimNode): number {
  return p.y + c.oy
}

/** One physics tick: springs to each node's fixed parent-relative target (the
 *  extent-aware layout), then a label-aware collision pass as a safety net. */
function tick(nodes: SimNode[], edges: Edge[], byId: Map<string, SimNode>, alpha: number) {
  const SPRING_K = 0.3 // pull to the parent-relative target (ox/oy)
  const ROOT_K = 0.14 // pull roots to their fixed anchor
  const VELOCITY_DECAY = 0.8
  const LEFT_EXT = GLYPH / 2 + 2
  const V_EXT = LINE_H / 2 + 1

  // directional springs (child → its parent-relative target); roots → anchor.
  for (const e of edges) {
    const p = byId.get(e.source)
    const c = byId.get(e.target)
    if (!p || !c) continue
    c.vx += (targetX(p, c) - c.x) * SPRING_K * alpha
    c.vy += (targetY(p, c) - c.y) * SPRING_K * alpha
  }
  for (const n of nodes) {
    if (n.ax != null) n.vx += (n.ax - n.x) * ROOT_K * alpha
    if (n.ay != null) n.vy += (n.ay - n.y) * ROOT_K * alpha
  }

  // label-aware AABB collision, several relaxation passes so dense rows un-overlap
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      const aL = a.x - LEFT_EXT
      const aR = a.x + a.rw
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]
        const bL = b.x - LEFT_EXT
        const bR = b.x + b.rw
        const ox = Math.min(aR, bR) - Math.max(aL, bL)
        const oy = V_EXT * 2 - Math.abs(a.y - b.y)
        if (ox > 0 && oy > 0) {
          if (ox < oy) {
            const dir = a.x <= b.x ? -1 : 1
            a.x += (dir * ox) / 2
            b.x -= (dir * ox) / 2
          } else {
            const dir = a.y <= b.y ? -1 : 1
            a.y += (dir * oy) / 2
            b.y -= (dir * oy) / 2
          }
        }
      }
    }
  }

  // integrate + friction, honoring pinned (dragged) nodes
  for (const n of nodes) {
    if (n.fx != null) {
      n.x = n.fx
      n.vx = 0
    } else {
      n.vx *= VELOCITY_DECAY
      n.x += n.vx
    }
    if (n.fy != null) {
      n.y = n.fy
      n.vy = 0
    } else {
      n.vy *= VELOCITY_DECAY
      n.y += n.vy
    }
  }
}

export function HierarchyInspector() {
  const { hierarchy: visible } = useDebugView()
  const { dataVersion } = useZeroNav()

  const isDev = process.env.NODE_ENV !== "production"
  const active = isDev && visible

  // Build the graph fresh whenever it's opened or data changes.
  const graph = useMemo(() => (active ? buildGraph() : null), [active, dataVersion])

  const nodesRef = useRef<SimNode[]>([])
  const byIdRef = useRef<Map<string, SimNode>>(new Map())
  const alphaRef = useRef(1)
  const rafRef = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
  // Pan offset (world → screen translate). Panning shifts the whole world.
  const panRef = useRef({ x: 0, y: 0 })
  const panDragRef = useRef<{ px: number; py: number } | null>(null)
  const centeredRef = useRef(false)
  // Zoom scale (world → screen). Ctrl/⌘+wheel & trackpad pinch adjust it.
  const scaleRef = useRef(1)
  const [, force] = useState(0)

  const ALPHA_MIN = 0.002
  const ALPHA_DECAY = 0.0228
  const MIN_SCALE = 0.2
  const MAX_SCALE = 3

  const startLoop = () => {
    if (rafRef.current != null || !graph) return
    const loop = () => {
      tick(nodesRef.current, graph.edges, byIdRef.current, alphaRef.current)
      alphaRef.current += (0 - alphaRef.current) * ALPHA_DECAY
      force((n) => n + 1)
      if (alphaRef.current > ALPHA_MIN || dragRef.current) rafRef.current = requestAnimationFrame(loop)
      else rafRef.current = null
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  useEffect(() => {
    if (!graph) return
    nodesRef.current = graph.nodes
    byIdRef.current = new Map(graph.nodes.map((n) => [n.id, n]))
    alphaRef.current = 1
    centeredRef.current = false
    startLoop()
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  // Wheel: plain wheel/trackpad pans; Ctrl/⌘+wheel (and trackpad pinch, which the
  // browser reports as a ctrlKey wheel) zooms around the cursor.
  // Attached natively with { passive: false } so we can preventDefault the zoom.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || !graph) return
    const onWheel = (ev: WheelEvent) => {
      const rect = vp.getBoundingClientRect()
      const cx = ev.clientX - rect.left
      const cy = ev.clientY - rect.top
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault()
        const old = scaleRef.current
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * Math.exp(-ev.deltaY * 0.0025)))
        if (next === old) return
        const p = panRef.current
        // keep the world point under the cursor fixed on screen
        const wx = (cx - p.x) / old
        const wy = (cy - p.y) / old
        panRef.current = { x: cx - wx * next, y: cy - wy * next }
        scaleRef.current = next
        force((n) => n + 1)
      } else {
        ev.preventDefault()
        const p = panRef.current
        panRef.current = { x: p.x - ev.deltaX, y: p.y - ev.deltaY }
        force((n) => n + 1)
      }
    }
    vp.addEventListener("wheel", onWheel, { passive: false })
    return () => vp.removeEventListener("wheel", onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  // On open, frame the Individual (entity0) horizontally centered and vertically
  // at ~1/3 from the top, so their branches have room to fan out downward.
  useLayoutEffect(() => {
    if (!graph || centeredRef.current) return
    const vp = viewportRef.current
    if (!vp) return
    const r = vp.getBoundingClientRect()
    const focus =
      graph.nodes.find((n) => n.entity.kind === "individual") ??
      graph.nodes.find((n) => n.parentId == null) ??
      null
    // Center on the Individual's CENTER OF GRAVITY = the middle of its glyph+label
    // combined (spans n.x-GLYPH/2 … n.x+rw), not just the glyph point.
    const cog = focus ? (focus.rw - GLYPH / 2) / 2 : 0
    const fx = (focus ? focus.x : WORLD_W / 2) + cog
    const fy = focus ? focus.y : WORLD_H / 2
    const s = scaleRef.current
    panRef.current = { x: r.width / 2 - fx * s, y: r.height / 3 - fy * s }
    centeredRef.current = true
    force((n) => n + 1)
  }, [graph])

  if (!active || !graph) return null

  const nodes = nodesRef.current
  const byId = byIdRef.current
  const pan = panRef.current
  const scale = scaleRef.current

  const reheat = () => {
    alphaRef.current = Math.max(alphaRef.current, 0.3)
    startLoop()
  }

  // client → world coordinates. The svg is transformed by `translate(pan) scale`
  // (origin 0,0), so world = (screen − pan) / scale, measured from the viewport.
  const toWorld = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return { x: clientX, y: clientY }
    const s = scaleRef.current
    const p = panRef.current
    return { x: (clientX - rect.left - p.x) / s, y: (clientY - rect.top - p.y) / s }
  }

  const onNodePointerDown = (id: string) => (ev: React.PointerEvent) => {
    ev.preventDefault()
    ev.stopPropagation() // don't start a pan
    ;(ev.currentTarget as Element).setPointerCapture?.(ev.pointerId)
    const n = byId.get(id)
    if (!n) return
    const p = toWorld(ev.clientX, ev.clientY)
    dragRef.current = { id, dx: n.x - p.x, dy: n.y - p.y }
    n.fx = n.x
    n.fy = n.y
    reheat()
  }

  // Pan: pointer down on empty viewport space.
  const onViewportPointerDown = (ev: React.PointerEvent) => {
    if (dragRef.current) return
    ;(ev.currentTarget as Element).setPointerCapture?.(ev.pointerId)
    panDragRef.current = { px: ev.clientX - pan.x, py: ev.clientY - pan.y }
  }

  const onPointerMove = (ev: React.PointerEvent) => {
    // node drag takes precedence
    const d = dragRef.current
    if (d) {
      const n = byId.get(d.id)
      if (!n) return
      const p = toWorld(ev.clientX, ev.clientY)
      n.fx = p.x + d.dx
      n.fy = p.y + d.dy
      alphaRef.current = Math.max(alphaRef.current, 0.15)
      return
    }
    const pd = panDragRef.current
    if (pd) {
      panRef.current = { x: ev.clientX - pd.px, y: ev.clientY - pd.py }
      force((n) => n + 1)
    }
  }

  const onPointerUp = () => {
    const d = dragRef.current
    if (d) {
      const n = byId.get(d.id)
      if (n) {
        n.fx = null
        n.fy = null
      }
    }
    dragRef.current = null
    panDragRef.current = null
  }

  return (
    <div
      className="fixed inset-3 z-[9999] flex select-none flex-col overflow-hidden rounded-md border border-border bg-card/90 font-mono text-xs text-card-foreground shadow-lg backdrop-blur"
      role="status"
      aria-label="Hierarchy inspector"
    >
      <div className="flex items-center justify-between gap-6 border-b border-border px-3 py-2">
        <span className="font-bold">{"Hierarchy · kind-directional graph"}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">{nodes.length} nodes</span>
      </div>

      {/* Pannable viewport — the world bleeds past these edges. */}
      <div
        ref={viewportRef}
        className="relative flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
        onPointerDown={onViewportPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <svg
          ref={svgRef}
          width={WORLD_W}
          height={WORLD_H}
          className="absolute left-0 top-0"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: "0 0" }}
        >
          {/* mask: white shows the edges, black circles at each node punch holes so
              edge tips don't show through the transparent glyph interiors. */}
          <defs>
            <mask id="zero-glyph-holes">
              <rect x={0} y={0} width={WORLD_W} height={WORLD_H} fill="white" />
              {nodes.map((n) => (
                <circle key={n.id} cx={n.x} cy={n.y} r={GLYPH / 3} fill="black" />
              ))}
            </mask>
          </defs>

          {/* secondary relationships (taggedSpaceIds): dotted, layout-neutral */}
          <g>
            {graph.tagEdges.map((e) => {
              const s = byId.get(e.source)
              const t = byId.get(e.target)
              if (!s || !t) return null
              return (
                <line
                  key={e.id}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.3}
                  strokeWidth={1}
                  strokeDasharray="2 4"
                  strokeLinecap="round"
                />
              )
            })}
          </g>

          {/* parent → child edges (vertical-biased S-curve for an organic flow).
              Masked so the tips are punched out where they'd show through the
              transparent glyph interiors. */}
          <g
            stroke="color-mix(in oklch, var(--muted-foreground) 38%, var(--border))"
            mask="url(#zero-glyph-holes)"
          >
            {graph.edges.map((e) => {
              const s = byId.get(e.source)
              const t = byId.get(e.target)
              if (!s || !t) return null
              // Edges attach to a node's glyph point, EXCEPT an Individual (anchored
              // at its glyph+label center of gravity) and its Soul parent, which is
              // rendered stacked directly above that same CoG.
              const indForAnchor = nodes.find((m) => m.entity.kind === "individual")
              const indCogXForAnchor = indForAnchor
                ? indForAnchor.x + (indForAnchor.rw - GLYPH / 2) / 2
                : 0
              const anchorX = (n: SimNode) =>
                n.entity.kind === "individual"
                  ? n.x + (n.rw - GLYPH / 2) / 2
                  : n.entity.kind === "soul"
                    ? indCogXForAnchor
                    : n.x
              const sx = anchorX(s)
              const sy = s.y
              const tx = anchorX(t)
              const ty = t.y
              // Soul's children get PURE STRAIGHT edges (the identity spine).
              const fromSoul = s.entity.kind === "soul"
              if (fromSoul) {
                return (
                  <line
                    key={e.id}
                    x1={sx}
                    y1={sy}
                    x2={tx}
                    y2={ty}
                    strokeWidth={1.25}
                  />
                )
              }
              // SPACE targets: cubic with VERTICAL tangents (control points share
              // each endpoint's x, pulled to the vertical midpoint by `f`).
              if (t.entity.kind === "space") {
                const f = 0.5
                const c1y = sy + (ty - sy) * f
                const c2y = ty - (ty - sy) * f
                return (
                  <path
                    key={e.id}
                    d={`M ${sx} ${sy} C ${sx} ${c1y} ${tx} ${c2y} ${tx} ${ty}`}
                    fill="none"
                    strokeWidth={1.25}
                  />
                )
              }
              // NON-SPACE targets whose PARENT is NOT a task (spaces included): the edge
              // LEAVES the parent from its BOTTOM (vertical start tangent) and REACHES
              // the child on its LEFT side (horizontal end tangent) — a bottom→left elbow.
              const parentNonTask = s.entity.kind !== "task"
              if (parentNonTask) {
                const k = 0.6
                const c1y = sy + (ty - sy) * k // straight down out of the parent
                const c2x = tx - (tx - sx) * k // straight in from the child's left
                return (
                  <path
                    key={e.id}
                    d={`M ${sx} ${sy} C ${sx} ${c1y} ${c2x} ${ty} ${tx} ${ty}`}
                    fill="none"
                    strokeWidth={1.25}
                  />
                )
              }
              // Other NON-SPACE targets: HORIZONTAL-biased S-curve (cubic with horizontal
              // tangents — control pts share each endpoint's y, pulled toward the
              // horizontal midpoint by `hf`). Stronger tune for more flow.
              const hf = 0.72
              const c1x = sx + (tx - sx) * hf
              const c2x = tx - (tx - sx) * hf
              return (
                <path
                  key={e.id}
                  d={`M ${sx} ${sy} C ${c1x} ${sy} ${c2x} ${ty} ${tx} ${ty}`}
                  fill="none"
                  strokeWidth={1.25}
                />
              )
            })}
          </g>

          {/* nodes — a bare glyph (its center = the node point) + a free-floating
              label to the right. No box, so the graph breathes like Obsidian's. */}
          <g>
            {(() => {
              // The single Individual's center of gravity (glyph+label midpoint):
              // used to anchor its label bg AND to center the Soul label above it.
              const ind = nodes.find((m) => m.entity.kind === "individual")
              const indCogX = ind ? ind.x + (ind.rw - GLYPH / 2) / 2 : 0
              return nodes.map((n) => {
              const closed = isClosed(n.entity)
              const cancelled = !!n.entity.cancelled
              const isIndividual = n.entity.kind === "individual"
              const isSoul = n.entity.kind === "soul"
              const shown =
                n.entity.title.length > 22 ? `${n.entity.title.slice(0, 21)}…` : n.entity.title
              return (
                <g key={n.id}>
                  {/* label: plain SVG text, non-interactive (so it never clips or
                      blocks panning); truncated to keep the cloud readable.
                      A Soul's label sits centered ABOVE the Individual's center of
                      gravity; an Individual gets a thick white bg; everyone else's
                      label floats to the right, vertically centered. */}
                  {isIndividual &&
                    (() => {
                      const w = shown.length * CHAR_W * 1.05 // uppercase runs a touch wide
                      const padX = 6
                      const padY = 4
                      // one thick white bg spanning the GLYPH + gap + label together
                      return (
                        <rect
                          x={n.x - GLYPH / 2 - padX}
                          y={n.y - GLYPH / 2 - padY}
                          width={GLYPH + LABEL_GAP + w + padX * 2}
                          height={GLYPH + padY * 2}
                          rx={3}
                          fill="var(--background)"
                          style={{ pointerEvents: "none" }}
                        />
                      )
                    })()}
                  <text
                    x={isSoul ? indCogX : n.x + GLYPH / 2 + LABEL_GAP}
                    y={isSoul ? n.y - GLYPH / 2 - LABEL_GAP : n.y}
                    fontSize={11}
                    fontFamily="var(--font-mono, monospace)"
                    fontWeight={isIndividual ? 700 : n.hasChildren ? 600 : 400}
                    fill={cancelled ? "var(--muted-foreground)" : "var(--foreground)"}
                    textAnchor={isSoul ? "middle" : "start"}
                    dominantBaseline={isSoul ? "auto" : "middle"}
                    style={{
                      pointerEvents: "none",
                      textDecoration: cancelled ? "line-through" : undefined,
                      textTransform: isIndividual ? "uppercase" : undefined,
                      letterSpacing: isIndividual ? "0.02em" : undefined,
                    }}
                  >
                    {shown}
                  </text>

                  {/* glyph: tight draggable box centered on (n.x, n.y) — except a
                      Soul, whose glyph stacks directly above the Individual's CoG. */}
                  <foreignObject
                    x={(isSoul ? indCogX : n.x) - GLYPH / 2}
                    y={n.y - GLYPH / 2}
                    width={GLYPH}
                    height={GLYPH}
                    onPointerDown={onNodePointerDown(n.id)}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    <div
                      className="flex h-full w-full items-center justify-center text-foreground"
                      title={`${n.entity.title} · ${NODE_KIND_META[n.entity.kind].label}`}
                    >
                      <NodeGlyph
                        kind={n.entity.kind}
                        filled={closed}
                        struck={cancelled}
                        className="h-4 w-4"
                        strokeWidth={1.75}
                      />
                    </div>
                  </foreignObject>
                </g>
              )
            })
            })()}
          </g>
        </svg>
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <span className="text-[10px] text-muted-foreground">
          {"§4 hide · drag nodes · wheel/drag to pan · ⌘/ctrl+wheel to zoom"}
        </span>
        <span className="text-[10px] text-muted-foreground">{"origin tree"}</span>
      </div>
    </div>
  )
}
