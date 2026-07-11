"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { VersionSwitcher } from "@/components/version-switcher"
import { Zero0ThemeToggle } from "./zero0-theme-toggle"
import { Zero0UpdateIndicator } from "./zero0-update-indicator"
import { Zero0Agenda, Zero0Activity } from "./zero0-activity"
import { recordPresence } from "@/lib/zero/activity-log"
import { Zero0Glyph } from "./zero0-glyph"
import { Zero0DomMenu, type Zero0DomMenuState } from "./zero0-dom-menu"
import { buildEntityMenuItems, applyEntityMenuAction, type MenuItem } from "@/lib/zero/menu-model"
import { Zero0FrameMenu, type Zero0FrameMenuAnchor } from "./zero0-frame-menu"
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
  setEntityAccent,
  setEntitySex,
  renameEntity,
  changeEntityKind,
  deleteEntity,
} from "@/lib/zero/data"
  import { KIND_META, isClosed, fillsGlyph, getState, type EntityState } from "@/lib/zero/kinds"
  import { isDone, isCancelled, getCreatedAt, getCompletedOn, describeLogEntry } from "@/lib/zero/entity-log"
import {
  parseCreateField,
  parseKindPrefix,
  parseFieldSetter,
  parseDateToken,
  parseHexColor,
  resolveCreatableKind,
} from "@/lib/zero/create-parse"
import { looksLikeUrl, normalizeUrl, resolveWebResourceByUrl, webDisplayName } from "@/lib/zero/web-resources"
import { useZero0Flag, toggleZero0Flag } from "@/lib/zero/zero0-chord"
import { useNowSeconds } from "@/lib/zero/use-now"
import { Zero0FrameMarker } from "./zero0-frame-marker"
import { ZERO_VERSION } from "@/lib/zero/version"
import { formatLocale } from "@/lib/zero/format-locale"
import { Zero0ResourceCanvas } from "./zero0-resource-canvas"
import type { Entity } from "@/lib/zero/types"

// The root context: the Individual whose space IS the homeview. Everything the
// user grows on the canvas nests under this id. Matches the seed in `data.ts`.
const ROOT_ID = "s_root"

// The `:color:` swatch palette — a small curated ramp shown when the create field
// reads exactly ":color:". Clicking one fills the draft with ":color:<hex>"; geeks can
// skip the picker and type the hex directly. Kept short + legible on the dark canvas.
const COLOR_SWATCHES = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#8b5cf6", "#ec4899", "#f5f5f5", "#71717a",
]

// True when the draft is a bare ":color:" (empty value) — the trigger to reveal the
// swatch picker. Any character typed after the trailing ":" no longer matches, so the
// picker hides instantly as the user keeps writing (e.g. a hand-typed hex).
const isColorPickerTrigger = (draft: string) => /^:color:\s*$/i.test(draft)

// Format an epoch (ms) for the meta readout. Only ever called under the `mounted`
// gate, so it's client-only — no SSR/static-export time-freeze hydration trap.
function fmt(epoch?: number): string {
  if (!epoch) return "—"
  return new Date(epoch).toLocaleString(formatLocale())
}

// Schedule `set` entries carry an epoch NUMBER as their value; render it as a date rather
// than a raw millisecond count in the life-log history. Everything else prints as-is.
const TIME_LOG_FIELDS = new Set(["startAt", "endAt", "at", "dueAt"])
function fmtLogValue(field: string, value: string | number | boolean): string {
  if (TIME_LOG_FIELDS.has(field) && typeof value === "number") return fmt(value)
  if (field === "sex" && typeof value === "string") return sexSymbol(value)
  return String(value)
}

// Render an Individual's sex as the Unicode gender GLYPH. "man"/"woman" stay the stored
// model values; ♂/♀ is purely the display form (falls back to the raw word if unknown).
function sexSymbol(sex: string): string {
  return sex === "man" ? "♂" : sex === "woman" ? "♀" : sex
}

// Render an {@link EntityState} as one stable STATE-row string. `open` shows no date
// (CREATED already carries "since when"); every other position carries its own instant,
// which lives nowhere else. `complete` also shows WHEN it will auto-close at midnight.
// `isLiving` (a death-terminal kind — an Individual/Organism) reads its `open` state as
// "alive" (lowercase, like every other state word), the natural antonym of `dead`.
function formatState(state: EntityState, format: (e?: number) => string, isLiving = false): string {
  switch (state.word) {
    case "open":
      if (isLiving) return state.reopenedAt ? `alive · reopened ${format(state.reopenedAt)}` : "alive"
      return state.reopenedAt ? `open · reopened ${format(state.reopenedAt)}` : "open"
    case "ongoing":
      // A live span in progress — `at` is when it STARTED. No auto-close yet (no end set).
      return `ongoing · since ${format(state.at)}`
    case "complete":
      return state.willCloseAt ? `complete · closes ${format(state.willCloseAt)} (auto)` : "complete"
    case "dead":
      // Age already carries its unit (e.g. "35 years"), so no ambiguity in the lifespan.
      return state.age != null ? `dead · ${format(state.at)} (${state.age})` : `dead · ${format(state.at)}`
    case "retired":
      return `retired · ${format(state.at)}`
    case "cancelled":
      return `cancelled · ${format(state.at)}`
    case "closed":
    default:
      return `closed · ${format(state.at)}`
  }
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
  // In-DOM right-click menu (null = closed). Used when nothing occludes the DOM; over a
  // native web Resource we route to the transparent overlay window instead (see below).
  const [menu, setMenu] = useState<Zero0DomMenuState | null>(null)
  // Whether we're in the Electron desktop app (native web views occlude the DOM, so
  // menus over an open Resource must be drawn in the native overlay window).
  const [isDesktop, setIsDesktop] = useState(false)
  // The onSelect callback for the CURRENTLY-open NATIVE overlay menu. The overlay echoes
  // the chosen action id back through a single persistent IPC listener, which dispatches
  // to whatever this points at (entity action, or a sibling-nav closure).
  const nativeSelectRef = useRef<((id: string) => void) | null>(null)
  // Frame right-click menu anchor (null = closed) — minimize/maximize a time frame.
  const [frameMenu, setFrameMenu] = useState<Zero0FrameMenuAnchor | null>(null)
  // Which time frames are MINIMIZED (collapsed to just their dayline band). Session-only,
  // a separate axis from § visibility: a shown frame can be full or minimized.
  const [minimized, setMinimized] = useState<{ agenda: boolean; activity: boolean; zeroHeader: boolean }>({
    agenda: false,
    activity: false,
    zeroHeader: false,
  })
  // Every hideable frame's visibility lives in the shared § chord store, so the footer
  // links, the in-frame "§x" corner markers, and the keyboard chords all drive the SAME
  // source of truth (in lockstep across the tree). Top-to-bottom the stack is: AGENDA ·
  // ACTIVITY · ZERO HEADER · ENTITY HEADER · ENTITY CONTENT · CREATE-ENTITY · FOOTER.
  //   §3 AGENDA (planned) + §2 ACTIVITY (presence) — the two time frames, hidden by
  //      default so the canvas stays blank until summoned.
  //   §1 ZERO HEADER + §0 ENTITY HEADER — the chrome headers, shown by default.
  const showAgenda = useZero0Flag("agenda")
  const showActivity = useZero0Flag("activity")
  const showEntityHeader = useZero0Flag("entityHeader")
  const showZeroHeader = useZero0Flag("zeroHeader")

  useEffect(() => {
    hydrateFromStorage()
    setMounted(true)
  }, [])

  const bump = useCallback(() => setRev((r) => r + 1), [])

  // GLUED-TOP live clock — the full weekday/date + time WITH SECONDS, shown at the very
  // top-left for ANY open entity, regardless of which frames are toggled below (it's
  // permanent chrome, mirroring the footer's glued-bottom role). Ticks once per second
  // via its own store; gated on `mounted` so the SSR value (0) never mismatches.
  const nowSec = useNowSeconds()
  const topClock = useMemo(() => {
    if (!mounted) return ""
    const d = new Date(nowSec)
    const loc = formatLocale()
    const date = d.toLocaleDateString(loc, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    const time = d.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit", second: "2-digit" })
    return `${date} · ${time}`
  }, [mounted, nowSec])

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
  // SIBLINGS: the children of the open node's PARENT — i.e. entities at the same depth on
  // the same branch. `path[len-2]` is the parent (undefined at the root, which has no
  // parent within the drill path, so no siblings there). Surfaced via the breadcrumb's
  // trailing chevron as a stable dropdown of ALL same-parent children (current one marked)
  // — lateral shortcuts to switch branch without climbing a crumb and drilling back in.
  const parentId = path.length >= 2 ? path[path.length - 2] : undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rev/parentId are the intended re-read triggers
  const siblings = useMemo(() => (mounted && parentId ? getChildren(parentId) : []), [mounted, rev, parentId])

  // ENTITIES readout breakdown over the direct children, by STATE:
  //   • open     — still open (word "open"); the true "to-do / live" count.
  //   • complete — reached its positive terminal but not yet filed (word "complete").
  //     Split into "done" (the complete is a Task's DONE checkmark — human name for it)
  //     vs "complete" (any other complete, e.g. a Moment whose end is in the past).
  // `total` is every direct child; ended (closed/cancelled/dead/retired) children are
  // simply not surfaced (total − open − done − complete = the ended remainder).
  const childBreakdown = useMemo(() => {
    let open = 0
    let done = 0
    let complete = 0
    for (const c of children) {
      const w = getState(c).word
      // open + ongoing are both "active / not yet done" for the tally.
      if (w === "open" || w === "ongoing") open++
      else if (w === "complete") {
        if (isDone(c)) done++
        else complete++
      }
    }
    return { open, done, complete, total: children.length }
  }, [children])
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
      // :color: — a kind-agnostic ACCENT. Empty value clears; otherwise it must parse
      // as a hex (typed directly, or filled in by the swatch picker). Painted on the
      // dayline ticks + anywhere the entity shows its color.
      if (setter.field === "color") {
        if (setter.value === "") {
          setEntityAccent(contextId, null)
          setNotice({ tone: "ok", text: "color cleared" })
          setDraft("")
          bump()
          return
        }
        const hex = parseHexColor(setter.value)
        if (!hex) {
          setNotice({ tone: "err", text: `invalid color "${setter.value}" — use a hex like ff0000` })
          return
        }
        setEntityAccent(contextId, hex)
        setNotice({ tone: "ok", text: `color set · ${hex}` })
        setDraft("")
        bump()
        return
      }
      // :done: — the soft DONE marker on THIS entity (Task only). `yes`/`no` (also
      // y/n, true/false, 1/0, done/undone); an empty value toggles. For the owner,
      // marking done also completes + stamps the midnight close (the data layer's rule).
      if (setter.field === "done") {
        const ctx = getEntity(contextId)
        if (!ctx || !KIND_META[ctx.kind].hasDoneState) {
          setNotice({ tone: "err", text: "only tasks have a done state" })
          return
        }
        const v = setter.value.toLowerCase()
        const truthy = ["yes", "y", "true", "1", "done"]
        const falsy = ["no", "n", "false", "0", "undone"]
        let next: boolean
        if (v === "") next = !isDone(ctx)
        else if (truthy.includes(v)) next = true
        else if (falsy.includes(v)) next = false
        else {
          setNotice({ tone: "err", text: `use :done: yes | no (got "${setter.value}")` })
          return
        }
        setEntityCompleted(contextId, next)
        setNotice({ tone: "ok", text: next ? "marked done" : "marked undone" })
        setDraft("")
        bump()
        return
      }
      // :sex: — an INDIVIDUAL's biological sex ("man" | "woman"; also m/w). Empty clears.
      if (setter.field === "sex") {
        const ctx = getEntity(contextId)
        if (!ctx || ctx.kind !== "individual") {
          setNotice({ tone: "err", text: "only individuals have a sex" })
          return
        }
        if (setter.value === "") {
          setEntitySex(contextId, null)
          setNotice({ tone: "ok", text: "sex cleared" })
          setDraft("")
          bump()
          return
        }
        const v = setter.value.toLowerCase()
        const sex = v === "man" || v === "m" ? "man" : v === "woman" || v === "w" ? "woman" : null
        if (!sex) {
          setNotice({ tone: "err", text: `use :sex: man | woman (got "${setter.value}")` })
          return
        }
        setEntitySex(contextId, sex)
        setNotice({ tone: "ok", text: `sex set · ${sexSymbol(sex)}` })
        setDraft("")
        bump()
        return
      }
      // :kind: — turn THIS entity into another creatable kind (same as the menu's
      // "Change into…"). Accepts the full name or its 4-letter prefix (space/spac,
      // organism/orga, …). Rejects a non-creatable/unknown target (individual, soul).
      if (setter.field === "kind") {
        const ctx = getEntity(contextId)
        if (!ctx) {
          setNotice({ tone: "err", text: "no open entity to set" })
          return
        }
        if (setter.value === "") {
          setNotice({ tone: "err", text: "use :kind: task | space | resource | moment | instant | community | organism" })
          return
        }
        const next = resolveCreatableKind(setter.value)
        if (!next) {
          setNotice({ tone: "err", text: `unknown kind "${setter.value}" — try task, space, resource, moment, instant, community, organism` })
          return
        }
        if (next === ctx.kind) {
          setNotice({ tone: "err", text: `already a ${KIND_META[next].label}` })
          return
        }
        changeEntityKind(contextId, next)
        setNotice({ tone: "ok", text: `kind set · ${KIND_META[next].label}` })
        setDraft("")
        bump()
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
        setNotice({ tone: "err", text: `unknown field :${setter.field}: — try :kind: :title: :start: :end: :at: :due: :color: :done: :sex:` })
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

  // Open a SIBLING (tab click): swap just the leaf of the path, keeping the breadcrumb
  // prefix identical (siblings share a parent, so only the last crumb changes). The
  // `contextId`-effect then re-logs presence, so the activity tracker refocuses as usual.
  const goToSibling = useCallback((id: string) => {
    setPath((p) => (p.length >= 2 ? [...p.slice(0, -1), id] : [ROOT_ID, id]))
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

  // Show a menu at CLIENT coords (x,y). Over a native web Resource on desktop the DOM is
  // occluded by the live site (no z-index can beat a WebContentsView), so the menu is
  // drawn in the transparent overlay window ABOVE the site — the site stays put, no
  // parking/blanking. Otherwise it's an ordinary in-DOM popup. Both render the same
  // MenuItem tree and resolve to the same `onSelect`.
  const showMenu = useCallback(
    (items: MenuItem[], x: number, y: number, onSelect: (id: string) => void) => {
      if (isDesktop && !!context?.webUrl && window.zero?.menu) {
        nativeSelectRef.current = onSelect
        window.zero.menu.open({ x, y, items })
      } else {
        setMenu({ items, x, y, onSelect })
      }
    },
    [isDesktop, context?.webUrl],
  )

  // Per-entity right-click menu. Opened from ANYWHERE an entity is shown — a child row, a
  // breadcrumb crumb, a sibling shortcut, the open node's header, or the empty content
  // frame (which targets the current context). `stopPropagation` so an inner target that
  // handled the event (a row) doesn't ALSO bubble up to a container handler.
  const openMenu = useCallback(
    (e: Entity, ev: React.MouseEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      showMenu(buildEntityMenuItems(e), ev.clientX, ev.clientY, (id) => {
        applyEntityMenuAction(e, id)
        bump()
      })
    },
    [showMenu, bump],
  )

  // Right-click by ENTITY ID — used by the ACTIVITY rows and the dayline ticks, which
  // only carry ids. Resolves to the live entity (skipping deleted / sentinel ids so no
  // empty menu appears) and defers to `openMenu`. `stopPropagation` there also stops the
  // event bubbling up to the FRAME's onContextMenu, so a tick opens the entity menu, not
  // the frame menu.
  const openMenuById = useCallback(
    (id: string, ev: React.MouseEvent) => {
      const e = getEntity(id)
      if (e) openMenu(e, ev)
    },
    [openMenu],
  )

  // Right-click the FRAME chrome (header or empty area) → the minimize/maximize menu.
  const openFrameMenu = useCallback((frame: "agenda" | "activity" | "zeroHeader", ev: React.MouseEvent) => {
    ev.preventDefault()
    ev.stopPropagation()
    setFrameMenu({ frame, x: ev.clientX, y: ev.clientY })
  }, [])

  // SIBLINGS dropdown — opened from the chevron beside the breadcrumb. Lists ALL of the
  // open node's same-parent children (INCLUDING the current one, marked), in their stable
  // child order. Listing all — not just the "others" — means the menu's contents + order
  // NEVER change as you switch: only which row is marked current moves. Picking one drills
  // laterally (goToSibling; picking the current is a harmless no-op). Behind a chevron so
  // the visible header never reshuffles; routed through `showMenu`, so over a web Resource
  // it draws in the native overlay (unoccluded).
  const openSiblings = useCallback(
    (ev: React.MouseEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      if (siblings.length < 2) return
      const items: MenuItem[] = siblings.map((s) => ({
        type: "item",
        id: s.id,
        label: s.title,
        glyphKind: s.kind,
        current: s.id === contextId,
      }))
      showMenu(items, ev.clientX, ev.clientY, (id) => goToSibling(id))
    },
    [siblings, contextId, showMenu, goToSibling],
  )

  // Detect the Electron desktop shell (only there do native web views occlude the DOM).
  useEffect(() => {
    setIsDesktop(typeof window !== "undefined" && !!window.zero?.menu)
  }, [])

  // Route the NATIVE overlay menu's chosen action back to whatever opened it. One
  // persistent listener; `nativeSelectRef` points at the current menu's onSelect.
  useEffect(() => {
    if (!window.zero?.menu?.onSelected) return
    return window.zero.menu.onSelected((actionId) => {
      const fn = nativeSelectRef.current
      nativeSelectRef.current = null
      fn?.(actionId)
    })
  }, [])

  // A right-click landed INSIDE the open web view (main forwards it as client coords,
  // since the DOM never sees it). Build the CURRENT context entity's menu and draw it in
  // the overlay at that point — so right-clicking the site itself gets the same menu.
  useEffect(() => {
    if (!window.zero?.resource?.onContextMenu) return
    return window.zero.resource.onContextMenu(({ id, x, y }) => {
      const ent = getEntity(id) ?? (contextId ? getEntity(contextId) : undefined)
      if (!ent) return
      showMenu(buildEntityMenuItems(ent), x, y, (actionId) => {
        applyEntityMenuAction(ent, actionId)
        bump()
      })
    })
  }, [contextId, showMenu, bump])

  // Meta rows for the CURRENT open node ������� raw lifecycle data, kind-aware. Recomputed
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
    // DONE — its own orthogonal row, TASKS only (the soft "I did this" marker).
    if (meta.hasDoneState) {
      const done = isDone(context)
      metaRows.push(["done", done ? `yes · ${fmt(getCompletedOn(context))}` : "no"])
    }
    // STATE — the single mutually-exclusive lifecycle row (open / complete / closed /
    // cancelled / dead / retired), replacing the old CLOSED + CANCELLED booleans. `open`
    // carries no date (CREATED above already says since when); other states carry theirs.
    if (meta.fillsWhenClosed || meta.terminal) {
      metaRows.push(["state", formatState(getState(context), fmt, meta.terminal === "death")])
    }
    if (context.kind === "task" && context.requested) metaRows.push(["requested", "yes"])
    // TEMPORAL slots — a kind's defining time dimension is ALWAYS shown (as "—" when
    // unset), the same way DONE/CLOSED always render. A Moment IS a span, an Instant
    // IS a point, so hiding those rows when empty would hide the kind's essence.
    const s = context.schedule
    if (context.kind === "moment") {
      metaRows.push(["start", s?.startAt ? fmt(s.startAt) : "—"])
      metaRows.push(["end", s?.endAt ? fmt(s.endAt) : "—"])
      // A Moment is conceptually a SPAN (start→end), but it can carry a lone POINT anchor
      // (`schedule.at`) — e.g. when a `:mome` prefix is combined with a single-time token,
      // or an Instant is later changed INTO a moment. The lifecycle machine reads that point
      // (`getState` → `completeSince` uses `endAt ?? at`), so a past `at` silently drives the
      // moment to COMPLETE + stamps its auto-close. Surface it here (was hidden, which made
      // such a moment read as unscheduled — START —, END — — yet mysteriously "complete").
      if (s?.at != null) metaRows.push(["at", fmt(s.at)])
    } else if (context.kind === "instant") {
      metaRows.push(["at", s?.at ? fmt(s.at) : "—"])
    } else if (s?.dueAt) {
      // Tasks (and other kinds) only surface a schedule row when one is actually set.
      metaRows.push(["due", fmt(s.dueAt)])
    } else if (s && (s.startAt || s.endAt || s.at)) {
      metaRows.push(["scheduled", s.at ? fmt(s.at) : `${fmt(s.startAt)} → ${fmt(s.endAt)}`])
    }
    // ACCENT — only when set (via `:color:`). The value is the raw hex; the dt cell
    // paints a matching swatch so the raw-data view still shows the color itself.
    if (context.accent) metaRows.push(["color", context.accent])
  // SEX — an Individual's defining identity field, always shown (— when unset), the
  // same way a Moment always shows its span. Individual-only.
  if (context.kind === "individual") metaRows.push(["sex", context.sex ? sexSymbol(context.sex) : "—"])
  }

  // ── Shared ZERO HEADER elements (reused by the full + minimized layouts) ──────
  // The ACCESS PATH breadcrumb — the trail to the open node; each crumb climbs back
  // to that depth, right-click targets that entity. In the full layout it's the value
  // of the CONTEXT row; minimized, it stands alone.
  const breadcrumb = (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Breadcrumb">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1
        return (
          <span
            key={c.id}
            className="flex items-center gap-1"
            onContextMenu={(ev) => {
              // Right-click a crumb → THAT entity's menu (same as its row). Handled on the
              // span so it fires even for the current/last crumb, whose button is disabled.
              const ent = getEntity(c.id)
              if (ent) openMenu(ent, ev)
            }}
          >
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
      {/* SIBLINGS chevron — a compact affordance at the end of the trail, shown only when
          the open node has same-parent siblings to switch between. Click → a dropdown of
          ALL those siblings (openSiblings), current one marked. Behind a chevron so the
          header stays STABLE: switching siblings never reshuffles a visible tab list. */}
      {siblings.length > 1 && (
        <button
          type="button"
          onClick={openSiblings}
          aria-label={`Switch sibling (${siblings.length} at this level)`}
          title="Switch sibling"
          className="ml-0.5 leading-none text-muted-foreground hover:text-foreground"
        >
          {"\u25BE"}
        </button>
      )}
    </nav>
  )

  return (
    <main
      className="relative flex h-screen flex-col bg-background text-foreground"
      style={{ fontFamily: "var(--font-zero0-mono), ui-monospace, monospace" }}
    >
      {/* ── GLUED TOP: live clock ──────────────────���───────────────────────────
          Permanent top chrome (mirrors the footer's glued-bottom role): the live full
          date + time WITH seconds, top-left. Always present �� for any open entity, and
          regardless of which frames are toggled below. `min-h` reserves its row so the
          layout doesn't jump between the SSR blank and the first mounted tick. */}
      <div className="flex min-h-[41px] shrink-0 items-center border-b border-border px-4 py-3 text-[10px] uppercase tracking-wider leading-none tabular-nums text-foreground">
        {topClock}
      </div>

      {/* ── AGENDA BAND (topmost, "TODAY") ──────────────────────────────────────
          The FORWARD-looking frame — what's PLANNED today (the planned dayline).
          Hidden by default (toggled from the footer) so the canvas stays blank; when
          shown it sits at the very top, above ACTIVITY. Show/hide is animated with the
          dep-free CSS grid-rows 0fr↔1fr trick (one compositor-friendly layout
          transition, no per-frame JS). Kept MOUNTED while collapsed so BOTH directions
          animate; `inert` drops it from tab/hit-testing when hidden. */}
      {mounted && (
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
          style={{ gridTemplateRows: showAgenda ? "1fr" : "0fr" }}
          inert={!showAgenda}
        >
          <div className="overflow-hidden">
            <Zero0Agenda
              onOpen={navigateTo}
              onContextMenuEntity={openMenuById}
              onFrameMenu={openFrameMenu}
              minimized={minimized.agenda}
              // Merge with ACTIVITY below when BOTH are minimized AND ACTIVITY is shown —
              // then TODAY drops its divider so the two minimized bands group together.
              hideBottomBorder={minimized.agenda && minimized.activity && showActivity}
              dataRev={rev}
            />
          </div>
        </div>
      )}

      {/* ── ACTIVITY BAND (below AGENDA, above the header) ──────────────���───────
          The BACKWARD-looking frame — WHERE the user has been today (presence dayline
          + details). Hidden by default, toggled from the footer, same grid-rows
          collapse animation as AGENDA. Clicking a place drills the canvas into it. */}
      {mounted && (
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
          style={{ gridTemplateRows: showActivity ? "1fr" : "0fr" }}
          inert={!showActivity}
        >
          <div className="overflow-hidden">
            <Zero0Activity
              onOpen={navigateTo}
              onContextMenuEntity={openMenuById}
              onFrameMenu={openFrameMenu}
              minimized={minimized.activity}
              dataRev={rev}
              currentContextId={contextId}
            />
          </div>
        </div>
      )}

      {/* ── ZERO HEADER (§1) ───────────────────────────────────────────────────
          Zero-UX chrome: the mark, the access path (breadcrumb), and a session
          readout. Not part of the node's own data. Toggled by §1 / the corner marker,
          and — like every frame in the stack — collapses with the dep-free grid-rows
          0fr↔1fr animation so the frames below slide up/down. Kept mounted so BOTH
          directions animate; `inert` drops it from tab/hit-testing when hidden. */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: showZeroHeader ? "1fr" : "0fr" }}
        inert={!showZeroHeader}
      >
        <div className="overflow-hidden">
      <header
        className="relative border-b border-border p-4 text-[10px] leading-relaxed text-muted-foreground tabular-nums"
        // Right-click the header chrome → minimize/maximize this frame (same frame menu as
        // the time frames). Guarded so a right-click on the breadcrumb/siblings (which target
        // an ENTITY) isn't hijacked: only fires when the target didn't handle it itself.
        onContextMenu={(ev) => {
          if (ev.defaultPrevented) return
          openFrameMenu("zeroHeader", ev)
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-foreground">zero</span>
          <span aria-hidden>·</span>
          <span>root canvas</span>
          {/* Build version — the release git tag this Surface was built from. Sits at
              the end of the identity line (right-aligned) so it's always in view, even
              in web-resource view where only the top of this header shows. */}
          <span className="ml-auto text-muted-foreground/70" title="Build version">
            {ZERO_VERSION}
          </span>
        </div>
        {/* MINIMIZED — just the breadcrumb (with its trailing SIBLINGS chevron), tight
            under the mark: the access path + the lateral-switch affordance without the
            fuller session block or its label column. Toggled via the header frame menu. */}
        {mounted && minimized.zeroHeader && <div className="mt-1.5">{breadcrumb}</div>}
        {/* FULL — the session readout as a labelled meta block. CONTEXT is the breadcrumb
            itself (the crumb trail IS the context, and its trailing chevron opens the
            SIBLINGS dropdown — so there's no separate reshuffling siblings row), then
            STORE/ENTITIES. Matches the ENTITY HEADER meta exactly (tight `6rem` label col +
            left-packed values) so the two blocks align as one column. Over a web surface
            only CONTEXT shows (STORE/ENTITIES are session/debug detail that would overcrowd
            the clean breadcrumb-over-site view); the header sits ABOVE the web-view holder,
            so its rows naturally push the tracked surface rect down. */}
        {mounted && !minimized.zeroHeader && (
          <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-4 gap-y-0.5">
            <dt className="uppercase tracking-widest">context</dt>
            <dd className="min-w-0">{breadcrumb}</dd>
            {!context?.webUrl && (
              <>
                <dt className="uppercase tracking-widest">store</dt>
                <dd className="truncate text-foreground">zero:root-items:v1</dd>
                <dt className="uppercase tracking-widest">entities</dt>
                <dd className="truncate text-foreground">
                  {children.length === 0
                    ? "none"
                    : [
                        `${childBreakdown.open} open`,
                        `${childBreakdown.total} total`,
                        ...(childBreakdown.done > 0 ? [`${childBreakdown.done} done`] : []),
                        ...(childBreakdown.complete > 0 ? [`${childBreakdown.complete} complete`] : []),
                      ].join(" · ")}
                </dd>
              </>
            )}
          </dl>
        )}
        <Zero0FrameMarker flag="zeroHeader" label="the zero header" />
      </header>
        </div>
      </div>

      {/* ── ENTITY CONTENT ─────────────────────────────────────────────────────
          The open node as raw data: META, then CHILDREN. Recursive — the root
          Individual renders exactly like any other entity. `min-h-0` lets this flex
          child shrink below its content so ONLY this band scrolls — the header,
          create field, and footer stay pinned regardless of how tall the list grows. */}
      {/* WEB VIEW — when the drilled-in context is a web resource (has a webUrl),
          the content area BECOMES that web surface, edge-to-edge horizontally. The
          zero header (breadcrumb), create field, and footer stay in place around it,
          so you can always climb back out. `overflow-hidden` (not auto) lets the
          surface fill without a scrollbar; the native desktop view tracks this rect. */}
      {mounted && context?.webUrl ? (
        <div
          className="min-h-0 flex-1 overflow-hidden"
          onContextMenu={(ev) => openMenu(context, ev)}
        >
          <Zero0ResourceCanvas
            key={context.id}
            id={context.id}
            url={context.webUrl}
            resourceId={context.webResourceId}
          />
        </div>
      ) : (
      <div
        className="min-h-0 flex-1 overflow-auto"
        // Right-clicking the empty content frame targets the CURRENT open node (the
        // context). Child rows stopPropagation, so this only fires on blank space.
        onContextMenu={context ? (ev) => openMenu(context, ev) : undefined}
      >
        {/* ENTITY HEADER (§0) — the open node's raw-data block (glyph/title/kind, meta
            rows, life log). Toggled with §0 / the corner marker; the children list below
            slides up/down with the same grid-rows collapse animation as every frame. */}
        {mounted && context && meta && (
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
            style={{ gridTemplateRows: showEntityHeader ? "1fr" : "0fr" }}
            inert={!showEntityHeader}
          >
            <div className="overflow-hidden">
          <section className="relative border-b border-border px-4 py-3">
            {/* Node header line: glyph + title + kind. Fill = closed (fillable kinds),
                bar = cancelled, fade+strike follow the same rules as the child rows.
                Right-clicking it opens the same per-entity menu as the node's own row. */}
            <div
              className={"flex items-center gap-2 text-[12px] " + (isClosed(context) ? "opacity-60" : "")}
              onContextMenu={(ev) => openMenu(context, ev)}
            >
              {meta.hasDoneState ? (
                <button
                  type="button"
                  onClick={() => toggleDone(context)}
                  className="cursor-pointer text-foreground transition-opacity hover:opacity-70"
                  aria-label={isDone(context) ? "Mark undone" : "Mark done"}
                  title={isDone(context) ? "Mark undone" : "Mark done"}
                >
                  <Zero0Glyph
                    kind={context.kind}
                    filled={fillsGlyph(context)}
                    done={isDone(context)}
                    cancelled={isCancelled(context)}
                    requested={context.kind === "task" && !!context.requested}
                    className="h-4 w-4"
                  />
                </button>
              ) : (
                <Zero0Glyph
                  kind={context.kind}
                  filled={fillsGlyph(context)}
                  done={meta.hasDoneState && isDone(context)}
                  cancelled={isCancelled(context)}
                  requested={context.kind === "task" && !!context.requested}
                  ongoing={getState(context).word === "ongoing"}
                  className="h-4 w-4 text-foreground"
                />
              )}
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
                  <dd className="flex items-center gap-1.5 truncate text-foreground" title={v}>
                    {k === "color" && (
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-sm border border-border"
                        style={{ backgroundColor: v }}
                      />
                    )}
                    <span className="truncate">{v}</span>
                  </dd>
                </div>
              ))}
            </dl>
            {/* LIFE LOG — the whole append-only history (lifecycle transitions AND field
                sets), oldest→newest, so the entity's entire life is retraceable. Every
                setter dual-writes here; a per-field history is just this list filtered. */}
            {mounted && context.log && context.log.length > 0 && (
              <div className="mt-3 border-t border-border pt-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">log</p>
                <ol className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
                  {context.log.map((entry, i) => (
                    <li key={i} className="contents">
                      <span className="shrink-0 text-muted-foreground">{fmt(entry.at)}</span>
                      <span className="truncate text-foreground">{describeLogEntry(entry, fmtLogValue)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <Zero0FrameMarker flag="entityHeader" label="the entity header" />
          </section>
            </div>
          </div>
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
                const state = getState(e) // the single lifecycle position (STATE axis)
                const done = isDone(e) // soft DONE marker (Task only), orthogonal to STATE
                const cancelled = state.word === "cancelled" // bar + strike
                const closed = isClosed(e) // ENDED (closed/dead/retired/cancelled) ⇒ fade — NOT complete
                const filled = fillsGlyph(e) // fill on complete AND closed (fillable kinds)
                const showCheck = done && km.hasDoneState
                const requested = e.kind === "task" && !!e.requested
                const ongoing = state.word === "ongoing" // live span ⇒ glyph rotates
                // Read-only lifecycle token — one word straight off the STATE axis
                // (open / ongoing / complete / closed / cancelled / dead / retired).
                const lifeLabel = state.word
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
                        bar = cancelled, "sent" flap = requested. For a TASK the glyph
                        is a BUTTON — clicking it toggles Done (same as the text toggle);
                        other kinds render a static span. */}
                    {km.hasDoneState ? (
                      <button
                        type="button"
                        onClick={() => toggleDone(e)}
                        className="flex w-6 shrink-0 cursor-pointer justify-center self-center text-foreground transition-opacity hover:opacity-70"
                        aria-label={`${done ? "Mark undone" : "Mark done"} · ${stateLabel}`}
                        title={done ? "Mark undone" : "Mark done"}
                      >
                        <Zero0Glyph
                          kind={e.kind}
                          filled={filled}
                          done={showCheck}
                          cancelled={cancelled}
                          requested={requested}
                          ongoing={ongoing}
                          className="h-3.5 w-3.5"
                        />
                      </button>
                    ) : (
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
                          ongoing={ongoing}
                          className="h-3.5 w-3.5"
                        />
                      </span>
                    )}
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
      )}

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
            placeholder="create entity…  (try:  :spac Day Job   ·   :start: 2607092046   ·   :color:)"
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            aria-label="Create entity"
          />
        </div>
        {/* :color: SWATCH PICKER — surfaces only while the draft is a bare ":color:".
            Clicking a swatch fills the field with ":color:<hex>", which no longer matches
            the trigger so the picker vanishes instantly; Enter then commits. Geeks can
            ignore this and type the hex straight after the colon. */}
        {isColorPickerTrigger(draft) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-4" role="listbox" aria-label="Pick a color">
            {COLOR_SWATCHES.map((hex) => (
              <button
                key={hex}
                type="button"
                role="option"
                aria-selected={false}
                aria-label={hex}
                title={hex}
                // Keep focus on the create input: preventing mousedown's default stops
                // the button from stealing focus, so the field stays focused and Enter
                // fires the command right after picking (no manual re-click needed).
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => setDraft(`:color:${hex.replace(/^#/, "")}`)}
                className="h-4 w-4 rounded-sm border border-border transition-transform hover:scale-125"
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        )}
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
        {/* AGENDA (§3) + ACTIVITY (§2) frame toggles, in top-to-bottom order. These flip
            the SAME chord flags as the § keybindings and the in-frame "§x" markers. */}
        <button
          type="button"
          onClick={() => toggleZero0Flag("agenda")}
          aria-pressed={showAgenda}
          className={
            showAgenda
              ? "text-foreground transition-colors"
              : "text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          agenda
        </button>
        <button
          type="button"
          onClick={() => toggleZero0Flag("activity")}
          aria-pressed={showActivity}
          className={
            showActivity
              ? "text-foreground transition-colors"
              : "text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          activity
        </button>
        {/* Surface-only "restart to update" affordance. Renders null on the web and
            whenever no background update is staged, so it adds no chrome by default. */}
        <span className="ml-auto">
          <Zero0UpdateIndicator />
        </span>
      </footer>

      {menu && <Zero0DomMenu menu={menu} onClose={() => setMenu(null)} />}
      {frameMenu && (
        <Zero0FrameMenu
          anchor={frameMenu}
          minimized={minimized[frameMenu.frame]}
          onToggle={() => setMinimized((m) => ({ ...m, [frameMenu.frame]: !m[frameMenu.frame] }))}
          onClose={() => setFrameMenu(null)}
        />
      )}
    </main>
  )
}
