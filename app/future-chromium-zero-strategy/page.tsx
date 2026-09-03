import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export const metadata: Metadata = {
  title: "Future Chromium Strategy",
  description:
    "How Zero stays portable across web engines — the bridge seam that makes WebView2 swappable for CEF, a Chromium fork, or a Brave-style embedding.",
}

// A pragmatic engineering keypoint (not a lyrical doc): what survives an engine swap,
// what gets rewritten, and an honest read on each migration path. Kept in the default
// Geist UI so it reads as a working strategy note, not a manifesto.

type Layer = { label: string; body: string }

// The two sides of the bridge seam.
const SURVIVES: Layer[] = [
  {
    label: "Renderer, end to end",
    body: "Keep-alive <Activity> drill stack, prewarm orchestration, the breadcrumb, the whole drill/interaction model, and the web↔non-web flash fixes. None of it knows what engine is behind the bridge.",
  },
  {
    label: "The IPC contract",
    body: "zero:resource:{mount, park, close, setBounds, prewarm, status, navigated, …}. This is THE seam. The renderer talks to an abstract resource host through this contract and never names the engine.",
  },
  {
    label: "The behaviors as concepts",
    body: "prewarm = create + load hidden; park = hide-but-keep-alive; reveal = show + reseed focus; bounds tracking follows the DOM rect. These port as ideas — you re-implement them, you don't redesign them.",
  },
]

const REWRITTEN: Layer[] = [
  {
    label: "The native host",
    body: "The C# WebView2 host behind the bridge: controller lifecycle, the AttachThreadInput keyboard-focus dance, SetWindowPos airspace / z-order management, and per-site environment folders. This is the Windows-specific layer.",
  },
]

type Path = {
  name: string
  verdict: string
  tone: "good" | "caution" | "avoid"
  body: string
}

// Honest read on each migration scenario.
const PATHS: Path[] = [
  {
    name: "Adopt CEF",
    verdict: "Realistic — the reason the seam exists",
    tone: "good",
    body: "The most likely path off Windows-only and onto Mac. Write a new host that speaks the same zero:resource:* contract. Focus and airspace work very differently (CEF has its own off-screen and windowed modes), so that layer is a genuine rewrite — but bounded to the host, and you delete the AttachThreadInput hackery entirely. The architecture is already shaped for this.",
  },
  {
    name: "Fork Chromium directly",
    verdict: "Avoid unless the engine IS the product",
    tone: "avoid",
    body: "You own the engine build, security patching, and release cadence forever. The bridge still insulates the renderer, but the cost lives in maintaining the fork, not in Zero's code. Only justified if deep engine customization is itself the differentiator.",
  },
  {
    name: "Plug into a Brave-style fork",
    verdict: "Most tractable of the fork scenarios",
    tone: "caution",
    body: "Functionally like adopting CEF: target their Chromium embedding surface through the same bridge. The rebase treadmill is THEIR burden — you consume the engine, you don't maintain it. Same host rewrite, someone else runs the treadmill.",
  },
]

const TONE_DOT: Record<Path["tone"], string> = {
  good: "bg-[#2ECC71]",
  caution: "bg-[#F5A623]",
  avoid: "bg-destructive",
}

export default function FutureChromiumZeroStrategyPage() {
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

        <header className="mb-16 flex flex-col gap-4">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Engine portability</p>
          <h1 className="text-balance text-4xl font-semibold leading-tight md:text-5xl">
            Future Chromium Strategy
          </h1>
          <p className="max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            Zero renders websites through a native web engine (today WebView2, Windows-only). The long-term
            keypoint: the engine sits behind a single IPC seam, so swapping it — to reach Mac, or to ride
            someone else&apos;s Chromium — is &quot;write a second host,&quot; not &quot;rearchitect Zero.&quot;
          </p>
        </header>

        <section className="mb-16 flex flex-col gap-6">
          <h2 className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            The seam: the <code className="font-mono text-foreground">zero:resource:*</code> bridge
          </h2>
          <p className="max-w-prose text-pretty leading-relaxed text-muted-foreground">
            The renderer never talks to WebView2. It talks to an abstract resource host through a fixed IPC
            contract. Everything above the seam is engine-agnostic; everything below is a swappable
            implementation detail. Keeping that contract clean — no HWND or AttachThreadInput notions leaking
            upward — is the one discipline that keeps every migration cheap.
          </p>
        </section>

        <section className="mb-16 grid gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-5">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[#2ECC71]" />
              Survives any swap
              <span className="text-muted-foreground">(~85%)</span>
            </h2>
            <ul className="flex flex-col gap-5">
              {SURVIVES.map((l) => (
                <li key={l.label} className="flex flex-col gap-1.5 border-t border-border pt-4">
                  <span className="text-sm font-medium text-foreground">{l.label}</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{l.body}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-5">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-destructive" />
              Gets rewritten
            </h2>
            <ul className="flex flex-col gap-5">
              {REWRITTEN.map((l) => (
                <li key={l.label} className="flex flex-col gap-1.5 border-t border-border pt-4">
                  <span className="text-sm font-medium text-foreground">{l.label}</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{l.body}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Bounded to the host. The concepts carry over — you re-implement the same behaviors against a new
              API rather than inventing new ones.
            </p>
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <h2 className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Migration paths, honestly</h2>
          <ol className="flex flex-col gap-8">
            {PATHS.map((p) => (
              <li key={p.name} className="flex flex-col gap-2 border-t border-border pt-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${TONE_DOT[p.tone]}`} />
                  <h3 className="text-lg font-medium text-foreground">{p.name}</h3>
                  <span className="text-sm text-muted-foreground">— {p.verdict}</span>
                </div>
                <p className="max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <p className="mt-16 border-t border-border pt-8 text-pretty text-sm leading-relaxed text-muted-foreground">
          Bottom line: keep <code className="font-mono text-foreground">zero:resource:*</code> engine-neutral,
          and the day Mac matters, the work is a second host implementation behind a seam that already exists.
        </p>
      </div>
    </main>
  )
}
