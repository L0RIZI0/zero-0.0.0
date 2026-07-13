import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export const metadata: Metadata = {
  title: "Zero — Excerpts",
  description:
    "One idea: Zero draws two faces of the same entity — its header (an excerpt at some size) and its content (its children). A row in a list is a header; flip it and it becomes content; each item inside is another header. From XS (glyph + title) up to Full (§0, the whole meta), every surface is the same object at a different resolution.",
}

// A small monospace kicker that labels each section — mirrors the shell's own
// uppercase, wide-tracked meta labels so /excerpts reads as part of Zero, not a
// page bolted on. (Same as /vision, on purpose.)
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
      {children}
    </p>
  )
}

// THE LADDER — the size scale from the smallest legible excerpt of a header up to
// the whole thing (§0). XS and Full are the fixed ends; the middle rungs are
// pragmatic presets, deliberately NOT frozen yet (see the open questions). Each rung
// says what it ADDS to the one before, and where that resolution already lives today.
// NOTE: the top size is "Full", NOT "Complete" — "Complete" is already an entity
// LIFECYCLE state (a done Task, a past Moment), so reusing it for a header size would
// collide. Full = the whole header; Complete = a thing's verdict. Different axes.
const SIZES: { size: string; adds: string; livesToday: string }[] = [
  {
    size: "XS",
    adds: "glyph · title",
    livesToday: "ACTIVITY rows; breadcrumb crumbs",
  },
  {
    size: "S",
    adds: "+ one line of meta",
    livesToday: "STARTERS tiles; ENTITY CONTENT rows",
  },
  {
    size: "M",
    adds: "+ state word · one primary action",
    livesToday: "a content row carrying its lifecycle word and a delete affordance",
  },
  {
    size: "L",
    adds: "+ schedule · coverage · child count",
    livesToday: "an expanded tile; a rich, taller row",
  },
  {
    size: "XL",
    adds: "+ children preview · tags · back-references",
    livesToday: "§0 in its minimized state",
  },
  {
    size: "Full",
    adds: "the exhaustive meta — id, kind, done, state, created, tags, every link",
    livesToday: "§0, the whole entity header",
  },
]

// The verbs a pinned Space header can carry — the tile is a header plus a verb that
// emits a timestamped child. Starter is what ships today; the rest are the natural
// extensions the model makes almost free.
const VERBS: { name: string; emits: string; forWhat: string; status: string }[] = [
  {
    name: "Starter",
    emits: "a Moment (a session, with duration) in the Space's Sessions",
    forWhat: "things you do over time — Sleep, Work, Walk the dog",
    status: "shipping",
  },
  {
    name: "Counter",
    emits: "an Instant (a point event) in Sessions; the tile shows today's count",
    forWhat: "things you tally — cigarettes, glasses of water, push-ups",
    status: "designed",
  },
  {
    name: "Rater",
    emits: "an Instant carrying a value; the tile shows today's average",
    forWhat: "things you score — mood, energy, sleep quality",
    status: "sketch",
  },
  {
    name: "Opener",
    emits: "nothing — it just drills into the Space",
    forWhat: "areas you visit but do not clock",
    status: "sketch",
  },
]

// The staged plan, in the order that keeps us honest — the refactor that proves the
// idea first, then the data model, then the verbs.
const STAGES: { tag: string; title: string; body: string }[] = [
  {
    tag: "a",
    title: "Build the two primitives: Header and Content.",
    body: "Pure refactor, no data change. Every list row, tile, and §0 becomes Header(entity, size, mode); every children view — the canvas, an expanded tile — becomes Content(entity, axis), rendering Headers that can flip to their own Content. The create bar folds in as a Full header in write mode. If this feels clean, the thesis is real; if it fights us, the thesis is wrong. This step is the honesty test.",
  },
  {
    tag: "b",
    title: "Make STARTERS real Spaces with a Sessions sub-space.",
    body: "A tile stops being a derived cluster of the activity log and becomes a Space the user created. Toggling it writes a Moment into that Space's one Sessions sub-space. The single-instance rule stops being enforced by procedure and becomes a data invariant: a Space has at most one ongoing child in Sessions.",
  },
  {
    tag: "c",
    title: "Add verbs beyond Starter.",
    body: "Counter, Rater, Opener — a small mode field on the tile. Each is the same S-size header wired to emit a different kind of child. No new subsystems; just a verb.",
  },
]

// What we deliberately have NOT decided. Writing these down is the point — they are
// the conversations to have before building, not gaps to paper over.
const OPEN: { q: string; lean: string }[] = [
  {
    q: "Is the dayline really content on a time axis?",
    lean:
      "Held, not decided. It is tempting: the list is a spatial container, the dayline a temporal one, over the same children — and an untimed child is simply out of the time axis's domain. But this is the least-proven leg of the model, so it stays a hypothesis until a real screen forces the answer.",
  },
  {
    q: "Do §4 (STARTERS) and §2 (ACTIVITY) converge?",
    lean:
      "They rhyme — both are lists of activity headers. But they may answer different questions: ACTIVITY is the implicit record of where you were (auto-logged from navigation); STARTERS is the explicit set of areas you clock in and out of by hand. Worth a dedicated conversation before merging them.",
  },
  {
    q: "Presence vs. sessions — one stream or two?",
    lean:
      "Lean two: presence is implicit where I was, a session is explicit what I was doing. A session can imply presence; presence never implies a session. Keeping them separate avoids double-counting the same minute.",
  },
  {
    q: "One Sessions sub-space, or two?",
    lean:
      "Decided: one. It holds both Moments (durations) and Instants (points) — the kind already tells duration from point, so a second container earns nothing.",
  },
  {
    q: "How many middle rungs, exactly?",
    lean:
      "Unknown, and that is fine. XS and Full are fixed; the rest are presets we will settle once real screens ask for them. The scale is a continuum — you can always insert a size between two.",
  },
]

export default function ExcerptsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col px-6 py-16 md:py-24">
        <Link
          href="/"
          className="mb-16 inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Zero
        </Link>

        {/* Hero — the thesis, stated plainly. */}
        <header className="mb-20 flex flex-col">
          <Kicker>Excerpts</Kicker>
          <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
            One header.
            <br />
            <span className="text-muted-foreground">Every size.</span>
          </h1>
          <p className="mt-8 max-w-prose text-pretty text-lg leading-relaxed text-muted-foreground md:text-xl">
            Zero draws two faces of the same entity: its <span className="text-foreground">header</span>{" "}
            — an excerpt at some size — and its <span className="text-foreground">content</span> —
            its children. A row in a list is a header excerpted down to what fits; flip
            it and it becomes content; each item inside is another header. From a glyph
            and a title up to the full §0 meta, everything on screen is the same object
            at a different resolution.
          </p>
        </header>

        {/* The thesis. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>The idea</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            A row is an excerpt of a header.
          </h2>
          <div className="flex flex-col gap-6 text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            <p>
              Every entity is a <span className="text-foreground">card</span>. When the
              card has room to lay all its shown fields on one line, it reads as a{" "}
              <span className="text-foreground">row</span>; when it doesn&apos;t, the
              same fields stack. Row and card are not two designs — they are one card
              under two amounts of width.
            </p>
            <p>
              And a header is not just two states, minimized or maximized. It is a{" "}
              <span className="text-foreground">continuum of resolutions</span>. The
              listing in ACTIVITY shows a glyph and a title. A tile in STARTERS adds a
              line of meta. §0 shows everything. These are the same header, excerpted
              to different depths — so the glyph, the state color, the coverage fade,
              the right-click menu are all defined once and appear, identically,
              everywhere.
            </p>
          </div>
        </section>

        {/* The two primitives. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>Two faces</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            Header and content, all the way down.
          </h2>
          <div className="flex flex-col gap-6 text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            <p>
              An entity has two faces. Its <span className="text-foreground">header</span>{" "}
              is the excerpt — the thing itself at some size. Its{" "}
              <span className="text-foreground">content</span> is its children. That is
              the whole vocabulary: <span className="text-foreground">Header(entity,
              size)</span> and <span className="text-foreground">Content(entity, axis)</span>.
            </p>
            <p>
              And they <span className="text-foreground">nest without end</span>. A
              content view is a column of headers. Right-click any header and ask for its
              content, and that row blooms into its own children — each of which is a
              header that can bloom again. The canvas is not &ldquo;a header on top, a
              list below.&rdquo; It is one entity shown as content, recursively.
              Drilling in is just promoting a child from header to content and making it
              the root of the view.
            </p>
            <p>
              An <span className="text-foreground">axis</span> is more than an
              arrangement — it also decides <span className="text-foreground">who
              belongs</span>. The <span className="font-mono text-sm">list</span> axis
              admits every child and arranges them spatially. Other axes carry a
              membership test: a child appears only if it has the attribute that axis is
              about. A Space that only gathers resources has no times, so on a{" "}
              <span className="font-mono text-sm">time</span> axis its children simply
              are not members — they are not missing, they are out of that axis&apos;s
              domain. Same content, seen through a lens that shows only what it can place.
            </p>
          </div>
        </section>

        {/* Create = a header being born. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>Creation</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            To create is to fill a header that has no id yet.
          </h2>
          <div className="flex flex-col gap-6 text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            <p>
              The create bar is not a separate tool. It is a{" "}
              <span className="text-foreground">Full header in write mode</span>, for an
              entity that does not exist yet. You are filling in fields; submitting
              commits — the entity gets an id and drops into the tree. Reading §0,
              editing §0, and composing a new entity are one component across a small
              matrix: <span className="text-foreground">nascent or committed</span>,
              times <span className="text-foreground">read or write</span>.
            </p>
            <p>
              Seen that way, everything that makes an entity is the{" "}
              <span className="text-foreground">same act at different ceremony</span>.
              Auto: the system emits a presence segment as you move. Verb: one click on a
              STARTERS tile emits a pre-filled session. Manual: you type the whole thing
              into the create bar. Automatic, templated, or hand-written — each is a
              header being born, differing only in how much was filled in for you.
            </p>
          </div>
        </section>

        {/* The ladder. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>The ladder</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            From XS to Full.
          </h2>
          <p className="mb-8 max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            Each rung says what it adds to the one below, and where that resolution
            already lives in the shell today. XS and Full are the fixed ends; the
            middle is not frozen.{" "}
            <span className="text-foreground">Full</span>, not &ldquo;Complete&rdquo; —
            that word already names a thing&apos;s lifecycle verdict, so the biggest
            size borrows a different one.
          </p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  <th className="px-4 py-3 font-normal">Size</th>
                  <th className="px-4 py-3 font-normal">Adds</th>
                  <th className="px-4 py-3 font-normal">Lives today</th>
                </tr>
              </thead>
              <tbody>
                {SIZES.map((s) => (
                  <tr key={s.size} className="border-b border-border/60 last:border-0 align-top">
                    <td className="px-4 py-3 font-mono text-foreground">{s.size}</td>
                    <td className="px-4 py-3 text-foreground">{s.adds}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.livesToday}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
            The one subtlety: a size is a <span className="text-foreground">curated
            projection</span>, not a raw field count. What &ldquo;one line of
            meta&rdquo; means for a Moment (its time) differs from what it means for an
            Individual (its role). The real artifact behind this table is a{" "}
            <span className="text-foreground">(kind × size) → fields</span> map — that
            map is the whole design.
          </p>
        </section>

        {/* STARTERS. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>Starters</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            The tiles are just Spaces you pinned.
          </h2>
          <div className="flex flex-col gap-6 text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            <p>
              Today the quick-log band (§4) is a <span className="text-foreground">derived
              </span> abstraction: Zero scans the log, clusters occurrences by kind and
              title, and synthesizes virtual tiles. That is why keeping only one
              instance running had to be enforced in several code paths — the tile
              isn&apos;t a real thing, so its rules live in procedures.
            </p>
            <p>
              Flip it. Let a tile be a <span className="text-foreground">Space the user
              created</span> — Sleep, Work, a person, the dog. Toggling it on creates a{" "}
              <span className="text-foreground">Moment</span> — a session with a start —
              inside that Space&apos;s one <span className="text-foreground">Sessions</span>{" "}
              sub-space, and drills in. Toggling it off stamps the end and leaves you
              where you are. &ldquo;Only one running at a time&rdquo; stops being a rule
              we enforce and becomes a fact of the data: a Space has at most one ongoing
              child in Sessions.
            </p>
            <p>
              The discipline that keeps this from sprawling: sessions are only for the
              handful of life-areas you deliberately clock. That is a{" "}
              <span className="text-foreground">curation</span> act — pinning a Space —
              not a property every entity carries. People have maybe ten. The cap is the
              feature. So <span className="text-foreground">FREQUENT becomes STARTERS</span>:
              your pinned areas, each shown as its header wired to a verb.
            </p>
          </div>
        </section>

        {/* Verbs. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>Verbs</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            A tile is a header plus a verb.
          </h2>
          <p className="mb-10 max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            &ldquo;Starter&rdquo; and &ldquo;Counter&rdquo; are not different widgets —
            they are the same S-size header carrying a different verb, each emitting a
            different kind of timestamped child.
          </p>
          <ol className="flex flex-col gap-8">
            {VERBS.map((v, i) => (
              <li key={v.name} className="flex gap-5 md:gap-8">
                <span
                  aria-hidden="true"
                  className="shrink-0 font-mono text-sm leading-relaxed text-accent"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex flex-col gap-2">
                  <h3 className="flex flex-wrap items-baseline gap-3 text-pretty text-xl font-medium leading-snug text-foreground md:text-2xl">
                    {v.name}
                    <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      {v.status}
                    </span>
                  </h3>
                  <p className="max-w-prose text-pretty text-base leading-relaxed text-muted-foreground">
                    Emits {v.emits}. For {v.forWhat}.
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* The staged plan. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>The order of work</Kicker>
          <h2 className="mb-10 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            Prove it, then build it.
          </h2>
          <ol className="flex flex-col gap-10">
            {STAGES.map((s) => (
              <li key={s.tag} className="flex gap-5 md:gap-8">
                <span
                  aria-hidden="true"
                  className="shrink-0 font-mono text-lg leading-tight text-accent"
                >
                  {s.tag}
                </span>
                <div className="flex flex-col gap-2">
                  <h3 className="text-pretty text-xl font-medium leading-snug text-foreground md:text-2xl">
                    {s.title}
                  </h3>
                  <p className="max-w-prose text-pretty text-base leading-relaxed text-muted-foreground">
                    {s.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Open questions. */}
        <section className="mb-16 flex flex-col border-t border-border pt-10">
          <Kicker>Not yet decided</Kicker>
          <h2 className="mb-10 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            The conversations still to have.
          </h2>
          <dl className="flex flex-col gap-10">
            {OPEN.map((item) => (
              <div key={item.q} className="flex flex-col gap-3">
                <dt className="text-pretty text-xl font-medium leading-snug text-foreground md:text-2xl">
                  {item.q}
                </dt>
                <dd className="max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
                  {item.lean}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <footer className="flex flex-col gap-1 border-t border-border pt-8">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
            Zero
          </p>
          <p className="text-sm text-muted-foreground">
            A living document. The ladder will gain and lose rungs as real screens ask
            for them — that is the point.
          </p>
        </footer>
      </div>
    </main>
  )
}
