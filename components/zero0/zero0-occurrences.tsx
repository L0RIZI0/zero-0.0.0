"use client"

import { useCallback, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Pencil, Ban, RotateCcw, Trash2 } from "lucide-react"
import type { Entity, Recurrence } from "@/lib/zero/types"
import { getOccurrenceRows, describeRecurrence, describeRecurrenceRule } from "@/lib/zero/face-model"
import { parseSlotToken, parseRepeatToken } from "@/lib/zero/create-parse"
import type { MenuItem } from "@/lib/zero/menu-model"
import { Zero0DomMenu, type Zero0DomMenuState } from "./zero0-dom-menu"

// The §0 PLANNED OCCURRENCES block (v0.2.229; ALWAYS-ON v0.2.232; renamed from "occurrences" v0.2.233)
// — the SINGLE way an entity shows its schedule in §0. Shown+editable for EVERY kind except the Soul
// (v0.2.238). (Backing field: schedule.plannedOccurrences[] + schedule.repeat + schedule.exceptions.)
//
// TWO-FOLD LAYOUT (v0.2.240): the occurrences are no longer one merged start-ordered list. They split
// into two independently start-ordered sub-lists:
//   1. SERIES (optional, only when schedule.repeat is set) — the projected rule INSTANCES, under a title
//      that names the rule (describeRecurrence, e.g. "repeats every Tuesday and Friday · 1:00 PM"). The
//      title carries the series-level actions: EDIT (placeholder — editing the RULE itself is future work)
//      + CLEAR (stop repeating).
//   2. ONE-OFF — the explicitly-planned DEFINITE occurrences (scalar primary + plannedOccurrences[]).
//      Its title carries CANCEL ALL + "+ add slot".
// Each row (instance or occurrence) carries per-item actions: EDIT (per-occurrence TIME edit, v0.2.248 —
// re-times just that instance via the shared bottom input, day fixed) · CANCEL/RESTORE · DELETE.
// CANCEL is a restorable struck tombstone, gated to not-yet-ended occurrences (r.cancellable); DELETE is
// a hard removal (definite: splice/clear; rule: a `removed` EXDATE that drops the instance from the
// projection). An INSTANT kind still renders each occurrence as a single POINT time (isInstant path in
// formatOccurrenceParts). DORMANT-by-design: only the STATUS word shows, never the planned-vs-actual delta.

const PLACEHOLDER = "e.g. 1400-1530, 2330, in 2h, 12h daily"
const EDIT_PLACEHOLDER = "e.g. 1400 or 1400-1530"

/** Local-clock `HHMM` for prefilling the time editor (v0.2.248). */
function clockHHMM(epoch: number): string {
  const d = new Date(epoch)
  return String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0")
}

/** Re-anchor a parsed clock onto an occurrence's EXISTING day (v0.2.248) — edit-occurrence is time-of-day
    only, so we keep the day of `dayAnchor` and overwrite just the H:M:S from `parsedTime` (which
    `parseSlotToken` may have placed on a different logical day). */
function applyClock(dayAnchor: number, parsedTime: number): number {
  const day = new Date(dayAnchor)
  const t = new Date(parsedTime)
  day.setHours(t.getHours(), t.getMinutes(), t.getSeconds(), 0)
  return day.getTime()
}

/** A user action on the block, dispatched up to the canvas (which owns the writers + re-render). Cancel
    and delete are discriminated by `origin` (v0.2.234) so the canvas routes to the right writer without
    guessing: a DEFINITE row carries whether it's the PRIMARY (scalar) span + its plannedOccurrences[]
    index; a RULE row carries its `recurrenceId` (the day-key the exceptions layer targets). */
export type OccurrenceAction =
  | { type: "add"; start: number; end?: number }
  | { type: "cancel"; origin: "definite"; primary: boolean; occIndex: number; cancelled: boolean }
  // RULE cancel — `ruleId` set ⇒ an ADDITIONAL series (v0.2.246); absent ⇒ the primary `repeat`.
  | { type: "cancel"; origin: "rule"; recurrenceId: number; cancelled: boolean; ruleId?: string }
  | { type: "delete"; origin: "definite"; primary: boolean; occIndex: number }
  | { type: "delete"; origin: "rule"; recurrenceId: number; ruleId?: string }
  // EDIT the TIME of one occurrence (v0.2.248) — time-of-day only; the new `start`/`end` already carry the
  // occurrence's existing day (re-anchored in the editor). Same origin-discrimination as cancel/delete.
  | { type: "edit"; origin: "definite"; primary: boolean; occIndex: number; start: number; end?: number }
  | { type: "edit"; origin: "rule"; recurrenceId: number; start: number; end?: number; ruleId?: string }
  // CANCEL ALL not-yet-ended DEFINITE occurrences (v0.2.240) — the block title's action.
  | { type: "cancelAll" }
  // SET the PRIMARY rule from the add-slot field (v0.2.235) — "12h daily", "daily", "weekdays 9h", etc.
  // `start`/`end` (when a time was also given) become the rule ANCHOR; absent ⇒ anchored at now.
  | { type: "repeat"; repeat: Recurrence; start?: number; end?: number }
  // ADD AN ADDITIONAL series (v0.2.246) — dispatched by add-slot when a primary rule ALREADY exists, so a
  // second rule becomes a new series rather than overwriting the first. Same anchor semantics as `repeat`.
  | { type: "addSeries"; repeat: Recurrence; start?: number; end?: number }
  // CLEAR a recurrence rule (v0.2.239) — "clear" / "stop repeating". `ruleId` set ⇒ remove that ADDITIONAL
  // series (v0.2.246); absent ⇒ drop the primary `schedule.repeat`.
  | { type: "clearRepeat"; ruleId?: string }

type Row = ReturnType<typeof getOccurrenceRows>[number]

/** One rendered SERIES strip (v0.2.246): the primary `repeat` (ruleId undefined) or one `series[]` entry,
    with its human label and the projected rule rows belonging to it. */
type SeriesGroup = { ruleId?: string; label: string; rows: Row[] }

const ACTION_CLS =
  "text-[9px] uppercase tracking-wider text-muted-foreground opacity-60 hover:text-foreground hover:opacity-100"

// Per-row ACTION ICONS (v0.2.293) — the edit/cancel/delete words were replaced by icons (pencil · ban/
// undo · trash), shown on hover, placed inline immediately AFTER the row text (left-aligned) rather than
// far-right. Far-right words drifted next to the neighbouring column and read as if they acted on IT; a
// compact icon cluster hugging its own row removes that ambiguity. Shared by occurrence + session rows.
export const ICON_BTN = "shrink-0 text-muted-foreground transition-colors hover:text-foreground"

export function Zero0Occurrences({
  entity,
  now,
  onAction,
}: {
  entity: Entity
  /** Epoch (ms) driving the derived status words. */
  now: number
  /** Dispatch an add / cancel / delete. Absent ⇒ read-only (no titles' actions, no per-row controls). */
  onAction?: (e: Entity, action: OccurrenceAction) => void
}) {
  const rows = getOccurrenceRows(entity, now)
  const ruleRows = rows.filter((r) => r.origin === "rule")
  const definiteRows = rows.filter((r) => r.origin === "definite")
  const anyCancellableDefinite = definiteRows.some((r) => !r.cancelled && r.cancellable)

  // THREE TEMPORAL COLUMNS (v0.2.289, Loris ask): the one-off definite rows are grouped by their anchor
  // day relative to `now` — PAST (up to yesterday) · TODAY · UPCOMING (tomorrow onward). Bucketed by the
  // SAME calendar-midnight day-diff that fmtDay uses for the row's "Yesterday/Today/Tomorrow" label, so a
  // row's column always agrees with its printed day. A span is placed by its START day (an overnight slot
  // that starts yesterday sits in PAST, matching its "Yesterday" label + end-crosses-midnight display); an
  // unset slot (no start/end) falls into TODAY as the neutral bucket. Rows stay start-ordered within each
  // column (definiteRows already is). This grouping is DEFINITE-only; series strips are untouched.
  const startOfDayMs = (t: number) => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const nowDay0 = startOfDayMs(now)
  const dayDiffOf = (r: Row) => {
    const a = r.startAt ?? r.endAt
    return a == null ? 0 : Math.round((startOfDayMs(a) - nowDay0) / 86_400_000)
  }
  const pastRows = definiteRows.filter((r) => dayDiffOf(r) < 0)
  const todayRows = definiteRows.filter((r) => dayDiffOf(r) === 0)
  const upcomingRows = definiteRows.filter((r) => dayDiffOf(r) > 0)

  // SERIES GROUPS (v0.2.246) — one strip per recurrence series: the PRIMARY `repeat` first (its rows carry
  // no ruleId), then each ADDITIONAL `series[]` entry (rows carry its id). Each series can co-exist and is
  // cancelled/cleared independently. `hasAnySeries` gates the "one-off" disambiguator label below.
  const seriesGroups: SeriesGroup[] = []
  if (entity.schedule?.repeat) {
    seriesGroups.push({ ruleId: undefined, label: describeRecurrence(entity), rows: ruleRows.filter((r) => r.ruleId == null) })
  }
  for (const sr of entity.schedule?.series ?? []) {
    seriesGroups.push({
      ruleId: sr.id,
      label: describeRecurrenceRule(sr.repeat, sr.anchorStart, sr.anchorEnd),
      rows: ruleRows.filter((r) => r.ruleId === sr.id),
    })
  }
  const hasAnySeries = seriesGroups.length > 0

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState(false)
  // EDIT MODE (v0.2.248) — when set, the SAME bottom input edits this occurrence's TIME (prefilled with
  // its clock, day stays fixed) instead of adding a new slot. Cleared on commit / Esc / blur.
  const [editing, setEditing] = useState<Row | null>(null)
  // Right-click menu for the series chips (v0.2.242) — reuses the shared Zero0DomMenu popup.
  const [menu, setMenu] = useState<Zero0DomMenuState | null>(null)

  // Dispatch a per-instance/occurrence action, discriminated by `origin` so the canvas routes to the
  // right writer without guessing. Shared by the one-off rows' inline buttons AND the series chips' menu.
  const dispatchRowAction = useCallback(
    (r: Row, kind: "cancel" | "delete") => {
      if (!onAction) return
      if (kind === "cancel") {
        onAction(
          entity,
          r.origin === "rule"
            ? { type: "cancel", origin: "rule", recurrenceId: r.recurrenceId!, cancelled: !r.cancelled, ruleId: r.ruleId }
            : { type: "cancel", origin: "definite", primary: r.primary, occIndex: r.occIndex, cancelled: !r.cancelled },
        )
      } else {
        onAction(
          entity,
          r.origin === "rule"
            ? { type: "delete", origin: "rule", recurrenceId: r.recurrenceId!, ruleId: r.ruleId }
            : { type: "delete", origin: "definite", primary: r.primary, occIndex: r.occIndex },
        )
      }
    },
    [onAction, entity],
  )

  // Enter EDIT mode for one occurrence (v0.2.248): open the shared bottom input prefilled with the
  // occurrence's current clock (HHMM / HHMM-HHMM), remembering which row we're editing. Day stays fixed.
  const startEdit = useCallback((r: Row) => {
    if (!onAction) return
    const prefill =
      r.startAt == null ? "" : r.endAt != null ? `${clockHHMM(r.startAt)}-${clockHHMM(r.endAt)}` : clockHHMM(r.startAt)
    setEditing(r)
    setAdding(false)
    setDraft(prefill)
    setError(false)
    setMenu(null)
  }, [onAction])

  // Commit a TIME edit: parse the draft as a clock-only token, re-anchor it onto the edited occurrence's
  // existing day, and dispatch `{type:"edit"}` discriminated by origin. Rule words are NOT accepted here
  // (editing an instance's TIME, not its rule) — a non-time token just errors. (v0.2.248)
  const submitEdit = useCallback(() => {
    if (!editing) return
    const parsed = parseSlotToken(draft.trim(), now)
    if (!parsed) {
      setError(true)
      return
    }
    const dayAnchor = editing.startAt ?? now
    const start = applyClock(dayAnchor, parsed.start)
    let end = parsed.end != null ? applyClock(dayAnchor, parsed.end) : undefined
    // An overnight span (e.g. 2330-0100) re-anchors with end <= start ⇒ push end to the next day.
    if (end != null && end <= start) end += 24 * 60 * 60 * 1000
    onAction?.(
      entity,
      editing.origin === "rule"
        ? { type: "edit", origin: "rule", recurrenceId: editing.recurrenceId!, start, end, ruleId: editing.ruleId }
        : { type: "edit", origin: "definite", primary: editing.primary, occIndex: editing.occIndex, start, end },
    )
    setEditing(null)
    setDraft("")
    setError(false)
  }, [editing, draft, now, onAction, entity])

  // Open the series-chip menu at the cursor: EDIT (disabled placeholder) · CANCEL/RESTORE (when the
  // instance is cancellable or already cancelled) · DELETE. Wired to BOTH right-click and plain click,
  // so the actions are reachable without a physical right-mouse button (trackpads, etc.).
  const openRowMenu = useCallback(
    (r: Row, ev: React.MouseEvent) => {
      if (!onAction) return
      // stopPropagation: the §0 detail panel wraps everything in an `onContextMenu` that opens the
      // ENTITY menu (it doesn't check `defaultPrevented`), so without this a right-click on a chip would
      // bubble up and open the entity menu instead of this one. (v0.2.244)
      ev.preventDefault()
      ev.stopPropagation()
      // EDIT time is available for ANY occurrence, PAST included (v0.2.287, Loris ask) — correcting a
      // past slot's recorded intent is legitimate, and the editor re-anchors onto the occurrence's own
      // day, so history stays put. (CANCEL below is still future-gated — you can't cancel history.)
      const items: MenuItem[] = [{ type: "item", id: "edit", label: "Edit time" }]
      if (r.cancelled || r.cancellable) items.push({ type: "item", id: r.cancelled ? "restore" : "cancel", label: r.cancelled ? "Restore" : "Cancel" })
      items.push({ type: "item", id: "delete", label: "Delete", danger: true })
      setMenu({
        items,
        x: ev.clientX,
        y: ev.clientY,
        onSelect: (id) => {
          if (id === "edit") startEdit(r)
          else if (id === "cancel" || id === "restore") dispatchRowAction(r, "cancel")
          else if (id === "delete") dispatchRowAction(r, "delete")
        },
      })
    },
    [onAction, dispatchRowAction],
  )

  // Open the RULE menu (on the "weekly · 11:00 PM" label): EDIT (disabled placeholder) · CLEAR (stop
  // repeating). Replaces the inline EDIT/CLEAR text actions — reachable by right-click OR plain click.
  const openRuleMenu = useCallback(
    (ev: React.MouseEvent, ruleId?: string) => {
      if (!onAction) return
      ev.preventDefault()
      ev.stopPropagation()
      setMenu({
        items: [
          { type: "item", id: "edit", label: "Edit", disabled: true },
          { type: "item", id: "clear", label: "Clear", danger: true },
        ],
        x: ev.clientX,
        y: ev.clientY,
        // ruleId set ⇒ remove that additional series; absent ⇒ clear the primary repeat. (v0.2.246)
        onSelect: (id) => {
          if (id === "clear") onAction(entity, { type: "clearRepeat", ruleId })
        },
      })
    },
    [onAction, entity],
  )

  // Open the BLOCK menu (on the "PLANNED OCCURRENCES" title): CANCEL ALL (v0.2.245) — moved off the
  // "one-off" sub-list header. Shown disabled when there's nothing cancellable, matching the app's
  // disabled-item convention. Reachable by right-click OR plain click on the title.
  const openBlockMenu = useCallback(
    (ev: React.MouseEvent) => {
      if (!onAction) return
      ev.preventDefault()
      ev.stopPropagation()
      setMenu({
        items: [{ type: "item", id: "cancelAll", label: "Cancel all", danger: true, disabled: !anyCancellableDefinite }],
        x: ev.clientX,
        y: ev.clientY,
        onSelect: (id) => {
          if (id === "cancelAll") onAction(entity, { type: "cancelAll" })
        },
      })
    },
    [onAction, entity, anyCancellableDefinite],
  )

  // Visual tone of a series chip by derived status (the vertical list's STATUS word is dropped here —
  // the chip conveys it via color + a `title` tooltip; NEXT is brightened + ringed).
  const chipCls = (r: Row) => {
    const interactive = onAction ? "cursor-pointer hover:text-foreground " : ""
    if (r.cancelled) return interactive + "rounded-sm px-1 line-through text-muted-foreground/40"
    if (r.isNext) return interactive + "rounded-sm px-1 text-foreground ring-1 ring-border"
    const tone = r.status === "missed" ? "text-muted-foreground/50" : "text-muted-foreground"
    return interactive + "rounded-sm px-1 " + tone
  }

  const submit = useCallback(() => {
    // RECURRENCE-AWARE (v0.2.235): if any word parses as a recurrence ("daily", "weekdays", …) the field
    // sets the entity's RULE instead of adding a one-off slot — the rest of the tokens (if any) parse as
    // the anchor TIME ("12h daily" ⇒ daily rule anchored at 12:00; bare "daily" ⇒ anchored at now by the
    // writer). Otherwise it's the definite-slot path.
    const words = draft.trim().split(/\s+/).filter(Boolean)
    let repeat: Recurrence | null = null
    let repeatIdx = -1
    for (let i = 0; i < words.length; i++) {
      const r = parseRepeatToken(words[i])
      if (r) {
        repeat = r
        repeatIdx = i
        break
      }
    }
    if (repeat) {
      const timePart = words.filter((_, i) => i !== repeatIdx).join(" ").trim()
      let anchor: { start: number; end?: number } | undefined
      if (timePart) {
        const parsed = parseSlotToken(timePart, now)
        if (!parsed) {
          setError(true)
          return
        }
        anchor = { start: parsed.start, end: parsed.end }
      }
      // If a PRIMARY rule already exists, a second rule becomes a NEW additional series (v0.2.246);
      // otherwise it sets the primary. Either way the anchor is the typed time (or now, in the writer).
      const kind = entity.schedule?.repeat ? "addSeries" : "repeat"
      onAction?.(entity, { type: kind, repeat, start: anchor?.start, end: anchor?.end })
      setDraft("")
      setError(false)
      setAdding(false)
      return
    }
    const parsed = parseSlotToken(draft, now)
    if (!parsed) {
      setError(true)
      return
    }
    onAction?.(entity, { type: "add", start: parsed.start, end: parsed.end })
    setDraft("")
    setError(false)
    setAdding(false)
  }, [draft, now, onAction, entity])

  // Open the shared bottom input in ADD mode (never overlapping edit mode). Shared by the per-column
  // "+ add" buttons and the empty-state "+ add" (v0.2.290).
  const openAdd = useCallback(() => {
    setEditing(null)
    setDraft("")
    setError(false)
    setAdding(true)
  }, [])

  // The relocated "+ add" trigger (v0.2.290, renamed from "+ add slot"). Rendered under the last row of
  // EACH displayed column when occurrences exist, or once below the title when none do.
  const addButton = (
    <button type="button" onClick={openAdd} className={ACTION_CLS} title="Add a one-off occurrence (or type a rule like 'daily')">
      + add
    </button>
  )

  // One DEFINITE (one-off) occurrence row — a SINGLE tight line: `·` · DAY · TIME · STATUS · [NEXT]. The
  // per-row actions (edit · cancel/restore · delete) no longer occupy a second line (v0.2.290, Loris ask) —
  // they were reserving vertical space and forcing a big inter-row gap. Instead they live in an ABSOLUTELY-
  // POSITIONED overlay pinned to the row's right edge, revealed on `group-hover`/`focus-within`, with an
  // OPAQUE `bg-background` (the panel's own bg) + a little left padding so it cleanly masks the day/time/
  // status beneath it when the column is too narrow to fit both. This lets rows stack at their natural
  // line-height with only a hairline gap. `hideDay` drops the leading day in the TODAY column (every row is
  // "Today"; the header says so); PAST/UPCOMING keep it. SERIES rows still render as chips, not this.
  const renderRow = (r: Row, hideDay = false) => (
    <li key={`${r.origin}-${r.index}`} className="group text-[10px] tabular-nums leading-5">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-muted-foreground opacity-50">
          ·
        </span>
        {/* DAY fixed-width so every TIME lines up (when shown). "unset" segments fade like the status word. */}
        <span className={"flex items-baseline gap-2 " + (r.cancelled ? "line-through opacity-60" : "")}>
          {!hideDay && <span className="w-16 shrink-0 text-muted-foreground">{r.day}</span>}
          <span className="whitespace-nowrap text-foreground">
            {r.time.map((seg, i) => (
              <span key={i} className={seg.muted ? "text-muted-foreground" : undefined}>
                {seg.text}
              </span>
            ))}
          </span>
        </span>
        <span className="whitespace-nowrap text-muted-foreground">{r.statusWord}</span>
        {r.isNext && <span className="text-[9px] uppercase tracking-wider text-foreground opacity-70">next</span>}
        {/* ACTION ICONS (v0.2.293) — inline right AFTER the text (not far-right), revealed on hover. The
            reserved (transparent) width means hovering never shifts the layout. Icons: pencil=edit ·
            ban/undo=cancel/restore · trash=delete. Kept left-hugging so they clearly belong to THIS row. */}
        {onAction && (
          <span className="ml-1 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {/* EDIT — per-occurrence TIME edit (v0.2.248/.287: available for ANY occurrence, past included). */}
            {(r.cancelled || r.cancellable) && (
              <button type="button" onClick={() => startEdit(r)} className={ICON_BTN} title="Edit this occurrence's time" aria-label="Edit time">
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {/* CANCEL / RESTORE — restorable struck tombstone, gated to not-yet-ended occurrences. */}
            {(r.cancelled || r.cancellable) && (
              <button
                type="button"
                onClick={() => dispatchRowAction(r, "cancel")}
                className={ICON_BTN}
                title={r.cancelled ? "Restore this occurrence" : "Cancel this occurrence"}
                aria-label={r.cancelled ? "Restore" : "Cancel"}
              >
                {r.cancelled ? <RotateCcw className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
              </button>
            )}
            {/* DELETE — hard removal (splice/clear the slot). Distinct from the restorable cancel. */}
            <button type="button" onClick={() => dispatchRowAction(r, "delete")} className={ICON_BTN} title="Delete this occurrence" aria-label="Delete">
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
    </li>
  )

  return (
    <div className="col-span-2 mt-3">
      {/* BLOCK TITLE (v0.2.245): the "PLANNED OCCURRENCES" label is a click/right-click menu trigger
          (Cancel all — moved off the one-off header). The "+ add" trigger USED to sit inline here; it
          moved (v0.2.290) to under each displayed column's last row, or under the title when empty. */}
      <div className="mb-1 flex items-baseline gap-3 text-[10px]">
        <button
          type="button"
          onClick={onAction ? openBlockMenu : undefined}
          onContextMenu={onAction ? openBlockMenu : undefined}
          title={onAction ? "Planned occurrences — Cancel all" : undefined}
          className={"uppercase tracking-widest text-muted-foreground " + (onAction ? "cursor-pointer hover:text-foreground" : "cursor-default")}
        >
          planned occurrences
        </button>
        {/* EMPTY STATE (v0.2.290): with no one-off occurrences, the single "+ add" lives right under the
            title. When occurrences exist it disappears from here and reappears per-column (below). */}
        {onAction && definiteRows.length === 0 && addButton}
      </div>

      {/* ── SERIES strips ── ONE per recurrence series (v0.2.246): the primary `repeat` first, then each
          additional `series[]` entry — each rendered identically as a SINGLE-ROW horizontal chip strip
          (v0.2.244). The rule label opens a right-click / click menu (Edit [disabled] · Clear) scoped to
          THAT series; each chip opens its own menu (Edit [disabled] · Cancel/Restore · Delete). Status is
          conveyed by chip tone (NEXT brightened + ringed, missed faded, cancelled struck) + a `title`. */}
      {seriesGroups.map((g) => (
        <div key={g.ruleId ?? "primary"} className="mb-2 flex items-baseline gap-x-3 text-[10px]">
          <button
            type="button"
            onClick={onAction ? (ev) => openRuleMenu(ev, g.ruleId) : undefined}
            onContextMenu={onAction ? (ev) => openRuleMenu(ev, g.ruleId) : undefined}
            title={onAction ? "Recurrence rule — Edit / Clear" : undefined}
            className={"flex shrink-0 items-center gap-2 text-muted-foreground " + (onAction ? "cursor-pointer hover:text-foreground" : "cursor-default")}
          >
            <span aria-hidden className="opacity-50">
              ↻
            </span>
            <span className="text-foreground">{g.label}</span>
          </button>
          {g.rows.length > 0 && (
            <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto">
              <div className="flex w-max items-baseline gap-x-1 tabular-nums">
                {g.rows.map((r, i) => (
                  <span key={`rule-${r.index}`} className="flex items-baseline gap-x-1 whitespace-nowrap">
                    {/* Middle-dot separator between chips, matching the recorded-sessions/access rows. */}
                    {i > 0 && (
                      <span aria-hidden className="text-muted-foreground opacity-50">
                        ·
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={onAction ? (ev) => openRowMenu(r, ev) : undefined}
                      onContextMenu={onAction ? (ev) => openRowMenu(r, ev) : undefined}
                      title={`${r.day} — ${r.statusWord}${r.isNext ? " · next" : ""}`}
                      className={chipCls(r)}
                    >
                      {r.day}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* ── ONE-OFF sub-list (the explicitly-planned definite occurrences) ── The "one-off" label is only
          a DISAMBIGUATOR from the series strips, so it's shown ONLY when a series exists AND there's at
          least one one-off row to label (v0.2.245/.246/.247); with no series there's nothing to
          distinguish, and with no one-off rows there's nothing to label. Its former CANCEL ALL / + ADD
          SLOT actions have moved to the block title above. */}
      <div>
        {hasAnySeries && definiteRows.length > 0 && (
          <div className="mb-1 text-[10px] text-muted-foreground">one-off</div>
        )}
        {/* THREE TEMPORAL COLUMNS (v0.2.289; visible-only + animated v0.2.290) — PAST · TODAY · UPCOMING.
            Only columns that hold at least one occurrence are rendered; an empty bucket is omitted entirely
            (no more em-dash placeholder). Each column is a flex child that grows to an equal share of the
            row, so 1/2/3 present columns split the width evenly. Show/hide is animated with `motion`: a
            column EXPANDS from zero width (flexGrow 0→1) + fades in on appear, and COLLAPSES + fades out on
            removal — because flexGrow is animated inline, the sibling columns continuously reflow to fill
            the freed space, giving a smooth settle with no jump. `AnimatePresence initial={false}` skips the
            animation on first paint (panel-open shows columns instantly; only later bucket changes animate).
            Each column carries its own "+ add" under the last row. */}
        {definiteRows.length > 0 && (
          <div className="flex gap-x-6">
            <AnimatePresence initial={false}>
              {(
                [
                  { key: "past", label: "Past", rows: pastRows, hideDay: false },
                  { key: "today", label: "Today", rows: todayRows, hideDay: true },
                  { key: "upcoming", label: "Upcoming", rows: upcomingRows, hideDay: false },
                ] as const
              )
                .filter((col) => col.rows.length > 0)
                .map((col) => (
                  <motion.div
                    key={col.key}
                    initial={{ opacity: 0, flexGrow: 0 }}
                    animate={{ opacity: 1, flexGrow: 1 }}
                    exit={{ opacity: 0, flexGrow: 0 }}
                    // v0.2.291: doubled the appear/disappear duration (0.28→0.56s) with a pronounced
                    // ease-out cubic (the codebase's FLIP curve) so a column settling in reads as a smooth,
                    // deliberate slide rather than a quick snap.
                    transition={{ duration: 0.56, ease: [0.22, 1, 0.36, 1] }}
                    className="min-w-0 basis-0 overflow-hidden"
                  >
                    <div className="mb-1 text-[9px] uppercase tracking-wider text-muted-foreground/60">{col.label}</div>
                    <ul className="flex flex-col">{col.rows.map((r) => renderRow(r, col.hideDay))}</ul>
                    {/* "+ add" stacks like another row (leading-5, no extra top margin) so the gap above it
                        matches the inter-occurrence rhythm instead of the old larger `mt-1` step (v0.2.291). */}
                    {onAction && <div className="pl-4 leading-5">{addButton}</div>}
                  </motion.div>
                ))}
            </AnimatePresence>
          </div>
        )}
        {/* Shared bottom input — DUAL-MODE (v0.2.248): ADD (empty, sets a slot/rule) when `adding`, or
            EDIT (prefilled, re-times one occurrence, day fixed) when `editing` is set. */}
        {onAction && (adding || editing) && (
          <div className="mt-1">
            {editing && (
              <div className="mb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">{`editing time · ${editing.day}`}</div>
            )}
            <input
              autoFocus
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setError(false)
              }}
              onKeyDown={(e) => {
                // CJK IME guard: don't submit while composing (or on Safari's unreliable 229).
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === "Enter") {
                  e.preventDefault()
                  if (editing) submitEdit()
                  else submit()
                } else if (e.key === "Escape") {
                  setAdding(false)
                  setEditing(null)
                  setDraft("")
                  setError(false)
                }
              }}
              onBlur={() => {
                // Editing: a blur cancels the edit (no accidental commit); Adding: close if empty.
                if (editing) {
                  setEditing(null)
                  setDraft("")
                  setError(false)
                } else if (!draft) setAdding(false)
              }}
              placeholder={editing ? EDIT_PLACEHOLDER : PLACEHOLDER}
              aria-label={editing ? "Edit occurrence time" : "New occurrence time"}
              aria-invalid={error}
              className={
                "w-full bg-transparent text-[10px] tabular-nums placeholder:text-muted-foreground/60 focus:outline-none " +
                (error ? "text-foreground underline decoration-dotted decoration-muted-foreground underline-offset-2" : "text-foreground")
              }
            />
            {error && (
              <div className="mt-0.5 text-[9px] text-muted-foreground">
                {editing
                  ? "Unrecognized — enter a time like 1400 or 1400-1530."
                  : 'Unrecognized — try a time (1400-1530, 2330, "in 2h") or a rule ("daily", "12h daily", "weekdays").'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Series-chip right-click / click menu — the shared popup (viewport-clamped, self-dismissing). */}
      {menu && <Zero0DomMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
