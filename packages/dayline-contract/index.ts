// ─────────────────────────────────────────────────────────────────────────────
// ZERO DAYLINE CONTRACT — v1 (draft)
//
// This is the ONLY shared surface between Zero's model and a dayline VIEW engine.
// The engine (e.g. Grok's canvas dayline) implements `mountDayline`; Zero's adapter
// produces `DaylineData` from the ontology and handles the callbacks. Neither side
// imports the other's files — they meet here, at a typed boundary.
//
// DESIGN PRINCIPLES (read before changing anything):
//
//  1. THE ENGINE OWNS ALL VIEW GEOMETRY. Zero passes ABSOLUTE-TIME marks only — no
//     pixels, no percentages, no warp. The fisheye/scroll axis, the sun, the springs,
//     pan/zoom, label placement, 60fps — all of that lives inside the engine and is
//     none of Zero's business. This is exactly why the render can be rebuilt freely
//     without touching the model.
//
//  2. DISPATCH TOKENS ARE OPAQUE. `occRef` and `sessionAnchorId` are identity tokens
//     the engine NEVER interprets — it only echoes them back in callbacks so Zero can
//     resolve which occurrence/session was acted on. This is what keeps the recurrence
//     rules, the definite/rule layers, cancel/restore semantics, etc. entirely on
//     Zero's side. The engine cannot accidentally re-derive the ontology because it
//     never sees it.
//
//  3. THE ENGINE IS PURE VIEW + INTENT. Callbacks announce USER INTENT ("the user
//     dragged this mark to here", "the user right-clicked empty space"). They do NOT
//     mutate anything. Zero validates and commits against the model, then pushes fresh
//     `DaylineData` back. One-way data in, intent events out.
//
//  4. FRAMEWORK-AGNOSTIC. The mount API is imperative (mount → update → destroy) so it
//     drops into React (useEffect wrapper), plain Electron, or anything else. No React
//     types appear in this file on purpose.
//
// This file is intentionally dependency-free. It is the target Grok builds against and
// the types Zero's adapter imports. It is versioned in the Zero repo today and can be
// lifted into its own npm package (`@zero/dayline-contract`) without edits.
// ─────────────────────────────────────────────────────────────────────────────

/** Epoch milliseconds. Every time in this contract is absolute UTC ms — never a Date, never a string. */
export type EpochMs = number

/** The four Zero entity kinds a mark can represent. The engine uses this only to pick a glyph/shape;
 *  all behavioural meaning stays in Zero. */
export type DaylineKind = "space" | "task" | "moment" | "instant"

/** Which rail a mark belongs to. `planned` = a scheduled occurrence; `recorded` = an actual tracked
 *  session; `access` = the machine-truth "where I was" band. The engine decides how to stack/lay these
 *  out (Zero's current view centers them and tells them apart by height). */
export type DaylineTrack = "planned" | "recorded" | "access"

/**
 * OPAQUE dispatch token for a planned occurrence. Zero mints it, the engine stores and echoes it back
 * verbatim in `onOccurrenceMenu` / `onOccurrenceRetime`. The engine MUST treat it as an unknown blob
 * (structurally it is Zero's `TimelineOccurrence["occRef"]`, but the engine must not depend on that).
 */
export type OccRef = unknown

/**
 * A GLYPH descriptor — enough for the engine to draw the entity's mark without knowing Zero's art.
 * v1 keeps this minimal: the kind picks the base silhouette, the flags drive the small state overlays
 * Zero already renders (spin while ongoing, 180° flip when a Space has a future planned occurrence,
 * strike when cancelled, check when done). If the engine wants Zero's EXACT silhouettes later, we add an
 * optional `svgPath` here and the adapter supplies it — but that is a v2 nicety, not a v1 requirement.
 *
 * EXACT GEOMETRY: `glyphs.ts` in this package is the pixel-faithful, canvas-ready spec for every kind's
 * silhouette and state overlay (extracted verbatim from Zero's live renderer). Draw from that; the flags
 * on this interface map 1:1 onto its STATE MODIFIERS section.
 */
export interface DaylineGlyph {
  kind: DaylineKind
  /** Entity accent color, already resolved by Zero (OKLCH or hex string). May be a neutral sentinel. */
  accent: string
  /** Spin the glyph — the entity is ongoing/live right now. */
  ongoing?: boolean
  /** Flip the silhouette 180° — a Space with a future planned occurrence (Zero's `glyphFlip180`). */
  flip180?: boolean
  /** Draw the "done" overlay. */
  done?: boolean
  /** Draw the struck-through/cancelled treatment. */
  cancelled?: boolean
}

/**
 * A single dayline MARK — one tick/bar in absolute time, with NO view geometry.
 *
 * This mirrors Zero's existing internal `CalBar` (the shared classification the dayline and calendar
 * already agree on), which is the whole point: the contract promotes a boundary Zero already relies on
 * rather than inventing a new one.
 */
export interface DaylineMark {
  /** Stable identity for this mark ACROSS updates — the engine keys its enter/exit/move animations off
   *  this. Zero's scheme: `plan:${occKey}` for planned, `sess:${anchorId}:${i}` for recorded. */
  key: string
  /** The entity this mark belongs to (echoed back in callbacks). */
  entityId: string
  kind: DaylineKind
  track: DaylineTrack

  /** Effective START. `undefined` ONLY for an end-only mark (unknown start). */
  start?: EpochMs
  /** Effective END (declared, implied, close time, or `now` for a live/open mark). Always present. */
  end: EpochMs

  /** Display label (already resolved: web titles cropped, historical title fold applied). */
  title: string
  glyph: DaylineGlyph

  // ── PRESENTATION FLAGS (each corresponds to a rendering treatment Zero already has) ──
  /** Zero-length mark placed at a point in time (an Instant, or an at/due point). Render as a marker,
   *  not a span. */
  point?: boolean
  instant?: boolean
  /** The mark is live right now — engine may pulse/spin it. */
  ongoing?: boolean
  /** No declared end — the mark trails off (Zero fades the trailing edge). */
  openEnded?: boolean
  /** The end time is a guess — fade the trailing edge. */
  unknownEnd?: boolean
  /** The start time is a guess — fade the leading edge. */
  unknownStart?: boolean
  /** Cancelled per-instance ghost — render struck-through at low opacity, DO NOT drop it. */
  cancelled?: boolean
  /** Recorded AUTO play (ongoing-on-enter) rather than a deliberate one — render dimmed. Zero's current
   *  dayline excludes autos; the engine may show them dimmed or hide them. */
  auto?: boolean

  /** Nesting depth (0 = root). A child mark is rendered inside/atop its ancestor's span. */
  depth?: number
  /** Parent mark's `entityId`, or null at a root. Lets the engine nest without knowing Zero's tree. */
  parentId?: string | null

  /** Optional sky/background wash (Zero uses this for sleep spans). */
  sky?: string

  // ── DISPATCH ──
  /** PLANNED marks: the opaque token to echo back on menu/retime. */
  occRef?: OccRef
  /** RECORDED marks: the session anchor id to echo back on menu/retime. */
  sessionAnchorId?: number
}

/**
 * The COMPLETE state the engine renders. Zero pushes a fresh `DaylineData` on every model change; the
 * engine diffs against the previous one (by `mark.key`) to animate. There is no incremental/patch API in
 * v1 — full snapshots keep the contract trivial and the marks list is small (Zero caps lenses at ~240).
 */
export interface DaylineData {
  /** The current instant. Drives the "now" marker and any live-edge computation. */
  now: EpochMs
  marks: DaylineMark[]
  /** Which rails Zero wants shown. The engine still decides layout; this is Zero's visibility intent
   *  (Zero defaults access + recorded OFF, planned ON). */
  rails?: { planned?: boolean; recorded?: boolean; access?: boolean }
}

/**
 * Theme for the engine's CHROME (axis, guides, labels, now-marker) — the parts that are NOT a mark's own
 * accent. Values are resolved color strings (the adapter reads Zero's CSS custom properties and passes
 * concrete values, so the engine never needs the DOM). All optional; the engine supplies sane fallbacks.
 */
export interface DaylineTheme {
  background?: string
  foreground?: string
  muted?: string
  border?: string
  /** The now-marker / accent-of-the-axis color. */
  now?: string
  /** "light" | "dark" — lets the engine pick appropriate contrasts for the sun, washes, etc. */
  scheme?: "light" | "dark"
}

/**
 * USER-INTENT callbacks. The engine calls these; Zero validates and commits, then re-pushes data. Screen
 * coordinates are viewport pixels (for positioning a Zero-owned context menu). None of these mutate state.
 */
export interface DaylineCallbacks {
  /** Left-click / activate a mark (open its entity). */
  onActivate?: (entityId: string, mark: DaylineMark) => void

  /** Right-click a PLANNED mark → Zero opens the occurrence menu at (screenX, screenY). */
  onOccurrenceMenu?: (entityId: string, occRef: OccRef, screenX: number, screenY: number) => void
  /** Right-click a RECORDED mark → Zero opens the session menu. */
  onSessionMenu?: (entityId: string, sessionAnchorId: number, screenX: number, screenY: number) => void

  /** Commit a drag-retime of a PLANNED occurrence — new absolute start/end (engine rounds to the minute
   *  or leaves that to Zero; Zero re-rounds regardless). */
  onOccurrenceRetime?: (entityId: string, occRef: OccRef, start: EpochMs, end: EpochMs) => void
  /** Commit a drag-retime of a RECORDED session. */
  onSessionRetime?: (entityId: string, sessionAnchorId: number, start: EpochMs, end: EpochMs) => void

  /** Left-click EMPTY dayline area → Zero expands into the multi-day calendar, centered on `centerTime`.
   *  `centerTime` is whatever time was under the click. */
  onEmptyClick?: (centerTime: EpochMs) => void
  /** Right-click EMPTY area → Zero opens the band/view menu (rail visibility, etc.) at (screenX, screenY). */
  onBandMenu?: (screenX: number, screenY: number) => void
}

/** Engine tuning the adapter may pass at mount. All optional; the engine owns the defaults. */
export interface DaylineOptions {
  /** Fraction of the width where "now" rests by default (Zero uses 1/3). The engine may treat this as the
   *  initial scroll rest position only, with free panning thereafter. */
  nowRestFraction?: number
  /** device pixel ratio hint; the engine can also read it itself. */
  dpr?: number
}

export interface MountDaylineArgs {
  /** The canvas (or container) the engine renders into. The engine owns everything inside it. */
  surface: HTMLCanvasElement
  data: DaylineData
  theme?: DaylineTheme
  callbacks?: DaylineCallbacks
  options?: DaylineOptions
}

/** The live handle Zero holds after mounting. Zero calls `update` on every model change and `destroy` on
 *  unmount. `resize` is called when the surface's box changes (or the engine may observe it itself). */
export interface DaylineHandle {
  update: (data: DaylineData) => void
  setTheme: (theme: DaylineTheme) => void
  resize: (width: number, height: number) => void
  destroy: () => void
}

/**
 * THE ENTRY POINT the engine exports. Zero's adapter calls this once per mounted dayline.
 *
 *   import { mountDayline } from "@zero/dayline-view"
 *   const handle = mountDayline({ surface, data, theme, callbacks })
 *   // ...later...
 *   handle.update(nextData)
 *   handle.destroy()
 */
export type MountDayline = (args: MountDaylineArgs) => DaylineHandle

/** Contract version. Bump on any breaking change to the shapes above; the engine and adapter should
 *  agree on the major. */
export const DAYLINE_CONTRACT_VERSION = "1.0.0-draft.1"
