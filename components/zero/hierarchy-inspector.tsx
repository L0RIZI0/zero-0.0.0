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
 *   • `space`      → to the RIGHT of the parent. Space siblings stack as a vertical
 *                    column whose CENTER sits on the parent's y (half above / half
 *                    below), one step to the right (cleared past the parent's label).
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
const SPACE_HGAP = 48 // horizontal gap between sibling-space SUBTREES in the row
const SPINE_DY = 132 // vertical gap for an `individual` child (identity spine)
const DR_DX = 16 // action children indent slightly right of the parent
const DR_TOP = 28 // first action child's subtree top sits this far below the parent
const ROW_GAP = 8 // gap between stacked action-child SUBTREES

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
 *  `place()` pass to assign every node a fixed offset (`ox/oy`) from its parent. */
function buildGraph(): { nodes: SimNode[]; edges: Edge[] } {
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

    // action children: stack their SUBTREES straight down, indented slightly right
    let cur = DR_TOP
    for (const a of dr) {
      const e = ext.get(a.id)!
      a.ox = DR_DX
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

    // space children: horizontal ROW BELOW the node, the row's LEFT TIP aligned
    // with the node's x (glyph center) — the row grows rightward from there.
    let rc = 0
    const spaceTop = down_ + SPACE_GAP // clear the node's own down-extent first
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

  return { nodes, edges }
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
  const [, force] = useState(0)

  const ALPHA_MIN = 0.002
  const ALPHA_DECAY = 0.0228

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

  // Center the viewport on the WORLD center once it's laid out, so the settling
  // tree (which is built around the middle of the big world) starts in frame.
  useLayoutEffect(() => {
    if (!graph || centeredRef.current) return
    const vp = viewportRef.current
    if (!vp) return
    const r = vp.getBoundingClientRect()
    panRef.current = { x: r.width / 2 - WORLD_W / 2, y: r.height / 2 - WORLD_H / 2 }
    centeredRef.current = true
    force((n) => n + 1)
  }, [graph])

  if (!active || !graph) return null

  const nodes = nodesRef.current
  const byId = byIdRef.current
  const pan = panRef.current

  const reheat = () => {
    alphaRef.current = Math.max(alphaRef.current, 0.3)
    startLoop()
  }

  // client → world coordinates (svg is rendered at natural WORLD size, so the
  // only transform between client and world space is the pan translate).
  const toWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: clientX, y: clientY }
    return { x: clientX - rect.left, y: clientY - rect.top }
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
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          {/* edges */}
          <g>
            {graph.edges.map((e) => {
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
                  stroke="var(--border)"
                  strokeWidth={1.25}
                />
              )
            })}
          </g>

          {/* nodes — a bare glyph (its center = the node point) + a free-floating
              label to the right. No box, so the graph breathes like Obsidian's. */}
          <g>
            {nodes.map((n) => {
              const closed = isClosed(n.entity)
              const cancelled = !!n.entity.cancelled
              return (
                <g key={n.id}>
                  {/* label: plain SVG text, non-interactive (so it never clips or
                      blocks panning); truncated to keep the cloud readable. */}
                  <text
                    x={n.x + GLYPH / 2 + LABEL_GAP}
                    y={n.y}
                    fontSize={11}
                    fontFamily="var(--font-mono, monospace)"
                    fontWeight={n.hasChildren ? 600 : 400}
                    fill={cancelled ? "var(--muted-foreground)" : "var(--foreground)"}
                    dominantBaseline="middle"
                    style={{
                      pointerEvents: "none",
                      textDecoration: cancelled ? "line-through" : undefined,
                    }}
                  >
                    {n.entity.title.length > 22 ? `${n.entity.title.slice(0, 21)}…` : n.entity.title}
                  </text>

                  {/* glyph: tight draggable box centered exactly on (n.x, n.y). */}
                  <foreignObject
                    x={n.x - GLYPH / 2}
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
            })}
          </g>
        </svg>
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <span className="text-[10px] text-muted-foreground">{"§4 hide · drag nodes · drag bg to pan"}</span>
        <span className="text-[10px] text-muted-foreground">{"origin tree"}</span>
      </div>
    </div>
  )
}
