"use client"

import type React from "react"
import { useMemo, useRef, useState } from "react"
import { Zero0Glyph } from "./zero0-glyph"
import {
  getFaceModel,
  getFaceMetaRows,
  getScheduleCells,
  getAccessCells,
  getPlayedCells,
  filterMetaRows,
  faceModelFromLike,
  getAggregate,
  aggregateEcho,
  aggregateMetaRows,
  makeRendersDistinctly,
  type FaceModel,
  type FaceLike,
  type FaceSize,
  type FaceMake,
} from "@/lib/zero/face-model"
import type { Entity } from "@/lib/zero/types"

/**
 * `<Zero0Face>` — the excerpt SIDE of an entity, rendered at a SIZE (the other side
 * is Content — its children). See /excerpts. This is stage (a) of the unification:
 * the §0 block and every ENTITY CONTENT row are now ONE component at two rungs.
 *
 * What's shared across every size (the honesty test paying off):
 *   • the PRESENTATION MODEL (`getFaceModel`) — glyph fill, done check, cancel bar,
 *     ongoing rotation, state word, inline meta echo — derived ONCE, in `face-model`.
 *   • the GLYPH CELL (`FaceGlyph`) — the button-if-done-able / span-otherwise wrapper
 *     around `<Zero0Glyph>`, defined ONCE here. Previously duplicated, with latent
 *     drift (§0 omitted `ongoing`, read `isCancelled()` directly); now unified.
 *
 * What varies by size is only the ARRANGEMENT — which fields, in what order, at what
 * scale — because "a size is a curated projection." The full ladder is drawn:
 *   • `xs`   — glyph + title only. PROJECTION-friendly (renders from a `FaceLike`, no
 *              live Entity needed), which is what lets ACTIVITY presence render as Faces.
 *   • `s`    — one line: glyph + title + state word.
 *   • `m`    — the standard ENTITY CONTENT row (glyph · accent · title · echo · state).
 *   • `l`/`xl`/`full` — BLOCK cards (identity line + a meta dl), via the shared FaceBlock.
 *              `l` = temporal essentials, `xl` = all but raw provenance, `full` = §0's
 *              complete record. The block rungs FILTER the same §0 rows, so they can never
 *              drift from §0 — a row can literally grow into the full face (the recursion).
 *
 * A Face renders from ONE resolved `FaceModel`, sourced from an `entity` (full lifecycle),
 * a `faceLike` projection (inert lifecycle), or an explicit `model`. The entity rungs
 * (`m`/`full`) require an entity; the projection rung (`xs`) does not.
 *
 * Content-side chrome stays in the canvas: the `<li>`/collapse wrapper, the row index,
 * the delete ×, hover-to-highlight, the §0 collapse + life log + frame marker. The Face
 * renders a FRAGMENT of flex children (m) or the identity line + meta dl (full), so the
 * surrounding layout is untouched.
 */

// The shared glyph cell — the ONE place that decides button-vs-span and which flags the
// glyph carries. `size` only picks the pixel scale + wrapper spacing; the glyph geometry
// and state are identical for a given entity at every rung.
function FaceGlyph({
  entity,
  model,
  size,
  onToggleDone,
  onTogglePlay,
  onMark,
}: {
  entity: Entity
  model: FaceModel
  size: "m" | "full"
  onToggleDone: (e: Entity) => void
  /** Play/Stop toggle for a `playable` ("whenever"/unscheduled) moment/space. */
  onTogglePlay?: (e: Entity) => void
  /** Record an occurrence for a `markable` instant. */
  onMark?: (e: Entity) => void
}) {
  const glyphClass = size === "full" ? "h-4 w-4" : "h-3.5 w-3.5"
  // Full sits on a `gap-2` line (no fixed column); a row glyph occupies the `w-6` column.
  const wrapperBase =
    size === "full" ? "text-foreground" : "flex w-6 shrink-0 justify-center self-center text-foreground"
  // A local counter bumped on each MARK click → drives the glyph's one-shot "written" spin.
  const [markSpin, setMarkSpin] = useState(0)
  const glyph = (
    <Zero0Glyph
      kind={entity.kind}
      filled={model.filled}
      done={model.showCheck}
      cancelled={model.cancelled}
      requested={model.requested}
      ongoing={model.ongoing}
      spinOnce={markSpin}
      className={glyphClass}
    />
  )
  if (model.hasDoneState) {
    return (
      <button
        type="button"
        onClick={() => onToggleDone(entity)}
        className={wrapperBase + " cursor-pointer transition-opacity hover:opacity-70"}
        aria-label={model.done ? "Mark undone" : "Mark done"}
        title={model.done ? "Mark undone" : "Mark done"}
      >
        {glyph}
      </button>
    )
  }
  // OCCURRENCE control (moment/space): the glyph drives the top-rail lifecycle — Play starts an
  // occurrence, Stop ends the running one (glyph spins while running), Reopen archives a finished
  // span and returns it to playable. `model.occAction` says which.
  if (model.playable && model.occAction && onTogglePlay) {
    const label = model.occAction === "stop" ? "Stop" : model.occAction === "reopen" ? "Reopen" : "Play"
    return (
      <button
        type="button"
        onClick={() => onTogglePlay(entity)}
        className={wrapperBase + " cursor-pointer transition-opacity hover:opacity-70"}
        aria-label={label}
        title={label}
      >
        {glyph}
      </button>
    )
  }
  // MARKABLE (live instant): clicking the glyph records an OCCURRENCE (a timestamp). An instant
  // is a point — it never runs — so there's no toggle, just a tally append.
  if (model.markable && onMark) {
    return (
      <button
        type="button"
        onClick={() => {
          onMark(entity)
          setMarkSpin((n) => n + 1) // one-shot "written" spin
        }}
        className={wrapperBase + " cursor-pointer transition-opacity hover:opacity-70"}
        aria-label="Mark occurrence"
        title="Mark occurrence"
      >
        {glyph}
      </button>
    )
  }
  return (
    <span className={wrapperBase} aria-label={model.stateLabel} title={model.stateLabel}>
      {glyph}
    </span>
  )
}

// The shared BLOCK body — an identity line (glyph · title · kind [· trailing]) above a
// meta dl. This is the ONE implementation behind every block rung: `full` (§0, all rows),
// `xl` (all but raw provenance), and `l` (temporal essentials). The rungs differ ONLY by
// which meta rows `filterMetaRows` keeps, so a smaller block can never drift from §0 — it
// only hides rows. The title is a plain span when `onOpen` is absent (that's §0, whose
// title isn't a drill target) and a drill-in button when present (a row grown into a card).
function FaceBlock({
  entity,
  model,
  now,
  size,
  onToggleDone,
  onTogglePlay,
  onMark,
  onOpen,
  onContextMenu,
  trailing,
  hiddenPrefix,
  rowsOverride,
}: {
  entity: Entity
  model: FaceModel
  now: number
  size: "l" | "xl" | "full"
  onToggleDone: (e: Entity) => void
  onTogglePlay?: (e: Entity) => void
  onMark?: (e: Entity) => void
  onOpen?: (e: Entity) => void
  onContextMenu?: (e: Entity, ev: React.MouseEvent) => void
  trailing?: React.ReactNode
  hiddenPrefix?: boolean
  /** When set (the `starter` make), the dl lists these ROLLUP rows instead of §0's. The
      identity line (glyph + title + kind) is unchanged — only the meta reading differs. */
  rowsOverride?: [string, string][]
}) {
  const rows = rowsOverride ?? filterMetaRows(getFaceMetaRows(entity, now), size)
  const titleText = hiddenPrefix ? `(hidden) ${model.title}` : model.title
  // RICH start/end: when these rows aren't an aggregate override, render the schedule cells
  // (faint sessions, pulsing "ongoing", per-cell hover, horizontal scroll) instead of the flat
  // string. The two rows share a synced horizontal scroll so their columns stay paired as you
  // scroll into older sessions. Built once here; keyed by the entity + `now` tick.
  const schedule = useMemo(
    () => (rowsOverride ? null : getScheduleCells(entity, now)),
    [entity, now, rowsOverride],
  )
  // RICH access: the total PRESENCE time followed by a per-session breakdown ("<durX> (<whenX>)"),
  // each hoverable for its full start–end (the live session pulses). Null when there are no
  // engagements. DECOUPLED from the plain DURATION row (which is now the occurrence length).
  const access = useMemo(
    () => (rowsOverride ? null : getAccessCells(entity, now)),
    [entity, now, rowsOverride],
  )
  // RICH occurrences (v0.6.28): the ACTUAL-happening clock = `via:"play"` sessions, same shape as
  // access. Null when nothing's played. SKIPPED for instant (its "occurrences" row is the plain
  // mark-tally string — must not be hijacked by this rich renderer). Matches face-model's guard.
  const played = useMemo(
    () => (rowsOverride || entity.kind === "instant" ? null : getPlayedCells(entity, now)),
    [entity, now, rowsOverride],
  )
  const startScrollRef = useRef<HTMLDivElement>(null)
  const endScrollRef = useRef<HTMLDivElement>(null)
  const syncLock = useRef(false)
  const syncScroll = (from: HTMLDivElement, to: HTMLDivElement | null) => {
    if (!to || syncLock.current) return
    syncLock.current = true
    to.scrollLeft = from.scrollLeft
    // Release after this frame so the mirrored scroll event doesn't ping-pong back.
    requestAnimationFrame(() => {
      syncLock.current = false
    })
  }
  const renderScheduleRow = (which: "start" | "end") => {
    const cells = schedule![which]
    const ref = which === "start" ? startScrollRef : endScrollRef
    const other = which === "start" ? endScrollRef : startScrollRef
    return (
      <dd className="min-w-0 text-foreground">
        <div
          ref={ref}
          onScroll={() => ref.current && syncScroll(ref.current, other.current)}
          className="no-scrollbar overflow-x-auto whitespace-pre"
        >
          {cells.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="text-muted-foreground opacity-70">{" · "}</span>}
              <span
                // Closed session cells are faint (a touch deeper than the plain muted token via
                // opacity-70); the live `ongoing` cell keeps full foreground opacity and pulses.
                className={(c.faint ? "text-muted-foreground opacity-70" : "text-foreground") + (c.pulse ? " zero0-pulse" : "")}
                title={c.full}
              >
                {c.text}
              </span>
            </span>
          ))}
        </div>
      </dd>
    )
  }
  // STATE row when the entity is ONGOING: a small PULSING "live" dot (a solid filled circle —
  // the universal live/active indicator, NOT a rotating ring which reads as "loading") + the
  // pulsing `ongoing` word, then the rest (" · since …") plain. Detected by the "ongoing" prefix
  // that `formatState` emits. Any other state renders as the normal string row.
  // ACCESS row with a per-session breakdown: "[total] · <dur1> (<when1>) · <dur2> …". The total
  // is foreground; each segment is a faint token hoverable for its full start–end (the live
  // session pulses). Horizontally scrollable like the schedule rows.
  const renderAccessRow = (cells: NonNullable<typeof access>) => (
    <dd className="min-w-0 text-foreground">
      <div className="no-scrollbar overflow-x-auto whitespace-pre">
        <span className="text-foreground" title="total duration">
          {cells.total}
        </span>
        {cells.segments.map((c, i) => (
          <span key={i}>
            <span className="text-muted-foreground opacity-70">{" · "}</span>
            <span
              className={"text-muted-foreground opacity-70" + (c.pulse ? " zero0-pulse" : "")}
              title={c.full}
            >
              {c.text}
            </span>
          </span>
        ))}
      </div>
    </dd>
  )
  const renderOngoingState = (v: string) => {
    const rest = v.slice("ongoing".length) // " · since …"
    return (
      <dd className="flex items-center gap-1.5 truncate text-foreground" title={v}>
        <span aria-hidden className="zero0-pulse h-2 w-2 shrink-0 rounded-full bg-foreground" />
        <span className="truncate">
          <span className="zero0-pulse">ongoing</span>
          {rest}
        </span>
      </dd>
    )
  }
  return (
    <>
      {/* Identity line: glyph + title + kind (+ trailing). Fill = closed (fillable kinds),
          bar = cancelled, fade follows the same rules as the row/§0. */}
      <div
        className={"flex items-center gap-2 text-[12px] " + (model.closed ? "opacity-60" : "")}
        onContextMenu={onContextMenu ? (ev) => onContextMenu(entity, ev) : undefined}
      >
        <FaceGlyph entity={entity} model={model} size="full" onToggleDone={onToggleDone} onTogglePlay={onTogglePlay} onMark={onMark} />
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(entity)}
            className={
              "text-foreground underline-offset-2 hover:underline " + (model.cancelled ? "line-through" : "")
            }
            title="Open"
          >
            {titleText}
          </button>
        ) : (
          <span className={"text-foreground " + (model.cancelled ? "line-through" : "")}>{titleText}</span>
        )}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{model.kindLabel}</span>
        {trailing}
      </div>
      {/* Raw meta key/values (filtered by rung). */}
      {rows.length > 0 && (
        <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-4 gap-y-0.5 text-[10px] tabular-nums">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="uppercase tracking-widest text-muted-foreground">{k}</dt>
              {schedule && (k === "planned start" || k === "planned end") ? (
                renderScheduleRow(k === "planned start" ? "start" : "end")
              ) : access && k === "access" ? (
                renderAccessRow(access)
              ) : played && k === "occurrences" ? (
                renderAccessRow(played)
              ) : k === "state" && v.startsWith("ongoing") ? (
                renderOngoingState(v)
              ) : (
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
              )}
            </div>
          ))}
        </dl>
      )}
    </>
  )
}

export interface Zero0FaceProps {
  size: FaceSize
  /** The entity to present. Required for the `m`/`full` rungs (they read lifecycle +
      toggle done). Omitted for a PROJECTION rung (`xs`), which renders from `faceLike`. */
  entity?: Entity
  /** A non-entity PROJECTION (STARTERS group / ACTIVITY presence) — used by `xs` when
      there is no live entity. Resolved into the same FaceModel via `faceModelFromLike`. */
  faceLike?: FaceLike
  /** An already-built model (escape hatch); wins over `entity`/`faceLike` when provided. */
  model?: FaceModel
  /** Epoch (ms) driving live duration/ongoing readouts (entity rungs). */
  now?: number
  /** Toggle the soft DONE marker (glyph + done cell) — entity rungs. */
  onToggleDone?: (e: Entity) => void
  /** `m`: clicking the title drills INTO the entity. */
  onOpen?: (e: Entity) => void
  /** `m`: prefix the title with "(hidden)" (only shown when Show hidden is on). */
  hiddenPrefix?: boolean
  /** `full`: right-click the identity line → the entity's menu. */
  onContextMenu?: (e: Entity, ev: React.MouseEvent) => void
  /** `full`: trailing slot on the identity line (the canvas's close button when drilled in). */
  trailing?: React.ReactNode
  /** `xs`: activate the title (the caller closes over its id — e.g. open the place). */
  onActivate?: () => void
  /** `xs`: right-click the title (the caller closes over its id → the entity menu). */
  onActivateContextMenu?: (ev: React.MouseEvent) => void
  /** `xs`: override the title button's width/flex class (rollup `w-24` vs feed `flex-1`). */
  titleClassName?: string
  /** The MAKE — how this Face READS (orthogonal to size). `starter` shows the entity as an
      aggregator of its Content (rollup meta) instead of its own meta; defaults to `default`. */
  make?: FaceMake
  /** Play/Stop toggle for a `playable` ("whenever"/unscheduled) moment/space glyph. */
  onTogglePlay?: (e: Entity) => void
  /** Record an occurrence for a `markable` instant glyph. */
  onMark?: (e: Entity) => void
}

export function Zero0Face({
  size,
  entity,
  faceLike,
  model: modelProp,
  now,
  onToggleDone,
  onOpen,
  hiddenPrefix,
  onContextMenu,
  trailing,
  onActivate,
  onActivateContextMenu,
  titleClassName,
  make = "default",
  onTogglePlay,
  onMark,
}: Zero0FaceProps) {
  // Resolve ONE model, from whichever input was given: an explicit model wins, else a
  // live entity (full lifecycle), else a projection (inert lifecycle).
  const model: FaceModel | null = modelProp
    ? modelProp
    : entity
      ? getFaceModel(entity, now ?? Date.now())
      : faceLike
        ? faceModelFromLike(faceLike)
        : null
  if (!model) return null

  // STARTER make — read this entity as an AGGREGATOR of its Content. Only when the make
  // renders distinctly AND we have a live entity to aggregate over; otherwise the render
  // falls through to the default (counter/rater/opener land later). The rollup is pure
  // (getChildren + the shared state model), so it substitutes the meta at every rung
  // WITHOUT changing the glyph, title, or the ▸ caret that drills into the real Content.
  const nowMs = now ?? Date.now()
  const isStarter = makeRendersDistinctly(make) && !!entity
  const agg = isStarter && entity ? getAggregate(entity, nowMs) : null
  const starterEcho = agg ? aggregateEcho(agg) : null

  // ── BLOCK RUNGS (l / xl / full) ── identity line + a (filtered) meta dl, rendered by
  // the shared FaceBlock. `full` is §0 (all rows, title as a plain span); `l`/`xl` are a
  // row grown into a card (fewer rows, title drills in via `onOpen`). The life log + frame
  // marker + collapse wrapper (§0) and the <li>/num/× strip (rows) stay in the canvas.
  if (size === "l" || size === "xl" || size === "full") {
    if (!entity) return null
    const toggle = onToggleDone ?? (() => {})
    return (
      <FaceBlock
        entity={entity}
        model={model}
        now={now ?? Date.now()}
        size={size}
        onToggleDone={toggle}
        onTogglePlay={onTogglePlay}
        onMark={onMark}
        onOpen={onOpen}
        onContextMenu={onContextMenu}
        trailing={trailing}
        hiddenPrefix={hiddenPrefix}
        rowsOverride={agg ? aggregateMetaRows(agg, nowMs, size) : undefined}
      />
    )
  }

  // ── M (ENTITY CONTENT row) ── a fragment of the row's flex columns. The <li>/collapse,
  // row index, delete ×, and hover handlers stay in the canvas. Entity-only rung.
  if (size === "m") {
    if (!entity) return null
    const toggle = onToggleDone ?? (() => {})
    return (
      <>
        {/* Glyph column: fill = closed (fillable kinds), check = done, bar = cancelled,
            "sent" flap = requested. Task glyph is a button (toggles Done); else static. */}
        <FaceGlyph entity={entity} model={model} size="m" onToggleDone={toggle} onTogglePlay={onTogglePlay} onMark={onMark} />
        {/* (Kind label column removed on ENTITY CONTENT rows — the glyph already conveys kind.) */}
        {/* MANUAL color marker — a small dot when THIS entity has an explicitly set accent.
            Inherited/ancestor colors are deliberately NOT shown. */}
        {model.accent && (
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 self-center rounded-full"
            style={{ backgroundColor: model.accent }}
          />
        )}
        {/* Title — click to DRILL IN. Strikethrough only when CANCELLED (plain closed just fades). */}
        <button
          type="button"
          onClick={() => onOpen?.(entity)}
          className={
            "flex-1 truncate text-left text-foreground underline-offset-2 hover:underline " +
            (model.cancelled ? "line-through" : "")
          }
          title="Open"
        >
          {hiddenPrefix ? `(hidden) ${model.title}` : model.title}
        </button>
        {/* Kind-relevant METAFIELD echo — schedule/duration/identity. For a `starter` this
            is REPLACED by the Content rollup ("12 · 3 open · 4h"). Hidden (no gap cost) when
            there's nothing to show. */}
        {(starterEcho ?? model.metaEcho) && (
          <span
            className="hidden shrink-0 truncate text-right tabular-nums text-muted-foreground/70 sm:block sm:max-w-[16rem]"
            title={starterEcho ?? model.metaEcho}
          >
            {starterEcho ?? model.metaEcho}
          </span>
        )}
        {/* (The old inline done/undone toggle column was removed — the GLYPH already toggles
            Done for done-able kinds, so the text column was redundant chrome.) */}
        {/* Read-only LIFECYCLE state token (Complete/Close/Cancel via menu). */}
        <span className="w-20 shrink-0 text-right text-muted-foreground/60">{model.lifeLabel}</span>
      </>
    )
  }

  // ── S ── one compact line: glyph + title + state word. A step up from `xs` (it carries
  // the lifecycle glyph + state, so it's a live entity view, not a bare projection) and a
  // step down from `m` (no kind column, no meta echo, no done cell). Entity-only; the title
  // drills in via `onOpen`.
  if (size === "s") {
    if (!entity) return null
    const toggle = onToggleDone ?? (() => {})
    return (
      <>
        <FaceGlyph entity={entity} model={model} size="m" onToggleDone={toggle} onTogglePlay={onTogglePlay} onMark={onMark} />
        <button
          type="button"
          onClick={() => onOpen?.(entity)}
          className={
            "flex-1 truncate text-left text-foreground underline-offset-2 hover:underline " +
            (model.cancelled ? "line-through" : "")
          }
          title="Open"
        >
          {hiddenPrefix ? `(hidden) ${model.title}` : model.title}
        </button>
        {/* A `starter` trades the lifecycle word for the Content rollup. */}
        {(starterEcho ?? model.lifeLabel) && (
          <span className="shrink-0 text-right text-muted-foreground/60">
            {starterEcho ?? model.lifeLabel}
          </span>
        )}
      </>
    )
  }

  // ── XS ── the smallest rung: a neutral KIND glyph + a title button, nothing else. Used
  // for PROJECTIONS (ACTIVITY presence rollups/segments today; STARTERS groups next) where
  // there's no lifecycle to show — just "which kind, called what, click to go there." The
  // glyph is muted + stateless (no fill/done/cancel), because a projection isn't the
  // entity's own lifecycle. The title's width/flex is caller-controlled (`titleClassName`),
  // and the caller keeps any aggregate meta (durations, bars, clock) as its own chrome
  // AROUND this fragment. An optional `metaEcho` on the model renders as a trailing note.
  if (size === "xs") {
    return (
      <>
        <Zero0Glyph kind={model.kind} className="h-3 w-3 shrink-0 text-muted-foreground" />
        <button
          type="button"
          onClick={onActivate}
          onContextMenu={onActivateContextMenu}
          className={
            (titleClassName ?? "flex-1") +
            " truncate text-left text-foreground transition-colors hover:text-muted-foreground"
          }
          title={model.title}
        >
          {model.title}
        </button>
        {(starterEcho ?? model.metaEcho) && (
          <span
            className="shrink-0 whitespace-nowrap text-muted-foreground"
            title={starterEcho ?? model.metaEcho}
          >
            {starterEcho ?? model.metaEcho}
          </span>
        )}
      </>
    )
  }

  // Every rung (xs · s · m · l · xl · full) is handled above; this is unreachable but
  // keeps the function total for the FaceSize union.
  return null
}
