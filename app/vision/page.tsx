import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export const metadata: Metadata = {
  title: "Zero — the Vision",
  description:
    "What Zero is, the one verb it lives for, and the honest constraints that keep it alive: a substrate you operate through, aimed at a single domain, earning its generality bottom-up.",
}

// A small monospace kicker that labels each section — mirrors the shell's own
// uppercase, wide-tracked meta labels so /vision reads as part of Zero, not a
// marketing page bolted on.
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
      {children}
    </p>
  )
}

// One "honest constraint" — a claim plus its plain-language consequence. These are
// the things that keep the ambition from drifting into the graveyard of generic tools.
const CONSTRAINTS: { claim: string; gloss: string }[] = [
  {
    claim: "Zero is a substrate, not an app.",
    gloss:
      "You operate through it. It composes and dispatches; it is not the work itself. A workout, a company, a grocery run — all reduce to the same handful of entity-kinds and the relations between them.",
  },
  {
    claim: "Build the substrate, but aim it.",
    gloss:
      "Generality declared top-down dies in the graveyard of tools that could do anything and so meant nothing. Generality earned bottom-up survives. Pick one domain you actually live in, be unambiguously the best tool on earth for it, and let the structure stretch to the next domain without a rewrite.",
  },
  {
    claim: "Guard the ontology, not the pixels.",
    gloss:
      "The real weight is semantic. Every new kind, flag, or lifecycle state is something a person has to hold in their head. Lightness means fewer kinds of things to understand — not fewer things on screen. The kind list should stop growing.",
  },
  {
    claim: "A behavior belongs to an entity, never to a place.",
    gloss:
      "What you can do to a thing depends on what it is and where it sits in the tree — not on which panel happens to be drawing it. The surface is incidental. The structure is the point.",
  },
]

// The three questions worth answering before any more building — with the answers
// that came out of them.
const QUESTIONS: { q: string; a: string }[] = [
  {
    q: "What is the one verb?",
    a: "DO. Not plan. Zero has enough visibility — your agenda, your tracked activity, your habits, which resources exist and who they were made available to — that the plan builds itself and stays true to reality. You stop running between chat, email, calls, and meetings just to feel like you have a grip on things.",
  },
  {
    q: "What breaks if the ontology is 6 kinds, not 12?",
    a: "Nothing has to. Twelve is fine if some kinds are simply made of others — an Event is really two Instants, a start and an end. Composition keeps the surface small while the vocabulary stays expressive.",
  },
  {
    q: "Where does structure come from — the user, or Zero?",
    a: "Both, dancing. The user states intent, mostly just by naming things. Zero watches reality and keeps the structure current with as little manual input as possible. Neither leads alone.",
  },
]

export default function VisionPage() {
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
          <Kicker>The vision</Kicker>
          <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
            Do.
            <br />
            <span className="text-muted-foreground">Don&apos;t plan.</span>
          </h1>
          <p className="mt-8 max-w-prose text-pretty text-lg leading-relaxed text-muted-foreground md:text-xl">
            Zero keeps your plan alive so you don&apos;t have to. It watches the shape
            of your reality — what&apos;s scheduled, what&apos;s done, what&apos;s
            available, what it&apos;s for — and quietly keeps the plan current, so you
            can spend your attention doing the work instead of re-reading the roadmap
            every three days.
          </p>
        </header>

        {/* What Zero is. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>What it is</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            A contextual shell — a medium beneath any kind of work.
          </h2>
          <div className="flex flex-col gap-6 text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            <p>
              Most tools organize one thing: tasks, or notes, or files, or calendars.
              Zero organizes the <span className="text-foreground">structure of
              activity itself</span> — resources to be used, tasks to be done, spaces
              to gather in, moments in time — into one small, recursive vocabulary that
              applies the same way whether you&apos;re shipping a product or planning a
              week.
            </p>
            <p>
              Today all of this information already exists in every team and every
              life. It just floats — unworked, unused — while people run between
              meetings and apps trying to feel like they have a grasp on what&apos;s
              true. Zero&apos;s bet is that if the structure is generic and always
              current, the grasp comes for free.
            </p>
          </div>
        </section>

        {/* The honest constraints. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>The honest constraints</Kicker>
          <h2 className="mb-10 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            What keeps the ambition alive.
          </h2>
          <ol className="flex flex-col gap-10">
            {CONSTRAINTS.map((c, i) => (
              <li key={c.claim} className="flex gap-5 md:gap-8">
                <span
                  aria-hidden="true"
                  className="shrink-0 font-mono text-sm leading-relaxed text-accent"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex flex-col gap-2">
                  <h3 className="text-pretty text-xl font-medium leading-snug text-foreground md:text-2xl">
                    {c.claim}
                  </h3>
                  <p className="max-w-prose text-pretty text-base leading-relaxed text-muted-foreground">
                    {c.gloss}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* The three questions. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>Three questions worth sitting with</Kicker>
          <h2 className="mb-10 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            The what, before the how.
          </h2>
          <dl className="flex flex-col gap-10">
            {QUESTIONS.map((item) => (
              <div key={item.q} className="flex flex-col gap-3">
                <dt className="text-pretty text-xl font-medium leading-snug text-foreground md:text-2xl">
                  {item.q}
                </dt>
                <dd className="max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Honesty about the present. */}
        <section className="mb-16 flex flex-col border-t border-border pt-10">
          <Kicker>Where it actually stands</Kicker>
          <div className="flex flex-col gap-6 text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            <p>
              None of this is done. Today Zero is a beautiful way to look at your own
              structure — the diving, the morphs, the contexts — but the engine still
              waits on the user to build most of that structure by hand, and the plan
              does not yet build itself. The parts that are real are the ones that are
              hard to fake: the recursive model, the closed vocabulary, the way every
              surface reads from the same source of truth.
            </p>
            <p className="text-foreground">
              The honest order of work: earn the substrate in one domain first. Let the
              generality follow. Make Zero the best tool on earth for one real life —
              this one — and trust that a structure good enough for that will stretch to
              the rest.
            </p>
          </div>
        </section>

        <footer className="flex flex-col gap-1 border-t border-border pt-8">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
            Zero
          </p>
          <p className="text-sm text-muted-foreground">
            A living document. It will be wrong in places, and that&apos;s the point —
            it changes as reality does.
          </p>
        </footer>
      </div>
    </main>
  )
}
