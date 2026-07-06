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
 * LAYOUT — an Obsidian-style FORCE-DIRECTED graph. A tiny self-contained physics
 * sim (no d3-force dep) relaxes the node cloud each frame with d3-style alpha decay:
 *   • charge      — every node repels every other (Coulomb, ~1/dist²)
 *   • link spring — parent↔child edges pull to a rest length
 *   • gravity     — a gentle pull toward the WORLD center so it can't drift away
 *   • COLUMN HINT — a parent's LEAF children get a soft spring toward a vertical
 *     stack just to the parent's right, so sibling leaves settle into a tidy
 *     columned list "when possible" while the rest of the graph stays organic.
 *
 * The sim runs in a LARGE virtual WORLD (much bigger than the viewport) so nodes
 * have room to breathe and the hierarchy reads clearly — the graph deliberately
 * BLEEDS past the window edges and the whole thing is PANNABLE (drag empty space).
 * Individual nodes are draggable too (drag reheats the sim). Recurrence occurrences
 * (`seriesId`) are skipped so the graph is the true containment skeleton.
 *
 * Read-only: re-seeds on `dataVersion`, never mutates. Renders nothing in
 * production. Mirrors the §3 inspector's chrome/style.
 */

const NODE_W = 150 // node pill width (label truncates within)
// Large virtual world so the graph can spread out and be panned (not squished to fit).
const WORLD_W = 2800
const WORLD_H = 2000
const COL_DX = 210 // horizontal gap a leaf column sits to the right of its parent
const ROW_DY = 34 // vertical spacing between stacked leaf siblings

type SimNode = {
  id: string
  entity: Entity
  hasChildren: boolean
  x: number
  y: number
  vx: number
  vy: number
  // column-hint metadata (only meaningful for leaves): stack offset around parent
  parentId: string | null
  isLeaf: boolean
  leafOffset: number // (index - (count-1)/2) among leaf siblings
  fx: number | null // pinned position while dragging
  fy: number | null
}

type Edge = { id: string; source: string; target: string }

/** Build the sim nodes + edges from the raw origin tree, seeded with a rough
 *  left→right tree layout so the physics starts from a sane, near-solved state. */
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
  const cx = WORLD_W / 2
  const cy = WORLD_H / 2

  const walk = (entity: Entity, depth: number, seedY: number) => {
    const children = byParent.get(entity.id) ?? []
    const leafSiblings = children.filter((c) => (byParent.get(c.id)?.length ?? 0) === 0)
    const leafCount = leafSiblings.length

    nodes.push({
      id: entity.id,
      entity,
      hasChildren: children.length > 0,
      // seed roughly by depth (x) and a spread on y; jitter avoids perfect overlap
      x: cx - WORLD_W / 4 + depth * COL_DX + (Math.random() - 0.5) * 8,
      y: seedY + (Math.random() - 0.5) * 8,
      vx: 0,
      vy: 0,
      parentId: entity.parentId,
      isLeaf: children.length === 0,
      leafOffset: 0,
      fx: null,
      fy: null,
    })

    let leafIdx = 0
    children.forEach((child, i) => {
      edges.push({ id: `${entity.id}->${child.id}`, source: entity.id, target: child.id })
      const childSeedY = seedY + (i - (children.length - 1) / 2) * ROW_DY * 1.6
      walk(child, depth + 1, childSeedY)
      // stamp leaf-column offset on the just-pushed child node if it's a leaf
      if ((byParent.get(child.id)?.length ?? 0) === 0) {
        const node = nodes[nodes.length - 1]
        node.leafOffset = leafIdx - (leafCount - 1) / 2
        leafIdx++
      }
    })
  }

  for (const root of byParent.get(null) ?? []) walk(root, 0, cy)
  return { nodes, edges }
}

/** One physics tick, d3-style. Mutates node positions in place. */
function tick(nodes: SimNode[], edges: Edge[], byId: Map<string, SimNode>, alpha: number) {
  const CHARGE = -4200
  const LINK_DIST = COL_DX
  const LINK_K = 0.32
  const GRAVITY = 0.02
  const COLUMN_K = 0.2
  const VELOCITY_DECAY = 0.6
  // Rectangular collision half-extents (pills are wide, short) + breathing margin.
  const HALF_W = NODE_W / 2 + 10
  const HALF_H = 13 + 4

  // charge: pairwise repulsion
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      const dx = a.x - b.x
      const dy = a.y - b.y
      let d2 = dx * dx + dy * dy
      if (d2 < 1) d2 = 1
      const dist = Math.sqrt(d2)
      const f = (CHARGE * alpha) / d2
      const fx = (dx / dist) * f
      const fy = (dy / dist) * f
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }
  }

  // rectangular collision: resolve overlapping pill boxes along the axis of
  // least penetration so wide labels stop stacking on top of each other.
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const ox = HALF_W * 2 - Math.abs(dx)
      const oy = HALF_H * 2 - Math.abs(dy)
      if (ox > 0 && oy > 0) {
        if (ox < oy) {
          const push = (ox / 2) * (dx < 0 ? -1 : 1)
          a.x -= push
          b.x += push
        } else {
          const push = (oy / 2) * (dy < 0 ? -1 : 1)
          a.y -= push
          b.y += push
        }
      }
    }
  }

  // link springs (parent↔child)
  for (const e of edges) {
    const s = byId.get(e.source)
    const t = byId.get(e.target)
    if (!s || !t) continue
    const dx = t.x - s.x
    const dy = t.y - s.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    const f = ((dist - LINK_DIST) / dist) * LINK_K * alpha
    const fx = dx * f
    const fy = dy * f
    s.vx += fx
    s.vy += fy
    t.vx -= fx
    t.vy -= fy
  }

  // gravity toward center + column hint for leaves
  const cx = WORLD_W / 2
  const cy = WORLD_H / 2
  for (const n of nodes) {
    n.vx += (cx - n.x) * GRAVITY * alpha
    n.vy += (cy - n.y) * GRAVITY * alpha

    if (n.isLeaf && n.parentId) {
      const p = byId.get(n.parentId)
      if (p) {
        const targetX = p.x + COL_DX
        const targetY = p.y + n.leafOffset * ROW_DY
        n.vx += (targetX - n.x) * COLUMN_K * alpha
        n.vy += (targetY - n.y) * COLUMN_K * alpha
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
  // cloud (which gravitates to the middle of the big world) starts in frame.
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
        <span className="font-bold">{"Hierarchy · force graph"}</span>
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

          {/* nodes */}
          <g>
            {nodes.map((n) => {
              const closed = isClosed(n.entity)
              const cancelled = !!n.entity.cancelled
              return (
                <foreignObject
                  key={n.id}
                  x={n.x - NODE_W / 2}
                  y={n.y - 12}
                  width={NODE_W}
                  height={24}
                  onPointerDown={onNodePointerDown(n.id)}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <div
                    className="flex h-6 items-center gap-1.5 rounded-md border border-border bg-background/90 px-2 leading-none shadow-sm"
                    title={`${n.entity.title} · ${NODE_KIND_META[n.entity.kind].label}`}
                  >
                    <span className="shrink-0 text-foreground">
                      <NodeGlyph
                        kind={n.entity.kind}
                        filled={closed}
                        struck={cancelled}
                        className="h-3.5 w-3.5"
                        strokeWidth={1.75}
                      />
                    </span>
                    <span
                      className={`truncate ${cancelled ? "text-muted-foreground line-through" : n.hasChildren ? "font-semibold text-foreground" : "text-card-foreground"}`}
                    >
                      {n.entity.title}
                    </span>
                  </div>
                </foreignObject>
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
