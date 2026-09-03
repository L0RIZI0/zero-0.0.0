import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Zero0EntitiesBible } from "@/components/zero0/zero0-entities-bible"

export const metadata: Metadata = {
  title: "Zero — Entities",
  description:
    "The bible of entities: an interactive table documenting every entity kind against every axis — glyph, name, use case, states (open/ongoing), click behaviour, remote play, and the conditions for each. Built up collaboratively, cell by cell.",
}

// Monospace kicker — matches the shell's uppercase, wide-tracked meta labels (as on /sugars).
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">{children}</p>
  )
}

export default function EntitiesPage() {
  return (
    <main className="min-h-dvh bg-background px-6 py-16 text-foreground md:px-10 md:py-24">
      {/* Hero stays comfortably measured. */}
      <div className="mx-auto flex max-w-5xl flex-col">
        <Link
          href="/"
          className="mb-16 inline-flex items-center gap-2 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Zero
        </Link>

        {/* Hero. */}
        <header className="mb-16 flex flex-col">
          <Kicker>Entities</Kicker>
          <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
            The bible
            <br />
            <span className="text-muted-foreground">of entities.</span>
          </h1>
          <p className="mt-8 max-w-prose text-pretty text-lg leading-relaxed text-muted-foreground md:text-xl">
            One living table where every entity kind is documented against every axis — its glyph,
            name and use case, its states (open, ongoing, and the rest), what a click does, how
            remote play behaves, and the exact conditions that make it read as ongoing. Edit any
            cell, and add, remove, or reorder rows and columns as the model grows.
          </p>
        </header>
      </div>

      {/* The interactive table spans the FULL width (only bounded by the main's padding) so as
          many columns as possible are visible without horizontal scrolling. */}
      <section className="flex w-full flex-col border-t border-border pt-10">
        <Kicker>The table</Kicker>
        <Zero0EntitiesBible />
      </section>
    </main>
  )
}
