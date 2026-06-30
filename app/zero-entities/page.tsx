"use client"

import Link from "next/link"
import { ArrowLeft, Check, X } from "lucide-react"
import { NodeGlyph, type NodeKind } from "@/components/zero/node-glyph"
import { KIND_META } from "@/lib/zero/kinds"

/** One-word lifecycle behavior label for a kind, read from KIND_META. */
function behaviorOf(kind: NodeKind): string {
  const meta = KIND_META[kind]
  if (meta.completable) return "Completable"
  if (meta.terminal === "retire") return "Retires"
  if (meta.terminal === "death") return "Mortal"
  return "Perpetual"
}

// The six ordinary "content" kinds — the things you actually fill Zero with.
const CONTENT_KINDS: NodeKind[] = ["task", "space", "event", "instant", "resource", "community"]

// The identity triad, OUTERMOST → innermost. Each is a structural entity describing
// who a Zero user is, rather than content. Creatable-ness comes from KIND_META.
const TRIAD: NodeKind[] = ["organism", "individual", "soul"]

// Aggregate lenses — views over entities, not kinds. Each layer adds to the last.
const LENSES: { name: string; formula: string; blurb: string }[] = [
  { name: "Population", formula: "All Individuals", blurb: "Every person, considered alone." },
  { name: "Society", formula: "Individuals + Organisms", blurb: "People together with the living entities they form." },
  {
    name: "Culture",
    formula: "Individuals + Organisms + Law + Art",
    blurb: "Society plus the rules it lives by and the artifacts it makes — artworks, urbanism, and the rest.",
  },
]

/** A small glyph rendered in the current text color, sized to a square box. */
function Glyph({ kind, className }: { kind: NodeKind; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center text-foreground ${className ?? "h-7 w-7"}`}>
      <NodeGlyph kind={kind} />
    </span>
  )
}

/**
 * A single glyph-state demo chip: the glyph (optionally filled) with an optional
 * overlay mark (check for a done Task, cross for a terminal kind) and a caption.
 */
function GlyphState({
  kind,
  filled = false,
  overlay,
  label,
}: {
  kind: NodeKind
  filled?: boolean
  overlay?: "check" | "cross"
  label: string
}) {
  return (
    <li className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-center text-card-foreground">
      <span className="relative inline-flex h-8 w-8 items-center justify-center text-foreground">
        <NodeGlyph kind={kind} filled={filled} />
        {overlay === "check" && (
          <Check className="absolute h-3 w-3 text-background" strokeWidth={3.5} aria-hidden />
        )}
        {overlay === "cross" && (
          <X className="absolute h-3 w-3 text-background" strokeWidth={3.5} aria-hidden />
        )}
      </span>
      <span className="text-pretty text-[11px] leading-relaxed text-muted-foreground">{label}</span>
    </li>
  )
}

/** Creatable / System-only pill. */
function Tag({ creatable }: { creatable: boolean }) {
  return (
    <span
      className={
        creatable
          ? "rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium tracking-wide text-secondary-foreground"
          : "rounded-full border border-border px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground"
      }
    >
      {creatable ? "Creatable" : "System"}
    </span>
  )
}

/** Lifecycle-behavior pill (Completable / Retires / Mortal / Perpetual). */
function BehaviorTag({ kind }: { kind: NodeKind }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
      {behaviorOf(kind)}
    </span>
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
          <p className="mt-2 max-w-prose text-pretty leading-relaxed text-muted-foreground">
            Every entity in Zero is first a <em>Space</em> — the same recursive container, identified
            by a stable id (never its title) and carrying its own meta. A particular <em>kind</em>
            layers extra properties and a dedicated glyph on top. These are the kinds, their shapes,
            which ones you can create, and how each resolves its end of life — <em>completable</em>
            kinds get done, while others retire or die.
          </p>
        </header>

        {/* Glyph states — how a kind's silhouette reads across its lifecycle. */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Glyph states</h2>
          <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
            A glyph is an <em>outline</em> while open. Completing any completable kind{" "}
            <strong className="font-medium text-foreground">fills</strong> its silhouette (the ink wipes in
            from the left) — a done Event is a solid up-triangle, a done Space a solid hexagon. Only a done{" "}
            <strong className="font-medium text-foreground">Task</strong> also gets the inner check. Kinds that
            can&apos;t be &ldquo;done&rdquo; never fill that way: a retired Community or a dead Organism instead
            carries a terminal mark.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <GlyphState kind="task" label="Open — outline" />
            <GlyphState kind="task" filled overlay="check" label="Done Task — fill + check" />
            <GlyphState kind="event" filled label="Done Event — filled triangle" />
            <GlyphState kind="space" filled label="Done Space — filled hexagon" />
            <GlyphState kind="community" overlay="cross" label="Retired Community — terminal mark" />
          </ul>
        </section>

        {/* Content entities */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Content</h2>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CONTENT_KINDS.map((kind) => {
              const meta = KIND_META[kind]
              return (
                <li
                  key={kind}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
                >
                  <Glyph kind={kind} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">{meta.label}</h3>
                      <Tag creatable={meta.creatable} />
                      <BehaviorTag kind={kind} />
                    </div>
                    <p className="mt-1 text-pretty text-xs leading-relaxed text-muted-foreground">
                      {meta.description}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        {/* Identity triad — rendered as a literally nested stack (Org ⊃ Individual ⊃ Soul). */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Identity</h2>
          <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
            A Zero user is a nested stack: a <strong className="font-medium text-foreground">Soul</strong> animates
            an <strong className="font-medium text-foreground">Individual</strong>, which occupies an{" "}
            <strong className="font-medium text-foreground">Organism</strong>. The active-account path is{" "}
            <em>Soul → Individual → Organism</em>, and the root Organism — <em>entity0</em> — is the home you open
            into. An Organism is more than a container: it is a{" "}
            <strong className="font-medium text-foreground">way of seeing the world</strong> — a point of view that
            expresses a reading of what matters and what doesn&apos;t in its environment. A company is one such reading.
          </p>

          <NestedTriad index={0} />

          <p className="mt-4 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
            Every Individual has a hidden body-Organism bound to its birth and death; an Individual can also create
            separate, longer-lived Organisms (companies, institutions). Both Individuals and Organisms own a{" "}
            <strong className="font-medium text-foreground">Lifeline</strong> — the canonical master timeline onto
            which all their Events, Instants, and scheduled Tasks project.
          </p>
        </section>

        {/* Aggregate lenses — views over the shared pool of entities, not kinds. */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lenses</h2>
          <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
            These are not entities but <em>views</em> over them — three widening layers: humans, then
            humans and their institutions, then everything they live by and make.
          </p>
          <ul className="mt-4 grid grid-cols-1 gap-3">
            {LENSES.map((lens) => (
              <li
                key={lens.name}
                className="rounded-xl border border-border bg-card p-4 text-card-foreground"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-sm font-medium">{lens.name}</h3>
                  <code className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
                    {lens.formula}
                  </code>
                </div>
                <p className="mt-1.5 text-pretty text-xs leading-relaxed text-muted-foreground">{lens.blurb}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}

/**
 * Recursively renders the triad as concentric bordered cards, so the markup
 * mirrors the containment: the Organism wraps the Individual, which wraps the
 * Soul. Each level shows its glyph, label, creatable/system tag and description.
 */
function NestedTriad({ index }: { index: number }) {
  if (index >= TRIAD.length) return null
  const kind = TRIAD[index]
  const meta = KIND_META[kind]
  const innermost = index === TRIAD.length - 1
  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-5 text-card-foreground">
      <div className="flex items-start gap-3">
        <Glyph kind={kind} className="h-8 w-8" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{meta.label}</h3>
            <Tag creatable={meta.creatable} />
            <BehaviorTag kind={kind} />
          </div>
          <p className="mt-1 text-pretty text-xs leading-relaxed text-muted-foreground">{meta.description}</p>
        </div>
      </div>
      {!innermost && <NestedTriad index={index + 1} />}
    </div>
  )
}
