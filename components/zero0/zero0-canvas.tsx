"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { VersionSwitcher } from "@/components/version-switcher"
import { Zero0ThemeToggle } from "./zero0-theme-toggle"
import { Zero0Activity } from "./zero0-activity"
import { recordPresence } from "@/lib/zero/activity-log"
import { Zero0Glyph } from "./zero0-glyph"
import { Zero0EntityMenu, type Zero0MenuAnchor } from "./zero0-entity-menu"
import {
  currentUser,
  getChildren,
  getEntity,
  hydrateFromStorage,
  addTask,
  addParsedEntity,
  addWebResource,
  setEntityCompleted,
  setEntityScheduleField,
  renameEntity,
  deleteEntity,
} from "@/lib/zero/data"
import { KIND_META, isClosed, isTerminal, fillsGlyph } from "@/lib/zero/kinds"
import { isDone, isCancelled, getCreatedAt, getCompletedOn } from "@/lib/zero/entity-log"
import { parseCreateField, parseKindPrefix, parseFieldSetter, parseDateToken } from "@/lib/zero/create-parse"
import { looksLikeUrl, normalizeUrl, resolveWebResourceByUrl, webDisplayName } from "@/lib/zero/web-resources"
import type { Entity } from "@/lib/zero/types"

// The root context: the Individual whose space IS the homeview. Everything the
// user grows on the canvas nests under this id. Matches the seed in `data.ts`.
const ROOT_ID = "s_root"

// Format an epoch (ms) for the meta readout. Only ever called under the `mounted`
// gate, so it's client-only — no SSR/static-export time-freeze hydration trap.
function fmt(epoch?: number): string {
  if (!epoch) return "—"
  return new Date(epoch).toLocaleString()
}

/**
 * Root `/` canvas — the stripped, "seemingly blank" slate for the next iteration
 * of Zero, wired to the REAL backbone (`lib/zero`): the same ontology, entity
 * model, and append-only lifecycle log that powers `/2`, but reading a FRESH,
 * isolated dataset (its own `zero:root-items:v1` storage key) that starts as just
 * the identity scaffold (Soul → Individual) and grows only from what you create.
 *
 * LAYOUT — three bands. The canvas treats the top + bottom as pure Zero-UX HELPERS
 * that SANDWICH the current node's raw data:
 *   1. TOP HELPER (`<header>`): the "zero · root canvas" mark, the ACCESS PATH
 *      (breadcrumb), and a CONTEXT/STORE/ENTITIES session readout.
 *   2. ENTITY CONTENT: the open node rendered as raw data — its META (id, kind,
 *      states, timestamps), then its CHILDREN list, then a create field. Because
 *      every entity is a context, this is fully recursive: the root Individual
 *      ("Loris") shows its own meta + children exactly like any Task or Space.
 *   3. BOTTOM HELPER (`<footer>`): the version switcher + theme toggle.
 *
 * Visual language is the `§3`/`§4` dev-inspector one: monospace, tiny muted
 * `tabular-nums`, hairline rules, no chrome — raw DATA. Scoped to this route
 * (tokens + a page-local `--font-zero0-mono`), so `/1` + `/2` keep Geist.
 */
export function Zero0Canvas() {
  // All reads/writes touch localStorage-backed module state, so gate behind mount
  // to avoid SSR/hydration mismatch. `rev` is a manual re-render bump after every
  // mutation (the store mutates a module array in place — the do-list pattern).
  const [mounted, setMounted] = useState(false)
  const [rev, setRev] = useState(0)
  const [draft, setDraft] = useState("")
  // Transient one-line feedback under the create field (the "terminal" talking back):
  // confirms a `:field:` setter or explains a rejected value. Cleared on next keystroke.
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null)
  // The drill-in stack: ids from the root context down to the current one. The
  // last id is the context whose children we render + create into.
  const [path, setPath] = useState<string[]>([ROOT_ID])
  // Right-click menu anchor (null = closed).
  const [menu, setMenu] = useState<Zero0MenuAnchor | null>(null)
  // The activity view (ported tracker) is hidden by default so the canvas stays blank;
  // toggled from the footer, it surfaces as a band ABOVE the header.
  const [showActivity, setShowActivity] = useState(false)

  useEffect(() => {
    hydrateFromStorage()
    setMounted(true)
  }, [])

  const bump = useCallback(() => setRev((r) => r + 1), [])

  const contextId = path[path.length - 1]

  // PRESENCE: log WHERE the user is — the current drilled-in context. Fires on every
  // context change (and initial mount) so the activity tracker records the trail through
  // the graph, exactly as the old shell did on `activeId`. `recordPresence` no-ops on a
  // repeat of the same id, so this is safe to run on each `contextId`.
  useEffect(() => {
    if (!mounted) return
    recordPresence(contextId)
  }, [mounted, contextId])
  const context = mounted ? getEntity(contextId) : undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rev/contextId are the intended re-read triggers
  const children = useMemo(() => (mounted ? getChildren(contextId) : []), [mounted, rev, contextId])
  // Resolve each crumb to a display label (fall back to the user name at the root).
  const crumbs = useMemo(
    () =>
      path.map((id, i) => ({
        id,
        label: getEntity(id)?.title ?? (i === 0 ? currentUser.name : id),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rev re-reads titles after renames
    [path, mounted, rev],
  )

  const create = useCallback(() => {
    const raw = draft.trim()
    if (!raw) return

    // 0) SELF-FIELD setter: `:field: value` mutates THIS entity (the ":" = "in this",
    //    trailing colon = a field, vs `:kind` which creates a child). Fields:
    //    :title: (free text) → renames self + records title history; :start:/:end:
    //    (moment span) → startAt/endAt, :at: (instant point) → at, :due: (task deadline)
    //    → dueAt (these parse a compact date token: HHMM today / YYMMDD / YYMMDDHHMM;
    //    empty value clears the slot). Talks back via the notice line instead of creating.
    const setter = parseFieldSetter(raw)
    if (setter) {
      // :title: is free text (not a date), and renames THIS entity while logging history.
      if (setter.field === "title") {
        if (setter.value === "") {
          setNotice({ tone: "err", text: "title can't be empty" })
          return
        }
        const ok = renameEntity(contextId, setter.value)
        setNotice(
          ok
            ? { tone: "ok", text: `renamed · ${setter.value}` }
            : { tone: "err", text: "no change" },
        )
        if (ok) {
          setDraft("")
          bump()
        }
        return
      }
      const fieldMap: Record<string, "startAt" | "endAt" | "at" | "dueAt"> = {
        start: "startAt",
        end: "endAt",
        at: "at",
        due: "dueAt",
      }
      const key = fieldMap[setter.field]
      if (!key) {
        setNotice({ tone: "err", text: `unknown field :${setter.field}: — try :title: :start: :end: :at: :due:` })
        return
      }
      // Empty value clears the slot; otherwise it must parse to a valid date token.
      let epoch: number | null = null
      if (setter.value !== "") {
        epoch = parseDateToken(setter.value)
        if (epoch == null) {
          setNotice({ tone: "err", text: `invalid time "${setter.value}" — use HHMM, YYMMDD, or YYMMDDHHMM` })
          return
        }
      }
      const ok = setEntityScheduleField(contextId, key, epoch)
      if (!ok) {
        setNotice({ tone: "err", text: "no open entity to set" })
        return
      }
      setNotice({ tone: "ok", text: epoch == null ? `${setter.field} cleared` : `${setter.field} set · ${fmt(epoch)}` })
      setDraft("")
      bump()
      return
    }

    // 1) A leading ":xxxx" selector (":" + first 4 letters of a kind) FORCES the kind
    //    (e.g. ":spac Day Job" → Space). It's stripped, and the remaining text still
    //    runs through the time grammar below.
    const kindPrefix = parseKindPrefix(raw)
    const body = kindPrefix ? kindPrefix.rest : raw
    if (!body) return // e.g. ":space" with no title — nothing to create

    // 2) With NO explicit kind, a body that reads as a URL / bare domain / internal
    //    Zero route (e.g. "figma.com", "https://x.com/p", "/zero-entities") is a
    //    RESOURCE, not a task — Zero is a contextual browser, so a browsable address
    //    becomes a diamond resource pinned to the current context. An explicit `:kind`
    //    prefix opts OUT (e.g. `:task /zero-entities` really is a task titled that).
    if (!kindPrefix && looksLikeUrl(body)) {
      const url = normalizeUrl(body)
      const resource = resolveWebResourceByUrl(url)
      addWebResource({
        title: webDisplayName(url, resource?.id),
        url,
        spaceId: contextId,
        resourceId: resource?.id,
      })
      setDraft("")
      bump()
      return
    }

    // 3) The backbone's "terminal hybrid" parser: a `--time` param (optionally with a
    //    past-tense verb) yields a scheduled Moment/Instant/Task. New entities nest
    //    under the CURRENT drilled-in context.
    const parsed = parseCreateField(body)

    if (kindPrefix) {
      // Explicit kind wins over the parser's verb-inferred kind; keep any parsed
      // schedule/done state from the time grammar.
      addParsedEntity({
        title: parsed ? parsed.title : body,
        spaceId: contextId,
        kind: kindPrefix.kind,
        schedule: parsed?.schedule,
        completed: parsed?.completed ?? false,
      })
    } else if (parsed) {
      addParsedEntity({
        title: parsed.title,
        spaceId: contextId,
        kind: parsed.kind,
        schedule: parsed.schedule,
        completed: parsed.completed,
      })
    } else {
      addTask({ title: body, spaceId: contextId })
    }
    setDraft("")
    bump()
  }, [draft, bump, contextId])

  // The one quick INLINE toggle: the soft DONE marker (done ⟷ undone), for kinds
  // that HAVE a done axis (Task / Moment / Instant). The lifecycle actions — Close /
  // Cancel / Reopen — live in the right-click menu.
  const toggleDone = useCallback(
    (e: Entity) => {
      if (!KIND_META[e.kind].hasDoneState) return
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

  // Jump to an ARBITRARY entity (e.g. clicked in the activity view), rebuilding the drill
  // path by walking `parentId` up to the root. Used when the target isn't a direct child
  // of the current context. Falls back to just [ROOT, id] if the chain can't reach root
  // (e.g. orphaned/detached), and to the root alone if the id is the root or unknown.
  const navigateTo = useCallback((id: string) => {
    if (id === ROOT_ID || !getEntity(id)) {
      setPath([ROOT_ID])
      return
    }
    const chain: string[] = []
    let cursor: string | undefined = id
    const guard = new Set<string>() // cycle guard
    while (cursor && cursor !== ROOT_ID && !guard.has(cursor)) {
      guard.add(cursor)
      chain.unshift(cursor)
      cursor = getEntity(cursor)?.parentId ?? undefined
    }
    setPath([ROOT_ID, ...chain])
  }, [])

  const openMenu = useCallback((e: Entity, ev: React.MouseEvent) => {
    ev.preventDefault()
    setMenu({ entity: e, x: ev.clientX, y: ev.clientY })
  }, [])

  // Meta rows for the CURRENT open node — raw lifecycle data, kind-aware. Recomputed
  // per render (cheap) rather than memoised, so it always mirrors `rev`.
  const meta = context ? KIND_META[context.kind] : undefined
  const metaRows: [string, string][] = []
  if (context && meta) {
    metaRows.push(["id", context.id])
    metaRows.push(["kind", context.kind])
    metaRows.push(["created", fmt(getCreatedAt(context))])
    // TITLE HISTORY — only when the entity has actually been renamed (>1 entry). Shows
    // the full chain oldest→newest with the time each name took effect, so the raw-data
    // view exposes what `titleAt(entity, t)` folds for the activity tracker.
    if (context.titleLog && context.titleLog.length > 1) {
      metaRows.push(["titles", context.titleLog.map((t) => `${t.title} (${fmt(t.at)})`).join("  →  ")])
    }
    // DONE axis — only kinds that have it (Task / Moment / Instant).
    if (meta.hasDoneState) {
      const done = isDone(context)
      metaRows.push(["done", done ? fmt(getCompletedOn(context)) : "no"])
    }
    // CLOSE axis — every kind with a lifecycle (fillable or terminal).
    if (meta.fillsWhenClosed || meta.terminal) {
      metaRows.push(["closed", isClosed(context) ? "yes" : "no"])
      metaRows.push(["cancelled", isCancelled(context) ? "yes" : "no"])
    }
    if (context.kind === "task" && context.requested) metaRows.push(["requested", "yes"])
    // TEMPORAL slots — a kind's defining time dimension is ALWAYS shown (as "—" when
    // unset), the same way DONE/CLOSED always render. A Moment IS a span, an Instant
    // IS a point, so hiding those rows when empty would hide the kind's essence.
    const s = context.schedule
    if (context.kind === "moment") {
      metaRows.push(["start", s?.startAt ? fmt(s.startAt) : "—"])
      metaRows.push(["end", s?.endAt ? fmt(s.endAt) : "—"])
    } else if (context.kind === "instant") {
      metaRows.push(["at", s?.at ? fmt(s.at) : "—"])
    } else if (s?.dueAt) {
      // Tasks (and other kinds) only surface a schedule row when one is actually set.
      metaRows.push(["due", fmt(s.dueAt)])
    } else if (s && (s.startAt || s.endAt || s.at)) {
      metaRows.push(["scheduled", s.at ? fmt(s.at) : `${fmt(s.startAt)} → ${fmt(s.endAt)}`])
    }
  }

  return (
    <main
      className="relative flex min-h-screen flex-col bg-background text-foreground"
      style={{ fontFamily: "var(--font-zero0-mono), ui-monospace, monospace" }}
    >
      {/* ── ACTIVITY BAND (above the header) ───────────────────────────────────
          The ported presence tracker — WHERE the user has been today. Hidden by
          default (toggled from the footer) so the canvas stays blank; when shown it
          sits ABOVE the top helper. Clicking a place drills the canvas into it. */}
      {mounted && showActivity && <Zero0Activity onOpen={navigateTo} />}

      {/* ── TOP HELPER ─────────────────────────────────────────────────────────
          Zero-UX chrome: the mark, the access path (breadcrumb), and a session
          readout. Not part of the node's own data. */}
      <header className="border-b border-border p-4 text-[10px] leading-relaxed text-muted-foreground tabular-nums">
        <div className="flex gap-2">
          <span className="text-foreground">zero</span>
          <span aria-hidden>·</span>
          <span>root canvas</span>
        </div>
        {/* Access path — always shown (it's the trail to the open node); each crumb
            climbs back to that depth. At the root it's just the user, non-clickable. */}
        {mounted && (
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
        <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-4">
          <dt className="uppercase tracking-widest">context</dt>
          <dd className="text-foreground">{mounted && context ? context.title : currentUser.name}</dd>
          <dt className="uppercase tracking-widest">store</dt>
          <dd className="text-foreground">zero:root-items:v1</dd>
          <dt className="uppercase tracking-widest">entities</dt>
          <dd className="text-foreground">{mounted ? children.length : "—"}</dd>
        </dl>
      </header>

      {/* ── ENTITY CONTENT ─────────────────────────────────────────────────────
          The open node as raw data: META, then CHILDREN. Recursive — the root
          Individual renders exactly like any other entity. */}
      <div className="flex-1 overflow-auto">
        {mounted && context && meta && (
          <section className="border-b border-border px-4 py-3">
            {/* Node header line: glyph + title + kind. Fill = closed (fillable kinds),
                bar = cancelled, fade+strike follow the same rules as the child rows. */}
            <div className={"flex items-center gap-2 text-[12px] " + (isClosed(context) ? "opacity-60" : "")}>
              <Zero0Glyph
                kind={context.kind}
                filled={fillsGlyph(context)}
                done={meta.hasDoneState && isDone(context)}
                cancelled={isCancelled(context)}
                requested={context.kind === "task" && !!context.requested}
                className="h-4 w-4 text-foreground"
              />
              <span className={"text-foreground " + (isCancelled(context) ? "line-through" : "")}>
                {context.title}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{meta.label}</span>
            </div>
            {/* Raw meta key/values. */}
            <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-4 gap-y-0.5 text-[10px] tabular-nums">
              {metaRows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="uppercase tracking-widest text-muted-foreground">{k}</dt>
                  <dd className="truncate text-foreground" title={v}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* Children listing. Empty until you create something. */}
        <div className="px-4 py-3">
          {mounted && children.length === 0 && (
            <p className="text-[11px] text-muted-foreground">— empty — create below</p>
          )}
          {mounted && children.length > 0 && (
            <ul className="text-[11px] tabular-nums">
              {children.map((e, i) => {
                const km = KIND_META[e.kind]
                const done = isDone(e) // soft DONE marker (checkmark, no close)
                const cancelled = isCancelled(e) // called-off (bar + strike, closes)
                const closed = isClosed(e) // lifecycle ended ⇒ fade the row
                const filled = fillsGlyph(e) // fill DERIVES from close (fillable kinds)
                const terminal = isTerminal(e)
                const showCheck = done && km.hasDoneState
                const requested = e.kind === "task" && !!e.requested
                // Read-only lifecycle token (actions are set via the right-click menu).
                // Priority: cancelled > terminal > closed > open. A closed FILLABLE kind
                // reads "complete"; a terminal kind reads retired/dead.
                const lifeLabel = cancelled
                  ? "cancelled"
                  : terminal
                    ? e.kind === "community"
                      ? "retired"
                      : "dead"
                    : closed
                      ? km.fillsWhenClosed
                        ? "complete"
                        : "closed"
                      : "open"
                const stateLabel =
                  `${done ? "done, " : ""}${lifeLabel}${requested ? ", requested" : ""}`
                return (
                  <li
                    key={e.id}
                    onContextMenu={(ev) => openMenu(e, ev)}
                    className={
                      "group flex items-baseline gap-3 border-b border-border/60 py-1.5 " +
                      // CLOSED (complete / plain-close / cancel / terminal) fades the row.
                      (closed ? "opacity-60" : "")
                    }
                  >
                    <span className="w-6 shrink-0 text-right text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {/* Glyph column: fill = closed (fillable kinds), check = done,
                        bar = cancelled, "sent" flap = requested. */}
                    <span
                      className="flex w-6 shrink-0 justify-center self-center text-foreground"
                      aria-label={stateLabel}
                      title={stateLabel}
                    >
                      <Zero0Glyph
                        kind={e.kind}
                        filled={filled}
                        done={showCheck}
                        cancelled={cancelled}
                        requested={requested}
                        className="h-3.5 w-3.5"
                      />
                    </span>
                    {/* Kind label — STATIC text. */}
                    <span className="w-16 shrink-0 uppercase tracking-wider text-muted-foreground">
                      {km.label}
                    </span>
                    {/* Title — click to DRILL IN. Strikethrough only when CANCELLED
                        (plain closed just fades via the row). */}
                    <button
                      type="button"
                      onClick={() => openEntity(e)}
                      className={
                        "flex-1 truncate text-left text-foreground underline-offset-2 hover:underline " +
                        (cancelled ? "line-through" : "")
                      }
                      title="Open"
                    >
                      {e.title}
                    </button>
                    {/* Inline DONE toggle (soft marker) — only kinds WITH a done axis
                        (Task / Moment / Instant). Others show a muted placeholder. */}
                    <button
                      type="button"
                      onClick={() => toggleDone(e)}
                      disabled={!km.hasDoneState}
                      className={
                        "w-16 shrink-0 text-right " +
                        (km.hasDoneState
                          ? "text-muted-foreground hover:text-foreground"
                          : "text-transparent")
                      }
                      title={km.hasDoneState ? "Toggle done" : "No done state"}
                    >
                      {km.hasDoneState ? (done ? "done" : "undone") : "—"}
                    </button>
                    {/* Read-only LIFECYCLE state token (Complete/Close/Cancel via menu). */}
                    <span className="w-20 shrink-0 text-right text-muted-foreground/60">{lifeLabel}</span>
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
      </div>

      {/* Create field — part of the entity content (you create INTO this context),
          pinned above the footer helper. Bare mono input, hairline top. */}
      <div className="border-t border-border px-4 py-2">
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="text-muted-foreground" aria-hidden>
            +
          </span>
          <input
            value={draft}
            onChange={(ev) => {
              setDraft(ev.target.value)
              if (notice) setNotice(null) // clear feedback as soon as you type again
            }}
            onKeyDown={(ev) => {
              if (ev.key !== "Enter") return
              // CJK IME guard: don't submit while composing.
              if (ev.nativeEvent.isComposing || ev.keyCode === 229) return
              create()
            }}
            placeholder="create entity…  (try:  :spac Day Job   ·   :start: 2607092046)"
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            aria-label="Create entity"
          />
        </div>
        {/* Terminal talk-back: one transient line confirming a `:field:` set or
            flagging a rejected value. Muted-ok vs a soft error tone. */}
        {notice && (
          <p
            className={"mt-1 pl-4 text-[10px] leading-none " + (notice.tone === "err" ? "text-destructive" : "text-muted-foreground")}
            role="status"
          >
            {notice.text}
          </p>
        )}
      </div>

      {/* ── BOTTOM HELPER ──────────────────────────────────────────────────────
          Zero-UX chrome: version switch + theme toggle. */}
      <footer className="flex items-center gap-3 border-t border-border p-4 text-[10px] leading-none text-muted-foreground">
        <VersionSwitcher />
        <span className="text-border" aria-hidden>
          |
        </span>
        <Zero0ThemeToggle />
        <span className="text-border" aria-hidden>
          |
        </span>
        <button
          type="button"
          onClick={() => setShowActivity((v) => !v)}
          aria-pressed={showActivity}
          className={
            showActivity
              ? "text-foreground transition-colors"
              : "text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          activity
        </button>
      </footer>

      {menu && <Zero0EntityMenu anchor={menu} onMutate={bump} onClose={() => setMenu(null)} />}
    </main>
  )
}
