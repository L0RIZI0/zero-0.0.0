/**
 * INTERACTION MATRIX — raw doc content, rendered by /matrix-interactions.
 *
 * This is a verbatim copy of the living tracking doc kept at
 * `v0_memories/user/zero-interaction-matrix.md`. That file lives OUTSIDE the app
 * bundle (it's a memory doc, not shipped), so to display it in the WEB PREVIEW we
 * embed the markdown here as a string and render it with react-markdown.
 *
 * KEEP IN SYNC: when the memory doc changes, update this string too (the page is a
 * viewer, not the source of truth). The status legend + tables are GFM markdown.
 */
export const INTERACTION_MATRIX_MD = String.raw`# Zero — interaction matrix (what-triggers-what)

The single place that answers "when the user does X to a [kind] entity in [state], what
happens (and what's the guard)?" Use it to check a NEW request against existing behaviour
BEFORE building — if a request contradicts a CURRENT row, flag it; if it fills a PROPOSED
row, cross-check the TODO ledger.

Status tags: **[CUR]** = built + verified today · **[PART]** = partially built ·
**[TODO]** = proposed/awaiting decision (see TODO ledger).

## Vocabulary
- **kinds**: soul · individual · organism · community · space · resource · task · moment · instant.
- **states** (\`getState().word\`, one axis, mutually exclusive; kinds.ts): \`open\` → \`complete\`
  → \`closed\`; plus \`ongoing\`, \`cancelled\`, terminal \`dead\`/\`retired\`. \`open\` includes a
  reopened entity.
- **axes/fields**: \`schedule{startAt,endAt,at,dueAt}\` · \`closeAt\` (frozen close instant) ·
  \`closePolicy\` ('manual' opts out of auto midnight-close) · \`completed\` (task done scalar) ·
  \`accent\` (color) · \`taggedContextIds\` (multi-parent links) · \`createdAt\`/\`ownerId\`/\`createdBy\`.

## TRIGGERS

### Navigation
| Trigger | Applies to | Effect | Guard / unless | Status |
|---|---|---|---|---|
| Drill into (open) an entity | any kind | Records a presence segment (activity log); becomes the breadcrumb leaf | no-op if same id repeated | [CUR] |
| Being the focused context | any kind | (today) no state change | — | [CUR] |
| Enter a Task with empty \`startAt\` | task/open | SHOULD read \`ongoing\` + glyph spins while inside; revert on exit | all-children-open ⇒ back to open, else ongoing no-spin | [TODO] |
| Focused-context spin scope | task only (proposed) | only Tasks spin while focused | — | [TODO] |

### Lifecycle (right-click menu / create-bar directives)
| Trigger | Applies to | Effect | Guard / unless | Status |
|---|---|---|---|---|
| Mark as Done | task, not-ended | sets \`completed\`; for OWNER also completes + stamps \`closeAt\` (next local midnight) | only kinds with \`hasDoneState\` (task); manual closePolicy skips the stamp | [CUR] |
| Mark as Undone | task, done | clears done + \`closeAt\` | — | [CUR] |
| Close / Retire / End | fillsWhenClosed or terminal kinds, not-ended | stamps \`closeAt\` = now-ish; state ⇒ closed / retired / dead | label by \`terminal\` meta | [CUR] |
| Cancel | closeable, not-ended | state ⇒ cancelled | HIDDEN for \`individual\` | [CUR] |
| Reopen | any ended | clears close/cancel ⇒ open | only shown when ended | [CUR] |
| Send / Unsend request | task | toggles \`requested\` (glyph gains a "sent" tail) | task only | [CUR] |
| Start now / End now | moment, not-ended | stamps \`schedule.startAt\` / \`endAt\` = Date.now() | not-ended only; no cross-midnight adjust (simple) | [CUR] |
| Set to now | instant, not-ended | stamps \`schedule.at\` = Date.now() | instant only | [CUR] |
| Set color… (submenu) | any kind | \`setEntityAccent(id, hex|null)\`; paints ticks + row | Clear returns to inherited/neutral | [CUR] |
| Change into… | creatable kinds | \`changeEntityKind\`; may stamp \`closeAt\` if new kind time-closes | identity kinds excluded | [CUR] |
| Delete | any user/seed | removes (user) or tombstones (seed) | — | [CUR] |

### Time / automatic
| Trigger | Applies to | Effect | Guard / unless | Status |
|---|---|---|---|---|
| Reaching \`closeAt\` | completed task / ended-end moment | state flips complete ⇒ closed at the frozen instant | \`closePolicy:manual\` ⇒ never (rests complete/ongoing) | [CUR] |
| Past start, no end | moment (any entity w/ startAt) | state ⇒ \`ongoing\`; glyph spins (pivots true centroid) | end set ⇒ leaves ongoing | [CUR] |
| Bare \`HHMM\` time entry | create-bar | resolved into the 5am→5am logical day-window containing now | 6/10-digit tokens keep absolute date | [CUR] |

### Create-bar grammar (see zero-create-field.md for full detail)
| Trigger | Effect | Status |
|---|---|---|
| No \`--\`/kind hint | default kind = **moment**; title verbatim (no verb inference) | [CUR] |
| \`--due\` / \`--start\`/\`--end\` / \`--at\` | kind ⇒ task / moment / instant | [CUR] |
| \`--start:now\` etc. | stamps Date.now() | [CUR] |
| \`--<digits>-<digits>\` | span shortcut (= \`--start:X --end:Y\`; date-only end ⇒ +2359) | [CUR] |
| cross-midnight span | moment \`endAt<=startAt\` ⇒ end +24h | [CUR] |
| title contains another entity's title | auto-tag via \`taggedContextIds\` (+inherit its accent unless \`--color\`) | [CUR] |
| \`--close:manual|auto\` | sets \`closePolicy\` (owner-only) | [CUR] |

### Display / derived (not stored)
| Field | Rule | Status |
|---|---|---|
| DURATION / AGE (§0 row) | instant ⇒ 0s; start+end ⇒ span; ongoing (start,no end) ⇒ now−start (live); else ⇒ now−\`createdAt\`. Label = **AGE for Individual**, else DURATION (label ONLY — no age field, same derived value as any plus-glyph context). Up to THREE adjacent units incl. mo/y, e.g. "35y 1mo 24d" / "1h 30m 5s" | [CUR] |
| Dayline planned tick | ongoing entity (startAt, no endAt) draws start→now (openEnded, as if end=now) until a real end exists; label "· ongoing" | [CUR] |
| Dayline tick vertical align | ALL ticks CENTERED in their lane (planned + presence alike; was planned-hugs-top). Each track is its own Dayline instance/lane so no overlap | [CUR] |
| Entity-content row color dot | a small dot before the title ONLY when the entity has its OWN \`accent\` (manual/\`--color\`/menu). Inherited ancestor color NOT painted | [CUR] |
| §0 COLOR meta row | shown only when \`accent\` set; dt cell paints the swatch, value = raw hex | [CUR] |
| TAGS / TAGGED BY (§0) | forward links + derived reverse (who points here) | [CUR] |

## Maintenance
- On any change to getState / menu-model / create-parse / canvas behaviour, UPDATE the
  affected row(s) and bump the Status tag. Add a row for every NEW trigger.
- Keep effects one-line; link deep detail to the relevant topic doc.
`
