"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { NodeGlyph, type NodeKind } from "@/components/zero/node-glyph"

/**
 * ZERO ENTITIES — the ontology reference ("the bible of Zero entities").
 *
 * This is a DOCUMENTATION page. Its content is authored directly from the
 * ontology draft rather than derived from the runtime model, because it
 * documents things the model doesn't encode yet:
 *   - ENTITY and EVERYTHING are ABSTRACTIONS, not runtime kinds — shown here as
 *     document-only rows (their glyphs are drawn inline below, since they have no
 *     entry in NodeGlyph).
 *   - the shared Meta (the cascaded fields every entity carries), including the
 *     children/tagged REFERENCES that groundwork the reference-based future.
 *
 * KEY REFRAME vs. the old page: Entity is the ESSENCE of every entity; Space is
 * just one KIND (the one that contains). Not every entity is a Space, but every
 * Space is an Entity. NOTE the time-span kind is presented as "Moment"; its
 * internal key is still `event` (a rename to `moment` is a separate, data-touching
 * task).
 */

/** A glyph is either a real runtime kind (drawn by NodeGlyph) or one of the two
 *  document-only abstractions drawn inline here. */
type GlyphKey = NodeKind | "entity" | "everything"

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
      "Some entities can be OPEN (alive) or CLOSED (dead, retired, archived): Tasks, Resources, Moments, Instants, Spaces, Communities, Organisms, Individuals.",
      "Three can additionally be UNDONE / DONE: Task, Moment, Instant.",
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
// The ordinary entity kinds, in hierarchy order. Organism has no assigned code
// yet (it was omitted from the draft table) but is kept in full.
const KINDS: EntityRow[] = [
  {
    code: "0.0.1",
    name: "Individual",
    glyph: "individual",
    glyphDesc: "A rotated \u201Cz\u201D",
    desc: "The Space of an Individual — a human being.",
    creatable: "yes",
    lifecycle: "Open / closed",
    fields: ["Same Meta as Entity, plus residence (geographical position)."],
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
    lifecycle: "Open / closed",
    fields: ["Inherited from Entity."],
    special: "A filled hexagon is a Space that is retired, archived, or dead.",
  },
  {
    code: "0.0.3",
    name: "Task",
    glyph: "task",
    glyphDesc: "A square",
    desc: "Something to do.",
    creatable: "yes",
    lifecycle: "Open / closed + undone / done",
    fields: [
      "Space + doneState — not a boolean but a list of timestamps: odd length means done.",
      "Every odd timestamp is a markedAsDone date, every even one a markedAsUndone date; an empty list means never done.",
    ],
    special:
      "A checkmarked square is a done Task; a filled square is a retired / dead Task; a struck-through square is a cancelled Task.",
  },
  {
    code: "0.0.4",
    name: "Resource",
    glyph: "resource",
    glyphDesc: "A diamond",
    desc: "Something to use.",
    creatable: "yes",
    lifecycle: "Open / closed",
  },
  {
    code: "0.0.5",
    name: "Moment",
    glyph: "event",
    glyphDesc: "An equilateral triangle pointing up",
    desc: "A span in time — usually two Instants defining that span.",
    creatable: "yes",
    lifecycle: "Open / closed + undone / done",
  },
  {
    code: "0.0.6",
    name: "Instant",
    glyph: "instant",
    glyphDesc: "An equilateral triangle pointing down",
    desc: "A point in time — a single Instant, possibly recurrent.",
    creatable: "yes",
    lifecycle: "Open / closed + undone / done",
  },
  {
    code: "0.0.7",
    name: "Community",
    glyph: "community",
    glyphDesc: "A regular pentagon",
    desc: "A shared Space with an Access Rule.",
    creatable: "yes",
    lifecycle: "Open / closed",
  },
  {
    code: null,
    name: "Organism",
    glyph: "organism",
    glyphDesc: "A regular circle",
    desc: "A living entity — a company, a point of view.",
    creatable: "yes",
    lifecycle: "Alive / dead",
    special: "Hierarchy code not yet assigned.",
  },
]

// The cascaded Meta — the fields every entity carries (fields 0–8 of Entity).
const META_FIELDS: { n: number; label: string; note: string }[] = [
  { n: 0, label: "ID", note: "A stable identifier — an entity is its id, never its title." },
  {
    n: 1,
    label: "Instants log",
    note: "Creation (\u201Cbirth\u201D), completion (\u201Cdeath\u201D), access entries & exits with who and when, status changes, close and cancel dates, and rebirth suggestions.",
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

/** The two document-only glyphs (no NodeGlyph entry). Drawn to sit in a 24-box,
 *  inheriting the current text color like NodeGlyph does. */
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

/** Renders a row's glyph — a real kind via NodeGlyph, or a document-only inline glyph. */
function RowGlyph({ glyph }: { glyph: GlyphKey }) {
  if (glyph === "entity") return <EntityGlyph />
  if (glyph === "everything") return <EverythingGlyph />
  return <NodeGlyph kind={glyph} />
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

/** A single entity card: glyph, name, code, pills, essence, and any field / special notes. */
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
            &ldquo;something that is, was, will be, or could be,&rdquo; the brick every context is made of. A{" "}
            <strong className="font-medium text-foreground">Space</strong> is just one <em>kind</em> — the one that
            contains — and probably the kind closest to Entity itself, differing mainly in its glyph and behavior.
          </p>
          <p className="mt-2 max-w-prose text-pretty leading-relaxed text-muted-foreground">
            So: <em>not every entity is a Space, but every Space is an Entity.</em> Each kind layers extra fields and
            a dedicated glyph on top of the shared Meta below, identified by a stable id — never its title.
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

        {/* Glyph states — how a silhouette reads across its lifecycle. */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Glyph states</h2>
          <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
            A glyph is an <strong className="font-medium text-foreground">outline</strong> while open (alive). A{" "}
            <strong className="font-medium text-foreground">filled</strong> glyph is a closed entity — retired,
            archived, or dead. A <strong className="font-medium text-foreground">struck-through</strong> glyph is a
            cancelled entity. Completable kinds (Task, Moment, Instant) additionally show a{" "}
            <strong className="font-medium text-foreground">checkmark</strong> when done, and Soul&apos;s closed
            glyph carries a small bar over it.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <GlyphState kind="task" label="Open — outline" />
            <GlyphState kind="task" showCheck label="Done Task — check" />
            <GlyphState kind="space" filled label="Closed — filled" />
            <GlyphState kind="task" struck label="Cancelled — struck" />
          </ul>
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
      </div>
    </main>
  )
}

/** A glyph-state demo chip for the legend. */
function GlyphState({
  kind,
  filled = false,
  showCheck = false,
  struck = false,
  label,
}: {
  kind: NodeKind
  filled?: boolean
  showCheck?: boolean
  struck?: boolean
  label: string
}) {
  return (
    <li className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-center text-card-foreground">
      <span className="inline-flex h-8 w-8 items-center justify-center text-foreground">
        <NodeGlyph kind={kind} filled={filled} showCheck={showCheck} struck={struck} />
      </span>
      <span className="text-pretty text-[11px] leading-relaxed text-muted-foreground">{label}</span>
    </li>
  )
}
