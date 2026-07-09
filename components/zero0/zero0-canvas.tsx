"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { VersionSwitcher } from "@/components/version-switcher"
import { Zero0ThemeToggle } from "./zero0-theme-toggle"
import {
  currentUser,
  getChildren,
  getEntity,
  hydrateFromStorage,
  addTask,
  addParsedEntity,
  setEntityCompleted,
  deleteEntity,
} from "@/lib/zero/data"
import { KIND_META, isClosed } from "@/lib/zero/kinds"
import { isDone } from "@/lib/zero/entity-log"
import { parseCreateField } from "@/lib/zero/create-parse"
import type { Entity, EntityKind } from "@/lib/zero/types"

// The root context: the Individual whose space IS the homeview. Everything the
// user grows on the canvas nests under this id. Matches the seed in `data.ts`.
const ROOT_ID = "s_root"

// A monospace, self-contained glyph per kind — outline vs filled forms echoing the
// ontology's geometry (square Task, hexagon Space, diamond Resource, triangle-up
// Moment, triangle-down Instant, pentagon Community, circle Organism, the tilted
// Individual, the Soul dot). Kept as plain text on purpose: zero0 reads as raw
// DATA, and this stays independent of the orphaned `components/zero` NodeGlyph (a
// GSAP component) so zero0 owns no heavy UI deps.
const GLYPH_OUTLINE: Record<EntityKind, string> = {
  task: "□",
  space: "⬡",
  resource: "◇",
  moment: "△",
  instant: "▽",
  community: "⬠",
  organism: "○",
  individual: "◈",
  soul: "◦",
}
const GLYPH_FILLED: Record<EntityKind, string> = {
  task: "■",
  space: "⬢",
  resource: "◆",
  moment: "▲",
  instant: "▼",
  community: "⬟",
  organism: "●",
  individual: "◆",
  soul: "•",
}

/**
 * Root `/` canvas — the stripped, "seemingly blank" slate for the next iteration
 * of Zero, now wired to the REAL backbone (`lib/zero`): the same ontology, entity
 * model, and append-only lifecycle log that powers `/2`, but reading a FRESH,
 * isolated dataset (its own `zero:root-items:v1` storage key) that starts as just
 * the identity scaffold (Soul → Individual) and grows only from what you create.
 *
 * Its visual language is deliberately the one from the `§3`/`§4` dev inspectors:
 * monospace, tiny muted `tabular-nums` type, hairline rules, and no chrome (no
 * cards, radii, shadows, or motion) — it reads as raw DATA. Styling is scoped to
 * this route: colors come from the shared TOKENS (dark/light still flips globally)
 * and the mono family is a page-local var (`--font-zero0-mono`, set by
 * `app/page.tsx`), so `layout.tsx`/`globals.css` stay untouched and `/1` + `/2`
 * keep Geist.
 *
 * Navigation is recursive: every entity is a context, so clicking a row's TITLE
 * drills into that entity (the list re-roots to its children) and a mono
 * breadcrumb climbs back — the containment tree explored one level at a time.
 */
export function Zero0Canvas() {
  // All reads/writes touch localStorage-backed module state, so gate behind mount
  // to avoid SSR/hydration mismatch. `rev` is a manual re-render bump after every
  // mutation (the store mutates a module array in place — the do-list pattern).
  const [mounted, setMounted] = useState(false)
  const [rev, setRev] = useState(0)
  const [draft, setDraft] = useState("")
  // The drill-in stack: ids from the root context down to the current one. The
  // last id is the context whose children we render + create into.
  const [path, setPath] = useState<string[]>([ROOT_ID])

  useEffect(() => {
    hydrateFromStorage()
    setMounted(true)
  }, [])

  const bump = useCallback(() => setRev((r) => r + 1), [])

  const contextId = path[path.length - 1]
  const context = mounted ? getEntity(contextId) : undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rev/contextId are the intended re-read triggers
  const children = useMemo(() => (mounted ? getChildren(contextId) : []), [mounted, rev, contextId])
  // Resolve each crumb to a display label (fall back to the user name at the root).
  const crumbs = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/exhaustive-deps -- rev re-reads titles after renames
      path.map((id, i) => ({
        id,
        label: getEntity(id)?.title ?? (i === 0 ? currentUser.name : id),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, mounted, rev],
  )

  const create = useCallback(() => {
    const raw = draft.trim()
    if (!raw) return
    // The backbone's "terminal hybrid" parser: a `--time` param (optionally with a
    // past-tense verb) creates a scheduled Moment/Instant, else a plain Task. New
    // entities nest under the CURRENT drilled-in context.
    const parsed = parseCreateField(raw)
    if (parsed) {
      addParsedEntity({
        title: parsed.title,
        spaceId: contextId,
        kind: parsed.kind,
        schedule: parsed.schedule,
        completed: parsed.completed,
      })
    } else {
      addTask({ title: raw, spaceId: contextId })
    }
    setDraft("")
    bump()
  }, [draft, bump, contextId])

  const toggleDone = useCallback(
    (e: Entity) => {
      if (!KIND_META[e.kind].completable) return
      setEntityCompleted(e.id, !isDone(e))
      bump()
    },
    [bump],
  )

  const remove = useCallback(
    (e: Entity) => {
      deleteEntity(e.id)
      // If we're inside the entity being deleted, climb out of it first.
      setPath((p) => (p.includes(e.id) ? p.slice(0, p.indexOf(e.id)) : p))
      bump()
    },
    [bump],
  )

  const openEntity = useCallback((e: Entity) => {
    setPath((p) => [...p, e.id])
  }, [])

  const goToCrumb = useCallback((i: number) => {
    setPath((p) => p.slice(0, i + 1))
  }, [])

  return (
    <main
      className="relative flex min-h-screen flex-col bg-background text-foreground"
      style={{ fontFamily: "var(--font-zero0-mono), ui-monospace, monospace" }}
    >
      {/* Inspector-style key/value readout — the header of the data surface. */}
      <header className="p-4 text-[10px] leading-relaxed text-muted-foreground tabular-nums">
        <div className="flex gap-2">
          <span className="text-foreground">zero</span>
          <span aria-hidden>·</span>
          <span>root canvas</span>
        </div>
        <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-4">
          <dt className="uppercase tracking-widest">context</dt>
          <dd className="text-foreground">{mounted && context ? context.title : currentUser.name}</dd>
          <dt className="uppercase tracking-widest">store</dt>
          <dd className="text-foreground">zero:root-items:v1</dd>
          <dt className="uppercase tracking-widest">entities</dt>
          <dd className="text-foreground">{mounted ? children.length : "—"}</dd>
        </dl>
        {/* Breadcrumb — the drill-in trail; each crumb climbs back to that depth. */}
        {mounted && path.length > 1 && (
          <nav className="mt-2 flex flex-wrap items-center gap-1" aria-label="Breadcrumb">
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1
              return (
                <span key={c.id} className="flex items-center gap-1">
                  {i > 0 && (
                    <span className="text-muted-foreground/50" aria-hidden>
                      /
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => goToCrumb(i)}
                    disabled={last}
                    aria-current={last ? "page" : undefined}
                    className={
                      last
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    }
                  >
                    {c.label}
                  </button>
                </span>
              )
            })}
          </nav>
        )}
      </header>

      {/* Body: the entity listing. Empty until you create something. */}
      <div className="flex-1 px-4 pb-4">
        {mounted && children.length === 0 && (
          <p className="text-[11px] text-muted-foreground">— empty — create below</p>
        )}
        {mounted && children.length > 0 && (
          <ul className="text-[11px] tabular-nums">
            {children.map((e, i) => {
              const meta = KIND_META[e.kind]
              const done = isDone(e)
              const closed = isClosed(e)
              const glyph = closed ? GLYPH_FILLED[e.kind] : GLYPH_OUTLINE[e.kind]
              const showCheck = done && !closed && meta.checkmarkWhenDone
              return (
                <li
                  key={e.id}
                  className="group flex items-baseline gap-3 border-b border-border/60 py-1.5"
                >
                  <span className="w-6 shrink-0 text-right text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {/* Glyph-state column: outline vs filled = open vs closed, with a
                      trailing check for a done-but-open completable. Read-only. */}
                  <span
                    className="w-6 shrink-0 text-center text-foreground"
                    aria-label={closed ? "closed" : done ? "done" : "open"}
                    title={closed ? "closed" : done ? "done" : "open"}
                  >
                    {glyph}
                    {showCheck && <span className="text-muted-foreground">✓</span>}
                  </span>
                  {/* Kind label — now STATIC text, not the toggle. */}
                  <span className="w-16 shrink-0 uppercase tracking-wider text-muted-foreground">
                    {meta.label}
                  </span>
                  {/* Title — click to DRILL IN to this entity's own context. */}
                  <button
                    type="button"
                    onClick={() => openEntity(e)}
                    className={
                      "flex-1 truncate text-left underline-offset-2 hover:underline " +
                      (closed ? "text-muted-foreground line-through" : "text-foreground")
                    }
                    title="Open"
                  >
                    {e.title}
                  </button>
                  {/* Status cell — the clear DONE/OPEN toggle button. */}
                  <button
                    type="button"
                    onClick={() => toggleDone(e)}
                    disabled={!meta.completable}
                    className={
                      "w-12 shrink-0 text-right " +
                      (meta.completable
                        ? "text-muted-foreground hover:text-foreground"
                        : "text-muted-foreground/40")
                    }
                    title={meta.completable ? "Toggle done" : "Not completable"}
                  >
                    {meta.completable ? (done ? "[done]" : "[ open]") : "—"}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(e)}
                    className="w-4 shrink-0 text-right text-transparent group-hover:text-muted-foreground hover:!text-foreground"
                    aria-label={`Delete ${e.title}`}
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Create field — bare mono input, hairline top, no chrome. */}
      <div className="border-t border-border px-4 py-2">
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="text-muted-foreground" aria-hidden>
            +
          </span>
          <input
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key !== "Enter") return
              // CJK IME guard: don't submit while composing.
              if (ev.nativeEvent.isComposing || ev.keyCode === 229) return
              create()
            }}
            placeholder="create entity…  (try:  Slept --2330-0630)"
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            aria-label="Create entity"
          />
        </div>
      </div>

      {/* Controls: hairline-topped footer, mono + muted, no chrome. */}
      <footer className="flex items-center gap-3 border-t border-border p-4 text-[10px] leading-none text-muted-foreground">
        <VersionSwitcher />
        <span className="text-border" aria-hidden>
          |
        </span>
        <Zero0ThemeToggle />
      </footer>
    </main>
  )
}
