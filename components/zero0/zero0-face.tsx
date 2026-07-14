"use client"

import type React from "react"
import { Zero0Glyph } from "./zero0-glyph"
import {
  getFaceModel,
  getFaceMetaRows,
  faceModelFromLike,
  type FaceModel,
  type FaceLike,
  type FaceSize,
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
 * scale — because "a size is a curated projection." `full` (§0) and `m` (the content
 * row) are entity rungs; `xs` is the smallest rung and is PROJECTION-friendly (it renders
 * from a lightweight `FaceLike`, not a live Entity), which is what lets ACTIVITY presence
 * (and, next, STARTERS groups) render as real Faces. `s`/`l`/`xl` are named but not drawn.
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
}: {
  entity: Entity
  model: FaceModel
  size: "m" | "full"
  onToggleDone: (e: Entity) => void
}) {
  const glyphClass = size === "full" ? "h-4 w-4" : "h-3.5 w-3.5"
  // Full sits on a `gap-2` line (no fixed column); a row glyph occupies the `w-6` column.
  const wrapperBase =
    size === "full" ? "text-foreground" : "flex w-6 shrink-0 justify-center self-center text-foreground"
  const glyph = (
    <Zero0Glyph
      kind={entity.kind}
      filled={model.filled}
      done={model.showCheck}
      cancelled={model.cancelled}
      requested={model.requested}
      ongoing={model.ongoing}
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
  return (
    <span className={wrapperBase} aria-label={model.stateLabel} title={model.stateLabel}>
      {glyph}
    </span>
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

  // ── FULL (§0) ── identity line + exhaustive meta dl. The life log + frame marker +
  // collapse wrapper stay in the canvas around this. Entity-only rung.
  if (size === "full") {
    if (!entity) return null
    const toggle = onToggleDone ?? (() => {})
    const rows = getFaceMetaRows(entity, now ?? Date.now())
    return (
      <>
        {/* Node header line: glyph + title + kind (+ trailing close). Fill = closed
            (fillable kinds), bar = cancelled, fade follows the same rules as rows. */}
        <div
          className={"flex items-center gap-2 text-[12px] " + (model.closed ? "opacity-60" : "")}
          onContextMenu={onContextMenu ? (ev) => onContextMenu(entity, ev) : undefined}
        >
          <FaceGlyph entity={entity} model={model} size="full" onToggleDone={toggle} />
          <span className={"text-foreground " + (model.cancelled ? "line-through" : "")}>{model.title}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{model.kindLabel}</span>
          {trailing}
        </div>
        {/* Raw meta key/values. */}
        <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-4 gap-y-0.5 text-[10px] tabular-nums">
          {rows.map(([k, v]) => (
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
      </>
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
        <FaceGlyph entity={entity} model={model} size="m" onToggleDone={toggle} />
        {/* Kind label — STATIC text. */}
        <span className="w-16 shrink-0 uppercase tracking-wider text-muted-foreground">{model.kindLabel}</span>
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
        {/* Kind-relevant METAFIELD echo — schedule/duration/identity. Hidden (no gap cost)
            for kinds with nothing temporal to show. */}
        {model.metaEcho && (
          <span
            className="hidden shrink-0 truncate text-right tabular-nums text-muted-foreground/70 sm:block sm:max-w-[16rem]"
            title={model.metaEcho}
          >
            {model.metaEcho}
          </span>
        )}
        {/* Inline DONE toggle (soft marker) — only kinds WITH a done axis. Others: muted placeholder. */}
        <button
          type="button"
          onClick={() => toggle(entity)}
          disabled={!model.hasDoneState}
          className={
            "w-16 shrink-0 text-right " +
            (model.hasDoneState ? "text-muted-foreground hover:text-foreground" : "text-transparent")
          }
          title={model.hasDoneState ? "Toggle done" : "No done state"}
        >
          {model.hasDoneState ? (model.done ? "done" : "undone") : "—"}
        </button>
        {/* Read-only LIFECYCLE state token (Complete/Close/Cancel via menu). */}
        <span className="w-20 shrink-0 text-right text-muted-foreground/60">{model.lifeLabel}</span>
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
        {model.metaEcho && (
          <span className="shrink-0 whitespace-nowrap text-muted-foreground" title={model.metaEcho}>
            {model.metaEcho}
          </span>
        )}
      </>
    )
  }

  // s / l / xl — not yet drawn (see /excerpts: middle rungs aren't frozen).
  return null
}
