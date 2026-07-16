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
| Inline row METAFIELD | any child in ENTITY CONTENT | each row shows a kind-relevant metafield (right-aligned, muted, before the lifecycle token): moment/space → span "start–end · dur" / "since start · dur" (live) / "whenever" / lone "at"; instant → its point time; task → "due …" when set, ELSE its own start/end span / ongoing / at (a task can be scheduled too, not just due); individual → "sex · age"; others → nothing. Time-of-day when same day, else "MMM D, h:mm". Derived via `rowMeta(e, now)`, never stored | hidden on narrow (<sm) widths; empty kinds add no gap | [CUR] |
| Right-click ▸ Hide / Unhide | any child in ENTITY CONTENT | toggles stored `hidden`; row collapses via a long 650ms eased grid-rows slide+fade, siblings renumber | counts/timeline/siblings untouched | [CUR] |
| Right-click ▸ Show hidden / Hide hidden | current context | VIEW toggle (session-only, resets on nav): reveals hidden + auto-hidden children with a `(hidden)` prefix | not a data mutation | [CUR] |
| Auto-hide (derived) | closed child | a child closed BEFORE today's 5am day-start collapses from ENTITY CONTENT | computed from `closeAt`, never stored; revealed by Show hidden | [CUR] |
| PLANNED vs RECORDED rails on the TODAY dayline (OPTION A, v0.4.0; band-grows v0.4.4) | declared/planned span vs recorded engagement | TWO TOUCHING RAILS split at a SEAM, framed PLAN vs REALITY: PLANNED rail (TOP, grows DOWNWARD from band top) = DECLARED spans only (`planned` memo — scheduled occurrences past/future incl. ongoing declared spans); RECORDED rail (BOTTOM, grows downward from the seam) = the viewed entity's RECORDED engagements (`sessions` memo — closed + running). PRESENCE is REMOVED from this lane (now only on the standalone ACTIVITY dayline). Viewing ROOT ⇒ recorded rail == presence (presence = root's engagements). Seam + total band height are DYNAMIC (`bandMetrics(plannedCount, recordedCount)`): resting seam=14px / band=28px with one sub-lane each | combined lane (`tracks="both"`) only; standalone `tracks="presence"` lane stays one centered band | [CUR] |
| RECORDED engagement bars (bottom rail) | any entity in the subtree with `schedule.sessions`/engagements (incl. "whenever" playables) | one bar per engagement touching today, clipped to the day: OPEN (no `endAt`) ⇒ running bar anchored at the now-edge; CLOSED ⇒ completed span. Both `play`+`focus`. Puts a Play'd whenever entity on the dayline | walks `collectDescendants(ROOT_ID)` (playables are un-clocked); key prefix `sess:` routes it to the recorded rail; tooltip appends `· play\|focus [· ongoing]` | [CUR] |
| LANE PACKING within a rail | 2+ spans overlapping in the same rail | greedy interval packing (`packLanes`): each bar takes the lowest lane whose last bar ended at/before its start; else a new lane opens. TOP packs by START (tiling declared spans share lane 0); BOTTOM packs LONGEST-FIRST (longest engagement hugs the seam) — this SUBSUMES the old ongoing stack (all running engagements share the now-edge ⇒ fully overlap ⇒ one lane each, longest nearest seam). Overflow (v0.4.4) = BAND GROWS TALLER: ticks keep FIXED height (`PLANNED_LANE_H=11`/`RECORDED_LANE_H=10`, no shrink), the band's height/seam grow with the sub-lane counts (`bandMetrics`) | DEFERRED (larger §3 sizes): (2) bounded lanes + "+N" marker; band-grow may later be tied to Face size | [PART] |
| Presence tick rounding | a run of contiguous presence segments (one "session of using Zero") | only the FIRST tick of a run rounds its LEFT corners and the LAST rounds its RIGHT; interior ticks are fully SQUARE so a session reads as one continuous pill. A gap (app backgrounded) starts a new run; an isolated tick is fully rounded | `roundLeft/roundRight` derived on the FULL ordered segment list (`prev.leftAt===enteredAt` adjacency) so it survives pan/clip; applies on every lane that paints presence | [CUR] |
| Tick opacity (any dayline) | any tick | PRESENCE ticks fully OPAQUE at all times (the solid record of where I was). PLANNED ticks ALSO full opacity now — the dynamic coverage/faint mapping is DISABLED via `DYNAMIC_PLANNED_OPACITY=false` (v0.3.95; machinery kept for flip-back). Root presence = solid theme-bg chip (near-black dark / near-white light) + grey hairline | root fill themed; no color-muting | [CUR] |
| PAST planned tick opacity (coverage) [DISABLED v0.3.95] | a real-duration planned occurrence fully in the past (end ≤ now) | WHEN `DYNAMIC_PLANNED_OPACITY` ON: opacity reflects how much it was HONORED — fraction of its window overlapped by recorded PRESENCE at that entity or any descendant, mapped LINEARLY between a 0.15 floor (missed) and 0.90 ceiling (fully honored) = `0.15 + coverage × 0.75`. Hover still snaps to full. Currently OFF ⇒ full opacity | one place at a time so segments don't double-count; clamped [0,1]; `coverage` derived in the planned memo, re-runs on activity-log change | [CUR] |
| Dayline tick HIGHLIGHT (cross-component) | HOVER an ENTITY CONTENT row | every dayline tick whose `id` matches the hovered row's entity grows to 26px + goes fully opaque (animated). Threaded as `highlightId` into both daylines (TODAY combined + ACTIVITY presence) | HOVER-ONLY — the open context is deliberately NOT highlighted (a persistent pin felt stuck); cleared on mouse-leave | [CUR] |
| §4 PINNED frame source (display name, formerly FREQUENT/STARTERS) | the §4 band | a CURATED list — exactly the entities the user pinned via the ENTITY CONTENT right-click, resolved in pin order from the global `starterPins` list. The old auto-frequency aggregation (`getFrequentEntities`) NO LONGER feeds §4 (fn + `zero0-frequent.tsx` kept but unused) | shown by default; toggle via §4 / footer "pinned"; flag key stays `"frequent"` for stored-chord back-compat | [CUR] |
| Right-click an ENTITY → "Pin as starter" / "Unpin starter" | any entity | a TOP-LEVEL toggle at the head of the entity menu (above a divider); adds/removes the entity from `starterPins`. Label reflects current membership (computed live per open). Appears on content rows, pinned tiles, and the header — everywhere `openMenu` runs | `starter-pin`/`starter-unpin` are canvas-intercepted (like `size:`/`make:`), not entity-data mutations; `applyEntityMenuAction` returns false for them | [CUR] |
| Click a PINNED tile (frame/title) | a pinned entity | DRILL into the entity (`navigateTo`). No session write here anymore — if it's a Task, the canvas dwell-effect punches it in once you stay past `DWELL_MS` (see below) | navigation only; session accrual is automatic via dwell | [CUR] |
| Click a PINNED tile GLYPH | a pinned entity | STAY on canvas + TOGGLE a `play` session via `toggleSession(id, "play")`: idle → `openSession`; running → `closeSession` (drops the entry if ≤ `MIN_SESSION_MS`). Never navigates | glyph SPINS (outline) while a session is open; `stopPropagation` so it doesn't trigger the frame drill | [CUR] |
| Session storage (all entities) | any entity's clock | sessions/ENGAGEMENTS live ON the entity as `schedule.sessions: {startAt, endAt?, kind}[]` — the last entry lacking `endAt` is the single OPEN (RUNNING) one. These are the RECORD (what actually happened) and are DELIBERATELY NOT mirrored into scalar `startAt/endAt` (those stay the DECLARED plan — e.g. a Play'd "whenever" keeps `startAt:"whenever"`). NOTHING sub-Space is created anymore (the old `Sessions` Space convention is GONE) | `getSessions`/`getOpenSession`/`hasOpenSession` (pure, in kinds.ts); `openSession`/`closeSession`/`toggleSession` (writes, in data.ts) | [CUR] |
| Session single-instance rule | any entity | at most ONE open session at a time — `openSession` is idempotent (no-op if one is already open) | — | [CUR] |
| PINNED tile live meta | a pinned entity with an open session | right of the title: an elapsed count-up (`Nm Ss` / `Nh Nm Ss`) since the open session's `startAt`, ticking each second; nothing when idle | reads `getOpenSession(entity).startAt` | [CUR] |
| PINNED tile dot color | a pinned entity | the entity's own `accent`, else its inherited accent from the parent chain, else the bluey Sleep default (`#5566d8`) for sleep-titled, else grey | reuses the §4 dot palette | [CUR] |
| PINNED empty state | no pins | a muted hint: "— nothing pinned yet — right-click an entity and "Pin as starter" —" | — | [CUR] |
| §4 default state | any load | HIDDEN by default (per request); summon with the §4 chord or the footer "pinned" link. When shown it's expanded, with a chevron to collapse. `starterPins` persists across reload; a running PLAY session survives reload (focus sessions get cleaned — see hydrate row) | `frequent: false` in zero0-chord defaults | [CUR] |
| Color picker free-text (create-bar `--color` + entity "Set color" menu) | any color choice | type a hex (`#8b5a2b`) OR a CSS name (`brown`, `grey`); resolved to hex via the browser parser; invalid text can't commit | shares the swatch `color:<hex>` path | [CUR] |
| Being the focused context | any kind | no immediate state change; a dwell timer starts (see next row) | — | [CUR] |
| DWELL into a Task (whole active path) | task/undone on the `path` | after `DWELL_MS` (~3s) of staying, `openSession(id, "focus")` on EVERY undone Task from root→current — so a subtask's work counts for each ancestor Task. Reads `ongoing` EVERYWHERE (crumb/rows/ticks/activity) purely from `hasOpenSession`. Merely passing through to a deeper context leaves NO session (each nav clears the pending timer) | punch-OUT is immediate on leaving; `MIN_SESSION_MS` discards too-short spans; only tracks what the canvas opened (`focusOpenRef`) | [CUR] |
| Mark a Task Done while it has an open focus session | task with open session | `closeSession` punches it out (a Done task isn't ongoing) even if it stays on the path | done also gates on task-children (see completeSince) | [CUR] |
| Mark a Task UNDONE while still inside it | task on the current `path`, no open session | `toggleDone` immediately re-`openSession(id,"focus")` so the glyph resumes spinning in place — the dwell effect won't re-fire (path unchanged). Fixes: glyph used to stay a static square until you navigated away and back | only when on the path & no session already open | [CUR] |
| ONGOING glyph rotation | any entity reading `ongoing` (open session, or concrete-started moment/space) | glyph rotates clockwise at a calm 10s/turn; angular velocity EASES IN at start (playbackRate ramp) and decelerates OUT to the nearest upright at stop, so it never snaps on/off. No opacity change. Same for every kind | Web Animations API in zero0-glyph.tsx; pivots the shape's visual centroid; skipped under prefers-reduced-motion | [CUR] |
| Glyph click on a PLAYABLE entity (`startAt: "whenever"`) | moment/space, not-ended | Play/Stop toggle → `toggleSession(id, "play")`; opens/closes a background session with NO navigation. Glyph spins while open. Task glyph stays done-toggle; instant stays one-shot — one glyph = one meaning per kind | `isPlayable(e)` = whenever moment/space; also offered as Play/Stop in the right-click menu | [CUR] |

### Lifecycle (right-click menu / create-bar directives)
| Trigger | Applies to | Effect | Guard / unless | Status |
|---|---|---|---|---|
| Mark as Done | task, not-ended | sets `completed`; for OWNER also completes + stamps `closeAt` (next local midnight) — BUT only if all `kind==="task"` children are complete (else "done but open", see below) | only kinds with `hasDoneState` (task); manual closePolicy skips the stamp | [CUR] |
| Mark Done with a still-open task child | task, done, has undone task-child | reads "done but open": keeps the Done checkmark, glyph NOT filled, state word = **`done`** (NEW dedicated word, ranked above ongoing/open; NOT `complete`); does NOT stamp `closeAt`. AUTOCOMPLETES (→ `complete`) the instant every `kind==="task"` child completes. Non-task children never gate | `allTaskChildrenComplete` in completeSince; `getStateInner` returns `{word:"done"}`; `childBreakdown`/`formatState` handle it | [CUR] |
| Play / Stop (menu) | playable moment/space (`startAt: "whenever"`), not-ended | `openSession`/`closeSession` with kind `play` — same as the glyph toggle. Shown INSTEAD of Start now/End now (a whenever entity has no clock time to stamp) | `isPlayable`; label reflects `hasOpenSession` | [CUR] |
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
| Past start, no end | moment OR space with CONCRETE startAt | state ⇒ `ongoing`; glyph spins (pivots true centroid). Space now joins Moment (a live container) | end set ⇒ leaves ongoing; `"whenever"` is NOT concrete ⇒ stays `open` until played | [CUR] |
| Open session present | any entity | state ⇒ `ongoing` purely from `hasOpenSession` ��� highest-priority ongoing branch, view-independent (covers Task focus AND Whenever play) | closes when the session closes | [CUR] |
| CLOSING an entity ends its open engagement (v0.4.2) | any entity with an OPEN engagement that gets Done / Cancelled / Closed | the close writers (`setEntityCompleted`/`setEntityCancelled`/`setEntityClosed`) call `closeSession(id, now)` on transition-to-closed — the engagement's `endAt` is stamped at the close moment (RECORD side, NOT declared `endAt`), so the bar stops printing as ongoing AND opening the entity shows WHEN it ended. HYDRATE cleanup closes pre-existing ORPHAN engagements on any already-closed entity (`isClosed`, any kind incl. `play`), ending at `lastLogAt` | skipped on un-check/restore/reopen (a reopened entity may run again); sub-`MIN_SESSION_MS` spans dropped. Distinct from the focus-cleanup that keeps a `play` stopwatch running while the entity is still OPEN | [CUR] |
| CLOSED occurrence, no declared end — dayline clamp (v0.4.3) | a CLOSED Moment/Space with a `startAt` but no `endAt` and NO engagement (so v0.4.2's `closeSession` can't reach it) | the `planned` memo no longer marks a CLOSED occurrence `ongoing`; lacking an `endAt` it terminates the bar at `computeCloseAt` (the RECORD close time) instead of stretching to now. A close time before the visible window ⇒ the bar simply doesn't render (correct — it ended earlier). SECOND, independent ghost-bar source alongside v0.4.2 (engagement-less) | `isClosed(occ)` + `computeCloseAt(occ)` in the memo; declared `endAt` still wins when present | [CUR] |
| ONGOING ROLLUP (v0.4.0) | any NON-ROOT entity with a CONTAINED descendant that is ongoing | state ⇒ `ongoing` (lowest-priority ongoing branch, below own open-session / own concrete-span): a Space spins while anything CONTAINED inside it runs. Follows `parentId` CONTAINMENT ONLY — a merely TAGGED-in ongoing entity does NOT light up its tagger. Recurses the subtree, short-circuits on first ongoing descendant (`containedOngoingSince` + `_containedResolver`, separate from `getChildren`) | STOPS BELOW ROOT: the root Individual (`parentId===null`) never gains ongoing from rollup (else it'd always spin) — root liveness = its own presence engagement, separate. Complete/done/cancelled entities keep their word (rollup ranks below them) | [CUR] |
| Reload with a dangling session | any entity | hydrate closes any open FOCUS session at the entity's last log stamp (dropping if ≤ `MIN_SESSION_MS`) — focus time shouldn't accrue while the app is closed. PLAY stopwatches (moment/space) are LEFT RUNNING | `[DECISION BAKED]` in `hydrateFromStorage`; easy to flip | [CUR] |
| Bare `HHMM` time entry | create-bar | resolved into the 5am→5am logical day-window containing now | 6/10-digit tokens keep absolute date | [CUR] |

### Create-bar grammar (see zero-create-field.md for full detail)
| Trigger | Effect | Status |
|---|---|---|
| No `--`/kind hint | default kind = **moment**; title verbatim (no verb inference) | [CUR] |
| `--due` / `--start`/`--end` / `--at` | kind ⇒ task / moment / instant | [CUR] |
| `--start:now` etc. | stamps Date.now() | [CUR] |
| `--end: 5min ago` / `--start: in 2h` | RELATIVE offset from now — `<dur> ago` (past) / `in <dur>` (future); `<dur>` = full duration grammar incl. word units (`5min`, `2 hours`, `1h30m`). Captured WHOLE despite the space (dedicated parseEntry passes before the single-token pass). E.g. ends an ongoing entity at now−5min | [CUR] |
| `--start:whenever` | marks the entity PLAYABLE — `startAt: "whenever"` (a trackable thing with no fixed clock time; glyph/menu offer Play/Stop). Only valid on `--start` | [CUR] |
| `--<digits>-<digits>` | span shortcut (= `--start:X --end:Y`; date-only end ⇒ +2359) | [CUR] |
| cross-midnight span | moment `endAt<=startAt` ⇒ end +24h | [CUR] |
| title contains another entity's title | auto-tag via `taggedContextIds` (+inherit its accent unless `--color`) | [CUR] |
| `--close:manual\|auto` | sets `closePolicy` (owner-only) | [CUR] |
| `--duration:<len>` | sets explicit `schedule.duration` (MINUTES) on ANY kind, independent of start. Accepts `1h30m` / `90` (bare = min) / `2h` / `45s` / `2d` / `1:30`; empty clears. Does NOT change inferred kind | [CUR] |

### Display / derived (not stored)
| Field | Rule | Status |
|---|---|---|
| DURATION / AGE (§0 row) | EXPLICIT `schedule.duration` (via `--duration`) wins for ANY kind regardless of start; ELSE: instant ⇒ 0s; HAS SESSIONS ⇒ Σ session spans (open one live to now) — the tracked-time source for a "whenever" playable thing; start+end ⇒ span; ongoing (concrete start, no end) ⇒ now−start (live); BEING (individual/organism) with no span/sessions ⇒ now−`createdAt` (AGE); ELSE ⇒ "—". A merely-open "whenever" moment/space with NO session reads "—". Label = **AGE for individual/organism**, else DURATION. Up to THREE adjacent units incl. mo/y | [CUR] |
| START / END rows (§0) | shown ALWAYS (— when unset, "whenever" when playable) for MOMENT and SPACE (both span-bearing); instant shows "at"; task shows "due"/condensed "scheduled"; other kinds only surface a schedule row when set | [CUR] |
| Dayline planned tick | ongoing entity (startAt, no endAt) draws start→now (openEnded, as if end=now) until a real end exists; label "· ongoing" | [CUR] |
| Dayline tick vertical align | single-track lane ⇒ ticks centered (top:50%). COMBINED lane ⇒ two TOUCHING rails split at a DYNAMIC seam (`bandMetrics`): each tick centers on its PACKED LANE center (`laneGeom` — planned lanes stack downward from the band top, recorded lanes stack downward from the seam), FIXED heights, via `-translate-y-1/2` off a numeric `railTop`. The day label pins to the first planned sub-lane center (`DAY_LABEL_CENTER_PX`) and stays there as the rail grows | [CUR] |
| Website content zoom (desktop) | trackpad pinch OR ⌘/Ctrl + scroll OR ⌘/Ctrl + = / - / 0 over an embedded web resource | steps that resource's `WebContentsView` zoom factor (0.3–5×, 0.1 steps; 0 resets to 100%). Per-tab, so each resource keeps its own scale. Electron-only (`zoom-changed` + `before-input-event` in main.cjs) | [CUR] |
| Entity-content row color dot | a small dot before the title ONLY when the entity has its OWN `accent` (manual/`--color`/menu). Inherited ancestor color NOT painted | [CUR] |
| §0 COLOR meta row | shown only when `accent` set; dt cell paints the swatch, value = raw hex | [CUR] |
| TAGS / TAGGED BY (§0) | forward links + derived reverse (who points here) | [CUR] |

## Maintenance
- On any change to getState / menu-model / create-parse / canvas behaviour, UPDATE the
  affected row(s) and bump the Status tag. Add a row for every NEW trigger.
- Keep effects one-line; link deep detail to the relevant topic doc.
- After editing, the `/matrix-interactions` viewer refreshes automatically on the next
  `pnpm dev` / build (the generator re-inlines this file). No manual copy step.
