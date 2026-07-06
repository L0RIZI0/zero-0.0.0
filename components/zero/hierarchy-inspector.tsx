"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useZeroNav } from "@/lib/zero/nav-store"
import { useDebugView } from "@/lib/zero/debug-view"
import { entities } from "@/lib/zero/data"
import { isClosed } from "@/lib/zero/kinds"
import { NODE_KIND_META, NodeGlyph } from "./node-glyph"
import type { Entity } from "@/lib/zero/types"

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
 * LAYOUT — a LAYERED (hierarchical) force graph. A free force-directed cloud makes
 * depth invisible, so instead we constrain the sim so the tree READS top-down. We
 * split nodes into BRANCHES (have children) and LEAVES (don't):
 *   • BRANCHES form a tidy top-down tree:
 *       – VERTICAL by DEPTH — pulled to a layer band (`ty = depth · LAYER_H`) by a
 *         stiff spring, so a PARENT ALWAYS SITS NORTH of its children;
 *       – HORIZONTAL is force-driven: parent ← barycenter of its branch children
 *         (apex centers OVER its subtree → distinct clusters), child → parent
 *         alignment, charge repulsion between columns, weak root centering.
 *   • LEAVES take NO horizontal slot — each hangs in a vertical COLUMN just
 *     below/right of its parent (spring to `parent + (leafOrder+1)·ROW_DY`), so a
 *     subtree reads as a heading with an indented list beneath it. This keeps the
 *     graph narrow and legible instead of spreading every leaf across the row.
 *   • Seeded with a tidy-tree pass so the sim starts near-solved and just relaxes.
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
const WORLD_W = 3200
const WORLD_H = 2200
const LAYER_H = 112 // vertical gap between BRANCH depth levels (parent north of children)
const X_GAP = 240 // horizontal seed spacing between branch columns (tidy-tree first pass)
const LEAF_DX = 18 // leaf column sits slightly right of its parent (reads as indent)
const ROW_DY = 22 // vertical spacing between stacked leaf siblings in a column

// approx label rendering metrics (mono 11px) used for collision + truncation
const LABEL_MAX = 22 // chars before we ellipsize
const CHAR_W = 6.6 // px per mono char at 11px
const LINE_H = 15 // label line box height

type SimNode = {
  id: string
  entity: Entity
  hasChildren: boolean
  isLeaf: boolean // no children → hangs in a vertical column under its parent
  parentId: string | null
  leafOrder: number // index among its parent's LEAF children (for column stacking)
  depth: number // BRANCH depth (only meaningful for branch nodes / layering)
  ty: number // target Y (world) for a branch node's depth band — the layering constraint
  /** right extent from the node center = glyph half + gap + label width, so
   *  collision reserves room for the label and labels stop overlapping. */
  rw: number
  x: number
  y: number
  vx: number
  vy: number
  fx: number | null // pinned position while dragging
  fy: number | null
}

type Edge = { id: string; source: string; target: string }

/** Build the sim nodes + edges from the raw origin tree.
 *
 *  BRANCH nodes (those with children) form a tidy top-down tree: X seeded by an
 *  in-order pass over branch columns, Y by branch depth. LEAF nodes don't take a
 *  horizontal slot — they hang in a vertical COLUMN just below/right of their
 *  parent, so a subtree reads as a heading with an indented list under it. */
function buildGraph(): { nodes: SimNode[]; edges: Edge[] } {
  const byParent = new Map<string | null, Entity[]>()
  for (const e of entities) {
    if (e.seriesId != null) continue
    const list = byParent.get(e.parentId)
    if (list) list.push(e)
    else byParent.set(e.parentId, [e])
  }
  const hasKids = (id: string) => (byParent.get(id)?.length ?? 0) > 0

  const nodes: SimNode[] = []
  const edges: Edge[] = []
  const byId = new Map<string, SimNode>()

  // pass 1: create every node + edge, stamp isLeaf / parentId / leafOrder.
  const walk = (entity: Entity) => {
    const children = byParent.get(entity.id) ?? []
    const isLeaf = children.length === 0
    const shownLen = Math.min(entity.title.length, LABEL_MAX)
    const node: SimNode = {
      id: entity.id,
      entity,
      hasChildren: !isLeaf,
      isLeaf,
      parentId: entity.parentId,
      leafOrder: 0,
      depth: 0,
      ty: 0,
      rw: GLYPH / 2 + LABEL_GAP + shownLen * CHAR_W,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
    }
    nodes.push(node)
    byId.set(node.id, node)

    let leafOrder = 0
    for (const child of children) {
      edges.push({ id: `${entity.id}->${child.id}`, source: entity.id, target: child.id })
      walk(child)
      if (!hasKids(child.id)) {
        const cn = byId.get(child.id)
        if (cn) cn.leafOrder = leafOrder++
      }
    }
  }
  for (const root of byParent.get(null) ?? []) walk(root)

  // pass 2: tidy-tree X for BRANCH nodes only (leaves never claim an X slot).
  let leafCounter = 0
  let maxDepth = 0
  const seedBranch = (entity: Entity, depth: number): number => {
    if (depth > maxDepth) maxDepth = depth
    const children = byParent.get(entity.id) ?? []
    const branchKids = children.filter((c) => hasKids(c.id))
    let x: number
    if (branchKids.length === 0) x = leafCounter++ * X_GAP
    else x = branchKids.reduce((s, c) => s + seedBranch(c, depth + 1), 0) / branchKids.length
    const n = byId.get(entity.id)!
    n.x = x
    n.depth = depth
    return x
  }
  for (const root of byParent.get(null) ?? []) if (hasKids(root.id)) seedBranch(root, 0)

  // center branch tree in the world; set branch target-Y bands.
  const branches = nodes.filter((n) => !n.isLeaf)
  const meanX = branches.reduce((s, n) => s + n.x, 0) / (branches.length || 1)
  const dx = WORLD_W / 2 - meanX
  const topY = WORLD_H / 2 - (maxDepth * LAYER_H) / 2
  for (const n of branches) {
    n.x += dx + (Math.random() - 0.5) * 6
    n.ty = topY + n.depth * LAYER_H
    n.y = n.ty + (Math.random() - 0.5) * 6
  }
  // seed each leaf in its parent's column.
  for (const n of nodes) {
    if (!n.isLeaf) continue
    const p = n.parentId ? byId.get(n.parentId) : null
    n.x = (p?.x ?? WORLD_W / 2) + LEAF_DX
    n.y = (p?.y ?? WORLD_H / 2) + (n.leafOrder + 1) * ROW_DY
    n.ty = n.y
  }

  return { nodes, edges }
}

/** One physics tick. BRANCH nodes: stiff Y layer spring (depth) + horizontal
 *  forces. LEAF nodes: spring to a vertical column slot under their parent. */
function tick(nodes: SimNode[], edges: Edge[], byId: Map<string, SimNode>, alpha: number) {
  const CHARGE = -1500 // horizontal repulsion between BRANCH columns
  const LAYER_K = 0.4 // stiff pull to the depth band (keeps parents north)
  const CHILD_ALIGN_K = 0.02 // branch child.x → parent.x (tucks subtree under parent)
  const PARENT_BARY_K = 0.12 // parent.x → mean branch-child.x (apex centers over subtree)
  const ROOT_X_K = 0.05 // roots gently anchored to world-center X
  const X_GRAVITY = 0.003 // faint global X centering for stability
  const LEAF_K = 0.35 // leaf → its column slot under the parent
  const VELOCITY_DECAY = 0.78
  const cx = WORLD_W / 2
  // label-aware collision box: small left/vertical, wide right (n.rw)
  const LEFT_EXT = GLYPH / 2 + 2
  const V_EXT = LINE_H / 2 + 1

  // horizontal charge between BRANCH nodes only (leaves are held by their column
  // spring; spacing between leaf labels is handled by collision).
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    if (a.isLeaf) continue
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      if (b.isLeaf) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      let d2 = dx * dx + dy * dy
      if (d2 < 1) d2 = 1
      const dist = Math.sqrt(d2)
      const f = (CHARGE * alpha) / d2
      const fx = (dx / dist) * f
      a.vx += fx
      b.vx -= fx
    }
  }

  // horizontal alignment along BRANCH↔BRANCH edges (barycenter → apex centering)
  for (const e of edges) {
    const p = byId.get(e.source)
    const c = byId.get(e.target)
    if (!p || !c || c.isLeaf) continue
    const d = c.x - p.x
    c.vx += -d * CHILD_ALIGN_K * alpha
    p.vx += d * PARENT_BARY_K * alpha
  }

  // branch layering + centering; leaf column springs
  for (const n of nodes) {
    if (n.isLeaf) {
      const p = n.parentId ? byId.get(n.parentId) : null
      if (p) {
        const targetX = p.x + LEAF_DX
        const targetY = p.y + (n.leafOrder + 1) * ROW_DY
        n.vx += (targetX - n.x) * LEAF_K * alpha
        n.vy += (targetY - n.y) * LEAF_K * alpha
      }
      continue
    }
    n.vy += (n.ty - n.y) * LAYER_K * alpha
    n.vx += (cx - n.x) * X_GRAVITY * alpha
    if (n.depth === 0) n.vx += (cx - n.x) * ROOT_X_K * alpha
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
        <span className="font-bold">{"Hierarchy · layered graph"}</span>
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
