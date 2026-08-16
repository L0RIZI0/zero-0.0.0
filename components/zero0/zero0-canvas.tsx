"use client"

import { Activity, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { VersionSwitcher } from "@/components/version-switcher"
import { Zero0ThemeToggle } from "./zero0-theme-toggle"
import { Zero0UpdateIndicator } from "./zero0-update-indicator"
import { Zero0WindowControls } from "./zero0-window-controls"
import { Zero0Agenda, Zero0Activity } from "./zero0-activity"
import type { DaylineOccRef } from "./zero0-dayline"
import { recordAccess, wasAwayOnLoad, getLastKnownAlive, markAliveNow } from "@/lib/zero/activity-log"
import { Zero0DomMenu, type Zero0DomMenuState } from "./zero0-dom-menu"
import { Zero0ColorField } from "./zero0-color-picker"
import { buildEntityMenuItems, applyEntityMenuAction, type MenuItem } from "@/lib/zero/menu-model"
import { Zero0PlanDialog, type PlanResult } from "./zero0-plan-dialog"
import {
  ROOT_ID,
  currentUser,
  getChildren,
  getDeletedChildren,
  restoreEntity,
  hardDeleteEntity,
  getEntity,
  getEnvKey,
  hydrateFromStorage,
  addParsedEntity,
  addWebResource,
  setWebTitle,
  setTaskDone,
  setEntityScheduleField,
  setEntityDuration,
  setEntityClosed,
  setEntityAccent,
  setEntitySex,
  setEntityFirstName,
  setEntityLastName,
  setEntityParents,
  findEntityByTitle,
  parentKindsFor,
  setEntityClosePolicy,
  renameEntity,
  changeEntityKind,
  deleteEntity,
  autoTagByTitle,
  isStarterPinned,
  toggleStarterPin,
  openSession,
  closeSession,
  setOpenSessionStart,
  markInstant,
  setInstantMax,
  endOngoing,
  addOccurrence,
  setOccurrenceCancelled,
  cancelPrimaryOccurrence,
  setRuleOccurrenceCancelled,
  deleteOccurrence,
  deleteRuleOccurrence,
  setRuleOccurrenceTime,
  setDefiniteOccurrenceTime,
  cancelAllDefiniteOccurrences,
  setEntityRepeat,
  addSeries,
  removeSeries,
  setEntityTimeblocks,
  reorderContextItems,
  moveEntityToContext,
  addManualSession,
  editSession,
  deleteSession,
  sweepStaleScalars,
  getActorFeed,
  ALIVE_GRACE_MS,
} from "@/lib/zero/data"
  import { KIND_META, getState, isClosed, hasOpenSession, getOpenSession, getSessions, isMarkable, isPlayable, getInstantMaxNb, canAutoPlay, entityHiddenState } from "@/lib/zero/kinds"
  import { isDone, describeLogEntry, describeActorLogEntry } from "@/lib/zero/entity-log"
import {
  parseEntry,
  inferKind,
  parseDateToken,
  parseDurationToMinutes,
  parseHexColor,
  parseRepeatToken,
  type EntryAttr,
} from "@/lib/zero/create-parse"
import { cropTitle, looksLikeUrl, normalizeUrl, resolveWebResourceByUrl, webLabel } from "@/lib/zero/web-resources"
import { useZero0Flag, toggleZero0Flag } from "@/lib/zero/zero0-chord"
import { useZeroCrossWindowSync } from "@/lib/zero/use-zero-sync"
import { useNowSeconds } from "@/lib/zero/use-now"
import { Zero0FrameMarker } from "./zero0-frame-marker"
import { ZERO_VERSION } from "@/lib/zero/version"
import { formatLocale } from "@/lib/zero/format-locale"
import { Zero0ResourceCanvas, toDesktopUrl } from "./zero0-resource-canvas"
import { Zero0Pins } from "./zero0-pins"
import { Zero0Frame } from "./zero0-frame"
import { Zero0Face } from "./zero0-face"
import type { OccurrenceAction } from "./zero0-occurrences"
import type { SessionAction } from "./zero0-sessions"
import { Zero0Favicon } from "./zero0-favicon"
import { Zero0Glyph } from "./zero0-glyph"
import { Zero0Content, type Zero0ContentCtx } from "./zero0-content"
  import { fmt, fmtLogStamp, fmtLogValue, sexSymbol, formatDuration, getFaceModel, type FaceSize, type FaceMake } from "@/lib/zero/face-model"
  import type { Entity, IndividualEntity, OrganismEntity } from "@/lib/zero/types"

// `canAutoPlay` + `ONGOING_ON_ENTER` now live in lib/zero/kinds.ts (canonical), shared by the
// session fold (deriveSessionsFromLog) and this canvas so the two can't drift.

// True when the draft is a "--color" command whose value is empty OR a (possibly partial)
// HEX — the trigger to reveal the swatch row + visual picker. v0.2.147: broadened from the
// bare-"--color" form to also match "--color:<hex>" so DRAGGING the visual picker (which writes
// the live hex back into the draft) keeps the picker mounted instead of unmounting mid-drag.
// A non-hex value (e.g. a typed CSS name "--color:red") still unmatches ⇒ picker hides.
const isColorPickerTrigger = (draft: string) => /^--color:?#?[0-9a-f]{0,6}\s*$/i.test(draft)
// Pull the "#rrggbb" out of a "--color:<hex>" draft (for seeding the visual picker); null when
// the value isn't yet a full 6-digit hex.
const draftColorHex = (draft: string): string | null => {
  const m = draft.match(/^--color:?#?([0-9a-f]{6})\s*$/i)
  return m ? `#${m[1]}` : null
}

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
 *   1. TOP HELPER (`<header>`): the "zero �� root canvas" mark, the ACCESS PATH
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

type CrumbState = "entering" | "stable" | "leaving"
type Crumb = {
  id: string
  label: string
  tooltip?: string
  webUrl?: string
  webResourceId?: string
  siblingCount: number
  idx: number
  isLast: boolean
}
type DisplayCrumb = Crumb & { state: CrumbState }

// Breadcrumb enter/exit choreography. Diffs the incoming crumb trail against what's on screen:
// brand-new crumbs start `entering` (collapsed → flipped to `stable` next frame so CSS grows
// them in), and crumbs that dropped out are retained as `leaving` (collapsed) until their
// transition finishes, then unmounted. The very first population (mount, or empty → seeded) is
// NOT animated — only genuine navigations after that. The collapse/expand itself is pure CSS
// (`.zero0-crumb-wrap`); this hook only orchestrates which crumbs exist + their state.
const CRUMB_ANIM_MS = 240
function useCrumbTransitions(crumbs: Crumb[]): DisplayCrumb[] {
  const [display, setDisplay] = useState<DisplayCrumb[]>(() => crumbs.map((c) => ({ ...c, state: "stable" })))
  const seeded = useRef(false)

  useEffect(() => {
    const initial = !seeded.current
    setDisplay((prev) => {
      const prevById = new Map(prev.map((d) => [d.id, d]))
      const currentIds = new Set(crumbs.map((c) => c.id))
      const next: DisplayCrumb[] = crumbs.map((c) => {
        const ex = prevById.get(c.id)
        // Carry a still-`entering` state forward; anything new (or a re-entered id whose old copy
        // was leaving) starts `entering`. On the initial seed, everything is `stable` (no anim).
        const state: CrumbState = initial ? "stable" : ex && ex.state !== "leaving" ? ex.state : "entering"
        return { ...c, state }
      })
      if (!initial) {
        for (const d of prev) {
          if (!currentIds.has(d.id) && d.state !== "leaving") next.push({ ...d, state: "leaving" })
        }
      }
      return next
    })
    if (crumbs.length > 0) seeded.current = true
  }, [crumbs])

  // Advance `entering` → `stable` on the next frame (double rAF so the collapsed initial state
  // paints first, giving the transition something to animate from), and drop `leaving` crumbs
  // once their exit transition has run.
  useEffect(() => {
    let raf1 = 0
    let raf2 = 0
    let timer = 0
    if (display.some((d) => d.state === "entering")) {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          setDisplay((d) => d.map((x) => (x.state === "entering" ? { ...x, state: "stable" } : x)))
        })
      })
    }
    if (display.some((d) => d.state === "leaving")) {
      timer = window.setTimeout(() => {
        setDisplay((d) => d.filter((x) => x.state !== "leaving"))
      }, CRUMB_ANIM_MS + 40)
    }
    return () => {
      if (raf1) cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      if (timer) clearTimeout(timer)
    }
  }, [display])

  return display
}

// A tiny dep-free × button (the zero0 tree avoids lucide). Explicitly CLOSES the open
// entity — for a web resource that destroys its warm tab; otherwise it just climbs out.
function Zero0CloseButton({
  onClick,
  className = "",
  iconClassName = "h-3 w-3",
}: {
  onClick: () => void
  className?: string
  iconClassName?: string
}) {
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
      <svg viewBox="0 0 16 16" className={iconClassName} fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
        <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
      </svg>
    </button>
  )
}

// WEB-SURFACE SEAM SHADOW — a soft, EASED penumbra painted along the BOTTOM of whatever frame
// sits directly on top of the native web surface (§0 when the entity header is shown over a web
// leaf, else §1 the zero header). The native surface is an OS layer composited OVER Zero's DOM
// within the content rect, so a real downward box-shadow onto the page is impossible — instead we
// paint this gradient INSIDE the frame's own airspace (which the surface does NOT cover), pinned
// to its bottom edge, so it reads as the web rect tucked under the frame's lip. Tall + many-stop
// (ease-out distribution) so it's an elegant graduated shadow, not a hard band; legible in both
// themes. pointer-events-none so it never eats clicks meant for the page.
// Taller (38px) + softer (peak 0.12, was 0.17 → 0.20 → 0.32): a bigger, gentler penumbra so the
// extra height counterbalances the reduced opacity — reads as a diffuse ambient shadow, not a dark
// lip. (Stops scaled to a 0.12 peak per Loris' successive "lower it further" nudges.)
const WEB_SEAM_SHADOW_H = 38
const WEB_SEAM_SHADOW_BG =
  "linear-gradient(to top," +
  " rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.093) 14%, rgba(0,0,0,0.066) 30%," +
  " rgba(0,0,0,0.042) 48%, rgba(0,0,0,0.024) 66%, rgba(0,0,0,0.010) 82%," +
  " rgba(0,0,0,0.003) 92%, rgba(0,0,0,0) 100%)"

function Zero0WebSeamShadow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
      style={{ height: WEB_SEAM_SHADOW_H, background: WEB_SEAM_SHADOW_BG }}
    />
  )
}

// THE §0 ENTITY HEADER (Face at full size + collapsible life LOG + the §0 frame marker), factored
// out so it renders identically in a normal ContextPane AND standalone above a web leaf's surface.
// Owns only its own `logExpanded` toggle. (The web-seam penumbra is painted by the web-view block's
// §0 wrapper, not here, so it can ride the wrapper's animating bottom edge without being clipped.)
function Zero0EntityHeaderBlock({
  entity,
  isRootLevel,
  nowSec,
  onToggleDone,
  onTogglePlay,
  onMark,
  onContextMenu,
  onScheduleAction,
  onSessionAction,
  onClose,
}: {
  entity: Entity
  isRootLevel: boolean
  nowSec: number
  onToggleDone: (e: Entity) => void
  onTogglePlay: (e: Entity) => void
  onMark: (e: Entity) => void
  onContextMenu: (e: Entity, ev: React.MouseEvent) => void
  onScheduleAction: (e: Entity, action: OccurrenceAction) => void
  onSessionAction: (e: Entity, action: SessionAction) => void
  onClose: (e: Entity) => void
}) {
  const [logExpanded, setLogExpanded] = useState(false)
  // ACTIVITY FEED (v0.2.283): for an INDIVIDUAL, the §0 "log" section shows the aggregated feed of
  // every action the person performed across the whole tree (created / accessed / done / … on other
  // entities), newest first — plus its OWN lifecycle (its `created`, `bornAt = …`) as bare self rows.
  // Every other kind keeps its raw per-entity lifecycle log unchanged. The feed is a pure read over
  // the in-memory entities (see getActorFeed); the tree is tiny so recomputing per render is cheap.
  const isIndividual = entity.kind === "individual"
  const actorFeed = isIndividual ? getActorFeed(entity.id) : null
  const logCount = isIndividual ? actorFeed!.length : entity.log?.length ?? 0
  return (
    <section className="relative border-b border-border px-4 py-3">
      <Zero0Face
        entity={entity}
        size="full"
        now={nowSec}
        onToggleDone={onToggleDone}
        onTogglePlay={onTogglePlay}
        onMark={onMark}
        onContextMenu={onContextMenu}
        onScheduleAction={onScheduleAction}
        onSessionAction={onSessionAction}
        trailing={
          !isRootLevel ? (
            <Zero0CloseButton className="ml-auto" onClick={() => onClose(entity)} />
          ) : undefined
        }
      />
      {logCount > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setLogExpanded((v) => !v)}
            aria-expanded={logExpanded}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            <span aria-hidden className="inline-block w-2 text-center">{logExpanded ? "▾" : "▸"}</span>
            <span>{isIndividual ? "activity" : "log"}</span>
            <span className="tracking-normal normal-case opacity-70">{`(${logCount})`}</span>
          </button>
          {logExpanded &&
            (isIndividual ? (
              <ol className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
                {actorFeed!.map(({ entry, objectId, objectTitle, isSelf }, i) => (
                  <li key={`${objectId}#${entry.id ?? i}`} className="contents">
                    <span className="shrink-0 text-muted-foreground">{fmtLogStamp(entry.at)}</span>
                    <span className="truncate text-foreground">
                      {describeActorLogEntry(entry, { objectTitle, isSelf, formatValue: fmtLogValue })}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <ol className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
                {entity.log!.map((entry, i) => (
                  <li key={entry.id ?? i} className="contents">
                    <span className="shrink-0 text-muted-foreground">
                      {entry.id != null && <span className="mr-1.5 opacity-40">{`#${entry.id}`}</span>}
                      {fmtLogStamp(entry.at)}
                    </span>
                    <span className="truncate text-foreground">{describeLogEntry(entry, fmtLogValue)}</span>
                  </li>
                ))}
              </ol>
            ))}
        </div>
      )}
      <Zero0FrameMarker flag="entityHeader" label="the entity header" />
    </section>
  )
}

// ONE CONTEXT LEVEL of the drill-in stack — the §0 entity header (Face + life log) plus the
// recursive ENTITY CONTENT, in its OWN scroll container. The canvas renders one of these per
// non-web level of `path`, wrapping each in <Activity> so ANCESTOR levels stay mounted-hidden
// (state + scroll preserved, effects paused) instead of unmounting — so climbing back out is
// instant and remembers where you were. Owns only truly per-level view state (`logExpanded`,
// scroll); all row view-overrides (size/make/expansion) stay canvas-global via `ctx`, keyed by
// entity id, so a row looks the same wherever it appears.
function Zero0ContextPane({
  entity,
  isRootLevel,
  showEntityHeader,
  nowSec,
  mounted,
  ancestry,
  ctx,
  onToggleDone,
  onTogglePlay,
  onMark,
  onContextMenu,
  onScheduleAction,
  onSessionAction,
  onClose,
}: {
  entity: Entity
  isRootLevel: boolean
  showEntityHeader: boolean
  nowSec: number
  mounted: boolean
  ancestry: Set<string>
  ctx: Zero0ContentCtx
  onToggleDone: (e: Entity) => void
  onTogglePlay: (e: Entity) => void
  onMark: (e: Entity) => void
  onContextMenu: (e: Entity, ev: React.MouseEvent) => void
  onScheduleAction: (e: Entity, action: OccurrenceAction) => void
  onSessionAction: (e: Entity, action: SessionAction) => void
  onClose: (e: Entity) => void
}) {
  return (
    <div
      className="min-h-0 flex-1 overflow-auto"
      onContextMenu={(ev) => onContextMenu(entity, ev)}
    >
      {mounted && (
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
          style={{ gridTemplateRows: showEntityHeader ? "1fr" : "0fr" }}
          inert={!showEntityHeader}
        >
          <div className="overflow-hidden">
            <Zero0EntityHeaderBlock
              entity={entity}
              isRootLevel={isRootLevel}
              nowSec={nowSec}
              onToggleDone={onToggleDone}
              onTogglePlay={onTogglePlay}
              onMark={onMark}
              onContextMenu={onContextMenu}
              onScheduleAction={onScheduleAction}
              onSessionAction={onSessionAction}
              onClose={onClose}
            />
          </div>
        </div>
      )}
      <div className="px-4 py-3">
        <Zero0Content entity={entity} axis="list" depth={0} ancestry={ancestry} ctx={ctx} isRoot mounted={mounted} />
      </div>
    </div>
  )
}

// How long you must STAY inside a context before a focus session opens on it (and its
// dwellable ancestors). Passing A→B→C to reach C fires nothing on A/B because each quick
  // navigation clears the prior timer. [Set to 0 WHILE BUILDING ZERO — Loris: access should
// count immediately, no waiting; the data layer still discards any session shorter than
// MIN_SESSION_MS as a second guard, so a fast pass-through leaves no trace. Tune freely.]
const DWELL_MS = 0

// LAST FOCUS — the drill-in `path` is persisted here so closing + reopening Zero (Electron
// OR the web app, both via renderer localStorage) restores the exact context you left off at.
// Own key, isolated from the entity store (`zero:root-items:v1`) and the activity log.
const PATH_STORAGE_KEY = "zero:root-path:v1"

// CONTEXT-ENTER PRE-WARM — on drilling INTO a context, create+load its direct web-resource children HIDDEN
// so opening one is an instant reveal (hides the ~330ms cold controller create). Bounded to the first N so a
// context with many web resources can't spawn an unbounded number of browser processes. [DOGFOODING: this
// mode trades memory for snappiness — the red "prewarm" note on §1 is the reminder to watch memory usage.]
const PREWARM_MAX_PER_CONTEXT = 3

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
  // The build version shown in the header. Starts at the web `ZERO_VERSION` constant (also
  // the SSR value, so hydration matches), then post-mount adopts the REAL running version
  // from the desktop bridge (`window.zero.appVersion` = app.getVersion()) when present — so
  // the desktop header always reflects the ACTUAL shipped build and can't drift from the
  // hand-maintained constant (the bug that made 195/196 look un-applied).
  const [displayVersion, setDisplayVersion] = useState(ZERO_VERSION)
  // The onSelect callback for the CURRENTLY-open NATIVE overlay menu. The overlay echoes
  // the chosen action id back through a single persistent IPC listener, which dispatches
  // to whatever this points at (entity action, or a sibling-nav closure).
  const nativeSelectRef = useRef<((id: string) => void) | null>(null)
  // Which time frames are MINIMIZED (collapsed to just their dayline band). Session-only,
  // a separate axis from § visibility: a shown frame can be full or minimized.
  const [minimized, setMinimized] = useState<{ agenda: boolean; activity: boolean; zeroHeader: boolean }>({
    // The §1 ZERO HEADER opens in its MINIMIZED form by default (a single breadcrumb line).
    // AGENDA now opens MAXIMIZED (v0.2.286) — the full TODAY dayline is the default view; its
    // minimized band is being relocated to the top app header next. (Activity stays hidden
    // entirely by its chord-flag default.)
    agenda: false,
    activity: false,
    zeroHeader: true,
  })
  // Every hideable frame's visibility lives in the shared § chord store, so the footer
  // links, the in-frame "§x" corner markers, and the keyboard chords all drive the SAME
  // source of truth (in lockstep across the tree). Top-to-bottom the stack is: AGENDA ·
  // ACTIVITY · ZERO HEADER · ENTITY HEADER · ENTITY CONTENT · CREATE-ENTITY · FOOTER.
  //   §3 AGENDA (planned) + §2 ACTIVITY (access) — the two time frames, hidden by
  //      default so the canvas stays blank until summoned.
  //   §1 ZERO HEADER + §0 ENTITY HEADER — the chrome headers, shown by default.
  const showAgenda = useZero0Flag("agenda")
  const showActivity = useZero0Flag("activity")
  const showEntityHeader = useZero0Flag("entityHeader")
  const showZeroHeader = useZero0Flag("zeroHeader")
  // §4 PINS — a strict show/hide toggle (v0.2.228): this flag alone controls the band's
  // visibility, like every other § frame. Ongoing chips populate it live while it's open.
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

  // SCALAR SWEEP (v0.2.271) — the clock trigger for the current-or-next scalar mirror. Each second,
  // re-mirror any entity whose scalar boundary just passed (see sweepStaleScalars' cheap guard), so
  // the raw fields / dayline / row meta roll forward with the wall clock instead of freezing at the
  // last write. bump() only when something actually promoted (rare), so this is idle most ticks.
  useEffect(() => {
    if (!mounted) return
    if (sweepStaleScalars(nowSec)) bump()
  }, [mounted, nowSec, bump])

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

  // ACCESS: log WHERE the user is — the current drilled-in context. Fires on every
  // context change (and initial mount) so the activity tracker records the trail through
  // the graph, exactly as the old shell did on `activeId`. `recordAccess` no-ops on a
  // repeat of the same id, so this is safe to run on each `contextId`.
  useEffect(() => {
    if (!mounted) return
    recordAccess(contextId)
  }, [mounted, contextId])

  // FOCUS SESSIONS — being inside a context records real access time on the MIDDLE (access spine)
  // rail = "how long I worked on this", for EVERY kind (per Loris v0.6.18): task/space/resource,
  // beings incl. the root, AND moments/instants. The WHOLE ACTIVE PATH gets a focus session, so
  // being in a subtask/resource counts as being in each ancestor too.
  //   TWO RAILS, cleanly split: a focus session is RECORDED ACTIVITY (bottom rail), NEVER the same
  //   thing as the STATE `ongoing`. For a Moment/Instant these DIVERGE — a focus (viewing) session
  //   accrues activity but does NOT make it read `ongoing` (that's gated in getState via
  //   `ongoingOpenSession`; their ongoing is reserved for the actual occurrence — a concrete
  //   scheduled start or a manual Play punch-in). Wedding invitation = a Task with recorded
  //   work-time; the WEDDING = a Moment whose scheduled Aug-14 span sits on the PLANNED rail.
  //   • Punch OUT (immediate): anything we opened that's no longer on the path.
  //   • Punch IN (after DWELL_MS, now 0): every not-closed entity on the path lacking an open
  //     session, so merely passing through to a deeper context leaves no trace (MIN_SESSION_MS
  //     discards the sub-threshold blip).
  // `focusOpenRef` tracks what WE opened, so punch-out never has to scan the whole store.
  const focusOpenRef = useRef<Set<string>>(new Set())
  // v0.6.32: the OTHER rail. `playOpenRef` tracks the AUTO-PLAY (ongoing-on-enter) sessions WE
  // opened, so leaving punches them out (freezing DURATION) exactly like focus. A MANUAL play
  // (Space Play'd from afar) is NOT in this ref → it survives navigation.
  const playOpenRef = useRef<Set<string>>(new Set())
  const dwellRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // AWAY-ARMED (v0.2.302): true when the app LOADED after a real absence (no proof of life within
  // ALIVE_GRACE_MS — see activity-log `wasAwayOnLoad`). While armed we SKIP the auto punch-in below,
  // so the hydrate-cleanup's capped-at-last-alive state survives and the leaf reads stopped/idle.
  // Cleared by `resumeFromAway` on the first click inside ENTITY CONTENT. Lazily initialized once on
  // the first mounted run (SSR-safe: `wasAwayOnLoad` no-ops without `window`).
  const awayArmedRef = useRef<boolean | null>(null)

  // PUNCH IN the whole current path — open/re-register a FOCUS (access) span on every path entity and
  // adopt any AUTO play span for punch-out. Extracted so BOTH the normal dwell tick AND the away-resume
  // click use the exact same logic. Returns true if it opened anything new (caller decides to bump).
  const punchInPath = useCallback(() => {
    let opened = false
    for (const id of path) {
      const e = getEntity(id)
      if (!e) continue
      // ── ACCESS rail (focus): EVERY kind accrues access — INCLUDING root (your overall Zero
      // session) and done/closed entities (v0.6.31: access is lifecycle-independent; getState
      // ranks complete/done/closed ABOVE session-ongoing so this never resurrects a finished
      // thing). We ensure exactly one open FOCUS; re-register an already-open one for punch-out
      // (reload continuity). Focus alone never spins the glyph (ongoing = play-only, v0.6.32).
      if (hasOpenSession(e, "focus")) {
        focusOpenRef.current.add(id) // re-register for punch-out
      } else if (openSession(id, "focus")) {
        focusOpenRef.current.add(id)
        opened = true
      }
      // ── PLAYED rail (play): {task, resource, space} are ONGOING-ON-ENTER while not done/closed.
      // The auto played span is DERIVED — opening `focus` above (⇒ `accessed`) already made it open
      // via the fold, so a freshly-entered entity is already play-open; we just register the AUTO
      // span for punch-out on leave. v0.2.257: the old "leaf-transitive resume" (re-opening a
      // paused-as-leaf ancestor when drilling deeper) is GONE — with pause/resume retired, an auto
      // span simply stays open the whole time its entity is in the path and closes on `exited`.
      if (canAutoPlay(e)) {
        const openPlay = getOpenSession(e, "play")
        // Only AUTO plays are access-managed (punched out on leave). A REMOTE play you drilled
        // into is a deliberate stopwatch that SURVIVES navigation — never adopt it into the
        // punch-out set, or leaving would silently Stop it.
        if (openPlay?.auto) playOpenRef.current.add(id)
      }
    }
    return opened
  }, [path])

  // RESUME after an away-gap: the user clicked back into ENTITY CONTENT. Disarm and punch the whole
  // path in NOW, so leaf + ancestors go ongoing together (matches the subtree model). No-op if not
  // armed, so a normal click inside content costs nothing.
  const resumeFromAway = useCallback(() => {
    if (!awayArmedRef.current) return
    awayArmedRef.current = false
    // Reset last-known-alive on the SAME gesture, so the runtime watchdog (below) doesn't see the
    // still-stale heartbeat and immediately re-cap the session we're resuming (v0.2.303).
    markAliveNow()
    if (punchInPath()) bump()
  }, [punchInPath, bump])

  useEffect(() => {
    if (!mounted) return
    // Freeze the away verdict once, on the first mounted run (before the heartbeat stamps fresh life).
    if (awayArmedRef.current === null) awayArmedRef.current = wasAwayOnLoad()
    const pathSet = new Set(path)
    let changed = false
    // Punch OUT the entities we auto-opened but have now left — BOTH rails independently. This runs
    // even while away-armed (nothing to punch out then, but harmless + keeps refs consistent).
    for (const id of Array.from(focusOpenRef.current)) {
      if (!pathSet.has(id)) {
        if (closeSession(id, "focus")) changed = true
        focusOpenRef.current.delete(id)
      }
    }
    for (const id of Array.from(playOpenRef.current)) {
      if (!pathSet.has(id)) {
        if (closeSession(id, "play")) changed = true // leaving stops ongoing (DURATION freezes)
        playOpenRef.current.delete(id)
      }
    }
    if (changed) bump()
    if (dwellRef.current) clearTimeout(dwellRef.current)
    dwellRef.current = setTimeout(() => {
      // AWAY GATE (v0.2.302): loaded after a real absence ⇒ do NOT auto-resume ongoing. Leave the
      // path stopped (capped at last-alive by the hydrate cleanup) until the user clicks inside
      // ENTITY CONTENT (resumeFromAway). Every other load path punches in as before.
      if (awayArmedRef.current) return
      if (punchInPath()) bump()
    }, DWELL_MS)
    return () => {
      if (dwellRef.current) clearTimeout(dwellRef.current)
    }
  }, [mounted, path, bump, punchInPath])

  // RUNTIME AWAY WATCHDOG (v0.2.303; PLAY-ONLY cap v0.2.306) — the missing piece for the WINDOW-STAYED-OPEN
  // case. The load-time gate only fires on (re)hydrate; if Zero is left open while the DEVICE goes idle,
  // no reload happens, so nothing capped the auto-ongoing and the glyph kept spinning. This interval polls
  // the device-level liveness signal (last OS-wide input via the heartbeat's powerMonitor feed) and, once
  // there's been no proof of life for ALIVE_GRACE_MS, caps the auto-ongoing at last-known-alive.
  //   • closeSession(id,"play",aliveAt) writes a `stopped` — the fold closes the open PLAY span (auto or
  //     remote), which is the ONLY thing that drives the spinning "ongoing" glyph + the BOTTOM rail tick,
  //     and ENDS it at the real last-alive moment. It leaves the FOCUS/ACCESS span (the MIDDLE-rail tick)
  //     OPEN — access = "this context is open in Zero", which by design persists while Zero is open and
  //     the device is powered, NOT gated on input idleness (v0.2.306, Loris' call). Access ends only via
  //     the load-time reconciliation (Zero was closed / device slept ⇒ next hydrate writes `exited`).
  //   • Arms `awayArmedRef` so the leaf won't auto-repunch the play on dwell; a click inside ENTITY
  //     CONTENT (resumeFromAway) disarms + resumes play on the whole path (access was never dropped).
  //   • Device-level: the heartbeat follows OS-wide input, so working in ANOTHER app on the same machine
  //     keeps `aliveAt` fresh and does NOT trip this — only a genuinely idle device does.
  useEffect(() => {
    if (!mounted) return
    const WATCHDOG_MS = 20_000
    const iv = setInterval(() => {
      if (awayArmedRef.current) return // already capped for this absence
      const aliveAt = getLastKnownAlive()
      if (aliveAt == null) return // no evidence yet — don't cap blindly
      if (Date.now() - aliveAt <= ALIVE_GRACE_MS) return // device used recently — still live
      // Device idle past the grace window → cap the auto-ongoing PLAY at the real last-alive moment;
      // the access/focus span stays open (middle rail keeps running while Zero is open).
      awayArmedRef.current = true
      let changed = false
      for (const id of path) {
        if (closeSession(id, "play", aliveAt)) changed = true // `stopped` caps play; focus/access survives
        playOpenRef.current.delete(id)
      }
      if (changed) bump()
    }, WATCHDOG_MS)
    return () => clearInterval(iv)
  }, [mounted, path, bump])

  // MOMENT/SPACE Play/Stop (v0.6.26 — Play ALWAYS opens a SESSION, moments included). A deliberate
  // glyph/menu Play is a MANUAL PLAY: a `via:"play"` session on the BOTTOM (recorded) rail. It NEVER
  // writes the scalar startAt/endAt (those are now PLANNED-only, top rail) — killing the phantom
  // top-rail tick + fake countdown. Fully DECOUPLED from `focusOpenRef` (a manual play is a
  // stopwatch: it survives navigation and runs until you Stop it; never auto-punched-out). Single
  // slot per entity: if a FOCUS session is already open (you're viewing it) a manual play is a
  // no-op — access already tracks you (two simultaneous focus+play sessions = deferred, see todos).
  const togglePlaySession = useCallback(
    (e: Entity) => {
      // v0.2.257 — PLAIN PLAY/STOP TOGGLE (start/stop-only model, pause/resume retired). The glyph
      // no longer branches on in-place-vs-remote: an OPEN play span (auto or remote) is STOPPED
      // (`closeSession("play")` → `stopped`, which the fold closes regardless of flavor, WITHOUT
      // ending your access session — you keep viewing it); otherwise a fresh play span STARTS
      // (`openSession("play")` → `started`, a remote span that survives navigation). Re-clicking
      // Play after a Stop simply starts a NEW played span, exactly as re-entering would.
      const openPlay = getOpenSession(e, "play")
      if (openPlay) {
        closeSession(e.id, "play")
        playOpenRef.current.delete(e.id)
      } else {
        openSession(e.id, "play")
      }
      bump()
    },
    [bump],
  )

  const context = mounted ? getEntity(contextId) : undefined
  // [v0] TEMP ACCESS-ROW PROBE (v0.2.230/.231) — dumps the viewed entity's focus (ACCESS) AND
  // play (RECORDED SESSIONS/spinning) session state + recent log verbs whenever the context or a
  // mutation (`rev`) changes, so we can see EXACTLY when the focus session that gates the ACCESS row
  // opens / closes / gets sub-threshold-discarded. Writes to BOTH the console AND (on desktop) the
  // debug-log FILE at window.zero.debugLogPath so Loris can send it from the packaged build. Remove
  // once the "ACCESS not always displayed" cause is confirmed.
  useEffect(() => {
    if (!mounted || !context) return
    const all = getSessions(context)
    const focus = all.filter((s) => s.via === "focus")
    const play = all.filter((s) => s.via === "play")
    const spanMs = (s: (typeof all)[number]) => Math.round((s.endedAt ?? Date.now()) - s.startedAt)
    const payload = {
      id: context.id,
      kind: context.kind,
      focusCount: focus.length,
      hasOpenFocus: focus.some((s) => s.endedAt == null),
      accessRowShows: focus.length > 0,
      focusSpansMs: focus.map(spanMs),
      playCount: play.length,
      hasOpenPlay: play.some((s) => s.endedAt == null),
      playSpansMs: play.map(spanMs),
      logTail: (context.log ?? []).slice(-10).map((l) => `${l.type}@${new Date(l.at).toLocaleTimeString()}`),
    }
    console.log("[v0] ACCESS-probe", payload)
    try {
      window.zero?.debugLog?.(`ACCESS-probe ${JSON.stringify(payload)}`)
    } catch {
      /* best-effort */
    }
  }, [mounted, context, rev])
  // SHOW HIDDEN — a per-context VIEW toggle (right-click ▸ Show hidden). When off, hidden
  // children (manual `hidden` flag OR auto-hidden-because-closed-before-today) collapse out
  // of ENTITY CONTENT; when on, they're revealed with a "(hidden)" title prefix. Session-
  // only and RESET on navigation so drilling into a new context starts clean.
  const [showHidden, setShowHidden] = useState(false)
  // PLAN DIALOG target (v0.2.269) — the entity whose right-click "Plan…" opened <Zero0PlanDialog>;
  // null = closed. Set by runEntityAction intercepting the "plan" view-action.
  const [planTarget, setPlanTarget] = useState<Entity | null>(null)
  // FROZEN open-time `now` for the Plan dialog (v0.2.271) — captured when the dialog opens and NOT
  // re-taken on the per-second clock, so the dialog's props stay referentially stable and its native
  // time/date pickers don't reset mid-selection. A ref mirrors planTarget so the apply/close handlers
  // can be fully stable (no planTarget dep) and keep <Zero0PlanDialog>'s React.memo effective.
  const [planNow, setPlanNow] = useState(0)
  const planTargetRef = useRef<Entity | null>(null)
  useEffect(() => {
    planTargetRef.current = planTarget
  }, [planTarget])
  useEffect(() => {
    setShowHidden(false)
  }, [contextId])
  // FOCUS ARBITRATION (desktop, over a web resource). The native webview is a SEPARATE OS process whose
  // window sits above Zero's own UI; when it holds keyboard focus, clicking a Zero field (e.g. create-entity)
  // focuses the DOM element but keys still route to the website. Because the webview never lives in the DOM,
  // ANY `focusin` we observe is necessarily a Zero element — so while a webview is shown, on focusin we ask
  // the host to hand keyboard focus back to Electron. Only wired when a webview is actually displayed.
  const hasWebView = isDesktop && !!context?.webUrl
  useEffect(() => {
    if (!hasWebView) return
    const release = () => {
      try {
        window.zero?.resource?.releaseFocus?.()
      } catch {
        /* ignore */
      }
    }
    document.addEventListener("focusin", release)
    return () => document.removeEventListener("focusin", release)
  }, [hasWebView])
  // LOG COLLAPSE — the §0 LIFE LOG is COLLAPSED by default (v0.2.150). It's an ever-growing list of
  // session-open/close ticks that pushed the children below the fold on every open while dogfooding.
  // Now OWNED PER-LEVEL by <Zero0ContextPane> (session-only): each drill level keeps its own toggle,
  // preserved while that level stays mounted in the keep-alive stack.
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

  // ── RESOURCE PRE-WARM (desktop/WebView2) ────────────────────────────────────────────
  // Create+load a web resource's native view HIDDEN so a later drill-in is an instant reveal.
  // `prewarmedRef` tracks the ids we pre-warmed (and never actually opened) so we can discard
  // them to bound memory when leaving their context. `openedRef` marks ids the user actually
  // drilled into — those become normal warm/parked views owned by the resource canvas, so we
  // must NOT discard them.
  const prewarmedRef = useRef<Set<string>>(new Set())
  const openedRef = useRef<Set<string>>(new Set())
  const prewarm = useCallback((id: string, url: string, resourceId?: string) => {
    if (typeof window === "undefined") return
    const r = window.zero?.resource
    if (!r?.prewarm || prewarmedRef.current.has(id) || openedRef.current.has(id)) return
    prewarmedRef.current.add(id)
    // Pass the window's inner size so the hidden view lays out at the real viewport width during the
    // background load (the resource isn't mounted yet, so this is the best available target size) →
    // the reveal is a pure show with no reflow. `envKey` = nearest-Space-ancestor identity of the
    // cookie jar / login this resource uses (SSO within a Space, isolation across Spaces).
    // CRITICAL: normalize the url with toDesktopUrl EXACTLY like the real mount does. An INTERNAL
    // page (e.g. "/matrix-interactions") is a relative url, and WebView2's Navigate() throws
    // ArgumentException on a relative uri — that crashed the pre-warmed controller and left a dead
    // warm view that the eventual open reused (⇒ "site doesn't display"). Normalizing here also
    // makes the prewarm url IDENTICAL to the mount url so the warm view is reused, not re-navigated.
    void r.prewarm({
      id,
      url: toDesktopUrl(url),
      resourceId,
      envKey: getEnvKey(id),
      w: window.innerWidth,
      h: window.innerHeight,
    })
  }, [])
  // CONTEXT-ENTER: pre-warm the current context's direct web-resource children (bounded), and
  // discard any previously pre-warmed views that aren't children here and were never opened.
  useEffect(() => {
    if (!isDesktop) return
    const r = typeof window !== "undefined" ? window.zero?.resource : undefined
    if (!r?.prewarm) return
    const webKids = children.filter((c) => !!c.webUrl)
    // PREWARM AT MOST ONE PER ENV (profile). Multiple controllers per profile is supported and IS the
    // default now (warm siblings + shared login), and controllers created SEQUENTIALLY on one profile
    // coexist fine. What still risks 0x8007139F is CONCURRENT creates on one profile — spinning up several
    // hidden controllers in the SAME env within a few ms of each other (the original blank-page trigger). So
    // we prewarm at most ONE resource per distinct envKey, and never into an envKey already occupied by a
    // live view (current web context or an opened resource). Cross-Space children (different profiles) still
    // prewarm freely; additional same-Space web siblings warm lazily on first open, then stay warm (parked).
    const seededEnvs = new Set<string>()
    if (context?.webUrl) seededEnvs.add(getEnvKey(context.id))
    for (const oid of openedRef.current) seededEnvs.add(getEnvKey(oid))
    let seededCount = 0
    for (const c of webKids) {
      if (seededCount >= PREWARM_MAX_PER_CONTEXT) break
      if (prewarmedRef.current.has(c.id) || openedRef.current.has(c.id)) continue
      const ek = getEnvKey(c.id)
      if (seededEnvs.has(ek)) continue // this profile already has (or is about to have) a live view
      prewarm(c.id, c.webUrl!, c.webResourceId)
      seededEnvs.add(ek)
      seededCount++
    }
    // Discard pre-warmed-but-unopened views we've navigated away from.
    const keep = new Set(webKids.map((c) => c.id))
    for (const id of Array.from(prewarmedRef.current)) {
      if (!keep.has(id) && !openedRef.current.has(id)) {
        r.discardPrewarm?.(id)
        prewarmedRef.current.delete(id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- children is the intended re-read trigger
  }, [isDesktop, contextId, children, prewarm, context])
  // SIBLINGS (entities at the same depth on the same branch = a crumb's parent's children) are
  // now resolved PER-CRUMB: each breadcrumb crumb carries its own `siblingCount`, and its
  // left-hand caret opens that level's sibling dropdown on demand (openSiblingsAt). No single
  // "current level" memo is needed anymore.

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
      // A Task marked Done counts as done whether it's already complete or still gated
      // (gated ⇒ STATE `open` now, since "done" is a flag not a state) — checked first.
      if (c.kind === "task" && isDone(c)) done++
      else if (w === "complete") complete++
      // open + scheduled (which now also covers ongoing, an `open`/`scheduled` STATE) = active.
      else if (w === "open" || w === "scheduled") open++
    }
    return { open, done, complete, total: children.length }
  }, [children])

  // Resolve each crumb to a display label (fall back to the user name at the root). A web
  // resource crumb shows its DISPLAYED title (page title for long URLs, else the URL) cropped to
  // a max width + favicon, with the full title/URL in a hover tooltip; never the raw stored URL
  // uncropped. `siblingCount` = how many entities sit at this crumb's level (its parent's
  // children); drives the per-crumb sibling-switch caret (>1 ⇒ there's somewhere to switch to).
  const crumbs = useMemo(
    () =>
      path.map((id, i) => {
        const e = getEntity(id)
        const web = e?.webUrl
          ? webLabel({ webUrl: e.webUrl, webResourceId: e.webResourceId, webTitle: e.displayTitle, title: e.title })
          : null
        // Crop the crumb label UNIFORMLY (web curated titles bypass webLabel's crop, and long entity
        // titles could wrap too). A short, fixed-length crumb can never grow the header height — which was
        // shoving the web-view rect down when a fetched page <title> arrived. `full` (not `display`) is the
        // uncropped source so we control the crop here; tooltip still carries the whole thing.
        const rawLabel = web ? web.full : (e?.title ?? (i === 0 ? currentUser.name : id))
        const label = cropTitle(rawLabel)
        const siblingCount = i > 0 ? getChildren(path[i - 1]).length : 0
        return {
          id,
          label,
          tooltip: web?.tooltip,
          webUrl: e?.webUrl,
          webResourceId: e?.webResourceId,
          siblingCount,
          idx: i,
          isLast: i === path.length - 1,
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rev re-reads titles after renames
    [path, mounted, rev],
  )

  // Animate the breadcrumb: newly-drilled crumbs grow/fade IN and removed (climbed-out /
  // closed / swapped) crumbs shrink/fade OUT, instead of the trail snapping. Returns the crumbs
  // to render, each tagged with a transition `state`.
  const displayCrumbs = useCrumbTransitions(crumbs)

  // SIBLING TABS (v0.2.291) — the children of the current LEAF's PARENT, i.e. every entity at the
  // leaf's own level (the leaf included). Rendered as a horizontal tab strip ABOVE the breadcrumb
  // (v0.2.300) so the user can hop laterally between peers without opening the per-crumb dropdown.
  // Empty at the root (no parent) and suppressed when there's only one peer (nothing to switch to) —
  // the same >1 gate the breadcrumb's sibling caret uses.
  // v0.2.300: the strip now mirrors EXACTLY the rows the parent's do-list shows — HIDDEN siblings
  // (manual `hidden` flag OR auto-hidden-because-closed-before-today, via `entityHiddenState`) are
  // dropped unless the view's `showHidden` toggle is on, matching zero0-content's own filter. The
  // CURRENT leaf is always kept even if hidden, so the strip always has an active tab to anchor on.
  const leafSiblings = useMemo(
    () => {
      if (path.length < 2) return []
      const all = getChildren(path[path.length - 2])
      if (showHidden) return all
      const leafId = path[path.length - 1]
      return all.filter((s) => s.id === leafId || entityHiddenState(s, nowSec) == null)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rev re-reads the child set after edits
    [path, mounted, rev, showHidden, nowSec],
  )

  // WEB-TITLE RESOLUTION — for every VISIBLE web resource (the open context's children + the
  // breadcrumb trail) that has no fetched `webTitle` yet, fetch the real page <title> via
  // `/api/web-title` and persist it (so the label upgrades from path/hostname → real title,
  // paired with the favicon). Covers EXTERNAL http(s) URLs AND internal Zero routes ("/vision",
  // resolved server-side against this origin) — both are real titled pages. Attempts are tracked
  // so a miss/failure is never retried in a loop; a success bumps to re-render. Non-blocking.
  const webTitleTriedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!mounted) return
    // The DESKTOP (Electron) build is a static export with no server, so `/api/web-title` isn't
    // shipped. Instead we resolve titles through the IPC bridge (main-process fetch, no CORS).
    // Internal Zero routes have no live server page in the desktop shell, so on desktop we only
    // upgrade EXTERNAL http(s) URLs and let internal routes fall back to their curated title/path.
    const bridge = typeof window !== "undefined" ? window.zero : undefined
    const isDesktop = process.env.NEXT_PUBLIC_ZERO_ELECTRON === "1" || !!bridge?.isDesktop
    const candidates = [...children, ...path.map((id) => getEntity(id)).filter(Boolean)] as Entity[]
    const seen = new Set<string>()
    for (const e of candidates) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      const url = e.webUrl
      if (!url || e.displayTitle || webTitleTriedRef.current.has(e.id)) continue
      const isHttp = /^https?:\/\//i.test(url)
      if (!isHttp && !url.startsWith("/")) continue // only http(s) or internal routes
      if (isDesktop) {
        // No server: use the native bridge for external pages; skip internal routes.
        if (!isHttp || !bridge?.webTitle) continue
        webTitleTriedRef.current.add(e.id)
        bridge
          .webTitle(url)
          .then((data) => {
            if (data?.title && setWebTitle(e.id, data.title)) bump()
          })
          .catch(() => {})
        continue
      }
      webTitleTriedRef.current.add(e.id)
      fetch(`/api/web-title?url=${encodeURIComponent(url)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { title?: string | null } | null) => {
          if (data?.title && setWebTitle(e.id, data.title)) bump()
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- children/path identity + rev drive rescans
  }, [children, path, mounted, rev])

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
        case "firstname":
        case "lastname": {
          // Structured identity names — Individual-only, INDEPENDENT of the display title.
          // Empty clears the slot. Multi-word via quotes: `--lastName:"Van Der Berg"`.
          if (ent.kind !== "individual") {
            setNotice({ tone: "err", text: "only individuals have a first/last name" })
            return null
          }
          const isFirst = attr.field === "firstname"
          const label = isFirst ? "first name" : "last name"
          const set = isFirst ? setEntityFirstName : setEntityLastName
          if (val === "") {
            set(id, null)
            return `${label} cleared`
          }
          set(id, val)
          return `${label} ${val}`
        }
        case "parent": {
          // Add a PARENT link by resolving a typed name to an allowed being: Individual→Individual
          // (parent people); Organism→Organism OR Individual (its FOUNDERS — zero or more of each).
          // Empty `--parent:` clears all parents. Repeat the flag to add several.
          const parentKinds = parentKindsFor(ent.kind)
          if (parentKinds.length === 0) {
            setNotice({ tone: "err", text: "only individuals and organisms have parents" })
            return null
          }
          if (val === "") {
            setEntityParents(id, null)
            return "parents cleared"
          }
          const match = findEntityByTitle(val, parentKinds)
          if (!match) {
            const label = parentKinds.join(" or ")
            setNotice({ tone: "err", text: `no ${label} named "${val}"` })
            return null
          }
          if (match.id === id) {
            setNotice({ tone: "err", text: `a ${ent.kind} can't be their own parent` })
            return null
          }
          const current = (ent as IndividualEntity | OrganismEntity).parents ?? []
          if (current.includes(match.id)) return `already a parent: ${match.title}`
          setEntityParents(id, [...current, match.id])
          return `parent + ${match.title}`
        }
        case "sessionstart":
        case "sessionend": {
          // ACCESS-SESSION sugar (v0.6.19; retargeted v0.6.20) — the deliberate counterpart to the
          // occurrence --start/--end above. Corrects the current entity's OPEN ACCESS session (its
          // focus session): "I opened Cooking just now but I've actually been cooking 30min" ⇒
          // `--sessionStart:30min ago`. This is the MIDDLE (collapsed-ACCESS leaf-spine) rail, so
  // the edit slides the middle tick. It NEVER touches the top-rail schedule NOR the standalone
  // ACCESS rail (§2). NOTE: play-vs-focus precedence when a PLAY session is also
          // open is deferred open-item #2 — today it hits whatever `getOpenSession` returns.
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
            if (!hasOpenSession(ent)) {
              setNotice({ tone: "err", text: "no running session here to backdate" })
              return null
            }
            if (!setOpenSessionStart(id, when)) {
              setNotice({ tone: "err", text: "couldn't adjust the running session start" })
              return null
            }
            return `session start ${fmt(when)}`
          }
          // sessionend — close the running session (optionally at a past/`now` moment). Empty ⇒ now.
          if (!hasOpenSession(ent)) {
            setNotice({ tone: "err", text: "no running session here to end" })
            return null
          }
          if (!closeSession(id, undefined, when ?? Date.now())) {
            // v0.6.32: via undefined ⇒ end the last-open session of any rail (manual --sessionend debug cmd)
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
          // `--at` maps to startAt (not the `at` point anchor): any kind can be planned, so
          // `--at` plans the entity's START. On an INSTANT, setEntityScheduleField still
          // collapses startDate/endDate/at to the one epoch, so a point is unaffected.
          const key = ({ start: "startDate", end: "endDate", at: "startDate", due: "dueDate" } as const)[attr.field]
          // NOTE: `--start:whenever` is GONE (v0.7). Playability no longer rides on a startDate
          // sentinel — every idle {idea,task,resource,moment,space} is playable by kind, so
          // there's nothing to opt into. `--start` now only accepts a concrete time (or clear).
          let epoch: number | null = null
          if (val.toLowerCase() === "now") {
            // `--start:now` / `--end:now` / `--at:now` — stamp the shared batch instant.
            epoch = batchNow
          } else if (val !== "") {
            epoch = parseDateToken(val, batchNow)
            if (epoch == null) {
              setNotice({ tone: "err", text: `invalid time "${val}" — use HHMM, YYMMDD, YYMMDDHHMM, now, "5min ago", or "in 2h"` })
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
        case "repeat": {
          // RECURRENCE (v0.2.234) — `--repeat:daily` / `weekly` / `monthly` / `yearly` / `weekdays` /
          // `weekends`. Empty clears the rule (back to one-off). Sets schedule.repeat via setEntityRepeat,
          // which seeds startDate=now as the anchor if the entity has no time yet, so the §0 PLANNED
          // OCCURRENCES block immediately projects the series. Same path in create AND command mode.
          if (val === "") {
            setEntityRepeat(id, null)
            return "repeat cleared"
          }
          const rule = parseRepeatToken(val)
          if (!rule) {
            setNotice({ tone: "err", text: `use --repeat:daily | weekly | monthly | yearly | weekdays | weekends (got "${val}")` })
            return null
          }
          setEntityRepeat(id, rule)
          return `repeat ${val.toLowerCase()}`
        }
        default: {
          // BARE recurrence aliases — `--daily`, `--weekdays`, `--monthly`, etc. (no value) still work
          // as a friendly shorthand for `--repeat:<word>` before we treat the flag as unknown.
          const bareRule = attr.value === "" ? parseRepeatToken(attr.field) : null
          if (bareRule) {
            setEntityRepeat(id, bareRule)
            return `repeat ${attr.field}`
          }
          setNotice({
            tone: "err",
            text: `unknown --${attr.field} — try --start --end --at --due --duration --repeat --maxnb --maxnbhard --close --color --sex --firstName --lastName --parent --title`,
          })
          return null
        }
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
      // The entity's stored TITLE is the raw URL (the `--title`); the label shown in ENTITY
      // CONTENT + breadcrumb is the DISPLAYED title (webpage title / hostname), resolved from
      // `webUrl` + the best-effort fetched `webTitle` (see the web-title effect below).
      const createdResource = addWebResource({
        title: url,
        url,
        contextId: target,
        resourceId: resource?.id,
      })
      // Pre-warm the just-typed resource: creating it signals strong intent to open it next, so
      // start loading it hidden now → clicking it is an instant reveal. (No-op on web/non-WebView2.)
      prewarm(createdResource.id, url, resource?.id)
      if (!inline) setDraft("")
      bump()
      return createdResource.id // id so Ctrl/Cmd-Enter can open it
    }

    // Kind = explicit `:kind`, else the default (always TASK — scheduling flags no longer
    // flip the kind; any kind can be planned).
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
      const st = fresh.schedule?.startDate
      const en = fresh.schedule?.endDate
      // Only a CONCRETE start can form a cross-midnight span ("whenever" has no time).
      if (typeof st === "number" && en != null && en <= st) {
        setEntityScheduleField(created.id, "endDate", en + 86_400_000)
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
    return created.id // id so Ctrl/Cmd-Enter can open the new entity
  }, [draft, bump, contextId])

  // The TASK glyph click tree (v0.6.32). One button, STATE-DEPENDENT — Loris's model:
  //   • SPINNING (an open `play` = ongoing) ⇒ STOP it. Access/focus keeps ticking (ACCESS runs),
  //     so DURATION freezes while you stay and look. Drops it from playOpenRef.
  //   • RESTING + not done ⇒ mark DONE. (A stopped-but-undone task; clicking commits it.)
  //   • DONE ⇒ un-done. If you're still INSIDE it and it's now auto-play-eligible, resume ongoing
  //     immediately (the dwell effect won't re-fire on an unchanged path — this avoids the static-
  //     glyph bug where an in-place un-done stayed at rest until you navigated away and back).
  // Wired as `onToggleDone` (FaceGlyph routes hasDoneFlag kinds here). Non-task done-kinds, if any
  // ever exist, just fall through to the done toggle.
  const toggleDone = useCallback(
    (e: Entity) => {
      if (!KIND_META[e.kind].hasDoneFlag) return
      const openPlay = getOpenSession(e, "play")
      if (openPlay) {
        // v0.2.257 — spinning ⇒ STOP the played span (plain toggle, no pause/resume). `closeSession`
        // writes `stopped`, which the fold closes for any flavor even while you're still inside — so
        // the chip drops and your access keeps ticking. (Was: auto-in-place PAUSED, else stopped.)
        closeSession(e.id, "play")
        playOpenRef.current.delete(e.id)
        return bump()
      }
      const nowDone = !isDone(e)
      setTaskDone(e.id, nowDone)
      if (!nowDone && canAutoPlay(e) && path.includes(e.id)) {
        // Un-done in place while still viewing it → START a fresh played span now (`openSession`
        // → `started`). undone cleared the fold's `blocked`; a deliberate start restarts the session
        // immediately so the glyph spins again without needing to navigate away and back.
        if (openSession(e.id, "play")) playOpenRef.current.add(e.id)
      }
      bump()
    },
    [bump, path, contextId],
  )

  // PLAY / STOP on a PLAYABLE glyph (v0.7 — idea·task·resource·moment·space; task routes through
  // its DONE glyph instead, so this fires for the rest). Both open/close a `via:"play"` SESSION
  // (bottom rail). PLAYING records actual time on the bottom rail; it NEVER stamps the scalar
  // startAt/endAt (those stay the declared plan). Guarded by isPlayable so it no-ops on a
  // being/soul/instant. Reopen (ended entity) just opens a fresh play session — bringing it live.
  const togglePlay = useCallback(
    (e: Entity) => {
      // Glyph Play/Stop: only for a LIVE playable (isPlayable already excludes ended entities, so
      // the glyph never offers "reopen" — that verb lives on the right-click menu, which routes to
      // reopenEntity). togglePlaySession is fully kind-agnostic (idea·resource·moment·space; task
      // routes through its DONE glyph and never reaches here).
      if (isPlayable(e)) togglePlaySession(e)
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
      // Soft-delete is GUARDED (open/scheduled only) ��� deleteEntity returns false if blocked, in
      // which case there's nothing to climb out of or re-render.
      if (!deleteEntity(e.id)) return
      // If we're inside the entity being deleted, climb out of it first.
      setPath((p) => (p.includes(e.id) ? p.slice(0, p.indexOf(e.id)) : p))
      bump()
    },
    [bump],
  )

  const openEntity = useCallback((e: Entity) => {
    // A pre-warmed view the user is now actually opening becomes a real (warm/parked) view owned
    // by the resource canvas — promote it out of the pre-warm set so context-leave won't discard it.
    if (e.webUrl) {
      openedRef.current.add(e.id)
      prewarmedRef.current.delete(e.id)
    }
    // DRILL THROUGH THE FULL PATH (v0.2.282). The tree can surface DEEP descendants (a grandchild
    // shown under an expanded parent), so we must not blindly append the clicked id to the current
    // path — that skips the intermediate ancestors and the breadcrumb jumps straight root→leaf.
    // Instead rebuild the whole drill trail from root by walking `parentId` up (same logic as
    // `navigateTo`). For a DIRECT child this yields the identical `[...p, e.id]`; for a deeper
    // descendant it inserts every ancestor so the breadcrumb reads root / … / parent / leaf.
    if (e.id === ROOT_ID) {
      setPath([ROOT_ID])
      return
    }
    const chain: string[] = []
    let cursor: string | undefined = e.id
    const guard = new Set<string>() // cycle guard
    while (cursor && cursor !== ROOT_ID && !guard.has(cursor)) {
      guard.add(cursor)
      chain.unshift(cursor)
      cursor = getEntity(cursor)?.parentId ?? undefined
    }
    setPath([ROOT_ID, ...chain])
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

  // Switch a SIBLING at crumb depth `i` (from that crumb's left-hand caret): truncate the
  // path to that depth and swap in the chosen sibling. For the LEAF (i = last) this just
  // swaps the last crumb, keeping the prefix identical; for an ANCESTOR it re-roots to the
  // sibling branch (the deeper crumbs belonged to the old branch and can't carry over). The
  // `contextId`-effect then re-logs access, so the activity tracker refocuses as usual.
  const goToSiblingAt = useCallback((i: number, id: string) => {
    setPath((p) => [...p.slice(0, i), id])
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

  // PINS (§4) END — the spinning-glyph click (STAY here): end whatever makes the chip ongoing.
  // v0.2.257: no more in-place-vs-remote split. `endOngoing`→`closeSession("play")` now writes an
  // explicit `stopped`, which the fold closes for ANY flavor (auto or remote), so it correctly drops
  // the chip for the entity you're CURRENTLY viewing too — your access/focus session keeps running.
  // (Previously an in-place auto span re-derived as open after endOngoing, so it needed `pauseOngoing`.)
  const endPin = useCallback(
    (id: string) => {
      endOngoing(id)
      playOpenRef.current.delete(id)
      bump()
    },
    [bump],
  )

  // PINS (§4) START — deliberately open an session on a pinned/idle entity. `via:"play"`
  // (NOT "focus") so it's a DELIBERATE, PERSISTENT start: unlike a dwell focus session it is
  // not tracked in `focusOpenRef`, so navigating away never punches it out, and hydrate keeps
  // it running on reload. Idempotent (openSession no-ops if one is already open). `focus`
  // ⇒ also navigate the canvas onto it (a plain click on a pinned chip); otherwise it starts
  // in the BACKGROUND in parallel, staying on the current canvas.
  const startPin = useCallback(
    (id: string, focus: boolean) => {
      // v0.6.26: EVERY kind (moments/spaces included) opens a deliberate `via:"play"` SESSION
      // (bottom-rail work session). Previously moment/space went through startOccurrence, which
      // stamped scalar startAt/endAt — the phantom top-rail tick + countdown, and worse, endPin
      // (endOngoing) then couldn't stop it (a stamped future endAt made effectiveScheduleEnd
      // non-null). A play session is closed cleanly by endOngoing → the chip drops out.
      openSession(id, "play")
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
      // PLAN… (v0.2.269) — a VIEW action: open the scheduling dialog for this entity. Mutates
      // nothing here; the dialog resolves a PlanResult and applyPlan() runs the writers.
      if (id === "plan") {
        setPlanNow(Date.now())
        setPlanTarget(e)
        return
      }
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
      // RESTORE — undelete a soft-deleted CHILD (id = `restore:<childId>`, from the container's
      // Deleted submenu). Targets a DIFFERENT id than `e`, so it's intercepted here rather than
      // delegated to applyEntityMenuAction (which acts on e.id).
      if (id.startsWith("restore:")) {
        restoreEntity(id.slice("restore:".length))
        return bump()
      }
      // PURGE — the SECOND, permanent delete (id = `purge:<childId>`, from the container's
      // Restore-deleted submenu on an already-soft-deleted child). Hard-removes the entity and its
      // whole subtree from the store; irreversible. Same different-id interception as restore.
      if (id.startsWith("purge:")) {
        hardDeleteEntity(id.slice("purge:".length))
        return bump()
      }
      // STARTER PIN — curation, not entity data: add/remove from the global §4 PINNED list.
      // Handled here (like the view toggles) rather than via `applyEntityMenuAction`.
      if (id === "starter-pin" || id === "starter-unpin") {
        toggleStarterPin(e.id)
        return bump()
      }
      // PLAYABLE play/stop routes through togglePlaySession (v0.7 ��� idea·resource·moment·space; a
      // `via:"play"` session on the bottom rail, never the scalar occurrence) so the menu shares the
      // glyph's in-place-pause / remote-stop four-verb logic. (applyEntityMenuAction's plain
      // open/close is only a fallback for the native overlay, which lacks the in-place context.)
      if (isPlayable(e) && (id === "play" || id === "stop")) return togglePlaySession(e)
      applyEntityMenuAction(e, id)
      bump()
    },
    [bump, togglePlaySession],
  )

  // §0 PLANNED OCCURRENCES BLOCK actions (v0.2.229; primary cancellable v0.2.232; rule rows v0.2.234) —
  // the "+ add slot" writer + per-occurrence cancel. A typed callback (not a menu-action string) since
  // the payload carries parsed epochs / an explicit target. "add" → addOccurrence (definite only).
  // "cancel" routes by the row's `origin` (never a positional guess): a RULE row → setRuleOccurrenceCancelled
  // (writes/clears the exceptions[recurrenceId] patch — the restore-able virtual-instance cancel); a
  // DEFINITE row dispatches on its `primary` flag → cancelPrimaryOccurrence (records the primary as a
  // struck slot + promotes the next soonest live span) or setOccurrenceCancelled at its plannedOccurrences[]
  // index, which also handles RESTORE (cancelled=false). All re-render via bump().
  const runScheduleAction = useCallback(
    (e: Entity, action: OccurrenceAction) => {
      if (action.type === "add") {
        addOccurrence(e.id, action.start, action.end)
      } else if (action.type === "repeat") {
        // "12h daily"-style add-slot (v0.2.235) — sets the PRIMARY rule, with any parsed time as the anchor.
        setEntityRepeat(e.id, action.repeat, action.start != null ? { start: action.start, end: action.end } : undefined)
      } else if (action.type === "addSeries") {
        // ADDITIONAL series (v0.2.246) — add-slot rule typed when a primary already exists; appends a new
        // self-anchored series rather than overwriting the primary, so multiple series co-exist.
        addSeries(e.id, action.repeat, action.start != null ? { start: action.start, end: action.end } : undefined)
      } else if (action.type === "clearRepeat") {
        // "stop repeating" (v0.2.239): ruleId set ⇒ remove that additional series (v0.2.246); absent ⇒
        // drop the primary rule so the block stops projecting the infinite primary series.
        if (action.ruleId != null) removeSeries(e.id, action.ruleId)
        else setEntityRepeat(e.id, null)
      } else if (action.type === "cancel") {
        if (action.origin === "rule") setRuleOccurrenceCancelled(e.id, action.recurrenceId, action.cancelled, action.ruleId)
        else if (action.primary) cancelPrimaryOccurrence(e.id)
        else setOccurrenceCancelled(e.id, action.occIndex, action.cancelled)
      } else if (action.type === "delete") {
        // Hard removal (v0.2.240): rule → a `removed` EXDATE that drops the instance from the projection
        // (v0.2.246: scoped to `ruleId`'s series when set); definite → splice the plannedOccurrences[]
        // slot, or clear the scalar primary (occIndex −1).
        if (action.origin === "rule") deleteRuleOccurrence(e.id, action.recurrenceId, action.ruleId)
        else deleteOccurrence(e.id, action.primary ? -1 : action.occIndex)
      } else if (action.type === "edit") {
        // Per-occurrence TIME edit (v0.2.248) — the new start/end already carry the occurrence's day.
        // rule → exceptions[day].start/end override (ruleId-scoped for a series); definite → the scalar
        // span (occIndex −1, non-recurring only) or a plannedOccurrences[] slot.
        if (action.origin === "rule") setRuleOccurrenceTime(e.id, action.recurrenceId, action.start, action.end, action.ruleId)
        else setDefiniteOccurrenceTime(e.id, action.primary ? -1 : action.occIndex, action.start, action.end)
      } else if (action.type === "cancelAll") {
        // "cancel all" on the one-off list (v0.2.240) — cancels every not-yet-ended definite occurrence.
        cancelAllDefiniteOccurrences(e.id)
      }
      bump()
    },
    [bump],
  )

  // RECORDED-SESSION edit/delete dispatch (v0.2.293) — the past-tense counterpart of runScheduleAction,
  // for the §0 RECORDED SESSIONS list (and the dayline recorded ticks). Both actions are keyed by the
  // session's `anchorId` (the fold's correction handle) and route to the append-only log writers:
  //   • editSession   → appends a `session-edit` overlay carrying the corrected start/end.
  //   • deleteSession → appends a `session-delete` tombstone.
  //   • addSession    → appends a `session` Instant (v0.2.294) so the fold materializes a new anchored
  //                     `via:"play"` session — for logging work done OUTSIDE Zero. The writer clamps
  //                     start ≤ now / end ≥ start; both bounds are passed (a manual session is closed).
  // The writers guard that the anchor still resolves to a recorded session, so a stale dispatch no-ops.
  const runSessionAction = useCallback(
    (e: Entity, action: SessionAction) => {
      if (action.type === "editSession") editSession(e.id, action.anchorId, action.start, action.end)
      else if (action.type === "deleteSession") deleteSession(e.id, action.anchorId)
      else if (action.type === "addSession") addManualSession(e.id, action.start, action.end)
      bump()
    },
    [bump],
  )

  // APPLY a Plan-dialog result (v0.2.269) against the existing writers, then close + re-render. The
  // dialog already decided tense (future ⇒ occurrence, past ⇒ session) and shape; this just routes:
  //   • occurrence → addOccurrence (a planned one-off, top-rail)
  //   • repeat     → setEntityRepeat (first rule) OR addSeries (entity already has a rule) — matches
  //                  the runScheduleAction primary-vs-series split so a 2nd recurring plan co-exists.
      //   • timeblocks → setEntityTimeblocks (a multi-span day; optional repeat makes the day recurring)
      //   • duration   → setEntityDuration (an unanchored length in minutes; no start/end)
      //   • session    → addManualSession (a recorded/ongoing session, bottom rail; end omitted = ongoing)
  //   �� due        → setEntityScheduleField("dueDate")
  const applyPlan = useCallback(
    (target: Entity, result: PlanResult) => {
      if (result.kind === "occurrence") addOccurrence(target.id, result.start, result.end)
      else if (result.kind === "repeat") {
        const s = target.schedule
        const hasRule = !!s?.repeat || !!(s?.series && s.series.length)
        const anchor = { start: result.start, end: result.end }
        if (hasRule) addSeries(target.id, result.repeat, anchor)
        else setEntityRepeat(target.id, result.repeat, anchor)
      } else if (result.kind === "timeblocks") {
        setEntityTimeblocks(target.id, result.timeblocks, result.repeat)
      } else if (result.kind === "duration") {
        setEntityDuration(target.id, result.minutes)
      } else if (result.kind === "session") addManualSession(target.id, result.start, result.end)
      else if (result.kind === "due") setEntityScheduleField(target.id, "dueDate", result.due)
      setPlanTarget(null)
      bump()
    },
    [bump],
  )

  // STABLE dialog handlers (v0.2.271) — pass referentially-stable props to the memoized dialog so a
  // per-second parent re-render never reaches it. Both read the CURRENT target via planTargetRef, so
  // neither depends on `planTarget` (which changes on open/close).
  const handlePlanApply = useCallback(
    (result: PlanResult) => {
      const t = planTargetRef.current
      if (t) applyPlan(t, result)
    },
    [applyPlan],
  )
  const closePlan = useCallback(() => setPlanTarget(null), [])

  // REMOVE an existing repeat rule from inside the dialog (v0.2.275) — null = primary `repeat`
  // (setEntityRepeat(id, null)), a string = a series id (removeSeries). The dialog STAYS OPEN so more
  // can be removed; we re-set planTarget to a FRESH clone so the memoized dialog re-renders and its
  // existing-rules list drops the removed row (both writers assign a new schedule reference). Stable
  // (reads planTargetRef, no planTarget dep) to keep the dialog's React.memo effective.
  const handleRemoveRule = useCallback(
    (ruleId: string | null) => {
      const t = planTargetRef.current
      if (!t) return
      if (ruleId === null) setEntityRepeat(t.id, null)
      else removeSeries(t.id, ruleId)
      // Re-fetch the (in-place-mutated) live entity and pass a fresh clone so the memoized dialog
      // re-renders with the updated schedule; keep the dialog open when rules remain, close if none.
      const fresh = getEntity(t.id)
      setPlanTarget(fresh ? { ...fresh } : null)
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
          // The soft-deleted children AT THIS entity — feeds the "Deleted (N)" restore submenu.
          // Present on every menu, but only renders when this entity actually has deleted kids
          // (chiefly the ENTITY CONTENT / context right-click, which targets the open node).
          deletedChildren: getDeletedChildren(e.id).map((d) => ({ id: d.id, title: d.title, kind: d.kind })),
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

  // Drop-INTO-nest: move an entity so it becomes a child of another (drag a row onto the
  // middle of another row). No-op on self/cycle (guarded in moveEntityToContext).
  const reparent = useCallback(
    (entityId: string, newContextId: string) => {
      const ok = moveEntityToContext(entityId, newContextId)
      if (ok) bump()
      return ok
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
      reparent,
    }),
    [toggleDone, togglePlay, mark, openEntity, remove, openMenu, sizeOf, makeOf, showHidden, nowSec, rev, expandedIds, toggleExpand, createChild, reorder, reparent],
  )

  // (The top-level Content's ancestry Set is now built PER-LEVEL at the render site — each
  // <Zero0ContextPane> gets `new Set(path.slice(0, i+1))`, the prefix up to its own level, so
  // its content can't re-drill into one of its own breadcrumb ancestors.)

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

  // Right-click a TOP-rail (planned) dayline tick → the PER-OCCURRENCE menu (v0.2.249), mirroring the §0
  // block's chip/row menu: Edit time · Cancel/Restore · Delete, all dispatched through the SAME
  // `runScheduleAction` using the occurrence's own dispatch identity (`occ`). EDIT navigates to the entity
  // (the inline time editor lives in the §0 block; the dayline hosts no text input this pass) — every other
  // verb acts in place. EDIT time + CANCEL are BOTH available for ANY occurrence incl. PAST (v0.2.287 edit,
  // v0.2.294 cancel) — mirrors the §0 block. Cancel is a reversible tombstone so it needn't be future-gated;
  // a visible dayline tick is never already-cancelled (cancelled occurrences don't render), so "Cancel".
  const openOccurrenceMenu = useCallback(
    (entityId: string, occ: DaylineOccRef, ev: React.MouseEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      const e = getEntity(entityId)
      if (!e) return
      const items: MenuItem[] = [
        { type: "item", id: "edit", label: "Edit time" },
        { type: "item", id: "cancel", label: "Cancel" },
      ]
      items.push({ type: "item", id: "delete", label: "Delete", danger: true })
      showMenu(items, ev.clientX, ev.clientY, (id) => {
        if (id === "edit") {
          navigateTo(entityId) // open the entity; per-occurrence time editing lives in its §0 block
        } else if (id === "cancel") {
          runScheduleAction(
            e,
            occ.origin === "rule"
              ? { type: "cancel", origin: "rule", recurrenceId: occ.recurrenceId!, cancelled: true, ruleId: occ.ruleId }
              : { type: "cancel", origin: "definite", primary: occ.occIndex === -1, occIndex: occ.occIndex, cancelled: true },
          )
        } else if (id === "delete") {
          runScheduleAction(
            e,
            occ.origin === "rule"
              ? { type: "delete", origin: "rule", recurrenceId: occ.recurrenceId!, ruleId: occ.ruleId }
              : { type: "delete", origin: "definite", primary: occ.occIndex === -1, occIndex: occ.occIndex },
          )
        }
      })
    },
    [showMenu, navigateTo, runScheduleAction],
  )

  // RECORDED-SESSION dayline menu (v0.2.293) — the bottom-rail mirror of openOccurrenceMenu. Right-click a
  // recorded tick that carries a session anchor → Edit time / Delete for THAT session. "Edit time" opens
  // the entity so the correction happens in its §0 RECORDED SESSIONS inline editor (exactly like the
  // occurrence menu routes edits to §0); "Delete" dispatches the tombstone writer directly.
  const openSessionMenu = useCallback(
    (entityId: string, anchorId: number, ev: React.MouseEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      const e = getEntity(entityId)
      if (!e) return
      const items: MenuItem[] = [
        { type: "item", id: "edit", label: "Edit time" },
        { type: "item", id: "delete", label: "Delete", danger: true },
      ]
      showMenu(items, ev.clientX, ev.clientY, (id) => {
        if (id === "edit") navigateTo(entityId)
        else if (id === "delete") runSessionAction(e, { type: "deleteSession", anchorId })
      })
    },
    [showMenu, navigateTo, runSessionAction],
  )

  // COMMIT a dayline DRAG re-time (v0.2.286). The dayline hands back the occurrence identity + the
  // new absolute start/end (already minute-rounded); this routes to the SAME per-occurrence TIME
  // writers the "Edit time" menu uses (setRuleOccurrenceTime / setDefiniteOccurrenceTime via the
  // `edit` action), so a drag and a manual §0 edit are one code path.
  const retimeOccurrence = useCallback(
    (entityId: string, occ: DaylineOccRef, start: number, end: number) => {
      const e = getEntity(entityId)
      if (!e) return
      runScheduleAction(
        e,
        occ.origin === "rule"
          ? { type: "edit", origin: "rule", recurrenceId: occ.recurrenceId!, start, end, ruleId: occ.ruleId }
          : { type: "edit", origin: "definite", primary: occ.occIndex === -1, occIndex: occ.occIndex, start, end },
      )
    },
    [runScheduleAction],
  )

  // COMMIT a dayline DRAG re-time of a RECORDED session (v0.2.294) — the bottom-rail mirror of
  // retimeOccurrence. The dayline hands back the session anchor + new absolute start/end (minute-rounded);
  // this routes to the SAME `editSession` writer the §0 inline editor + the per-session menu use, so a
  // handle-drag and a manual edit are one code path.
  const retimeSession = useCallback(
    (entityId: string, anchorId: number, start: number, end: number) => {
      const e = getEntity(entityId)
      if (!e) return
      runSessionAction(e, { type: "editSession", anchorId, start, end })
    },
    [runSessionAction],
  )

  // SIBLINGS dropdown �� opened from the caret to the LEFT of a crumb (any depth except root).
  // Lists ALL entities at that crumb's level (its parent's children, INCLUDING the current one,
  // marked), in their stable child order. Listing all — not just the "others" — means the menu's
  // contents + order NEVER change as you switch: only which row is marked current moves. Picking
  // one drills laterally at that depth (goToSiblingAt; picking the current is a harmless no-op).
  // Routed through `showMenu`, so over a web Resource it draws in the native overlay (unoccluded).
  const openSiblingsAt = useCallback(
    (i: number, ev: React.MouseEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      const parent = i > 0 ? path[i - 1] : undefined
      const sibs = parent ? getChildren(parent) : []
      if (sibs.length < 2) return
      const current = path[i]
      const items: MenuItem[] = sibs.map((s) => ({
        type: "item",
        id: s.id,
        // A web resource sibling reads as its DISPLAYED title (page title for long URLs, else the
        // URL) cropped to a max width, not the raw stored URL.
        label: s.webUrl
          ? webLabel({ webUrl: s.webUrl, webResourceId: s.webResourceId, webTitle: s.displayTitle, title: s.title }).display
          : s.title,
        glyphKind: s.kind,
        current: s.id === current,
      }))
      showMenu(items, ev.clientX, ev.clientY, (id) => goToSiblingAt(i, id))
    },
    [path, showMenu, goToSiblingAt],
  )

  // Detect the Electron desktop shell (only there do native web views occlude the DOM).
  useEffect(() => {
    setIsDesktop(typeof window !== "undefined" && !!window.zero?.menu)
    // Adopt the REAL shipped version from the desktop bridge (falls back to ZERO_VERSION on
    // web / older shells). app.getVersion() has no "v" prefix, so add one to match the tag.
    const real = typeof window !== "undefined" ? window.zero?.appVersion : null
    if (real) setDisplayVersion(real.startsWith("v") ? real : `v${real}`)
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
    <nav className="flex flex-wrap items-center" aria-label="Breadcrumb">
      {displayCrumbs.map((c) => {
        // A `leaving` crumb is animating out — never treat it as the current page.
        const last = c.isLast && c.state !== "leaving"
        const isRoot = c.idx === 0
        return (
          // WRAP + INNER = the enter/exit collapse. `.zero0-crumb-wrap` is a grid that animates
          // its column 1fr↔0fr (with opacity), so a crumb grows IN / shrinks OUT to its content
          // width, pushing the rest of the trail smoothly instead of snapping. `.zero0-crumb-inner`
          // clips the overflow during the collapse. `data-state` drives it (see globals.css).
          <span key={c.id} className="zero0-crumb-wrap" data-state={c.state}>
            <span className="zero0-crumb-inner">
              <span
                className="zero0-crumb flex items-center gap-1"
                onContextMenu={(ev) => {
                  // Right-click a crumb → THAT entity's menu (same as its row). Handled on the
                  // span so it fires even for the current/last crumb, whose button is disabled.
                  const ent = getEntity(c.id)
                  if (ent) openMenu(ent, ev)
                }}
              >
                {/* SEPARATOR "/" — doubles as the SIBLING switcher AND carries the inter-crumb
                    spacing (ml) so it collapses WITH the crumb (nav has no flex gap anymore).
                    The "/" preceding a crumb (any depth except root) opens a dropdown of ALL
                    entities at THAT crumb's level (openSiblingsAt), current one marked; picking
                    one drills laterally at this depth. Interactive only when siblingCount > 1;
                    otherwise a plain muted "/". */}
                {!isRoot &&
                  (c.siblingCount > 1 ? (
                    <button
                      type="button"
                      onClick={(ev) => openSiblingsAt(c.idx, ev)}
                      aria-label={`Switch sibling (${c.siblingCount} at this level)`}
                      title="Switch sibling"
                      className="ml-1 mr-0.5 text-muted-foreground/50 hover:text-foreground"
                    >
                      /
                    </button>
                  ) : (
                    <span className="ml-1 mr-0.5 text-muted-foreground/50" aria-hidden>
                      /
                    </span>
                  ))}
                {c.webUrl && <Zero0Favicon url={c.webUrl} resourceId={c.webResourceId} />}
                <button
                  type="button"
                  onClick={() => goToCrumb(c.idx)}
                  disabled={last}
                  aria-current={last ? "page" : undefined}
                  title={c.tooltip}
                  className={`inline-block max-w-[14rem] truncate align-bottom ${
                    last
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  }`}
                >
                  {c.label}
                </button>
                {/* CLOSE — to the RIGHT of every crumb except root. Hidden with zero footprint at
                    rest (`.zero0-crumb-close` in globals.css), fades + expands in on crumb hover,
                    pushing the following "/" and deeper crumbs right. Closes THAT entity: parks/
                    destroys its web view and climbs the path out (closeContext). */}
                {!isRoot && (
                  <Zero0CloseButton
                    iconClassName="h-2 w-2"
                    className="zero0-crumb-close"
                    onClick={() => {
                      const ent = getEntity(c.id)
                      if (ent) closeContext(ent)
                    }}
                  />
                )}
              </span>
            </span>
          </span>
        )
      })}
    </nav>
  )

  // SIBLING TAB STRIP (v0.2.291) — a horizontal row of the leaf's peers (glyph/favicon + title,
  // title cropped to 15 chars), rendered ABOVE the breadcrumb whenever §1 is shown (v0.2.300).
  // Clicking a tab switches laterally at the leaf depth (goToSiblingAt); the current leaf's tab is
  // the active, non-interactive one. Suppressed unless there are ≥2 peers (matches the crumb caret's
  // gate). `mb-1.5` puts the gap BELOW the strip (toward the breadcrumb) now that it sits on top.
  const leafDepth = path.length - 1
  const siblingTabs =
    leafSiblings.length > 1 ? (
      <nav className="mb-1.5 flex flex-wrap items-center gap-1" aria-label="Sibling entities">
        {leafSiblings.map((s) => {
          const isCurrent = s.id === path[leafDepth]
          const rawLabel = s.webUrl
            ? webLabel({ webUrl: s.webUrl, webResourceId: s.webResourceId, webTitle: s.displayTitle, title: s.title }).display
            : s.title
          // Hard 15-char cap per the request (the breadcrumb uses width-based cropTitle; here it's an
          // explicit character budget so tabs stay uniformly short regardless of font metrics).
          const label = rawLabel.length > 15 ? rawLabel.slice(0, 14) + "…" : rawLabel
          const gm = s.webUrl ? null : getFaceModel(s, Date.now())
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => goToSiblingAt(leafDepth, s.id)}
              onContextMenu={(ev) => openMenu(s, ev)}
              disabled={isCurrent}
              aria-current={isCurrent ? "page" : undefined}
              title={rawLabel}
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-none transition-colors ${
                isCurrent
                  ? "border-border text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {s.webUrl ? (
                <Zero0Favicon url={s.webUrl} resourceId={s.webResourceId} />
              ) : (
                gm && (
                  <Zero0Glyph
                    kind={s.kind}
                    filled={gm.filled}
                    done={gm.done}
                    cancelled={gm.cancelled}
                    requested={gm.requested}
                    // v0.2.292: the tab glyph is now DYNAMIC like the §0 face — it SPINS while the
                    // sibling is ongoing and thickens while scheduled — and is sized h-3.5 to match the
                    // favicon, so the "icon next to title" reads uniformly across web + native tabs.
                    ongoing={gm.ongoing}
                    scheduled={gm.scheduled}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                )
              )}
              {/* MANUAL color marker — a small dot when the sibling has an explicitly-set accent
                  (own color only; inherited colors deliberately not shown — matches the §0 face row). */}
              {s.color && (
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
              )}
              <span className="max-w-[8rem] truncate">{label}</span>
            </button>
          )
        })}
      </nav>
    ) : null

  return (
    <main
      className="relative flex h-screen flex-col bg-background text-foreground"
      style={{ fontFamily: "var(--font-zero0-mono), ui-monospace, monospace" }}
    >
      {/* ── GLUED TOP: live clock ───────��──��───────�����─���───���───────────────────���─
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

      {/* ── §4 PINS BAND (topmost, just under the clock) ─────────────────────────
          The §4 frame: a horizontal row of colored chips for every ONGOING entity (glyph
          + title). Click a chip to drill in; click its spinning glyph to END it. Like every
          other § frame it is a STRICT show/hide TOGGLE (the `frequent` flag, via §4 chord /
          footer / frame marker) — v0.2.228 dropped the old auto-show-when-ongoing so ��4 can
          both hide AND display it. Ongoing chips populate it live while it's open. (Named
          "PINS" because you can pin a chip so it lingers here after it stops being ongoing.) */}
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

      {/* ── AGENDA BAND (topmost, "TODAY") ─────────────────���─────��─────────���────
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
            onOccurrenceMenu={openOccurrenceMenu}
            onSessionMenu={openSessionMenu}
            onOccurrenceRetime={retimeOccurrence}
            onSessionRetime={retimeSession}
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
          The BACKWARD-looking frame ��� WHERE the user has been today (access dayline
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

      {/* ── ZERO HEADER (§1) ─────────������────────────���───��───────────────────────
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
        {/* IDENTITY LINE removed (v0.2.291); the build VERSION moved onto the breadcrumb row itself
            (v0.2.292) so it no longer costs a standalone band above — reclaiming that vertical space. */}
        {/* MINIMIZED — the breadcrumb (with its trailing SIBLINGS chevron) sharing its row with the
            right-aligned build VERSION, then the sibling-tab strip beneath. Toggled via the frame menu. */}
        {mounted && minimized.zeroHeader && (
          <>
            {/* SIBLING TABS — the lateral-switch strip, ABOVE the breadcrumb even in the tight view. */}
            {siblingTabs}
            <div className="flex items-center gap-2">
              {breadcrumb}
              {/* BUILD VERSION — right-aligned on the breadcrumb row; still the top row shown in
                  web-resource view, so it stays in view there. */}
              <span className="ml-auto shrink-0 text-muted-foreground/70" title="Build version">
                {displayVersion}
              </span>
              {/* CLOSE for a WEB RESOURCE — after the version. §0's × is hidden while the web surface
                  is up, so this is the explicit-close gesture for a resource. */}
              {context?.webUrl && <Zero0CloseButton className="shrink-0" onClick={() => closeContext(context)} />}
            </div>
          </>
        )}
        {/* FULL — the session readout as a labelled meta block. CONTEXT is the breadcrumb
            itself (the crumb trail IS the context, and its trailing chevron opens the
            SIBLINGS dropdown �� so there's no separate reshuffling siblings row), then
            STORE/ENTITIES. Matches the ENTITY HEADER meta exactly (`7.5rem` label col +
            left-packed values) so the two blocks align as one column. The 7.5rem width (up
            from 6rem, v0.2.147) lets the longest §0 label — "PLANNED DURATION" — sit on one
            line instead of wrapping. Over a web surface only CONTEXT shows (STORE/ENTITIES are
            session/debug detail that would overcrowd the clean breadcrumb-over-site view); the
            header sits ABOVE the web-view holder, so its rows push the tracked surface down. */}
        {/* SIBLING TABS — same lateral-switch strip in the full view, ABOVE the CONTEXT/breadcrumb row. */}
        {mounted && !minimized.zeroHeader && siblingTabs}
        {mounted && !minimized.zeroHeader && (
          <dl className="grid grid-cols-[7.5rem_1fr] gap-x-4 gap-y-0.5">
            <dt className="uppercase tracking-widest">context</dt>
            <dd className="flex min-w-0 items-center gap-2">
              {breadcrumb}
              {/* BUILD VERSION — right-aligned on the CONTEXT row (v0.2.292), sharing the breadcrumb's
                  line rather than sitting on a standalone band above. Still the top row shown in
                  web-resource view. */}
              <span className="ml-auto shrink-0 text-muted-foreground/70" title="Build version">
                {displayVersion}
              </span>
              {/* CLOSE for a WEB RESOURCE — after the version, still far-right on the breadcrumb row.
                  §0's × is replaced by the web surface, so this is the resource's close gesture. */}
              {context?.webUrl && <Zero0CloseButton className="shrink-0" onClick={() => closeContext(context)} />}
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
        {/* SEAM SHADOW note: over a web view the seam shadow is a SINGLE element in the §0 wrapper
            (web-view block below), pinned to that wrapper's animating bottom edge so it rides the
            seam continuously — at §0's bottom when open, gliding up to right under this header as §0
            collapses. No separate header-anchored shadow is needed (it would cause a jump on toggle).
            See Zero0WebSeamShadow for why it's an in-airspace gradient, not a box-shadow onto the
            (natively-composited) page. */}
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
      {/* CONTENT AREA — the drill-in stack. Each NON-WEB level of `path` renders its own
          keep-alive <Zero0ContextPane>; ancestor levels stay mounted-hidden via <Activity>
          (state + scroll preserved, effects paused) so climbing back out is instant and
          remembers where you were, and future heavier ENTITY CONTENT never re-mounts on a
          switch. If the current leaf is a web resource, its native surface renders on top of
          the (all-hidden) DOM panes. `relative flex-col` so the one visible pane fills via
          `flex-1` while hidden ones (display:none) drop out of layout. */}
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
        // AWAY-RESUME (v0.2.302): a pointer-down anywhere in ENTITY CONTENT re-arms ongoing after a
        // long absence. Capture phase so it fires before the click's own handler (row open, etc.);
        // a no-op unless `awayArmed`, so normal clicks are unaffected. This is the ONE gesture that
        // brings the leaf + ancestor path back to ongoing — mere window focus does not.
        onPointerDownCapture={resumeFromAway}
      >
        {/* v0.2.266: `overflow-y-auto` makes the web content area SCROLL like a non-web pane. With
            the web §0 shown, §0 sits at natural height on top and the web surface (h-full below)
            starts below the fold — you scroll §0 up to pull the web rect into view, exactly like
            ENTITY CONTENT on a non-web entity. Before this the web surface was `flex-1` and a tall
            §0 (raw fields + log) squeezed it to zero, so the site "wasn't displayed at all". The
            native surface is clamped to this scrollport (see NativeSurface.rectOf) so it never
            paints over the footer while scrolled. */}
        {/* SEAM SHADOW note: the web-surface seam shadow now lives at the BOTTOM of the zero
            header (see above) — a 10px internal gradient in the header's airspace. Nothing can
            paint here at the content-area top because the native surface composites OVER it. */}
        {mounted &&
          path.map((id, i) => {
            const e = getEntity(id)
            // Web levels have no DOM pane — they're shown by the native surface below.
            if (!e || e.webUrl) return null
            const active = i === path.length - 1
            return (
              <Activity key={id} mode={active ? "visible" : "hidden"}>
                <Zero0ContextPane
                  entity={e}
                  isRootLevel={i === 0}
                  showEntityHeader={showEntityHeader}
                  nowSec={nowSec}
                  mounted={mounted}
                  // Ancestry = the path PREFIX up to this level, so the pane's content can't
                  // re-drill into one of its own ancestors (cycle guard) while still allowing
                  // the next drilled level (a descendant) to expand normally.
                  ancestry={new Set(path.slice(0, i + 1))}
                  ctx={contentCtx}
                  onToggleDone={toggleDone}
                  onTogglePlay={togglePlay}
                  onMark={mark}
                  onContextMenu={openMenu}
                  onScheduleAction={runScheduleAction}
                  onSessionAction={runSessionAction}
                  onClose={closeContext}
                />
              </Activity>
            )
          })}
        {mounted && context?.webUrl && (
          <>
            {/* §0 OVER WEB — the resource's OWN entity header, shown in normal flow ABOVE the web
                rect when the §0 flag is on (chord `§0` / footer toggles it). Face-header ONLY (no
                child ENTITY CONTENT list — the web page IS the content).
                Kept MOUNTED and collapsed via the SAME grid-rows 1fr↔0fr trick the non-web §0
                (Zero0ContextPane) uses — so toggling §0 SMOOTHLY grows/shrinks it (300ms ease-out)
                instead of popping, and the native surface below follows the animating rect frame-by
                -frame via its rAF rect tracker. `inert` drops it from tab/hit-testing when collapsed.
                THE SEAM SHADOW is a SINGLE element pinned to the BOTTOM of this `relative` wrapper
                (sibling to the overflow-clip, so it's NOT clipped by the collapse). Because the
                wrapper's height animates natural↔0, `bottom-0` RIDES the seam up continuously: at
                §0's bottom while open, gliding to the content-top (right under §1) as it collapses —
                one unbroken shadow, no jump from §0 to §1. */}
            <div
              className="relative grid shrink-0 transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
              style={{ gridTemplateRows: showEntityHeader ? "1fr" : "0fr" }}
              inert={!showEntityHeader}
            >
              <div className="overflow-hidden">
                <Zero0EntityHeaderBlock
                  entity={context}
                  isRootLevel={path.length <= 1}
                  nowSec={nowSec}
                  onToggleDone={toggleDone}
                  onTogglePlay={togglePlay}
                  onMark={mark}
                  onContextMenu={openMenu}
                  onScheduleAction={runScheduleAction}
                  onSessionAction={runSessionAction}
                  onClose={closeContext}
                />
              </div>
              <Zero0WebSeamShadow />
            </div>
            {/* The native web surface. v0.2.266: `shrink-0 h-full` (was `flex-1`) so it's ALWAYS a
                full content-viewport tall — when §0 is hidden it fills the area exactly; when §0 is
                shown it sits a full viewport below the fold and the container scrolls to reveal it,
                instead of being crushed to zero by a tall §0. The native desktop view tracks THIS
                rect (clamped to the scrollport so it never spills over the footer). */}
            <div
              className="relative h-full shrink-0 overflow-hidden"
              onContextMenu={(ev) => openMenu(context, ev)}
            >
              <Zero0ResourceCanvas
                key={context.id}
                id={context.id}
                url={context.webUrl}
                resourceId={context.webResourceId}
                envKey={getEnvKey(context.id)}
              />
            </div>
          </>
        )}
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
              // Ctrl/Cmd-Enter = create AND drill straight into the new entity; plain Enter
              // creates and stays here. (No-op for command-mode lines, which return no id.)
              const openIt = ev.ctrlKey || ev.metaKey
              const createdId = create()
              if (openIt && createdId) navigateTo(createdId)
            }}
            placeholder="create entity…  (⌘/Ctrl-Enter to create & open   ·   try:  :mome Sleep --start:2330   ·   :done   ·   --color)"
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            aria-label="Create entity"
          />
        </div>
        {/* --color PICKER — the SHARED Zero0ColorField (swatch ramp + "hex or name…" field that
            reveals the HSV picker on focus), identical to the right-click "Set color" menu (v0.2.149).
            Surfaces while the draft reads "--color[:<hex>]". A swatch/typed/picked color fills the
            draft ("--color:<hex>") — which still matches the (broadened) trigger, so it stays open;
            the create input's own Enter commits the whole command (so NO onCommit here, and
            keepFocusOnSwatch keeps the create field focused so that Enter still fires). */}
        {isColorPickerTrigger(draft) && (
          <div className="mt-1.5 pl-4">
            <Zero0ColorField
              keepFocusOnSwatch
              seedHex={draftColorHex(draft)}
              onApply={(hex) => setDraft(`--color:${hex.replace(/^#/, "")}`)}
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

      {/* ── BOTTOM HELPER ────────────────────────────────────────────────────��─
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
        {/* Doc links — plain anchors, not frame toggles. `entities` = the interactive
            "bible of entities" table; `features` = the marketing-facet feature tour;
            `sugars` = the create-bar grammar reference. */}
        <a
          href="/entities"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          entities
        </a>
        <a
          href="/features"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          features
        </a>
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

      {/* PLAN dialog (v0.2.269) — opened by the entity right-click "Plan…". Centered modal over a
          dimmed canvas; `nowSec` (live ms clock) drives its future-vs-past tense split. */}
      {planTarget && (
        <Zero0PlanDialog
          entity={planTarget}
          now={planNow}
          onApply={handlePlanApply}
          onClose={closePlan}
          onRemoveRule={handleRemoveRule}
        />
      )}
    </main>
  )
}
