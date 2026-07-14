# Zero — interaction matrix (what-triggers-what)

The single place that answers "when the user does X to a [kind] entity in [state], what
happens (and what's the guard)?" Use it to check a NEW request against existing behaviour
BEFORE building — if a request contradicts a CURRENT row, flag it; if it fills a PROPOSED
row, cross-check the TODO ledger.

Status tags: **[CUR]** = built + verified today · **[PART]** = partially built ·
**[TODO]** = proposed/awaiting decision (see TODO ledger).

> **This is the SOURCE OF TRUTH.** It's a git-tracked repo file. The `/matrix-interactions`
> web viewer renders it via `lib/zero/interaction-matrix-doc.ts`, which is AUTO-GENERATED from
> this file by `scripts/gen-interaction-matrix.mjs` (runs on `predev`/`prebuild`). Edit THIS
> file; never hand-edit the generated `.ts`. The memory doc
> `v0_memories/user/zero-interaction-matrix.md` is only a pointer here.

## Vocabulary
- **kinds**: soul · individual · organism · community · space · resource · task · moment · instant.
- **states** (`getState().word`, one axis, mutually exclusive; kinds.ts): `open` → `complete`
  → `closed`; plus `ongoing`, `cancelled`, terminal `dead`/`retired`. `open` includes a
  reopened entity.
- **axes/fields**: `schedule{startAt,endAt,at,dueAt}` · `closeAt` (frozen close instant) ·
  `closePolicy` ('manual' opts out of auto midnight-close) · `completed` (task done scalar) ·
  `accent` (color) · `taggedContextIds` (multi-parent links) · `createdAt`/`ownerId`/`createdBy`.

## TRIGGERS

### Navigation
| Trigger | Applies to | Effect | Guard / unless | Status |
|---|---|---|---|---|
| Drill into (open) an entity | any kind | Records a presence segment (activity log); becomes the breadcrumb leaf | no-op if same id repeated | [CUR] |
| Drill INTO a web resource | resource w/ `webUrl` (desktop) | mounts a native tab; if already warm/parked ⇒ instant reveal (no reload) | web preview iframes internal `/…`; native only in Electron | [CUR] |
| Drill AWAY from a web resource | resource w/ `webUrl` (desktop) | PARKS the tab: hidden + background-throttled, kept resident (warm) for instant re-open | LRU pool cap 4 ⇒ oldest parked tab destroyed | [CUR] |
| Close button (§0/§1 header ×) | any drilled-in entity (`path>1`) | climbs out to parent; for a `webUrl` resource also DESTROYS its tab for good | root has no × | [CUR] |
| Inline row METAFIELD | any child in ENTITY CONTENT | each row shows a kind-relevant metafield (right-aligned, muted, before the lifecycle token): moment → span "start–end · dur" / "since start · dur" (live) / lone "at"; instant → its point time; task → "due …" when set, ELSE its own start/end span / ongoing / at (a task can be scheduled too, not just due); individual → "sex · age"; others → nothing. Time-of-day when same day, else "MMM D, h:mm". Derived via `rowMeta(e, now)`, never stored | hidden on narrow (<sm) widths; empty kinds add no gap | [CUR] |
| Right-click ▸ Hide / Unhide | any child in ENTITY CONTENT | toggles stored `hidden`; row collapses via a long 650ms eased grid-rows slide+fade, siblings renumber | counts/timeline/siblings untouched | [CUR] |
| Right-click ▸ Show hidden / Hide hidden | current context | VIEW toggle (session-only, resets on nav): reveals hidden + auto-hidden children with a `(hidden)` prefix | not a data mutation | [CUR] |
| Auto-hide (derived) | closed child | a child closed BEFORE today's 5am day-start collapses from ENTITY CONTENT | computed from `closeAt`, never stored; revealed by Show hidden | [CUR] |
| Presence on the TODAY dayline | any visited entity | drill-in presence segments paint ticks on the TODAY lane (`tracks="both"`); tooltip = title, click opens it | — | [CUR] |
| Planned vs presence on the TODAY lane | scheduled occurrence vs presence segment | one centered band; planned ticks a fixed 20px TALL, presence a fixed 10px; presence painted last so it stacks IN FRONT | applies before AND after the now marker; heights hover-independent | [CUR] |
| Tick opacity (any dayline) | any tick | PRESENCE ticks fully OPAQUE at all times (the solid record of where I was); FUTURE/ongoing/point PLANNED ticks at 0.4 until hovered (→ full). Root presence = solid theme-bg chip (near-black dark / near-white light) + grey hairline | root fill themed; no color-muting | [CUR] |
| PAST planned tick opacity (coverage) | a real-duration planned occurrence fully in the past (end ≤ now) | opacity reflects how much it was HONORED: fraction of its window overlapped by recorded PRESENCE at that entity or any descendant, mapped LINEARLY between a 0.15 floor (missed) and 0.90 ceiling (fully honored) — `0.15 + coverage × 0.75`. Hover still snaps to full | one place at a time so segments don't double-count; clamped [0,1]; `coverage` derived in the planned memo, re-runs on activity-log change | [CUR] |
| Dayline tick HIGHLIGHT (cross-component) | HOVER an ENTITY CONTENT row | every dayline tick whose `id` matches the hovered row's entity grows to 26px + goes fully opaque (animated). Threaded as `highlightId` into both daylines (TODAY combined + ACTIVITY presence) | HOVER-ONLY — the open context is deliberately NOT highlighted (a persistent pin felt stuck); cleared on mouse-leave | [CUR] |
| §4 PINNED frame source (display name, formerly FREQUENT/STARTERS) | the §4 band | a CURATED list — exactly the entities the user pinned via the ENTITY CONTENT right-click, resolved in pin order from the global `starterPins` list. The old auto-frequency aggregation (`getFrequentEntities`) NO LONGER feeds §4 (fn + `zero0-frequent.tsx` kept but unused) | shown by default; toggle via §4 / footer "pinned"; flag key stays `"frequent"` for stored-chord back-compat | [CUR] |
| Right-click an ENTITY → "Pin as starter" / "Unpin starter" | any entity | a TOP-LEVEL toggle at the head of the entity menu (above a divider); adds/removes the entity from `starterPins`. Label reflects current membership (computed live per open). Appears on content rows, pinned tiles, and the header — everywhere `openMenu` runs | `starter-pin`/`starter-unpin` are canvas-intercepted (like `size:`/`make:`), not entity-data mutations; `applyEntityMenuAction` returns false for them | [CUR] |
| Click a PINNED tile (frame/title) | a pinned entity | DRILL into the entity **and** START a session: `startSession` ensures the entity's `Sessions` sub-Space (created on first use), punches out any still-ongoing session there, then spins a fresh ongoing Moment titled after the entity. You land INSIDE the entity; the session records in the background | navigation + background session in one click | [CUR] |
| Click a PINNED tile GLYPH | a pinned entity | STAY on canvas + TOGGLE the session: running → `stopSession` (stamp the ongoing session's `endAt`=now → complete); idle → `startSession`. Never navigates, never starts a second | glyph SPINS (outline) while a session is ongoing; `stopPropagation` so it doesn't trigger the frame drill | [CUR] |
| Sessions sub-Space (per pinned entity) | a pinned entity's clock | a child Space titled "Sessions", CREATED ON DEMAND on the first session; holds one Moment per session. Identified purely by convention (kind=space + title="Sessions"), so nothing is added to the Entity/persistence shape | `ensureSessionsSpace`/`getSessionsSpace`/`getOngoingSession` | [CUR] |
| Session single-instance rule | a pinned entity's Sessions space | at most ONE session ongoing at a time — `startSession` first stamps `endAt`=now on any currently-ongoing session moment in that space before spinning the new one | verified: 2 moments, exactly 1 ongoing after a punch-in | [CUR] |
| PINNED tile live meta | a pinned entity with a running session | right of the title: an elapsed count-up (`Nm Ss` / `Nh Nm Ss`) since the ongoing session's `startAt`, ticking each second; nothing when idle | title tooltip shows "session since <clock>" | [CUR] |
| PINNED tile dot color | a pinned entity | the entity's own `accent`, else its inherited accent from the parent chain, else the bluey Sleep default (`#5566d8`) for sleep-titled, else grey | reuses the §4 dot palette | [CUR] |
| PINNED empty state | no pins | a muted hint: "— nothing pinned yet — right-click an entity and "Pin as starter" —" | — | [CUR] |
| §4 default state | any load | EXPANDED by default; a chevron in the header manually expands/collapses (animated height). `starterPins` persists across reload; a running session survives reload too | replaced the old auto-collapse behaviour | [CUR] |
| Color picker free-text (create-bar `--color` + entity "Set color" menu) | any color choice | type a hex (`#8b5a2b`) OR a CSS name (`brown`, `grey`); resolved to hex via the browser parser; invalid text can't commit | shares the swatch `color:<hex>` path | [CUR] |
| Being the focused context | any kind | (today) no state change | — | [CUR] |
| Enter a Task with empty `startAt` | task/open | SHOULD read `ongoing` + glyph spins while inside; revert on exit | all-children-open ⇒ back to open, else ongoing no-spin | [TODO] |
| Focused-context spin scope | task only (proposed) | only Tasks spin while focused | — | [TODO] |

### Lifecycle (right-click menu / create-bar directives)
| Trigger | Applies to | Effect | Guard / unless | Status |
|---|---|---|---|---|
| Mark as Done | task, not-ended | sets `completed`; for OWNER also completes + stamps `closeAt` (next local midnight) | only kinds with `hasDoneState` (task); manual closePolicy skips the stamp | [CUR] |
| Mark as Undone | task, done | clears done + `closeAt` | — | [CUR] |
| Close / Retire / End | fillsWhenClosed or terminal kinds, not-ended | stamps `closeAt` = now-ish; state ⇒ closed / retired / dead | label by `terminal` meta | [CUR] |
| Cancel | closeable, not-ended | state ⇒ cancelled | HIDDEN for `individual` | [CUR] |
| Reopen | any ended | clears close/cancel ⇒ open | only shown when ended | [CUR] |
| Send / Unsend request | task | toggles `requested` (glyph gains a "sent" tail) | task only | [CUR] |
| Start now / End now | moment, not-ended | stamps `schedule.startAt` / `endAt` = Date.now() | not-ended only; no cross-midnight adjust (simple) | [CUR] |
| Set to now | instant, not-ended | stamps `schedule.at` = Date.now() | instant only | [CUR] |
| Set color… (submenu) | any kind | `setEntityAccent(id, hex\|null)`; paints ticks + row | Clear returns to inherited/neutral | [CUR] |
| Change into… | creatable kinds | `changeEntityKind`; may stamp `closeAt` if new kind time-closes | identity kinds excluded | [CUR] |
| Delete | any user/seed | removes (user) or tombstones (seed) | — | [CUR] |

### Time / automatic
| Trigger | Applies to | Effect | Guard / unless | Status |
|---|---|---|---|---|
| Reaching `closeAt` | completed task / ended-end moment | state flips complete ⇒ closed at the frozen instant | `closePolicy:manual` ⇒ never (rests complete/ongoing) | [CUR] |
| Past start, no end | moment (any entity w/ startAt) | state ⇒ `ongoing`; glyph spins (pivots true centroid) | end set ⇒ leaves ongoing | [CUR] |
| Bare `HHMM` time entry | create-bar | resolved into the 5am→5am logical day-window containing now | 6/10-digit tokens keep absolute date | [CUR] |

### Create-bar grammar (see zero-create-field.md for full detail)
| Trigger | Effect | Status |
|---|---|---|
| No `--`/kind hint | default kind = **moment**; title verbatim (no verb inference) | [CUR] |
| `--due` / `--start`/`--end` / `--at` | kind ⇒ task / moment / instant | [CUR] |
| `--start:now` etc. | stamps Date.now() | [CUR] |
| `--<digits>-<digits>` | span shortcut (= `--start:X --end:Y`; date-only end ⇒ +2359) | [CUR] |
| cross-midnight span | moment `endAt<=startAt` ⇒ end +24h | [CUR] |
| title contains another entity's title | auto-tag via `taggedContextIds` (+inherit its accent unless `--color`) | [CUR] |
| `--close:manual\|auto` | sets `closePolicy` (owner-only) | [CUR] |

### Display / derived (not stored)
| Field | Rule | Status |
|---|---|---|
| DURATION / AGE (§0 row) | instant ⇒ 0s; start+end ⇒ span; ongoing (start,no end) ⇒ now−start (live); else ⇒ now−`createdAt`. Label = **AGE for Individual**, else DURATION (label ONLY — no age field, same derived value as any plus-glyph context). Up to THREE adjacent units incl. mo/y, e.g. "35y 1mo 24d" / "1h 30m 5s" | [CUR] |
| Dayline planned tick | ongoing entity (startAt, no endAt) draws start→now (openEnded, as if end=now) until a real end exists; label "· ongoing" | [CUR] |
| Dayline tick vertical align | ALL ticks CENTERED in their lane (planned + presence alike; was planned-hugs-top). Each track is its own Dayline instance/lane so no overlap | [CUR] |
| Entity-content row color dot | a small dot before the title ONLY when the entity has its OWN `accent` (manual/`--color`/menu). Inherited ancestor color NOT painted | [CUR] |
| §0 COLOR meta row | shown only when `accent` set; dt cell paints the swatch, value = raw hex | [CUR] |
| TAGS / TAGGED BY (§0) | forward links + derived reverse (who points here) | [CUR] |

## Maintenance
- On any change to getState / menu-model / create-parse / canvas behaviour, UPDATE the
  affected row(s) and bump the Status tag. Add a row for every NEW trigger.
- Keep effects one-line; link deep detail to the relevant topic doc.
- After editing, the `/matrix-interactions` viewer refreshes automatically on the next
  `pnpm dev` / build (the generator re-inlines this file). No manual copy step.
