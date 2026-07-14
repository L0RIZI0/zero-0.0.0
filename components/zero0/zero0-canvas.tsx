"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { VersionSwitcher } from "@/components/version-switcher"
import { Zero0ThemeToggle } from "./zero0-theme-toggle"
import { Zero0UpdateIndicator } from "./zero0-update-indicator"
import { Zero0Agenda, Zero0Activity } from "./zero0-activity"
import { recordPresence } from "@/lib/zero/activity-log"
import { Zero0DomMenu, type Zero0DomMenuState } from "./zero0-dom-menu"
import { cssColorToHex } from "./zero0-menu-list"
import { buildEntityMenuItems, applyEntityMenuAction, type MenuItem } from "@/lib/zero/menu-model"
import { Zero0FrameMenu, type Zero0FrameMenuAnchor } from "./zero0-frame-menu"
import {
  ROOT_ID,
  currentUser,
  getChildren,
  getEntity,
  hydrateFromStorage,
  addParsedEntity,
  addWebResource,
  setEntityCompleted,
  setEntityScheduleField,
  setEntityClosed,
  setEntityAccent,
  setEntitySex,
  setEntityClosePolicy,
  renameEntity,
  changeEntityKind,
  deleteEntity,
  autoTagByTitle,
  isStarterPinned,
  toggleStarterPin,
  startSession,
  stopSession,
  getOngoingSession,
} from "@/lib/zero/data"
  import { KIND_META, isClosed, getState } from "@/lib/zero/kinds"
  import { isDone, describeLogEntry } from "@/lib/zero/entity-log"
import {
  parseEntry,
  inferKind,
  parseDateToken,
  parseHexColor,
  type EntryAttr,
} from "@/lib/zero/create-parse"
import { looksLikeUrl, normalizeUrl, resolveWebResourceByUrl, webDisplayName } from "@/lib/zero/web-resources"
import { useZero0Flag, toggleZero0Flag } from "@/lib/zero/zero0-chord"
import { useZeroCrossWindowSync } from "@/lib/zero/use-zero-sync"
import { useNowSeconds } from "@/lib/zero/use-now"
import { Zero0FrameMarker } from "./zero0-frame-marker"
import { ZERO_VERSION } from "@/lib/zero/version"
import { formatLocale } from "@/lib/zero/format-locale"
import { Zero0ResourceCanvas } from "./zero0-resource-canvas"
import { Zero0Pinned } from "./zero0-pinned"
import { Zero0Face } from "./zero0-face"
import { Zero0Content, type Zero0ContentCtx } from "./zero0-content"
import { fmt, fmtLogValue, sexSymbol, type FaceSize, type FaceMake } from "@/lib/zero/face-model"
import type { Entity } from "@/lib/zero/types"

// The `--color` swatch palette — a small curated ramp shown when the create field
// reads exactly "--color" / "--color:". Clicking one fills the draft with "--color:<hex>";
// geeks can skip the picker and type the hex directly. Kept short + legible on dark.
const COLOR_SWATCHES = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#8b5cf6", "#ec4899", "#f5f5f5", "#71717a",
]

// True when the draft is a bare "--color" / "--color:" (empty value) — the trigger to
// reveal the swatch picker. Any character typed after the colon no longer matches, so the
// picker hides instantly as the user keeps writing (e.g. a hand-typed hex).
const isColorPickerTrigger = (draft: string) => /^--color:?\s*$/i.test(draft)

// The Face-model formatters (`fmt`, `sexSymbol`, `fmtLogValue`, …) + the presentation
// model (`getFaceModel`) + the §0 meta rows (`getFaceMetaRows`) live in `lib/zero/
// face-model` now — one source shared by <Zero0Face> and the canvas's own log / create
// notice. Imported at the top of this file.

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

// A tiny dep-free × button (the zero0 tree avoids lucide). Explicitly CLOSES the open
// entity — for a web resource that destroys its warm tab; otherwise it just climbs out.
function Zero0CloseButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      title="Close"
      className={
        "flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground transition-opacity hover:opacity-70 " +
        className
      }
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
        <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
      </svg>
    </button>
  )
}

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
    // Agenda + the §1 ZERO HEADER open in their MINIMIZED form by default — a single
    // dayline band / breadcrumb line — so the canvas stays calm until the user expands
    // them. (Activity stays hidden entirely by its chord-flag default.)
    agenda: true,
    activity: false,
    zeroHeader: true,
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
  // §4 FREQUENT — the topmost quick-create band; shown by default (see the chord store).
  const showFrequent = useZero0Flag("frequent")

  useEffect(() => {
    hydrateFromStorage()
    setMounted(true)
  }, [])

  const bump = useCallback(() => setRev((r) => r + 1), [])

  // TIER-2 cross-window sync: when ANOTHER window/tab edits the shared entity store,
  // rebuild from localStorage and re-render this window. Lets you browse Zero in one
  // window while working in another, both live on the same dataset.
  useZeroCrossWindowSync(bump)

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
    // TIME first, then day/date — the live clock is the glanceable part; the calendar
    // context follows it.
    return `${time} · ${date}`
  }, [mounted, nowSec])

  const contextId = path[path.length - 1]

  // DAYLINE HIGHLIGHT — the entity whose dayline tick(s) should light up (grow to 26px + go
  // fully opaque). Driven PURELY by HOVERING an ENTITY CONTENT row — a transient "this is the
  // row you're pointing at" echo. We deliberately do NOT light the open context; a persistent
  // pin made the lane feel stuck. Threaded into both daylines (TODAY combined + ACTIVITY).
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null)
  const highlightId = hoveredRowId

  // PRESENCE: log WHERE the user is — the current drilled-in context. Fires on every
  // context change (and initial mount) so the activity tracker records the trail through
  // the graph, exactly as the old shell did on `activeId`. `recordPresence` no-ops on a
  // repeat of the same id, so this is safe to run on each `contextId`.
  useEffect(() => {
    if (!mounted) return
    recordPresence(contextId)
  }, [mounted, contextId])
  const context = mounted ? getEntity(contextId) : undefined
  // SHOW HIDDEN — a per-context VIEW toggle (right-click ▸ Show hidden). When off, hidden
  // children (manual `hidden` flag OR auto-hidden-because-closed-before-today) collapse out
  // of ENTITY CONTENT; when on, they're revealed with a "(hidden)" title prefix. Session-
  // only and RESET on navigation so drilling into a new context starts clean.
  const [showHidden, setShowHidden] = useState(false)
  useEffect(() => {
    setShowHidden(false)
  }, [contextId])
  // PER-ROW FACE SIZE — the rung each ENTITY CONTENT row is shown at (right-click ▸ Size).
  // A VIEW override, not stored data ("a size is a curated projection" — a way of LOOKING,
  // not a property of the entity), so it lives in session state keyed by entity id: kept as
  // you navigate, reset on app restart. Same spirit as `showHidden`/collapse/minimized.
  const [rowSizes, setRowSizes] = useState<Record<string, FaceSize>>({})
  const sizeOf = useCallback((id: string): FaceSize => rowSizes[id] ?? "m", [rowSizes])
  // PER-ROW FACE MAKE — how each row READS (right-click ▸ Make), orthogonal to size. Same
  // view-override contract as `rowSizes`: session-only, keyed by entity id, reset on reload.
  const [rowMakes, setRowMakes] = useState<Record<string, FaceMake>>({})
  const makeOf = useCallback((id: string): FaceMake => rowMakes[id] ?? "default", [rowMakes])
  // PER-ROW INLINE EXPANSION — which rows are opened into their own nested Content (the
  // recursion). A VIEW state like `rowSizes`: session-only, kept while navigating, reset on
  // reload. Keyed by entity id (an entity expands consistently wherever it appears).
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const toggleExpand = useCallback(
    (id: string) => setExpandedIds((m) => ({ ...m, [id]: !m[id] })),
    [],
  )
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

    // TWO-SIGIL GRAMMAR (v0.3.34): one line → a KIND directive + ACTION flags +
    // ATTRIBUTES + a TITLE. `:word` = a kind (`:mome`) or an action (`:done`);
    // `--field:value` = an attribute (`--start:2330`, `--color:ff0000`, `--title:…`);
    // whatever's left is the title. TARGET RULE — a TITLE ⇒ create + configure a NEW
    // child under the open context; NO title ⇒ the bar is a COMMAND LINE acting on the
    // CURRENTLY OPEN entity.
    const entry = parseEntry(raw)

    if (entry.unknown.length > 0) {
      setNotice({
        tone: "err",
        text: `unknown :${entry.unknown[0]} — kinds :task :spac :mome :inst :reso :comm :orga · actions :done :undone :close :cancel :reopen`,
      })
      return
    }

    // Apply ONE `--field:value` attribute to `id`, reusing the same mutators + validation
    // whether the target is a brand-new child or the open entity. Returns a short success
    // fragment for the notice, or null after setting its OWN error notice.
    const applyAttr = (id: string, attr: EntryAttr): string | null => {
      const ent = getEntity(id)
      if (!ent) {
        setNotice({ tone: "err", text: "no target entity" })
        return null
      }
      const val = attr.value
      switch (attr.field) {
        case "title": {
          if (val === "") {
            setNotice({ tone: "err", text: "title can't be empty" })
            return null
          }
          if (!renameEntity(id, val)) {
            setNotice({ tone: "err", text: "no change" })
            return null
          }
          return "renamed"
        }
        case "color": {
          // Kind-agnostic ACCENT (dayline ticks + wherever the entity shows its color).
          if (val === "") {
            setEntityAccent(id, null)
            return "color cleared"
          }
          const hex = parseHexColor(val)
          if (!hex) {
            setNotice({ tone: "err", text: `invalid color "${val}" — use a hex like ff0000` })
            return null
          }
          setEntityAccent(id, hex)
          return `color ${hex}`
        }
        case "sex": {
          if (ent.kind !== "individual") {
            setNotice({ tone: "err", text: "only individuals have a sex" })
            return null
          }
          if (val === "") {
            setEntitySex(id, null)
            return "sex cleared"
          }
          const v = val.toLowerCase()
          const sex = v === "man" || v === "m" ? "man" : v === "woman" || v === "w" ? "woman" : null
          if (!sex) {
            setNotice({ tone: "err", text: `use --sex:man | woman (got "${val}")` })
            return null
          }
          setEntitySex(id, sex)
          return `sex ${sexSymbol(sex)}`
        }
        case "start":
        case "end":
        case "at":
        case "due": {
          // A compact date token (HHMM today / YYMMDD / YYMMDDHHMM); empty clears the slot.
          // A single time on a moment sets its START ⇒ ONGOING (never auto-completes); only
          // an END completes/closes it. This is the whole point-vs-start fix.
          const key = ({ start: "startAt", end: "endAt", at: "at", due: "dueAt" } as const)[attr.field]
          let epoch: number | null = null
          if (val.toLowerCase() === "now") {
            // `--start:now` / `--end:now` / `--at:now` — stamp the current instant.
            epoch = Date.now()
          } else if (val !== "") {
            epoch = parseDateToken(val)
            if (epoch == null) {
              setNotice({ tone: "err", text: `invalid time "${val}" — use HHMM, YYMMDD, YYMMDDHHMM, or now` })
              return null
            }
          }
          if (!setEntityScheduleField(id, key, epoch)) {
            setNotice({ tone: "err", text: `can't set ${attr.field} on a ${KIND_META[ent.kind].label}` })
            return null
          }
          return epoch == null ? `${attr.field} cleared` : `${attr.field} ${fmt(epoch)}`
        }
        case "close": {
          // CLOSE POLICY (owner-only): `--close:manual` opts out of the automatic midnight
          // close (rests at Complete/Ongoing until closed by hand); `--close:auto` (or empty)
          // restores the default. Not the `:close` ACTION — that's a `:` directive.
          const v = val.toLowerCase()
          const policy = v === "" || v === "auto" ? "auto" : v === "manual" ? "manual" : null
          if (policy == null) {
            setNotice({ tone: "err", text: `use --close:manual | auto (got "${val}")` })
            return null
          }
          if (!setEntityClosePolicy(id, policy)) {
            setNotice({ tone: "err", text: "only the owner can change the close policy" })
            return null
          }
          return `close ${policy}`
        }
        default:
          setNotice({
            tone: "err",
            text: `unknown --${attr.field} — try --start --end --at --due --close --color --sex --title`,
          })
          return null
      }
    }

    const hasTitle = entry.title !== ""

    // ── COMMAND MODE — no title ⇒ act on the currently OPEN entity. ─────────────────
    if (!hasTitle) {
      const target = getEntity(contextId)
      if (!target) {
        setNotice({ tone: "err", text: "no open entity" })
        return
      }
      const done: string[] = []

      // `:kind` with no title turns THIS entity into that kind (the menu's "Change into…").
      if (entry.kind) {
        if (entry.kind === target.kind) {
          setNotice({ tone: "err", text: `already a ${KIND_META[entry.kind].label}` })
          return
        }
        changeEntityKind(contextId, entry.kind)
        done.push(`kind ${KIND_META[entry.kind].label}`)
      }

      for (const attr of entry.attrs) {
        const msg = applyAttr(contextId, attr)
        if (msg == null) return // applyAttr already showed the error
        done.push(msg)
      }

      let deletedSelf = false
      for (const action of entry.actions) {
        const ent = getEntity(contextId)
        if (!ent) break
        // `applyEntityMenuAction` is the SAME dispatcher the right-click menu uses.
        if (!applyEntityMenuAction(ent, action)) {
          setNotice({ tone: "err", text: `can't ${action} this ${KIND_META[ent.kind].label}` })
          return
        }
        done.push(action)
        if (action === "delete") deletedSelf = true
      }

      if (done.length === 0) return
      setDraft("")
      // Deleting the open entity: climb out of it (mirrors the row delete).
      if (deletedSelf) setPath((p) => (p.length > 1 ? p.slice(0, -1) : p))
      setNotice({ tone: "ok", text: done.join(" · ") })
      bump()
      return
    }

    // ── CREATE MODE — a titled NEW child under the open context. ────────────────────

    // A browsable address (URL / bare domain / internal Zero route) with NO explicit
    // kind ⇒ a diamond RESOURCE (Zero is a contextual browser). `:kind` opts out.
    if (entry.kind === null && looksLikeUrl(entry.title)) {
      const url = normalizeUrl(entry.title)
      const resource = resolveWebResourceByUrl(url)
      addWebResource({
        title: webDisplayName(url, resource?.id),
        url,
        contextId,
        resourceId: resource?.id,
      })
      setDraft("")
      bump()
      return
    }

    // Kind = explicit `:kind`, else deterministically inferred from the scheduling fields
    // (default MOMENT — most logged things happen in time).
    const kind = entry.kind ?? inferKind(entry.title, entry.attrs)
    const created = addParsedEntity({ title: entry.title, contextId, kind })

    // Configure the new child: apply every attribute (skip --title — the free text already
    // named it), then any :action flags (e.g. `:done` logs it already-done / cancelled).
    for (const attr of entry.attrs) {
      if (attr.field === "title") continue
      applyAttr(created.id, attr) // best-effort; a bad token shows a notice but keeps the entity
    }
    for (const action of entry.actions) {
      const ent = getEntity(created.id)
      if (ent) applyEntityMenuAction(ent, action)
    }

    // CROSS-MIDNIGHT SPAN: a moment whose end lands at/-before its start (e.g. sleep
    // 23:30 → 06:30) means "the next day" — bump the end forward 24h so the span is real.
    const fresh = getEntity(created.id)
    if (fresh && fresh.kind === "moment") {
      const st = fresh.schedule?.startAt
      const en = fresh.schedule?.endAt
      if (st != null && en != null && en <= st) {
        setEntityScheduleField(created.id, "endAt", en + 86_400_000)
      }
    }

    // AUTO-TAG by title: link the new entity into every existing (non-closed) entity whose
    // name it contains — "Work on Zero" surfaces under the Space "Zero". It inherits the
    // match's accent UNLESS the user set one explicitly with --color.
    const explicitColor = entry.attrs.some((a) => a.field === "color" && a.value !== "")
    const tagged = autoTagByTitle(created.id, { inheritAccent: !explicitColor })

    setDraft("")
    if (tagged.length > 0) {
      setNotice({ tone: "ok", text: `tagged: ${tagged.map((t) => t.title).join(", ")}` })
    }
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

  // EXPLICIT CLOSE (header × button) — the counterpart to drilling away. Drilling away
  // PARKS a web resource (kept warm/dormant for an instant re-open); closing destroys
  // it for good (its native tab is torn down, freeing memory) and climbs out to the
  // parent. For a non-web entity there's no view to destroy, so it's simply "climb out".
  // No-op at the root (nothing above to close into).
  const closeContext = useCallback(
    (e: Entity) => {
      if (typeof window !== "undefined" && window.zero?.resource?.close && e.webUrl) {
        window.zero.resource.close(e.id)
      }
      setPath((p) => (p.includes(e.id) ? p.slice(0, p.indexOf(e.id)) : p.length > 1 ? p.slice(0, -1) : p))
    },
    [],
  )

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

  // PINNED (§4) OPEN — the frame/title click on a pinned starter: DRILL into the entity AND
  // spin a fresh session in its Sessions sub-Space (startSession enforces the ≤1-ongoing
  // rule + creates the Sessions space on first use). You land inside the entity; the session
  // records in the background.
  const openPinned = useCallback(
    (id: string) => {
      startSession(id)
      navigateTo(id)
      bump()
    },
    [navigateTo, bump],
  )

  // PINNED (§4) SESSION TOGGLE — the glyph click (STAY here): stop the running session if one
  // is ongoing, else start one. No navigation — just clock in/out from the shelf.
  const togglePinnedSession = useCallback(
    (id: string) => {
      if (getOngoingSession(id)) stopSession(id)
      else startSession(id)
      bump()
    },
    [bump],
  )

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
  // Run a chosen entity-menu action. "show-hidden" / "hide-hidden" are VIEW toggles (not
  // data mutations), so they flip local state here; everything else delegates to the shared
  // dispatcher. Shared by the DOM menu and the native overlay so both behave identically.
  const runEntityAction = useCallback(
    (e: Entity, id: string) => {
      if (id === "show-hidden") return setShowHidden(true)
      if (id === "hide-hidden") return setShowHidden(false)
      // SIZE — a VIEW override (see `rowSizes`), not a data mutation, so it's handled here
      // rather than delegated to `applyEntityMenuAction`. Choosing "m" (the default) clears
      // the override to keep the map tidy.
      if (id.startsWith("size:")) {
        const next = id.slice("size:".length) as FaceSize
        return setRowSizes((m) => {
          const copy = { ...m }
          if (next === "m") delete copy[e.id]
          else copy[e.id] = next
          return copy
        })
      }
      // MAKE — a VIEW override too (see `rowMakes`). Choosing "default" clears the entry.
      if (id.startsWith("make:")) {
        const next = id.slice("make:".length) as FaceMake
        return setRowMakes((m) => {
          const copy = { ...m }
          if (next === "default") delete copy[e.id]
          else copy[e.id] = next
          return copy
        })
      }
      // STARTER PIN — curation, not entity data: add/remove from the global §4 PINNED list.
      // Handled here (like the view toggles) rather than via `applyEntityMenuAction`.
      if (id === "starter-pin" || id === "starter-unpin") {
        toggleStarterPin(e.id)
        return bump()
      }
      applyEntityMenuAction(e, id)
      bump()
    },
    [bump],
  )

  // Open the entity menu. `opts.size` (passed by the ENTITY CONTENT rows) adds the Size
  // submenu with the row's current rung ticked; surfaces without a per-entity size (the
  // breadcrumb, siblings, §0 header, activity) omit it.
  const openMenu = useCallback(
    (e: Entity, ev: React.MouseEvent, opts?: { size?: FaceSize; make?: FaceMake }) => {
      ev.preventDefault()
      ev.stopPropagation()
      showMenu(
        buildEntityMenuItems(e, {
          showHidden,
          currentSize: opts?.size,
          currentMake: opts?.make,
          // The pin toggle appears on EVERY entity menu (content rows, tiles, header) with
          // its label reflecting current membership — computed live so it always matches.
          starterPinned: isStarterPinned(e.id),
        }),
        ev.clientX,
        ev.clientY,
        (id) => runEntityAction(e, id),
      )
    },
    [showMenu, showHidden, runEntityAction],
  )

  // The bundle of actions + view accessors that <Zero0Content> threads down through its
  // recursion, so every nested Content shares ONE set of handlers (no prop-drilling per
  // level). Memoized so the recursive tree doesn't re-render on unrelated canvas changes.
  const contentCtx: Zero0ContentCtx = useMemo(
    () => ({
      toggleDone,
      openEntity,
      remove,
      openMenu,
      sizeOf,
      makeOf,
      setHoveredRowId,
      showHidden,
      nowSec,
      rev,
      expandedIds,
      toggleExpand,
    }),
    [toggleDone, openEntity, remove, openMenu, sizeOf, makeOf, showHidden, nowSec, rev, expandedIds, toggleExpand],
  )

  // The drill path as a Set — the top-level Content's ancestry. Seeds the cycle guard so a
  // row can't expand into an entity that's already an ancestor on the breadcrumb (a
  // `taggedContextIds` loop). `contextId` itself is added inside Content as it recurses.
  const contentAncestry = useMemo(() => new Set(path), [path])

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
      showMenu(buildEntityMenuItems(ent, { showHidden }), x, y, (actionId) => runEntityAction(ent, actionId))
    })
  }, [contextId, showMenu, showHidden, runEntityAction])

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
      {/* ── GLUED TOP: live clock ──────────────────���─���─────────────────────────
          Permanent top chrome (mirrors the footer's glued-bottom role): the live full
          date + time WITH seconds, top-left. Always present �� for any open entity, and
          regardless of which frames are toggled below. `min-h` reserves its row so the
          layout doesn't jump between the SSR blank and the first mounted tick. */}
      <div className="flex min-h-[41px] shrink-0 items-center border-b border-border px-4 py-3 text-[10px] font-medium uppercase tracking-wider leading-none tabular-nums text-foreground">
        {topClock}
      </div>

      {/* ── PINNED BAND (§4, topmost — just under the clock) ────────────────────
          The user's curated shelf of "starters": entities pinned via the ENTITY
          CONTENT right-click. Clicking one drills in + starts a session; the glyph
          clocks in/out without navigating. Shown by default. Same dep-free grid-rows
          collapse animation as every frame; kept MOUNTED while hidden so both
          directions animate, `inert` when collapsed. */}
      {mounted && (
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
          style={{ gridTemplateRows: showFrequent ? "1fr" : "0fr" }}
          inert={!showFrequent}
        >
          <div className="overflow-hidden">
            <Zero0Pinned
              dataRev={rev}
              onOpen={openPinned}
              onToggleSession={togglePinnedSession}
              onContextMenu={(e, ev) => openMenu(e, ev)}
            />
          </div>
        </div>
      )}

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
              highlightId={highlightId}
            />
          </div>
        </div>
      )}

      {/* ── ACTIVITY BAND (below AGENDA, above the header) ─────────────������───────
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
              highlightId={highlightId}
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
        {mounted && minimized.zeroHeader && (
          <div className="mt-1.5 flex items-center">
            {breadcrumb}
            {/* CLOSE for a WEB RESOURCE — on the breadcrumb line, far-right (under the
                version value). §0's × is hidden while the web surface is up, so this is
                the explicit-close gesture for a resource. Destroys the warm tab + climbs out. */}
            {context?.webUrl && <Zero0CloseButton className="ml-auto" onClick={() => closeContext(context)} />}
          </div>
        )}
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
            <dd className="flex min-w-0 items-center">
              {breadcrumb}
              {/* CLOSE for a WEB RESOURCE — far-right on the breadcrumb row, so it lands
                  directly under the version value in the identity line above. §0's × is
                  replaced by the web surface, so this is the resource's close gesture. */}
              {context?.webUrl && <Zero0CloseButton className="ml-auto" onClick={() => closeContext(context)} />}
            </dd>
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

      {/* ── ENTITY CONTENT ────────────────────────────────────────────────��────
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
        {mounted && context && (
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
            style={{ gridTemplateRows: showEntityHeader ? "1fr" : "0fr" }}
            inert={!showEntityHeader}
          >
            <div className="overflow-hidden">
          <section className="relative border-b border-border px-4 py-3">
            {/* The open node as a FULL Face (§0) — glyph/title/kind identity line + the
                exhaustive meta dl. The close button (drilled-in, non-web) rides the
                identity line via `trailing`; right-click opens the node's own menu. The
                life log + frame marker below stay Content-side (canvas). */}
            <Zero0Face
              entity={context}
              size="full"
              now={nowSec}
              onToggleDone={toggleDone}
              onContextMenu={openMenu}
              trailing={
                path.length > 1 ? (
                  <Zero0CloseButton className="ml-auto" onClick={() => closeContext(context)} />
                ) : undefined
              }
            />
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

        {/* ENTITY CONTENT — the container's INSIDE, via the recursive Content primitive.
            A row can expand (▸) into its own nested Content. Empty until you create. */}
        <div className="px-4 py-3">
          {context && (
            <Zero0Content
              entity={context}
              axis="list"
              depth={0}
              ancestry={contentAncestry}
              ctx={contentCtx}
              isRoot
              mounted={mounted}
            />
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
            placeholder="create entity…  (try:  :mome Sleep --start:2330   ·   --end:0630   ·   :done   ·   --color)"
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            aria-label="Create entity"
          />
        </div>
        {/* --color SWATCH PICKER — surfaces only while the draft is a bare "--color".
            Clicking a swatch fills the field with "--color:<hex>", which no longer matches
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
                onClick={() => setDraft(`--color:${hex.replace(/^#/, "")}`)}
                className="h-4 w-4 rounded-sm border border-border transition-transform hover:scale-125"
                style={{ backgroundColor: hex }}
              />
            ))}
            {/* FREE-TEXT entry — a hex ("#8b5a2b") OR a CSS name ("brown", "grey"). Resolves
                to a hex via the browser's parser and fills the draft, exactly like a swatch. */}
            <input
              type="text"
              aria-label="Custom color (hex or CSS name)"
              placeholder="hex / name…"
              onMouseDown={(ev) => ev.stopPropagation()}
              onChange={(ev) => {
                const hex = cssColorToHex(ev.target.value)
                if (hex) setDraft(`--color:${hex.replace(/^#/, "")}`)
              }}
              className="ml-1 w-20 rounded-sm border border-border bg-background px-1 py-0.5 text-[10px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
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
        {/* PINNED (§4) + AGENDA (§3) + ACTIVITY (§2) frame toggles, in top-to-bottom
            order. These flip the SAME chord flags as the § keybindings and "§x" markers.
            (The flag key stays "frequent" for back-compat with stored chord state.) */}
        <button
          type="button"
          onClick={() => toggleZero0Flag("frequent")}
          aria-pressed={showFrequent}
          className={
            showFrequent
              ? "text-foreground transition-colors"
              : "text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          pinned
        </button>
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
