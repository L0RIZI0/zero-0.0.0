import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export const metadata: Metadata = {
  title: "Web browsing in Zero — engineering reference",
  description:
    "The full technical picture of Zero's web-browsing feature: the WebView2 .NET host, prewarm, per-Space login env keying, park/close lifecycle, sleep/idle input recovery, OAuth popups, background media, limitations, and open work.",
}

// Engineering handoff doc (NOT the lyrical /features page). Geist UI, dense, factual —
// written so v0 (or another agent) can pick the feature up cold. Everything here is
// grounded in the live code: native/resource-host/* (C# WebView2 host),
// electron/resource-host-bridge.cjs + electron/main.cjs (Electron side), and
// components/zero0/* (renderer). Keep it in sync when the feature changes.

// ── small primitives ───────────────────────────────────────────────────────────
function Kicker({ children }: { children: React.ReactNode }) {
  return <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{children}</p>
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[0.85em] text-foreground">{children}</code>
}

// A fact row: term on the left, explanation on the right (stacks on mobile).
function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <li className="grid gap-1.5 border-t border-border pt-4 md:grid-cols-[14rem_1fr] md:gap-6">
      <span className="text-sm font-medium text-foreground">{term}</span>
      <span className="text-sm leading-relaxed text-muted-foreground">{children}</span>
    </li>
  )
}

const TONE_DOT: Record<"ok" | "caution" | "gap", string> = {
  ok: "bg-[#2ECC71]",
  caution: "bg-[#F5A623]",
  gap: "bg-destructive",
}

function StatusItem({
  tone,
  title,
  children,
}: {
  tone: "ok" | "caution" | "gap"
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex flex-col gap-2 border-t border-border pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${TONE_DOT[tone]}`} />
        <h3 className="text-base font-medium text-foreground">{title}</h3>
      </div>
      <p className="max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">{children}</p>
    </li>
  )
}

// ── version history (the sleep + OAuth saga) ────────────────────────────────────
const HISTORY: { v: string; marker?: string; note: string }[] = [
  { v: "v0.2.210", note: "Proved multiple WebView2 controllers per profile are fine SEQUENTIALLY; concurrent creates on one profile caused the 0x8007139F blank. Basis for the one-prewarm-per-env rule." },
  { v: "v0.2.213", marker: "popup-foreground-v13", note: "Instrumented the OAuth popup path (previously an empty catch swallowed failures). Revealed the popup + Google account picker actually load fine (real Edge, 200)." },
  { v: "v0.2.214", marker: "popup-foreground-v13", note: "First foreground attempt for the popup (TopMost pulse + AttachThreadInput steal). Insufficient — popup still opened behind the main window." },
  { v: "v0.2.215", marker: "input-reanchor-v14", note: "Webview input recovery now fires on window-focus + a 1s idle-return poll (getSystemIdleTime), not just sleep. Fixed the away-a-few-minutes freeze. Keyboard recovered; mouse did not." },
  { v: "v0.2.216", marker: "input-reanchor-v15", note: "Reanchor now also re-raises the container z-order to HWND_TOP, so MOUSE hit-testing recovers after sleep, not just keyboard. Sleep saga closed." },
  { v: "v0.2.217", marker: "popup-owner-v16", note: "OAuth popup is now an OWNED window of the Electron top-level HWND (SetWindowLongPtr GWL_HWNDPARENT), so it always floats above instead of opening invisibly." },
]

// ── open work ────────────────────────────────────────────────────────────────────
const OPEN: { title: string; body: string }[] = [
  {
    title: "Popup favicon",
    body: "The OAuth popup Form has no Icon set, so Windows shows a generic default. One line in PopupWindow (win.Icon = app icon). Trivial, not yet done.",
  },
  {
    title: "Background media as a real feature",
    body: "Today background audio is an incidental side effect of park-keeps-alive. A dedicated persistent mini-player (transport controls, survives close) would make it intentional.",
  },
  {
    title: "Login inheritance with override",
    body: "getEnvKey resolves to the NEAREST Space today (every nested Space forks its own jar). Proposed inverse: an explicit webEnvId marker; resolve to the first ancestor carrying one so a top Space's jar is inherited by descendants unless a child opts to fork. Pure keying, engine-independent. Caveat: cookie jars don't merge — 'override' = fork a fresh jar, not inherit-then-patch.",
  },
  {
    title: "Cross-platform (Mac/Linux)",
    body: "Requires a non-WebView2 host behind the same zero:resource:* seam (CEF is the realistic path). See /future-chromium-zero-strategy.",
  },
]

export default function WebBrowsingReferencePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col px-6 py-16 md:py-24">
        <Link
          href="/features"
          className="mb-16 inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Features
        </Link>

        {/* Hero */}
        <header className="mb-16 flex flex-col gap-4">
          <Kicker>Engineering reference · web browsing</Kicker>
          <h1 className="text-balance text-4xl font-semibold leading-tight md:text-5xl">
            Web browsing in Zero
          </h1>
          <p className="max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            A handoff-grade reference for the feature as it exists today (v0.2.217, Windows-only). Grounded in
            the live code, not recollection. In Zero a web page is an <em>entity</em>: a web-resource kind with
            a <Code>webUrl</Code>, living in the context tree like a Task or Space, revealed as a real browser
            surface when you drill in.
          </p>
        </header>

        {/* Architecture */}
        <section className="mb-16 flex flex-col gap-6">
          <Kicker>Architecture</Kicker>
          <h2 className="text-pretty text-2xl font-semibold leading-tight">Real Edge behind an IPC seam</h2>
          <ul className="flex flex-col gap-5">
            <Fact term="The renderer">
              <Code>components/zero0/zero0-canvas.tsx</Code> and <Code>zero0-resource-canvas.tsx</Code> track a
              DOM rect for the web surface and drive it entirely through IPC. The renderer never touches the
              engine directly.
            </Fact>
            <Fact term="The engine">
              A separate <strong>.NET host process running WebView2</strong> (<Code>CoreWebView2</Code>) —
              genuine Microsoft Edge. Files: <Code>native/resource-host/HostContext.cs</Code> (views, input,
              bounds), <Code>PopupWindow.cs</Code> (OAuth popups), <Code>Program.cs</Code> (entry + build
              marker log line).
            </Fact>
            <Fact term="The seam">
              <Code>electron/resource-host-bridge.cjs</Code> speaks the engine-neutral{" "}
              <Code>zero:resource:*</Code> contract (mount, park, close, setBounds, prewarm, reanchor, status,
              navigated…). Everything above it is engine-agnostic; the C# host is a swappable implementation.
            </Fact>
            <Fact term="No spoofing">
              Because it&apos;s real Edge, sites see a supported browser. There is deliberately{" "}
              <strong>no UA/client-hints/fingerprint spoofing</strong> in the host — that whole arms race
              belonged to the old Electron <Code>WebContentsView</Code> path (still present as a fallback behind{" "}
              <Code>useWebView2()</Code>, but not the live path).
            </Fact>
          </ul>
        </section>

        {/* Prewarm */}
        <section className="mb-16 flex flex-col gap-6">
          <Kicker>Prewarm</Kicker>
          <h2 className="text-pretty text-2xl font-semibold leading-tight">Instant reveal, one per profile</h2>
          <p className="max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
            On entering a context, <Code>zero0-canvas</Code> prewarms its direct web-resource children: spins up
            a hidden controller, loads the URL, lays it out at the real viewport size so a later drill-in is a
            pure instant reveal with no reflow. Two guardrails:
          </p>
          <ul className="flex flex-col gap-5">
            <Fact term="One per env (profile)">
              Seed at most one prewarm per <Code>envKey</Code>, never into an env that already has a live view.
              Multiple controllers per profile are fine sequentially (v0.2.210) but concurrent creates on one
              profile caused the old <Code>0x8007139F</Code> blank — so same-Space siblings warm lazily on first
              open, then stay parked-warm.
            </Fact>
            <Fact term="Bounded">
              Capped by <Code>PREWARM_MAX_PER_CONTEXT</Code>; prewarmed-but-never-opened views are discarded when
              you leave the context, to cap memory.
            </Fact>
          </ul>
        </section>

        {/* Login / env keying */}
        <section className="mb-16 flex flex-col gap-6">
          <Kicker>Login &amp; identity</Kicker>
          <h2 className="text-pretty text-2xl font-semibold leading-tight">Cookie jars keyed per Space</h2>
          <ul className="flex flex-col gap-5">
            <Fact term="getEnvKey (lib/zero/data.ts)">
              Walks up the entity&apos;s <Code>parentId</Code> chain and returns the <strong>nearest Space
              ancestor&apos;s id</strong> as the WebView2 profile name. Walks <Code>parentId</Code> only — never{" "}
              <Code>taggedContextIds</Code> — so the login env is deterministic regardless of navigation.
            </Fact>
            <Fact term="Per-Space isolation">
              Everything under one Space shares a cookie jar (SSO within the Space). Different Spaces are
              isolated jars — same site, different accounts, cleanly separate.
            </Fact>
            <Fact term="Nesting">
              A Task <Code>T</Code> in Space <Code>B</Code> inside Space <Code>A</Code> inherits{" "}
              <strong>B&apos;s</strong> login (the nearest Space), not A&apos;s. Every nested Space forks its own
              jar today. Cookies persist on disk across restarts.
            </Fact>
          </ul>
        </section>

        {/* Lifecycle */}
        <section className="mb-16 flex flex-col gap-6">
          <Kicker>Lifecycle</Kicker>
          <h2 className="text-pretty text-2xl font-semibold leading-tight">Park vs close</h2>
          <ul className="flex flex-col gap-5">
            <Fact term="Drill away = park">
              <Code>SetVisible(false)</Code> — the view is hidden but kept alive; the controller is NOT closed
              and the page keeps running (no <Code>TrySuspend</Code>/mute in the host).
            </Fact>
            <Fact term="× button = destroy">
              Closes the controller and tears the view down. This is the only path that stops a running page.
            </Fact>
            <Fact term="Eviction">
              On the live WebView2 path, eviction is <strong>off</strong> — parked views stay resident. The
              Electron fallback path keeps only <Code>WARM_LIMIT = 4</Code> warm views (LRU) and throttles
              parked ones.
            </Fact>
          </ul>
        </section>

        {/* Sleep / input recovery */}
        <section className="mb-16 flex flex-col gap-6">
          <Kicker>Sleep &amp; idle recovery</Kicker>
          <h2 className="text-pretty text-2xl font-semibold leading-tight">Why input dies and how it comes back</h2>
          <p className="max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
            The host is a background helper whose views are <Code>SetParent</Code>&apos;d under Electron&apos;s
            HWND. Across sleep, session lock, and any idle low-power transition (notably display power-off on
            Modern Standby), the OS silently tears down the <Code>AttachThreadInput</Code> merge that routes
            mouse+keyboard into the visible webview, and knocks its child-window z-order below Electron&apos;s
            content HWND. Symptom: the page renders but is dead to input (or dead to mouse only).
          </p>
          <ul className="flex flex-col gap-5">
            <Fact term="Triggers (electron/main.cjs)">
              <Code>reanchor</Code> fires on <Code>powerMonitor</Code> resume + unlock-screen, on{" "}
              <Code>browser-window-focus</Code>, and on a 1s idle-return poll using{" "}
              <Code>powerMonitor.getSystemIdleTime()</Code> (OS-level, works even while our merge is broken;
              threshold 30s).
            </Fact>
            <Fact term="Recovery (ReanchorInput)">
              Force-detach then re-attach the input merge, then <Code>RaiseToTop()</Code> —{" "}
              <Code>SetWindowPos(HWND_TOP, …)</Code> + re-assert controller visibility/bounds — so keyboard AND
              mouse hit-testing both come back. No hide/reload, so no flicker or lost page state.
            </Fact>
          </ul>
        </section>

        {/* OAuth popups */}
        <section className="mb-16 flex flex-col gap-6">
          <Kicker>OAuth popups</Kicker>
          <h2 className="text-pretty text-2xl font-semibold leading-tight">Sign in with Google &amp; friends</h2>
          <ul className="flex flex-col gap-5">
            <Fact term="The flow works">
              A site&apos;s login button does <Code>window.open</Code> → <Code>OnNewWindow</Code> →{" "}
              <Code>PopupWindow.OpenAsync</Code> in the same profile. <Code>e.NewWindow = core</Code> is required
              so the popup can <Code>postMessage</Code> its result back to the opener (GIS/OAuth{" "}
              <Code>response_mode=form_post</Code>). Google&apos;s account picker loads fine — real Edge, no
              engine wall.
            </Fact>
            <Fact term="Visibility fix (v0.2.217)">
              The popup is now an <strong>owned window</strong> of the Electron top-level HWND via{" "}
              <Code>SetWindowLongPtr(child, GWL_HWNDPARENT, GetAncestor(owner, GA_ROOT))</Code>, so it always
              floats above instead of opening behind the main window. Fighting the foreground lock alone
              (v214) was unreliable from a background process.
            </Fact>
            <Fact term="Diagnostics">
              Popup logs: <Code>popup open BEGIN … owner=</Code>, <Code>popup SetOwner</Code>,{" "}
              <Code>popup controller OK</Code>, <Code>popup navDone ok=… status=…</Code>,{" "}
              <Code>popup front state visible=… bounds=… fg=…</Code>. If a popup is ever invisible again, check{" "}
              <Code>fg=</Code> and whether <Code>bounds</Code> are on-screen.
            </Fact>
          </ul>
        </section>

        {/* Feature status */}
        <section className="mb-16 flex flex-col gap-6">
          <Kicker>Status &amp; limitations, honestly</Kicker>
          <h2 className="text-pretty text-2xl font-semibold leading-tight">What works, what doesn&apos;t</h2>
          <ul className="flex flex-col gap-6">
            <StatusItem tone="ok" title="Contextual browsing, per-Space login, warm reveal">
              Core loop is solid and genuinely differentiated: real Edge, instant reveals, cookie jars scoped to
              the Space you&apos;re in.
            </StatusItem>
            <StatusItem tone="ok" title="Sleep / idle / focus recovery">
              Keyboard and mouse both recover automatically after sleep, lock, or idle — no more manual
              park→reveal (closed in v0.2.215–216).
            </StatusItem>
            <StatusItem tone="ok" title="Background audio (e.g. YouTube)">
              Start playback, drill away → the view is parked (alive, not suspended or muted), so audio keeps
              playing. Requires a play gesture first; the × button stops it; no PiP/mini-player/mute controls.
              Works, but incidental — see open work.
            </StatusItem>
            <StatusItem tone="caution" title="Embedded third-party OAuth">
              Now appears and functions, but any site&apos;s embedded login is inherently more brittle than a
              standalone browser. Watch this on new sites.
            </StatusItem>
            <StatusItem tone="gap" title="Windows-only">
              WebView2 + the .NET host. No macOS/Linux renderer without a second host behind the seam.
            </StatusItem>
            <StatusItem tone="gap" title="One visible surface; can't drill a web resource's children while shown">
              The content region is occupied by the web view; use the sibling-switch. No split/tiled web views
              yet.
            </StatusItem>
          </ul>
        </section>

        {/* Version history */}
        <section className="mb-16 flex flex-col gap-6">
          <Kicker>Version history — the sleep &amp; OAuth saga</Kicker>
          <h2 className="text-pretty text-2xl font-semibold leading-tight">How we got to v0.2.217</h2>
          <ul className="flex flex-col gap-4">
            {HISTORY.map((h) => (
              <li key={h.v} className="grid gap-1.5 border-t border-border pt-4 md:grid-cols-[10rem_1fr] md:gap-6">
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono text-sm font-medium text-foreground">{h.v}</span>
                  {h.marker ? (
                    <span className="font-mono text-xs text-muted-foreground">{h.marker}</span>
                  ) : null}
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">{h.note}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The <Code>Program.cs</Code> build-marker log line (e.g. <Code>popup-owner-v16</Code>) is the fastest
            way to confirm which host build is actually running in a given <Code>host.log</Code>.
          </p>
        </section>

        {/* Open work */}
        <section className="mb-16 flex flex-col gap-6">
          <Kicker>Open work &amp; where it can go</Kicker>
          <h2 className="text-pretty text-2xl font-semibold leading-tight">Pick up here</h2>
          <ol className="flex flex-col gap-6">
            {OPEN.map((o) => (
              <li key={o.title} className="flex flex-col gap-1.5 border-t border-border pt-4">
                <span className="text-sm font-medium text-foreground">{o.title}</span>
                <span className="max-w-prose text-sm leading-relaxed text-muted-foreground">{o.body}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Key files */}
        <section className="mb-16 flex flex-col gap-6">
          <Kicker>Key files</Kicker>
          <h2 className="text-pretty text-2xl font-semibold leading-tight">Where the code lives</h2>
          <ul className="flex flex-col gap-4">
            <Fact term="native/resource-host/">
              <Code>HostContext.cs</Code> (views, input merge, bounds, reanchor, P/Invokes),{" "}
              <Code>PopupWindow.cs</Code> (OAuth popups), <Code>Program.cs</Code> (entry + build marker).
            </Fact>
            <Fact term="electron/">
              <Code>resource-host-bridge.cjs</Code> (the <Code>zero:resource:*</Code> seam),{" "}
              <Code>main.cjs</Code> (reanchor triggers, idle poll, WARM_LIMIT for the fallback path).
            </Fact>
            <Fact term="components/zero0/">
              <Code>zero0-canvas.tsx</Code> (prewarm, drill/reveal, breadcrumb),{" "}
              <Code>zero0-resource-canvas.tsx</Code> (the web surface + bounds tracking).
            </Fact>
            <Fact term="lib/zero/">
              <Code>data.ts</Code> — <Code>getEnvKey</Code> (per-Space profile keying).
            </Fact>
          </ul>
        </section>

        <p className="border-t border-border pt-8 text-pretty text-sm leading-relaxed text-muted-foreground">
          Related: <Link href="/future-chromium-zero-strategy" className="text-foreground underline underline-offset-4">Future Chromium Strategy</Link>{" "}
          (engine portability / the path to Mac), and <Link href="/features" className="text-foreground underline underline-offset-4">Features</Link>{" "}
          (the product-facing view). This page is the technical source of truth — keep it in sync as the feature
          changes.
        </p>
      </div>
    </main>
  )
}
