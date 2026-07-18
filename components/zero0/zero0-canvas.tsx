"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { VersionSwitcher } from "@/components/version-switcher"
import { Zero0ThemeToggle } from "./zero0-theme-toggle"
import { Zero0UpdateIndicator } from "./zero0-update-indicator"
import { Zero0WindowControls } from "./zero0-window-controls"
import { Zero0Agenda, Zero0Activity } from "./zero0-activity"
import { recordPresence } from "@/lib/zero/activity-log"
import { Zero0DomMenu, type Zero0DomMenuState } from "./zero0-dom-menu"
import { cssColorToHex } from "./zero0-menu-list"
import { buildEntityMenuItems, applyEntityMenuAction, type MenuItem } from "@/lib/zero/menu-model"
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
  setEntityDuration,
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
  openEngagement,
  closeEngagement,
  setOpenEngagementStart,
  markInstant,
  setInstantMax,
  endOngoing,
  reorderContextItems,
} from "@/lib/zero/data"
  import { KIND_META, isClosed, getState, hasOpenEngagement, getOpenEngagement, isMarkable, getInstantMaxNb } from "@/lib/zero/kinds"
  import { isDone, describeLogEntry } from "@/lib/zero/entity-log"
import {
  parseEntry,
  inferKind,
  parseDateToken,
  parseDurationToMinutes,
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
import { Zero0Pins } from "./zero0-pins"
import { Zero0Frame } from "./zero0-frame"
import { Zero0Face } from "./zero0-face"
import { Zero0Content, type Zero0ContentCtx } from "./zero0-content"
  import { fmt, fmtLogValue, sexSymbol, formatDuration, type FaceSize, type FaceMake } from "@/lib/zero/face-model"
import type { Entity } from "@/lib/zero/types"
import { WHENEVER } from "@/lib/zero/types"

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

// How long you must STAY inside a context before a focus session opens on it (and its
// dwellable ancestors). Passing A→B→C to reach C fires nothing on A/B because each quick
// navigation clears the prior timer. [Set to 0 WHILE BUILDING ZERO — Loris: presence should
// count immediately, no waiting; the data layer still discards any session shorter than
// MIN_SESSION_MS as a second guard, so a fast pass-through leaves no trace. Tune freely.]
const DWELL_MS = 0

// LAST FOCUS — the drill-in `path` is persisted here so closing + reopening Zero (Electron
// OR the web app, both via renderer localStorage) restores the exact context you left off at.
// Own key, isolated from the entity store (`zero:root-items:v1`) and the activity log.
const PATH_STORAGE_KEY = "zero:root-path:v1"

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
  // Which time frames are MINIMIZED (collapsed to just their dayline band). Engagement-only,
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
  // §4 PINS — the band auto-shows whenever an entity is ongoing. This flag is the MANUAL
  // override (toggled by §4) that force-reveals the EMPTY frame when nothing is ongoing.
  const showFrequent = useZero0Flag("frequent")

  useEffect(() => {
    hydrateFromStorage()
    // Restore the LAST FOCUS (drill-in path) so you resume where you left off. Validate the
    // stored chain against the freshly-hydrated store: keep ROOT then each id that still
    // resolves to a live entity, stopping at the first that was deleted while away.
    try {
      const raw = localStorage.getItem(PATH_STORAGE_KEY)
      if (raw) {
        const stored: unknown = JSON.parse(raw)
        if (Array.isArray(stored) && stored[0] === ROOT_ID) {
          const valid: string[] = [ROOT_ID]
          for (let i = 1; i < stored.length; i++) {
            const id = stored[i]
            if (typeof id === "string" && getEntity(id)) valid.push(id)
            else break
          }
          if (valid.length > 1) setPath(valid)
        }
      }
    } catch {
      // ignore malformed/absent storage — fall back to root
    }
    setMounted(true)
  }, [])

  // Persist the LAST FOCUS on every path change (post-mount, so the SSR default `[ROOT_ID]`
  // never clobbers a stored deeper focus before it's restored above).
  useEffect(() => {
    if (!mounted) return
    try {
      localStorage.setItem(PATH_STORAGE_KEY, JSON.stringify(path))
    } catch {
      // ignore quota / private-mode failures
    }
  }, [mounted, path])

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

  // Clear any stale row-hover whenever the context changes. Drilling into a row via a click
  // leaves that row's `onMouseEnter`-set hover behind — React fires NO `onMouseLeave` when the
  // row unmounts on navigation — so `hoveredRowId` would otherwise stay pinned to the entity
  // you just entered, keeping ITS dayline tick lit at 26px "while inside it" (the reported bug).
  // Resetting on navigation keeps the highlight strictly hover-driven.
  useEffect(() => {
    setHoveredRowId(null)
  }, [contextId])

  // PRESENCE: log WHERE the user is — the current drilled-in context. Fires on every
  // context change (and initial mount) so the activity tracker records the trail through
  // the graph, exactly as the old shell did on `activeId`. `recordPresence` no-ops on a
  // repeat of the same id, so this is safe to run on each `contextId`.
  useEffect(() => {
    if (!mounted) return
    recordPresence(contextId)
  }, [mounted, contextId])

  // FOCUS SESSIONS — being inside a context records real presence time on the RECORDED (activity)
  // rail = "how long I worked on this", for EVERY kind (per Loris v0.6.18): task/space/resource,
  // beings incl. the root, AND moments/instants. The WHOLE ACTIVE PATH gets a focus session, so
  // being in a subtask/resource counts as being in each ancestor too.
  //   TWO RAILS, cleanly split: a focus session is RECORDED ACTIVITY (bottom rail), NEVER the same
  //   thing as the STATE `ongoing`. For a Moment/Instant these DIVERGE — a focus (viewing) session
  //   accrues activity but does NOT make it read `ongoing` (that's gated in getState via
  //   `ongoingOpenEngagement`; their ongoing is reserved for the actual occurrence — a concrete
  //   scheduled start or a manual Play punch-in). Wedding invitation = a Task with recorded
  //   work-time; the WEDDING = a Moment whose scheduled Aug-14 span sits on the PLANNED rail.
  //   • Punch OUT (immediate): anything we opened that's no longer on the path.
  //   • Punch IN (after DWELL_MS, now 0): every not-closed entity on the path lacking an open
  //     session, so merely passing through to a deeper context leaves no trace (MIN_SESSION_MS
  //     discards the sub-threshold blip).
  // `focusOpenRef` tracks what WE opened, so punch-out never has to scan the whole store.
  const focusOpenRef = useRef<Set<string>>(new Set())
  const dwellRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!mounted) return
    const pathSet = new Set(path)
    let changed = false
    for (const id of Array.from(focusOpenRef.current)) {
      if (!pathSet.has(id)) {
        if (closeEngagement(id)) changed = true
        focusOpenRef.current.delete(id)
      }
    }
    if (changed) bump()
    if (dwellRef.current) clearTimeout(dwellRef.current)
    dwellRef.current = setTimeout(() => {
      let opened = false
      for (const id of path) {
        const e = getEntity(id)
        if (!e) continue
        // EVERY kind accrues presence on the activity rail — INCLUDING root: a focus session on
        // root IS your overall Zero user session (one open span until you leave/reload), recorded
        // on the activity rail. It never reads "ongoing" because a BEING's focus session is
        // STATE-exempt (ongoingOpenEngagement) and the rollup stops at beings — so root records
        // its span WITHOUT spinning. Skip done Tasks and already-closed entities (a finished thing
        // shouldn't silently re-open just because you glanced at it).
        if (isDone(e) || isClosed(e)) continue
        // v0.6.25: an entity may already have an open MANUAL PLAY (via:"play") — e.g. a Space you
        // Play'd from afar and then navigated into. Don't punch a focus session on top of it and,
        // crucially, don't register it in `focusOpenRef` (that ref drives auto punch-OUT on
        // navigation — registering a play there would STOP the stopwatch the moment you leave).
        // Only NEWLY-opened focus, or an already-open FOCUS (reload continuity), belongs in the ref.
        const existing = getOpenEngagement(e)
        if (existing) {
          if (existing.via === "focus") focusOpenRef.current.add(id) // re-register focus for punch-out
          continue // leave a manual play running; single slot means no focus atop it
        }
        if (openEngagement(id, "focus")) {
          focusOpenRef.current.add(id)
          opened = true
        }
      }
      if (opened) bump()
    }, DWELL_MS)
    return () => {
      if (dwellRef.current) clearTimeout(dwellRef.current)
    }
  }, [mounted, path, bump])

  // MOMENT/SPACE Play/Stop (v0.6.26 — Play ALWAYS opens a SESSION, moments included). A deliberate
  // glyph/menu Play is a MANUAL PLAY: a `via:"play"` session on the BOTTOM (recorded) rail. It NEVER
  // writes the scalar startAt/endAt (those are now PLANNED-only, top rail) — killing the phantom
  // top-rail tick + fake countdown. Fully DECOUPLED from `focusOpenRef` (a manual play is a
  // stopwatch: it survives navigation and runs until you Stop it; never auto-punched-out). Single
  // slot per entity: if a FOCUS session is already open (you're viewing it) a manual play is a
  // no-op — presence already tracks you (two simultaneous focus+play sessions = deferred, see todos).
  const togglePlaySession = useCallback(
    (e: Entity) => {
      const open = getOpenEngagement(e)
      if (open?.via === "play") closeEngagement(e.id) // Stop the running manual play
      else if (!open) openEngagement(e.id, "play") // Start one (nothing else running)
      bump()
    },
    [bump],
  )

  const context = mounted ? getEntity(contextId) : undefined
  // SHOW HIDDEN — a per-context VIEW toggle (right-click ▸ Show hidden). When off, hidden
  // children (manual `hidden` flag OR auto-hidden-because-closed-before-today) collapse out
  // of ENTITY CONTENT; when on, they're revealed with a "(hidden)" title prefix. Engagement-
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
      // open + ongoing + scheduled are all "active / not yet done" for the tally.
      if (w === "open" || w === "ongoing" || w === "scheduled") open++
      // "done" = a Task marked Done but still gated (not yet complete) — count as done.
      else if (w === "done") done++
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

  // `create()` with no args = submit the main create field against the OPEN context (the
  // original behaviour). `create(rawArg, targetArg)` = create under an ARBITRARY context
  // (used by the inline create row inside an expanded Content row). When a `rawArg` is
  // given we never touch the shared `draft`/notice chrome, so a nested create can't clobber
  // the main field.
  const create = useCallback((rawArg?: string, targetArg?: string) => {
    const inline = rawArg !== undefined
    const raw = (rawArg ?? draft).trim()
    if (!raw) return
    const target = targetArg ?? contextId

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
    // `batchNow` anchors ALL relative/`now` tokens in ONE create/edit to a SINGLE instant, so a
    // pair like `--start:now --end:in 2h` spans EXACTLY 2h (v0.6.29). Previously "now" read
    // Date.now() here while "in 2h" read its own Date.now() inside parseDateToken — a few-ms gap
    // that, floored by formatDuration, surfaced as "1h 59m 59s".
    const applyAttr = (id: string, attr: EntryAttr, batchNow: number = Date.now()): string | null => {
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
        case "sessionstart":
        case "sessionend": {
          // ACCESS-SESSION sugar (v0.6.19; retargeted v0.6.20) — the deliberate counterpart to the
          // occurrence --start/--end above. Corrects the current entity's OPEN ACCESS session (its
          // focus engagement): "I opened Cooking just now but I've actually been cooking 30min" ⇒
          // `--sessionStart:30min ago`. This is the MIDDLE (collapsed-ACCESS leaf-spine) rail, so
          // the edit slides the middle tick. It NEVER touches the top-rail schedule NOR the pure
          // PRESENCE truth rail (§2). NOTE: play-vs-focus precedence when a PLAY session is also
          // open is deferred open-item #2 — today it hits whatever `getOpenEngagement` returns.
          const when = val.toLowerCase() === "now" ? batchNow : val === "" ? null : parseDateToken(val, batchNow)
          if (val !== "" && when == null) {
            setNotice({ tone: "err", text: `invalid time "${val}" — use HHMM, "30min ago", "in 2h", or now` })
            return null
          }
          if (attr.field === "sessionstart") {
            if (when == null) {
              setNotice({ tone: "err", text: "--sessionStart needs a time (e.g. 30min ago)" })
              return null
            }
            if (!hasOpenEngagement(ent)) {
              setNotice({ tone: "err", text: "no running session here to backdate" })
              return null
            }
            if (!setOpenEngagementStart(id, when)) {
              setNotice({ tone: "err", text: "couldn't adjust the running session start" })
              return null
            }
            return `session start ${fmt(when)}`
          }
          // sessionend — close the running session (optionally at a past/`now` moment). Empty ⇒ now.
          if (!hasOpenEngagement(ent)) {
            setNotice({ tone: "err", text: "no running session here to end" })
            return null
          }
          if (!closeEngagement(id, when ?? Date.now())) {
            setNotice({ tone: "err", text: "couldn't end the running session" })
            return null
          }
          return `session ended ${fmt(when ?? Date.now())}`
        }
        case "start":
        case "end":
        case "at":
        case "due": {
          // A compact date token (HHMM today / YYMMDD / YYMMDDHHMM); empty clears the slot.
          // A single time on a moment sets its START ⇒ ONGOING (never auto-completes); only
          // an END completes/closes it. This is the whole point-vs-start fix.
          const key = ({ start: "startAt", end: "endAt", at: "at", due: "dueAt" } as const)[attr.field]
          // `--start:whenever` — mark the entity PLAYABLE (a trackable thing with no fixed
          // time; its glyph offers Play/Stop). Only valid on `start`.
          if (val.toLowerCase() === "whenever") {
            if (attr.field !== "start") {
              setNotice({ tone: "err", text: "whenever only applies to --start" })
              return null
            }
            if (!setEntityScheduleField(id, "startAt", WHENEVER)) {
              setNotice({ tone: "err", text: `can't set start on a ${KIND_META[ent.kind].label}` })
              return null
            }
            return "start whenever (playable)"
          }
          let epoch: number | null = null
          if (val.toLowerCase() === "now") {
            // `--start:now` / `--end:now` / `--at:now` — stamp the shared batch instant.
            epoch = batchNow
          } else if (val !== "") {
            epoch = parseDateToken(val, batchNow)
            if (epoch == null) {
              setNotice({ tone: "err", text: `invalid time "${val}" — use HHMM, YYMMDD, YYMMDDHHMM, now, "5min ago", "in 2h", or whenever` })
              return null
            }
          }
          // `--start`/`--end`/`--at`/`--due` ALWAYS target the PLANNED schedule (top-rail scalars),
          // NOT any running session (v0.6.26 — these are pure PLANNING, user-set only; Play never
          // writes them anymore). So `--start:1600` PLANS the entity for 4pm — a top-rail tick.
          // Adjusting a live SESSION's start is the separate `--sessionStart` action above.
          if (!setEntityScheduleField(id, key, epoch)) {
            setNotice({ tone: "err", text: `can't set ${attr.field} on a ${KIND_META[ent.kind].label}` })
            return null
          }
          return epoch == null ? `${attr.field} cleared` : `${attr.field} ${fmt(epoch)}`
        }
        case "duration": {
          // Explicit LENGTH (`--duration:1h30m`, `--duration:90`, `--duration:2d`), kind-
          // agnostic + independent of start. Empty clears it (back to derived length).
          if (val === "") {
            setEntityDuration(id, null)
            return "duration cleared"
          }
          const minutes = parseDurationToMinutes(val)
          if (minutes == null) {
            setNotice({ tone: "err", text: `invalid duration "${val}" — try 1h30m, 90, 2h, 45s, 2d` })
            return null
          }
          if (!setEntityDuration(id, minutes)) {
            setNotice({ tone: "err", text: `can't set duration on a ${KIND_META[ent.kind].label}` })
            return null
          }
          return `duration ${formatDuration(minutes * 60000)}`
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
        case "maxnb":
        case "maxnbhard": {
          // INSTANT max OCCURRENCES before it completes. `--maxnb:3` (soft — extra marks still
          // recorded) vs `--maxnbhard:3` (hard — no marks past complete). Bare `--maxnbhard`
          // hardens the current count; empty `--maxnb` resets to the default unique occurrence.
          if (ent.kind !== "instant") {
            setNotice({ tone: "err", text: "only instants have a max occurrence count" })
            return null
          }
          const hard = attr.field === "maxnbhard"
          if (val === "") {
            if (hard) {
              setInstantMax(id, getInstantMaxNb(ent), true)
              return "maxnb hard"
            }
            setInstantMax(id, 1, false)
            return "maxnb reset (unique)"
          }
          const n = Number.parseInt(val, 10)
          if (!Number.isFinite(n) || n < 1) {
            setNotice({ tone: "err", text: `use --${attr.field}:<n≥1> (got "${val}")` })
            return null
          }
          setInstantMax(id, n, hard)
          return `maxnb ${n}${hard ? " hard" : ""}`
        }
        default:
          setNotice({
            tone: "err",
            text: `unknown --${attr.field} — try --start --end --at --due --duration --maxnb --maxnbhard --close --color --sex --title`,
          })
          return null
      }
    }

    const hasTitle = entry.title !== ""

    // ── COMMAND MODE — no title ⇒ act on the TARGET entity. ─────────────────────────
    if (!hasTitle) {
      const targetEnt = getEntity(target)
      if (!targetEnt) {
        setNotice({ tone: "err", text: "no open entity" })
        return
      }
      const done: string[] = []

      // `:kind` with no title turns THIS entity into that kind (the menu's "Change into…").
      if (entry.kind) {
        if (entry.kind === targetEnt.kind) {
          setNotice({ tone: "err", text: `already a ${KIND_META[entry.kind].label}` })
          return
        }
        changeEntityKind(target, entry.kind)
        done.push(`kind ${KIND_META[entry.kind].label}`)
      }

      const editNow = Date.now() // one instant for the whole batch (see applyAttr / batchNow)
      for (const attr of entry.attrs) {
        const msg = applyAttr(target, attr, editNow)
        if (msg == null) return // applyAttr already showed the error
        done.push(msg)
      }

      let deletedSelf = false
      for (const action of entry.actions) {
        const ent = getEntity(target)
        if (!ent) break
        // `applyEntityMenuAction` is the SAME dispatcher the right-click menu uses. (Create-field
        // actions can't be play/stop — EntryActionId excludes them — so no space-toggle guard here.)
        if (!applyEntityMenuAction(ent, action)) {
          setNotice({ tone: "err", text: `can't ${action} this ${KIND_META[ent.kind].label}` })
          return
        }
        done.push(action)
        if (action === "delete") deletedSelf = true
      }

      if (done.length === 0) return
      if (!inline) setDraft("")
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
        contextId: target,
        resourceId: resource?.id,
      })
      if (!inline) setDraft("")
      bump()
      return
    }

    // Kind = explicit `:kind`, else deterministically inferred from the scheduling fields
    // (default MOMENT — most logged things happen in time).
    const kind = entry.kind ?? inferKind(entry.title, entry.attrs)
    const created = addParsedEntity({ title: entry.title, contextId: target, kind })

    // Configure the new child: apply every attribute (skip --title — the free text already
    // named it), then any :action flags (e.g. `:done` logs it already-done / cancelled).
    const createNow = Date.now() // one instant for the whole batch (see applyAttr / batchNow)
    for (const attr of entry.attrs) {
      if (attr.field === "title") continue
      applyAttr(created.id, attr, createNow) // best-effort; a bad token shows a notice but keeps the entity
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
      // Only a CONCRETE start can form a cross-midnight span ("whenever" has no time).
      if (typeof st === "number" && en != null && en <= st) {
        setEntityScheduleField(created.id, "endAt", en + 86_400_000)
      }
    }

    // AUTO-TAG by title: link the new entity into every existing (non-closed) entity whose
    // name it contains — "Work on Zero" surfaces under the Space "Zero". It inherits the
    // match's accent UNLESS the user set one explicitly with --color.
    const explicitColor = entry.attrs.some((a) => a.field === "color" && a.value !== "")
    const tagged = autoTagByTitle(created.id, { inheritAccent: !explicitColor })

    if (!inline) setDraft("")
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
      const nowDone = !isDone(e)
      setEntityCompleted(e.id, nowDone)
      // A Task is ongoing only while UNDONE, so marking it done punches out its focus
      // session (if any); it stops accruing work time even if it stays on the path.
      if (nowDone && e.kind === "task" && hasOpenEngagement(e)) {
        closeEngagement(e.id)
        focusOpenRef.current.delete(e.id)
      } else if (!nowDone && e.kind === "task" && path.includes(e.id) && !hasOpenEngagement(e)) {
        // Reopened IN PLACE while still inside it. The dwell effect won't re-fire (the
        // `path` didn't change), so punch a focus session back in NOW — otherwise the
        // glyph stayed a static square until you navigated away and back (the bug Loris hit).
        if (openEngagement(e.id, "focus")) focusOpenRef.current.add(e.id)
      }
      bump()
    },
    [bump, path],
  )

  // PLAY / STOP on a MOMENT/SPACE glyph (v0.6.26) — both open/close a `via:"play"` SESSION (bottom
  // rail). A moment is no longer "its own occurrence": its SCHEDULED time is PLANNED-only (top rail,
  // user-set), and PLAYING it records actual time on the bottom rail — the same as a space. This
  // retires the startOccurrence/endOccurrence/reopenOccurrence Play mechanism (which stamped scalar
  // startAt/endAt behind the user's back and caused the phantom top-rail tick + countdown).
  const togglePlay = useCallback(
    (e: Entity) => {
      if (e.kind === "space" || e.kind === "moment") togglePlaySession(e)
    },
    [togglePlaySession],
  )

  // MARK an occurrence on a MARKABLE (live) instant glyph — appends a zero-length timestamp
  // to its tally without navigating. Guarded by isMarkable so it never fires elsewhere.
  const mark = useCallback(
    (e: Entity) => {
      if (!isMarkable(e)) return
      markInstant(e.id)
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

  // PINS (§4) OPEN — the chip/title click: DRILL into the ongoing entity. If it's a Task,
  // the focus-session effect punches it in once you dwell (see above); no session write here.
  const openPin = useCallback(
    (id: string) => {
      navigateTo(id)
      bump()
    },
    [navigateTo, bump],
  )

  // PINS (§4) END — the spinning-glyph click (STAY here): end whatever makes the chip
  // ongoing (close its open engagement, or cap its running span at now — see `endOngoing`).
  // The chip then drops out of the band on the next scan (it's no longer own-ongoing).
  const endPin = useCallback(
    (id: string) => {
      endOngoing(id)
      bump()
    },
    [bump],
  )

  // PINS (§4) START — deliberately open an engagement on a pinned/idle entity. `via:"play"`
  // (NOT "focus") so it's a DELIBERATE, PERSISTENT start: unlike a dwell focus session it is
  // not tracked in `focusOpenRef`, so navigating away never punches it out, and hydrate keeps
  // it running on reload. Idempotent (openEngagement no-ops if one is already open). `focus`
  // ⇒ also navigate the canvas onto it (a plain click on a pinned chip); otherwise it starts
  // in the BACKGROUND in parallel, staying on the current canvas.
  const startPin = useCallback(
    (id: string, focus: boolean) => {
      // v0.6.26: EVERY kind (moments/spaces included) opens a deliberate `via:"play"` SESSION
      // (bottom-rail work session). Previously moment/space went through startOccurrence, which
      // stamped scalar startAt/endAt — the phantom top-rail tick + countdown, and worse, endPin
      // (endOngoing) then couldn't stop it (a stamped future endAt made effectiveScheduleEnd
      // non-null). A play session is closed cleanly by endOngoing → the chip drops out.
      openEngagement(id, "play")
      if (focus) navigateTo(id)
      bump()
    },
    [navigateTo, bump],
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
      // MOMENT/SPACE play/stop routes through togglePlaySession (v0.6.26) — a `via:"play"` session,
      // never the scalar occurrence. (applyEntityMenuAction does the same toggle as a fallback.)
      if ((e.kind === "space" || e.kind === "moment") && (id === "play" || id === "stop"))
        return togglePlaySession(e)
      applyEntityMenuAction(e, id)
      bump()
    },
    [bump, togglePlaySession],
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
  // Create a child under an ARBITRARY context (the inline create row inside an expanded
  // Content row). Reuses the full create grammar via the parameterised `create`.
  const createChild = useCallback(
    (targetContextId: string, raw: string) => {
      const text = raw.trim()
      if (text) create(text, targetContextId)
    },
    [create],
  )

  // Persist a drag-and-drop sibling order for a context, then re-render (getChildren reads
  // the saved order). `orderedIds` is the full visible order the user arranged.
  const reorder = useCallback(
    (targetContextId: string, orderedIds: string[]) => {
      reorderContextItems(targetContextId, orderedIds)
      bump()
    },
    [bump],
  )

  const contentCtx: Zero0ContentCtx = useMemo(
    () => ({
      toggleDone,
      togglePlay,
      mark,
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
      createChild,
      reorder,
    }),
    [toggleDone, togglePlay, mark, openEntity, remove, openMenu, sizeOf, makeOf, showHidden, nowSec, rev, expandedIds, toggleExpand, createChild, reorder],
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

  // Right-click the FRAME chrome (header or empty area) → the minimize/maximize toggle.
  // Routed through the unified `showMenu` (like the entity + siblings menus) so that over an
  // open web Resource it draws in the NATIVE overlay instead of an in-DOM popup that the
  // WebContentsView would paint on top of — the "frame menu renders behind the site" bug.
  const openFrameMenu = useCallback(
    (frame: "agenda" | "activity" | "zeroHeader", ev: React.MouseEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      const items: MenuItem[] = [
        {
          type: "item",
          id: "toggle-frame",
          label: minimized[frame] ? "Maximize the frame" : "Minimize the frame",
        },
      ]
      showMenu(items, ev.clientX, ev.clientY, () =>
        setMinimized((m) => ({ ...m, [frame]: !m[frame] })),
      )
    },
    [minimized, showMenu],
  )

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
      {/* ── GLUED TOP: live clock ──────────��───────���─���─────────────────────────
          Permanent top chrome (mirrors the footer's glued-bottom role): the live full
          date + time WITH seconds, top-left. Always present �� for any open entity, and
          regardless of which frames are toggled below. `min-h` reserves its row so the
          layout doesn't jump between the SSR blank and the first mounted tick. */}
      {/* The band doubles as the DESKTOP TITLE BAR: `-webkit-app-region: drag` lets you
          click-and-drag it to MOVE the frameless window (Windows/Linux; a no-op on the web
          and under macOS's native title bar). The window controls opt back out via `no-drag`.
          `justify-between` keeps the live clock left and the min/max/close cluster top-right. */}
      <div
        className="flex min-h-[41px] shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 text-[10px] font-medium uppercase tracking-wider leading-none tabular-nums text-foreground"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <span>{topClock}</span>
        <Zero0WindowControls />
      </div>

      {/* ── §4 PINS BAND (topmost, just under the clock) ───────────────────��────
          The repurposed §4 frame: a horizontal row of colored chips for every ONGOING
          entity (glyph + title). Click a chip to drill in; click its spinning glyph to
          END it. UNLIKE the other frames this has NO footer toggle — it is purely
          AUTOMATIC: `Zero0Pins` renders nothing (→ the band collapses) whenever nothing
          is ongoing, and appears the moment something starts. (Named "PINS" because the
          plan is to let you pin a chip so it lingers here after it stops being ongoing.) */}
      {mounted && (
        <Zero0Pins
          dataRev={rev}
          focusId={contextId}
          forceShow={showFrequent}
  onOpen={openPin}
  onEnd={endPin}
  onStart={startPin}
  onContextMenu={(e, ev) => openMenu(e, ev)}
  />
      )}

      {/* ── AGENDA BAND (topmost, "TODAY") ──────────────────────────────────────
          The FORWARD-looking frame — what's PLANNED today (the planned dayline).
          Hidden by default (toggled from the footer) so the canvas stays blank; when
          shown it sits at the very top, above ACTIVITY. Show/hide is animated with the
          dep-free CSS grid-rows 0fr↔1fr trick (one compositor-friendly layout
          transition, no per-frame JS). Kept MOUNTED while collapsed so BOTH directions
          animate; `inert` drops it from tab/hit-testing when hidden. */}
      {mounted && (
        <Zero0Frame open={showAgenda}>
          <Zero0Agenda
            onOpen={navigateTo}
            onContextMenuEntity={openMenuById}
            onFrameMenu={openFrameMenu}
            onToggleMinimize={() => setMinimized((m) => ({ ...m, agenda: !m.agenda }))}
            minimized={minimized.agenda}
            // Merge with ACTIVITY below when BOTH are minimized AND ACTIVITY is shown —
            // then TODAY drops its divider so the two minimized bands group together.
            hideBottomBorder={minimized.agenda && minimized.activity && showActivity}
            dataRev={rev}
            highlightId={highlightId}
          />
        </Zero0Frame>
      )}

      {/* ── ACTIVITY BAND (below AGENDA, above the header) ───────────��─������───────
          The BACKWARD-looking frame ��� WHERE the user has been today (presence dayline
          + details). Hidden by default, toggled from the footer, same grid-rows
          collapse animation as AGENDA. Clicking a place drills the canvas into it. */}
      {mounted && (
        <Zero0Frame open={showActivity}>
          <Zero0Activity
            onOpen={navigateTo}
            onContextMenuEntity={openMenuById}
            onFrameMenu={openFrameMenu}
            minimized={minimized.activity}
            dataRev={rev}
            currentContextId={contextId}
            highlightId={highlightId}
          />
        </Zero0Frame>
      )}

      {/* ── ZERO HEADER (§1) ─────────���─────────────────────────────────────────
          Zero-UX chrome: the mark, the access path (breadcrumb), and a session
          readout. Not part of the node's own data. Toggled by §1 / the corner marker,
          and — like every frame in the stack — collapses with the dep-free grid-rows
          0fr↔1fr animation so the frames below slide up/down. Kept mounted so BOTH
          directions animate; `inert` drops it from tab/hit-testing when hidden. */}
      <Zero0Frame open={showZeroHeader}>
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
      </Zero0Frame>

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
              onTogglePlay={togglePlay}
              onMark={mark}
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
        {/* AGENDA (§3) + ACTIVITY (§2) frame toggles, in top-to-bottom order. These flip
            the SAME chord flags as the § keybindings and "§x" markers. (§4 PINS has no
            toggle — it auto-shows only while something is ongoing.) */}
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
        <span className="text-border" aria-hidden>
          |
        </span>
        {/* Doc link — the create-bar grammar reference (also reachable via the seeded
            "Zero" docs Space). A plain anchor, not a frame toggle. */}
        <a
          href="/sugars"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          sugars
        </a>
        {/* Surface-only "restart to update" affordance. Renders null on the web and
            whenever no background update is staged, so it adds no chrome by default. */}
        <span className="ml-auto">
          <Zero0UpdateIndicator />
        </span>
      </footer>

      {/* Both the entity menu and the frame toggle now flow through this ONE in-DOM popup
          (or the native overlay when a site is open — see showMenu). */}
      {menu && <Zero0DomMenu menu={menu} onClose={() => setMenu(null)} />}
    </main>
  )
}
