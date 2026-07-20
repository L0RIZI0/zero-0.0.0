"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import type { EntityKind } from "@/lib/zero/types"

/**
 * ZERO ENTITIES — the ontology reference ("the bible of Zero entities").
 *
 * This is a DOCUMENTATION page. Its content is authored directly from the
 * ontology draft rather than derived from the runtime model, because it
 * documents things the model doesn't encode yet:
 *   - ENTITY and EVERYTHING are ABSTRACTIONS, not runtime kinds — shown here as
 *     document-only rows (their glyphs are drawn inline below, since they have no
 *     entry in Zero0Glyph).
 *   - the shared Meta (the cascaded fields every entity carries), including the
 *     children/tagged REFERENCES that groundwork the reference-based future.
 *
 * KEY REFRAME: Entity is the ESSENCE of every entity; Space is just one KIND (the
 * one that contains). Not every entity is a Space, but every Space is an Entity.
 *
 * GLYPH STATES are RENDERED, not described: each card shows a little row of the
 * actual silhouettes via <Zero0Glyph>, so the page reads its own glyphs instead of
 * narrating them.
 *
 * STATE MODEL (current): every entity resolves to ONE computed STATE word via
 * getState(), layered by priority: cancelled → closed/dead/retired (a terminal close)
 * → complete → done → ongoing → open. "complete" is the resting word for a FILLABLE
 * kind whose time/verdict has passed (filled + faded); "ongoing" SPINS the glyph.
 * Under the words sit two mechanics: CLOSE (open → closed, every kind, always fades)
 * and DONE (a soft checkmark that does NOT close — Task ONLY now). BEINGS
 * (soul/individual/organism/community) rest at their own presence ("alive"/"open"),
 * never made "ongoing" by what they contain (see the ONGOING + rollup note below).
 */

/** A glyph is either a real runtime kind (drawn by Zero0Glyph) or one of the two
 *  document-only abstractions drawn inline here. */
type GlyphKey = EntityKind | "entity" | "everything"

/**
 * One rendered glyph-state chip within a card. The visual axes map onto the two-axis
 * model:
 *   - `showCheck` → DONE (soft marker, Task/Moment/Instant only — does not close);
 *   - `filled`    → CLOSED for a FILLABLE kind (fill DERIVES from close) — this IS the
 *                   "complete" look; usually paired with `faded`;
 *   - `faded`     → CLOSED (the row fades). Alone = a terminal close (retire/die) that
 *                   keeps its outline; with `filled` = a fillable kind's complete;
 *   - `struck`    → CANCELLED (a bar over the glyph + strikethrough — also closes).
 * `filled`/`showCheck`/`struck` are drawn by Zero0Glyph; `faded` is applied as opacity
 * at the chip level.
 */
type GlyphStateSpec = {
  label: string
  filled?: boolean
  showCheck?: boolean
  struck?: boolean
  faded?: boolean
}

type EntityRow = {
  /** Hierarchy code from the ontology, e.g. "0.0.3". `null` = not yet assigned. */
  code: string | null
  name: string
  glyph: GlyphKey
  glyphDesc: string
  /** Short essence line. */
  desc: string
  /** Creatable by an Individual. */
  creatable: "yes" | "no" | "some"
  /** Terse lifecycle summary (open/closed, done, permanent, mortal…). */
  lifecycle: string
  /** Extra field / behavior bullets (optional). */
  fields?: string[]
  /** RENDERED glyph states for this kind (optional; real kinds only). */
  states?: GlyphStateSpec[]
  /** Glyph-state or other special notes (optional). */
  special?: ReactNode
}

// ── The essence & the roots ────────────────────────────────────────────────
// The abstract base and the two singular roots. These sit apart from the
// ordinary creatable kinds.
const FOUNDATIONS: EntityRow[] = [
  {
    code: "0.0.0",
    name: "Entity",
    glyph: "entity",
    glyphDesc: "A large plus sign with a missing center",
    desc: "Something that is, was, will be, or could be — the brick of Zero, what every context is.",
    creatable: "some",
    lifecycle: "Some kinds open / closed",
    fields: [
      "The base every kind extends: all kinds inherit the shared Meta below.",
      "STATE: every entity resolves to ONE computed word \u2014 open, ongoing, done, complete, closed, cancelled, dead, or retired \u2014 read live by getState() and shown on the glyph.",
      "CLOSE (open \u2192 closed) belongs to every kind and always FADES the row. Fillable kinds (Task, Space, Resource, Moment, Instant) also FILL their glyph when closed \u2014 that filled+faded state is what we call \u201Ccomplete.\u201D Terminal kinds (Community, Organism, Individual) just fade on close, keeping their outline (retire / die).",
      "DONE (done \u2192 undone) is a SECOND, softer mechanic \u2014 a checkmark that does NOT close \u2014 carried only by Task now (Moment/Instant dropped it; they auto-close when their time passes).",
      "ONGOING spins the glyph. Sources: an open SESSION (a Task being worked on, or a \u201Cwhenever\u201D Moment/Space playing), a Moment/Space with a concrete started span still running, or ROLLUP \u2014 a container spins while anything CONTAINED inside it runs. Rollup STOPS at the first BEING (a person isn\u2019t \u201Congoing,\u201D just alive).",
      "Any entity can be CANCELLED (called off): a bar is laid over its glyph and its title is struck through. Cancel also closes.",
      "Entities keep a record of who has access to them, who accessed them, and when (gathered in an auto-created Community).",
    ],
  },
  {
    code: "0.1.0",
    name: "Everything",
    glyph: "everything",
    glyphDesc: "A large filled disk (an empty circle denotes Nothing)",
    desc: "The set of every entity ever created, rooted at the highest known parent.",
    creatable: "no",
    lifecycle: "Permanent",
    special: "All Meta is null except ID, Title (\u201Ceverything\u201D) and Description.",
  },
  {
    code: "0.2.0",
    name: "Soul",
    glyph: "soul",
    glyphDesc: "A thick centered dot",
    desc: "Something conscious — a point of view in time.",
    creatable: "no",
    lifecycle: "Open / closed",
    special: "The glyph of the closed state carries a small bar over it.",
  },
]

// ── The kinds ────────────────────────────────────────────────────────────────
// The ordinary entity kinds, in hierarchy order.
const KINDS: EntityRow[] = [
  {
    code: "0.0.1",
    name: "Individual",
    glyph: "individual",
    glyphDesc: "A rotated \u201Cz\u201D",
    desc: "The Space of an Individual — a human being.",
    creatable: "yes",
    lifecycle: "Alive / dead (fades)",
    fields: [
      "Same Meta as Entity, plus residence (geographical position).",
      "A BEING: its open state reads \u201Calive,\u201D and it is NEVER made \u201Congoing\u201D by what it contains \u2014 the ongoing rollup stops here (so the root Individual stays \u201Calive\u201D while its Spaces spin).",
    ],
    states: [
      { label: "Alive — outline" },
      { label: "Dead — faded, outline kept", faded: true },
    ],
    special:
      "The glyph gains a dot for Zero Citizens (Conscious Individuals). None exist yet except uzer0 (userID 0), which has privileged access to everything; uzer1 (userID 1) is Loris, a regular user.",
  },
  {
    code: "0.0.2",
    name: "Space",
    glyph: "space",
    glyphDesc: "A regular hexagon",
    desc: "Something that contains.",
    creatable: "yes",
    lifecycle: "Open / ongoing / closed",
    fields: [
      "No DONE checkmark \u2014 a Space simply closes; closing fills its glyph and fades the row (\u201Ccomplete\u201D).",
      "ONGOING (glyph spins) when it has a concrete started span still running, OR by ROLLUP while anything CONTAINED inside it is ongoing.",
    ],
    states: [
      { label: "Open" },
      { label: "Ongoing — outline spins" },
      { label: "Closed (complete) — filled + faded", filled: true, faded: true },
      { label: "Cancelled — barred", struck: true, faded: true },
    ],
  },
  {
    code: "0.0.3",
    name: "Task",
    glyph: "task",
    glyphDesc: "A square",
    desc: "Something to do.",
    creatable: "yes",
    lifecycle: "Open / ongoing / done / closed",
    fields: [
      "The only kind that still carries DONE (a checkmark). Done says the work happened; it does NOT close the task on its own.",
      "ONGOING (glyph spins) while the task is being worked on \u2014 an open focus SESSION, opened when you dwell inside it and closed when you leave.",
      "Marking Done while a child task is still incomplete reads \u201Cdone\u201D (checkmark, not yet complete); it auto-completes once every task-child completes.",
      "CLOSING the task fills its glyph and fades the row \u2014 that filled+faded state is \u201Ccomplete.\u201D A done task auto-closes at the next local midnight (filed overnight).",
    ],
    states: [
      { label: "Open" },
      { label: "Ongoing — outline spins" },
      { label: "Done — check, stays open", showCheck: true },
      { label: "Closed (complete) — filled + faded", filled: true, faded: true },
      { label: "Cancelled — barred + struck", struck: true, faded: true },
    ],
  },
  {
    code: "0.0.4",
    name: "Resource",
    glyph: "resource",
    glyphDesc: "A diamond",
    desc: "Something to use.",
    creatable: "yes",
    lifecycle: "Open / closed",
    fields: ["No DONE axis \u2014 no checkmark. It simply closes; closing fills its glyph and fades the row (\u201Ccomplete\u201D)."],
    states: [
      { label: "Open" },
      { label: "Closed (complete) — filled + faded", filled: true, faded: true },
      { label: "Cancelled — barred", struck: true, faded: true },
    ],
  },
  {
    code: "0.0.5",
    name: "Moment",
    glyph: "moment",
    glyphDesc: "An equilateral triangle pointing up",
    desc: "A span in time — usually two Instants defining that span.",
    creatable: "yes",
    lifecycle: "Open / ongoing / closed",
    fields: [
      "No DONE checkmark anymore \u2014 a Moment auto-CLOSES (fills + fades) once its span has passed.",
      "ONGOING (glyph spins) while its concrete span is in progress (started, not yet ended), or while a \u201Cwhenever\u201D Moment is being played (an open session).",
    ],
    states: [
      { label: "Open" },
      { label: "Ongoing — outline spins" },
      { label: "Closed (complete) — filled + faded", filled: true, faded: true },
      { label: "Cancelled — barred + struck", struck: true, faded: true },
    ],
  },
  {
    code: "0.0.6",
    name: "Instant",
    glyph: "instant",
    glyphDesc: "An equilateral triangle pointing down",
    desc: "A point in time — a single Instant, possibly recurrent.",
    creatable: "yes",
    lifecycle: "Open / closed",
    fields: ["No DONE checkmark anymore \u2014 an Instant auto-CLOSES (fills + fades) once its point has passed."],
    states: [
      { label: "Open" },
      { label: "Closed (complete) — filled + faded", filled: true, faded: true },
      { label: "Cancelled — barred + struck", struck: true, faded: true },
    ],
  },
  {
    code: "0.0.7",
    name: "Community",
    glyph: "community",
    glyphDesc: "A regular pentagon",
    desc: "A shared Space with an Access Rule.",
    creatable: "yes",
    lifecycle: "Open / retired (fades)",
    fields: ["Not completable — it reaches a TERMINAL end (retired) rather than being done or completed."],
    states: [
      { label: "Open" },
      { label: "Retired — faded", faded: true },
    ],
  },
  {
    code: "0.0.8",
    name: "Organism",
    glyph: "organism",
    glyphDesc: "A regular circle",
    desc: "A living entity — a company, an institution, a point of view.",
    creatable: "yes",
    lifecycle: "Alive / dead (fades)",
    fields: ["Not completable — it reaches a TERMINAL end (dead) rather than being done or completed."],
    states: [
      { label: "Alive" },
      { label: "Dead — faded", faded: true },
    ],
  },
]

// The cascaded Meta — the fields every entity carries (fields 0–8 of Entity).
const META_FIELDS: { n: number; label: string; note: string }[] = [
  { n: 0, label: "ID", note: "A stable identifier — an entity is its id, never its title." },
  {
    n: 1,
    label: "Instants log",
    note: "Creation (\u201Cbirth\u201D), done marks, close/reopen and cancel dates, access entries & exits with who and when, status changes, and rebirth suggestions.",
  },
  { n: 2, label: "Title", note: "A mutable, possibly repeated label." },
  { n: 3, label: "Description", note: "A list of entities plus a layout." },
  { n: 4, label: "Render", note: "A string describing how the entity renders visually." },
  {
    n: 5,
    label: "Optional Instants",
    note: "DueDate (a timestamp; 0 means no due date) and Timebox (a duration in ms; 0 means none).",
  },
  {
    n: 6,
    label: "Start / end Instants",
    note: "A list where every odd Instant is a startDate and every even one an endDate.",
  },
  { n: 7, label: "Children references", note: "References to the entities this one contains." },
  { n: 8, label: "Tagged references", note: "References to entities tagged onto this one (multi-parent)." },
]

// Aggregate LENSES — views over the shared pool of entities, not kinds. Each
// layer adds to the one before it.
const LENSES: { name: string; formula: string; blurb: string }[] = [
  { name: "Population", formula: "All Individuals", blurb: "Every person, considered alone." },
  {
    name: "Society",
    formula: "Individuals + Organisms",
    blurb: "People together with the living entities they form.",
  },
  {
    name: "Culture",
    formula: "Individuals + Organisms + Law + Art",
    blurb: "Society plus the rules it lives by and the artifacts it makes — artworks, urbanism, and the rest.",
  },
]

// The STATE words getState() can resolve to, in the priority order it checks them.
// This mirrors lib/zero/kinds.ts (StateWord + getStateInner) and face-model formatState.
const STATE_WORDS: { word: string; blurb: string }[] = [
  { word: "cancelled", blurb: "Called off — a bar over the glyph, title struck; also closes. Highest priority." },
  {
    word: "closed / dead / retired",
    blurb:
      "The lifecycle ended (manually or when a stamped time passed). Death-terminal beings read \u201Cdead\u201D (with age), Communities \u201Cretired,\u201D everything else \u201Cclosed.\u201D Always fades.",
  },
  { word: "complete", blurb: "A fillable kind whose time/verdict has passed — filled + faded. May still auto-close later." },
  { word: "done", blurb: "A Task marked Done but still gated by an incomplete task-child. Checkmark, not yet complete." },
  {
    word: "ongoing",
    blurb:
      "Glyph SPINS. An open session, a running concrete span, or rollup from a contained descendant (stopping at the first being).",
  },
  { word: "open", blurb: "The resting default. Death-terminal beings render this as \u201Calive.\u201D" },
]

/** The two document-only glyphs (no Zero0Glyph entry). Drawn to sit in a 24-box,
 *  inheriting the current text color like Zero0Glyph does. */
function EntityGlyph() {
  // A plus sign with a MISSING CENTER — four bars pointing in from the edges,
  // leaving a gap in the middle.
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" fill="currentColor" aria-hidden>
      <rect x="10.6" y="2.5" width="2.8" height="6.2" rx="0.4" />
      <rect x="10.6" y="15.3" width="2.8" height="6.2" rx="0.4" />
      <rect x="2.5" y="10.6" width="6.2" height="2.8" rx="0.4" />
      <rect x="15.3" y="10.6" width="6.2" height="2.8" rx="0.4" />
    </svg>
  )
}

function EverythingGlyph() {
  // A large filled disk (the set of all entities). An empty circle would denote
  // Nothing — shown in the glyph-states legend.
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" fill="currentColor" aria-hidden>
      <circle cx="12" cy="12" r="9.7" />
    </svg>
  )
}

/** Renders a row's glyph — a real kind via Zero0Glyph, or a document-only inline glyph. */
function RowGlyph({ glyph }: { glyph: GlyphKey }) {
  if (glyph === "entity") return <EntityGlyph />
  if (glyph === "everything") return <EverythingGlyph />
  return <Zero0Glyph kind={glyph} />
}

/** Creatable pill. */
function CreatableTag({ creatable }: { creatable: EntityRow["creatable"] }) {
  const label = creatable === "yes" ? "Creatable" : creatable === "some" ? "Some kinds" : "System"
  const creatableStyle = creatable === "no"
    ? "border border-border text-muted-foreground"
    : "bg-secondary text-secondary-foreground"
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${creatableStyle}`}>
      {label}
    </span>
  )
}

/** A row of RENDERED glyph states for a kind: each chip draws the real silhouette
 *  in the given state (open / done / complete / closed / cancelled) with a caption
 *  below. A plain-`closed` chip fades (opacity) since the silhouette is unchanged. */
function GlyphStates({ kind, states }: { kind: EntityKind; states: GlyphStateSpec[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-3">
      {states.map((s) => (
        <li
          key={s.label}
          className="flex min-w-[64px] flex-col items-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-2 text-center"
        >
          <span
            className="inline-flex h-6 w-6 items-center justify-center text-foreground"
            style={s.faded ? { opacity: 0.5 } : undefined}
          >
            <Zero0Glyph kind={kind} filled={s.filled} done={s.showCheck} cancelled={s.struck} />
          </span>
          <span className="text-pretty text-[10px] leading-tight text-muted-foreground">{s.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** A single entity card: glyph, name, code, pills, essence, fields, rendered
 *  glyph states, and any special note. */
function EntityCard({ row }: { row: EntityRow }) {
  return (
    <li className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground">
      <span
        className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center text-foreground"
        title={row.glyphDesc}
      >
        <RowGlyph glyph={row.glyph} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">{row.name}</h3>
          {row.code && (
            <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {row.code}
            </code>
          )}
          <CreatableTag creatable={row.creatable} />
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
            {row.lifecycle}
          </span>
        </div>
        <p className="mt-1.5 text-pretty text-xs leading-relaxed text-muted-foreground">{row.desc}</p>
        <p className="mt-1 text-[11px] italic leading-relaxed text-muted-foreground/80">{row.glyphDesc}</p>
        {row.fields && (
          <ul className="mt-2 space-y-1">
            {row.fields.map((f, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
                <span aria-hidden className="text-muted-foreground/50">
                  &middot;
                </span>
                <span className="text-pretty">{f}</span>
              </li>
            ))}
          </ul>
        )}
        {row.states && <GlyphStates kind={row.glyph as EntityKind} states={row.states} />}
        {row.special && (
          <p className="mt-2 text-pretty text-[11px] leading-relaxed text-muted-foreground">{row.special}</p>
        )}
      </div>
    </li>
  )
}

export default function ZeroEntitiesPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Zero
        </Link>

        <header className="mt-8">
          <h1 className="text-pretty text-2xl font-semibold tracking-tight">Zero Entities</h1>
          <p className="mt-3 max-w-prose text-pretty leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">Entity</strong> is the essence of everything in Zero —
            &ldquo;something that is, was, will be, or could be,&rdquo; the brick every context is made of. Each
            entity has a <em>kind</em> that gives it a glyph and a behavior, and layers its own fields on top of the
            shared Meta below.
          </p>
          <p className="mt-2 max-w-prose text-pretty leading-relaxed text-muted-foreground">
            A <strong className="font-medium text-foreground">Space</strong> — the kind that contains — is the one
            closest to Entity itself. So <em>not every entity is a Space, but every Space is an Entity.</em> Every
            entity is identified by a stable id, never its title.
          </p>
        </header>

        {/* The cascaded Meta — the fields every entity carries. */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">The Meta</h2>
          <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
            Every kind inherits Entity&apos;s Meta. The last two &mdash; children and tagged{" "}
            <strong className="font-medium text-foreground">references</strong> &mdash; are the groundwork for
            Zero&apos;s reference-based future, where an entity is a set of references rendered recursively.
          </p>
          <ol className="mt-4 space-y-2">
            {META_FIELDS.map((m) => (
              <li
                key={m.n}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground"
              >
                <code className="mt-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {m.n}
                </code>
                <div className="min-w-0">
                  <span className="text-xs font-medium">{m.label}</span>
                  <span className="ml-2 text-pretty text-[11px] leading-relaxed text-muted-foreground">
                    {m.note}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Glyph states — how a silhouette reads across its lifecycle (rendered). */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Glyph states</h2>
          <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
            A glyph is an <strong className="font-medium text-foreground">outline</strong> while open, and{" "}
            <strong className="font-medium text-foreground">spins</strong> while{" "}
            <strong className="font-medium text-foreground">ongoing</strong> (being worked on, a running span, or a
            container with something ongoing inside). <strong className="font-medium text-foreground">Done</strong> is a
            soft marker — a <strong className="font-medium text-foreground">checkmark</strong> over the outline, carried
            only by <strong className="font-medium text-foreground">Task</strong> now — and does <em>not</em> close the
            entity. <strong className="font-medium text-foreground">Close</strong> ends the lifecycle and always{" "}
            <strong className="font-medium text-foreground">fades</strong> the row. A{" "}
            <strong className="font-medium text-foreground">fillable</strong> kind (Task, Space, Resource, Moment,
            Instant) also <strong className="font-medium text-foreground">fills</strong> its glyph when closed — that
            filled + faded state is what we call <strong className="font-medium text-foreground">complete</strong>. A{" "}
            <strong className="font-medium text-foreground">terminal</strong> kind (Community, Organism, Individual)
            fades only, keeping its outline (retire / die). A{" "}
            <strong className="font-medium text-foreground">Cancel</strong> (called off) lays a{" "}
            <strong className="font-medium text-foreground">bar</strong> over the glyph and strikes the title through;
            it also closes. Soul&apos;s closed glyph carries a small bar over it. Each kind below shows its own states.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
            <GlyphState kind="task" label="Open — outline" />
            <GlyphState kind="task" label="Ongoing — outline spins" />
            <GlyphState kind="task" showCheck label="Done — check, stays open" />
            <GlyphState kind="task" filled faded label="Closed (complete) — filled + faded" />
            <GlyphState kind="community" faded label="Terminal close — faded, outline kept" />
            <GlyphState kind="task" struck faded label="Cancelled — barred + struck" />
          </ul>
        </section>

        {/* State words — the computed word getState() resolves to, in priority order. */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">State words</h2>
          <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
            Every entity resolves to exactly one <strong className="font-medium text-foreground">state</strong>, checked
            in this priority order (the first that matches wins). This is what the glyph and the inline{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">state</code> row read.
          </p>
          <ol className="mt-4 space-y-2">
            {STATE_WORDS.map((s, i) => (
              <li
                key={s.word}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground"
              >
                <code className="mt-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {i + 1}
                </code>
                <div className="min-w-0">
                  <span className="text-xs font-medium">{s.word}</span>
                  <span className="ml-2 text-pretty text-[11px] leading-relaxed text-muted-foreground">{s.blurb}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* The essence & the roots. */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            The essence &amp; the roots
          </h2>
          <ul className="mt-4 grid grid-cols-1 gap-3">
            {FOUNDATIONS.map((row) => (
              <EntityCard key={row.name} row={row} />
            ))}
          </ul>
        </section>

        {/* The kinds. */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">The kinds</h2>
          <ul className="mt-4 grid grid-cols-1 gap-3">
            {KINDS.map((row) => (
              <EntityCard key={row.name} row={row} />
            ))}
          </ul>
        </section>

        {/* Lenses — aggregate views over the shared pool of entities, not kinds. */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lenses</h2>
          <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
            Beyond the kinds, Zero can be read through aggregate <strong className="font-medium text-foreground">
            lenses</strong> — views over the shared pool of entities rather than new kinds. Each layer builds on the
            one before it.
          </p>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {LENSES.map((lens) => (
              <li
                key={lens.name}
                className="rounded-xl border border-border bg-card p-4 text-card-foreground"
              >
                <h3 className="text-sm font-medium">{lens.name}</h3>
                <code className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">{lens.formula}</code>
                <p className="mt-1.5 text-pretty text-xs leading-relaxed text-muted-foreground">{lens.blurb}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}

/** A glyph-state demo chip for the top legend. */
function GlyphState({
  kind,
  filled = false,
  showCheck = false,
  struck = false,
  faded = false,
  label,
}: {
  kind: EntityKind
  filled?: boolean
  showCheck?: boolean
  struck?: boolean
  /** Plain-closed: fade the chip (the silhouette itself is unchanged). */
  faded?: boolean
  label: string
}) {
  return (
    <li className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-center text-card-foreground">
      <span
        className="inline-flex h-8 w-8 items-center justify-center text-foreground"
        style={faded ? { opacity: 0.5 } : undefined}
      >
        <Zero0Glyph kind={kind} filled={filled} done={showCheck} cancelled={struck} />
      </span>
      <span className="text-pretty text-[11px] leading-relaxed text-muted-foreground">{label}</span>
    </li>
  )
}
