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
| FREQUENT tile: single-instance rule | recurring activity | a tile allows only ONE occurrence running at a time — starting a fresh one (frame/glyph click, or logging an ongoing block) first punches OUT any current ongoing (enforced in canvas punch-in/log paths) | pre-existing multi-ongoing seed data is left alone; the rule prevents future accumulation | [CUR] |
| Click a FREQUENT tile FRAME (whole card, §4) | recurring activity (kind+title, ≥2 in last 30d) | a TOGGLE. IDLE → punch IN (create a same-kind+title occurrence `startAt`=now under the activity's USUAL parent) and DRILL in (create + open + ongoing). RUNNING → END the ongoing occurrence (stamp `endAt`=now) and STAY where you are (no navigation) — clicking the same tile again from anywhere punches it out | whole card is the click target; running-click ENDS now (no longer just opens); band shown by default, toggle §4 / footer "frequent" | [CUR] |
| Click a FREQUENT tile GLYPH | recurring activity | IDLE → punch IN + STAY on canvas (start without drilling). RUNNING → punch OUT (end) the ongoing occurrence, stay on canvas — never starts a second | glyph SPINS (outline, never filled) while ongoing; `stopPropagation` so it doesn't trigger the frame | [CUR] |
| §4 default state | any load | EXPANDED by default; NEVER auto-collapses (punch in/out, open, log all leave it as-is). A chevron in the header manually expands/collapses; height change is animated | replaced the old auto-collapse-on-next-click behaviour | [CUR] |
| FREQUENT tile layout | the tile band | tiles stack HORIZONTALLY at natural width (wrap to new rows as needed), each a bordered card with header + its own vertical list below. When §4 is COLLAPSED the per-tile list is clipped to `max-w-0` too, so a running tile hugs its header (no width inflation to the wide list) | not equal-width; not a vertical stack | [CUR] |
| FREQUENT tile header meta slot (right of title) | n = ongoing count | n≥2 → `(n)`; n==1 → the ongoing instance's live meta: a down-counter `Nm Ss left` if it has a future end, else elapsed count-up `Nh Nm Ss`; n==0 → nothing | occupies the old `(n)` position | [CUR] |
| Expanded-list membership | a recurring activity's occurrences | list shows every ONGOING **or** COMPLETE-not-closed occurrence (finished, awaiting overnight filing); ended/closed drop out | oldest first | [CUR] |
| Expanded-list row duration | a list row | SECONDS shown only on ONGOING rows (`1h 35m 00s`); COMPLETE rows show `Nh Nm` (no seconds) | glyph fill matches header via `fillsGlyph`: complete filled, ongoing outline | [CUR] |
| In the expanded list: click a row GLYPH | an ongoing occurrence | punch OUT: stamp its `endAt`=now (tz-stable close); stays on canvas; §4 stays expanded | complete rows have no punch-out | [CUR] |
| In the expanded list: click a row TITLE/meta | an ongoing or complete occurrence | OPEN (drill into) it, no punch-out; §4 stays expanded | — | [CUR] |
| Right-click a FREQUENT tile → POPOVER | recurring activity | ONE popover: a bulk-action row on top, then the block log form below — no "Log…" step. **End all (n)** punches every ONGOING out → complete (disabled when 0 ongoing). **Close all (m)** force-closes every LISTED occurrence now — ongoing AND complete — clearing the tile list (disabled only when the list is empty, so it still sweeps complete rows End all leaves) | Escape/backdrop dismiss; bulk ops stay on canvas | [CUR] |
| Popover log form | recurring activity | START time + DURATION (chips set it / number) + binary **ended: yes/no** toggle (default NO). NO → commit button **"Start Now"**, files an ONGOING occurrence at now. YES → start recalculated back by duration (end anchored ≈now), button "Log · span", files a COMPLETE block [start, start+dur] | toggling recalcs start so end stays put; changing duration while ended keeps end anchored; never future-dated | [CUR] |
| FREQUENT tile dot color | frequent activity | newest member that ACTUALLY carries an `accent` (NOT strictly the latest, whose accent may be blank after a punch-in), else the bluey Sleep default (`#5566d8`) for sleep-titled, else grey | fixes the dot greying after an accent-less punch-in | [CUR] |
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
