import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Bitcount_Grid_Single } from "next/font/google"

// Bitcount Grid Single — a distinctive dot-grid / bitmap display face. Scoped to this
// page only via its CSS variable so it never leaks into the rest of the shell's Geist UI.
const blackletter = Bitcount_Grid_Single({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-blackletter",
})

export const metadata: Metadata = {
  title: "The Zero Laws",
  description: "The four immutable laws that govern Zero — its contexts, its recursion, and its calm.",
}

// The four made-up laws. Each is a terse gothic decree plus a plain-language gloss
// that ties it back to Zero's contextual, recursive model.
const LAWS: { numeral: string; title: string; gloss: string }[] = [
  {
    numeral: "I",
    title: "Every Thing Is a World",
    gloss:
      "No entity is a mere leaf. Open any Task, any Resource, any Soul, and a whole space unfolds within it — for containment has no floor.",
  },
  {
    numeral: "II",
    title: "Context Precedes Content",
    gloss:
      "Nothing is shown outside the place that gives it meaning. You are always somewhere, and where you are decides what you see.",
  },
  {
    numeral: "III",
    title: "What Collapses May Return",
    gloss:
      "To close is not to destroy. Each thing folds into its glyph and waits, whole, until it is called forth once more.",
  },
  {
    numeral: "IV",
    title: "The Self Is the First Door",
    gloss:
      "Before all spaces stands the Individual. To enter Zero is to enter yourself, and every path begins at that threshold.",
  },
]

export default function ZeroLawsPage() {
  return (
    <main
      className={`${blackletter.variable} min-h-screen bg-background text-foreground`}
    >
      <div className="mx-auto flex max-w-3xl flex-col px-6 py-16 md:py-24">
        <Link
          href="/"
          className="mb-16 inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Zero
        </Link>

        <header className="mb-16 flex flex-col items-center text-center">
          <p className="mb-4 text-xs uppercase tracking-[0.3em] text-muted-foreground">
            The immutable decrees of
          </p>
          <h1
            className="text-balance text-6xl leading-none text-foreground md:text-8xl"
            style={{ fontFamily: "var(--font-blackletter)" }}
          >
            The Zero Laws
          </h1>
        </header>

        <ol className="flex flex-col gap-14">
          {LAWS.map((law) => (
            <li
              key={law.numeral}
              className="flex flex-col gap-4 border-t border-border pt-10 md:flex-row md:gap-8"
            >
              <span
                aria-hidden="true"
                className="shrink-0 text-5xl leading-none text-muted-foreground md:w-24 md:text-6xl"
                style={{ fontFamily: "var(--font-blackletter)" }}
              >
                {law.numeral}
              </span>
              <div className="flex flex-col gap-4">
                <h2
                  className="text-pretty text-4xl leading-tight text-foreground md:text-5xl"
                  style={{ fontFamily: "var(--font-blackletter)" }}
                >
                  {law.title}
                </h2>
                <p className="max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
                  {law.gloss}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </main>
  )
}
