import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, Globe, Layers, History, KeyRound, Timer, MapPin } from "lucide-react"

export const metadata: Metadata = {
  title: "Zero — Features",
  description:
    "Zero is a contextual browser-shell: the web, your work, and your history in one recursive space. Browse inside a context, keep logins where they belong, and always know where you were and what you did.",
}

// A small monospace kicker — mirrors the shell's uppercase, wide-tracked meta labels
// so /features reads as part of Zero, not a marketing page bolted on.
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
      {children}
    </p>
  )
}

// A placeholder media slot — a labelled frame standing in for a screenshot or
// short loop we'll drop in later. Kept as a real, styled element (not an empty box)
// so the page reads finished even before the capture exists.
function MediaSlot({ label, aspect = "aspect-video" }: { label: string; aspect?: string }) {
  return (
    <figure
      className={`relative ${aspect} w-full overflow-hidden rounded-lg border border-border bg-card`}
      aria-label={label}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
          {label}
        </span>
      </div>
      {/* hairline grid hint so the empty frame still feels intentional */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
    </figure>
  )
}

// The headline feature — the context-world / contextual browser. Given its own
// spotlight block above the grid.
// The supporting features — each a facet of "the web lives inside your work."
const FEATURES: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  blurb: string
}[] = [
  {
    icon: Globe,
    title: "Browse inside a context",
    blurb:
      "Open a real website right where the work is — a doc inside a project, a dashboard inside a client. The page isn't a tab in some other app. It's an entity in your world, living exactly where it belongs.",
  },
  {
    icon: KeyRound,
    title: "Logins that know where they are",
    blurb:
      "Sign in once inside a Space and every tool in it comes along — one identity, shared. Open the same tool under a different client and it stays cleanly separate. Your accounts follow the context, not the guesswork.",
  },
  {
    icon: Layers,
    title: "Everything stays warm",
    blurb:
      "Step back out and the places you were don't vanish — they're kept standing, ready on call. Return in an instant, right where you left off, scroll position and all. Nothing reloads just because you looked away.",
  },
  {
    icon: History,
    title: "A life-log for every thing",
    blurb:
      "Every entity quietly remembers its own story — when it started, when it moved, when it was done. Nothing is lost, nothing needs a spreadsheet. The history is just there, attached to the thing itself.",
  },
  {
    icon: Timer,
    title: "Sessions, tracked for free",
    blurb:
      "Being somewhere counts. Zero notices where your attention actually goes and turns it into sessions — no timers to start, no buttons to remember. The record of what you did writes itself.",
  },
  {
    icon: MapPin,
    title: "Always know where you were",
    blurb:
      "A living breadcrumb of exactly where you are, one click back to anywhere you've been. Pin the places you return to and drop straight in. You never lose the thread of what you were doing.",
  },
]

export default function FeaturesPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-4xl flex-col px-6 py-16 md:py-24">
        <Link
          href="/"
          className="mb-16 inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Zero
        </Link>

        {/* Hero */}
        <header className="mb-16 flex flex-col">
          <Kicker>Features</Kicker>
          <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
            The web lives
            <br />
            <span className="text-muted-foreground">inside your work.</span>
          </h1>
          <p className="mt-8 max-w-prose text-pretty text-lg leading-relaxed text-muted-foreground md:text-xl">
            Zero isn&apos;t a browser next to your tools, or a tool next to your browser.
            It&apos;s one space where websites, tasks, and the record of what you did all
            sit together — and stay in context. Here&apos;s what that unlocks.
          </p>
        </header>

        {/* Spotlight — the context-world headline feature */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>The context-world</Kicker>
          <h2 className="mb-6 text-pretty text-3xl font-semibold leading-tight md:text-5xl">
            Step into a context. The world reshapes around it.
          </h2>
          <p className="mb-10 max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            Everything in Zero is an entity you can step inside — a project, a client, a day.
            When you do, the web comes with you: the sites you use there open in place, sign
            themselves in from the context&apos;s own identity, and stay warm behind you so
            stepping back is instant. It feels less like opening apps and more like walking
            into a room where everything you need is already set up.
          </p>
          <MediaSlot label="Preview — drilling into a context" />
        </section>

        {/* Feature grid */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>What you get</Kicker>
          <h2 className="mb-10 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            Built around where you are and what you did.
          </h2>
          <ul className="grid gap-x-10 gap-y-12 md:grid-cols-2">
            {FEATURES.map((f) => {
              const Icon = f.icon
              return (
                <li key={f.title} className="flex flex-col gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-accent">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="text-pretty text-xl font-medium leading-snug text-foreground">
                    {f.title}
                  </h3>
                  <p className="max-w-prose text-pretty text-base leading-relaxed text-muted-foreground">
                    {f.blurb}
                  </p>
                </li>
              )
            })}
          </ul>
        </section>

        {/* Secondary media — the "where you were / what you did" story */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>Where you were, what you did</Kicker>
          <h2 className="mb-6 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            Your history keeps itself.
          </h2>
          <p className="mb-10 max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            Because every place you go and every thing you touch is a real entity, Zero can
            remember it without asking you to log anything. The breadcrumb shows where you
            are, sessions capture where your time actually went, and each entity carries its
            own timeline. Look back whenever you want — the answer is always already there.
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            <MediaSlot label="Preview — the breadcrumb trail" aspect="aspect-[4/3]" />
            <MediaSlot label="Preview — an entity's life-log" aspect="aspect-[4/3]" />
          </div>
        </section>

        {/* Close */}
        <section className="mb-16 flex flex-col border-t border-border pt-10">
          <h2 className="mb-4 text-pretty text-2xl font-semibold leading-tight md:text-3xl">
            One space. Everything in its place.
          </h2>
          <p className="max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            The web, your work, and your history stop living in separate windows and start
            living in the same one — organized the way you actually think about them. That&apos;s
            the whole idea, and it&apos;s already real.
          </p>
        </section>

        <footer className="flex flex-col gap-4 border-t border-border pt-8">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
              Zero
            </p>
            <p className="text-sm text-muted-foreground">
              A living page — it grows as Zero does.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Building on Zero?{" "}
            <Link
              href="/web-browsing"
              className="text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground"
            >
              Web browsing — engineering reference
            </Link>{" "}
            has the full technical picture of the contextual browser (architecture, prewarm, per-Space
            logins, sleep recovery, limitations, and open work).
          </p>
        </footer>
      </div>
    </main>
  )
}
