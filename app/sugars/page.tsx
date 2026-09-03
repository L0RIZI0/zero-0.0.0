import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export const metadata: Metadata = {
  title: "Zero — Sugars",
  description:
    "The create bar is one small language. A line is a title plus optional sigils: :kind picks what to make, :action flags a lifecycle move, and --field:value sets a slot (times, color, occurrences). Type nothing special and a verb infers the kind. This page is the whole grammar, kind by kind.",
}

// Monospace kicker — matches the shell's uppercase, wide-tracked meta labels so the
// page reads as part of Zero (same as /vision and /excerpts).
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">{children}</p>
  )
}

// A code chip for inline sigils/tokens.
function Tok({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>
  )
}

// ── THE KIND SIGILS — ":xxxx" picks what to make (first 4 letters of the kind name). ──
const KINDS: { sigil: string; kind: string; note: string }[] = [
  { sigil: ":spac", kind: "space", note: "a container — the default drill-in context" },
  { sigil: ":task", kind: "task", note: "a to-do; carries the DONE checkmark axis" },
  { sigil: ":mome", kind: "moment", note: "a lived span; closes at next midnight" },
  { sigil: ":inst", kind: "instant", note: "a zero-duration point; tallies occurrences" },
  { sigil: ":reso", kind: "resource", note: "a cross-cutting thing (a link, a person, a tool)" },
  { sigil: ":comm", kind: "community", note: "a group of organisms" },
  { sigil: ":orga", kind: "organism", note: "a living being" },
  { sigil: ":indi", kind: "individual", note: "a person (temporarily creatable, dogfooding)" },
]

// ── ACTION FLAGS — ":word" applies a lifecycle move to the entity being created/edited. ──
const ACTIONS: { flag: string; does: string }[] = [
  { flag: ":done", does: "mark a Task complete (checkmark)" },
  { flag: ":undone", does: "clear the Task checkmark" },
  { flag: ":close", does: "file the entity now (closed)" },
  { flag: ":cancel", does: "cancel — a struck-through, ended state" },
  { flag: ":reopen", does: "undo a close/cancel, back to open" },
  { flag: ":request", does: "flag a resource as requested" },
  { flag: ":unrequest", does: "clear the requested flag" },
  { flag: ":delete", does: "remove the entity" },
]

// ── FIELD ATTRIBUTES — "--field:value" sets a slot. Empty value clears it. ──
const FIELDS: { field: string; value: string; does: string }[] = [
  { field: "--start", value: "time", does: "schedule start (or, on an ONGOING entity, backdate the running session)" },
  { field: "--end", value: "time", does: "schedule end" },
  { field: "--at", value: "time", does: "the point time (moment/instant anchor)" },
  { field: "--due", value: "time", does: "a Task's due time" },
  { field: "--duration", value: "span", does: "set end = start + span (e.g. 1h30m)" },
  { field: "--maxnb", value: "n", does: "INSTANT: occurrences required to complete (default 1). Soft — extra marks still recorded" },
  { field: "--maxnbhard", value: "n", does: "INSTANT: as --maxnb, but a HARD cap — no marks accepted past complete" },
  { field: "--close", value: "manual", does: "opt out of the automatic next-midnight close (moment/instant)" },
  { field: "--color", value: "hex/name", does: "set the accent color" },
  { field: "--sex", value: "man/woman", does: "an organism/individual's sex glyph" },
  { field: "--title", value: "text", does: "set the title explicitly (when free text is ambiguous)" },
]

// ── TIME GRAMMAR — how a <time> value is written. ──
const TIMES: { shape: string; means: string }[] = [
  { shape: "5min ago · 2h ago · 1h30m ago", means: "relative to now, in the past" },
  { shape: "in 10m · in 2h", means: "relative to now, in the future" },
  { shape: "0630 · 2330", means: "HHMM today (4 digits)" },
  { shape: "260716 · 2607161430", means: "YYMMDD or YYMMDDHHMM (6 / 10 digits)" },
  { shape: "tonight · tomorrow · whenever", means: "named anchors (whenever = playable, no fixed time)" },
]

// ── COMPACT CHEAT-SHEET — every idiom in one scan, with a worked example. ──
const CHEATS: { line: string; result: string }[] = [
  { line: ":task Fix the export bug --due:tonight", result: "a Task due tonight" },
  { line: ":mome Slept --2330-0630", result: "a Moment spanning 23:30 → 06:30" },
  { line: ":inst Took meds --maxnbhard:3", result: "an Instant needing 3 occurrences, hard-capped" },
  { line: ":inst Coffee --at:in 30m", result: "a scheduled Instant, 30 minutes out" },
  { line: "Slept 8h", result: "verb inference → a Moment (no sigil needed)" },
  { line: "Wrote the memo --start:2h ago", result: "verb → a Task, started 2h ago" },
  { line: ":spac Day Job --color:#2F6FED", result: "a blue Space" },
  { line: "Ship v1 :done", result: "a Task, created already complete" },
  { line: "--start:5min ago", result: "on the current ONGOING entity: backdate its session" },
]

function RefTable({
  cols,
  rows,
}: {
  cols: string[]
  rows: { k: string; a: string; b?: string }[]
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
            {cols.map((c) => (
              <th key={c} className="px-4 py-3 font-normal">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className="border-b border-border/60 align-top last:border-0">
              <td className="whitespace-nowrap px-4 py-3 font-mono text-foreground">{r.k}</td>
              <td className="px-4 py-3 text-foreground">{r.a}</td>
              {r.b !== undefined && <td className="px-4 py-3 text-muted-foreground">{r.b}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SugarsPage() {
  return (
    <main className="min-h-dvh bg-background px-6 py-16 text-foreground md:px-10 md:py-24">
      <div className="mx-auto flex max-w-3xl flex-col">
        <Link
          href="/"
          className="mb-16 inline-flex items-center gap-2 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Zero
        </Link>

        {/* Hero. */}
        <header className="mb-20 flex flex-col">
          <Kicker>Sugars</Kicker>
          <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
            One bar.
            <br />
            <span className="text-muted-foreground">One language.</span>
          </h1>
          <p className="mt-8 max-w-prose text-pretty text-lg leading-relaxed text-muted-foreground md:text-xl">
            The create bar is not a form. It is a small, forgiving grammar: a line of free text
            that becomes a title, sprinkled with <span className="text-foreground">sigils</span>{" "}
            that shape what gets made. Pick a kind with <Tok>:kind</Tok>, flag a lifecycle move
            with <Tok>:action</Tok>, set a slot with <Tok>--field:value</Tok> — or type nothing
            special and let a verb infer the kind. This is the whole vocabulary.
          </p>
        </header>

        {/* The idea. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>The shape of a line</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            Title first. Sigils optional.
          </h2>
          <div className="flex flex-col gap-6 text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            <p>
              Everything you don&apos;t mark becomes the <span className="text-foreground">title</span>.
              The sigils are stripped out wherever they appear, so{" "}
              <Tok>:task Call the bank --due:tonight</Tok> and{" "}
              <Tok>Call the bank :task --due:tonight</Tok> parse the same. Order is for humans,
              not the parser.
            </p>
            <p>
              A value is whatever follows the first colon; an <span className="text-foreground">empty
              value clears</span> that slot. Times are captured whole — so{" "}
              <Tok>--start:5min ago</Tok> keeps the &ldquo;ago&rdquo; instead of truncating at the
              space. Submitting commits the line: the entity gets an id and drops into the current
              context.
            </p>
          </div>
        </section>

        {/* Kinds. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>Kinds</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            <Tok>:kind</Tok> — pick what to make.
          </h2>
          <p className="mb-8 max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            The selector is the first four letters of the kind name (the full name works too).
            Omit it and Zero infers a kind from your verb — see below.
          </p>
          <RefTable
            cols={["Sigil", "Kind", "What it is"]}
            rows={KINDS.map((k) => ({ k: k.sigil, a: k.kind, b: k.note }))}
          />
        </section>

        {/* Actions. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>Actions</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            <Tok>:action</Tok> — flag a lifecycle move.
          </h2>
          <p className="mb-8 max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            Actions apply on create or on edit. On an existing entity they are the same moves the
            right-click menu offers, just typed.
          </p>
          <RefTable cols={["Flag", "Does"]} rows={ACTIONS.map((a) => ({ k: a.flag, a: a.does }))} />
        </section>

        {/* Fields. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>Fields</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            <Tok>--field:value</Tok> — set a slot.
          </h2>
          <p className="mb-8 max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            Aliases: <Tok>--s</Tok> = <Tok>--start</Tok>, <Tok>--e</Tok> = <Tok>--end</Tok>. A
            span end that is date-only covers the whole final day. Instants have their own two
            occurrence fields — <Tok>--maxnb</Tok> and <Tok>--maxnbhard</Tok> — described next.
          </p>
          <RefTable
            cols={["Field", "Value", "Does"]}
            rows={FIELDS.map((f) => ({ k: f.field, a: f.value, b: f.does }))}
          />
        </section>

        {/* Instants deep-cut. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>Instants</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            A point that can happen more than once.
          </h2>
          <div className="flex flex-col gap-6 text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            <p>
              An instant is a zero-duration <span className="text-foreground">point</span>, never a
              span — so it never reads as ongoing. By default it is a{" "}
              <span className="text-foreground">unique occurrence</span>: it completes the moment
              its scheduled <Tok>--at</Tok> passes, or on its first mark. Its states are{" "}
              <span className="text-foreground">open</span> (no schedule),{" "}
              <span className="text-foreground">scheduled</span> (an <Tok>--at</Tok> is set),{" "}
              <span className="text-foreground">complete</span> (max occurrences reached, filled
              glyph), <span className="text-foreground">closed</span> (filed at midnight), and{" "}
              <span className="text-foreground">cancelled</span>.
            </p>
            <p>
              Set <Tok>--maxnb:3</Tok> and it needs three occurrences to complete — marks plus a
              passed scheduled <Tok>--at</Tok> both count. Each occurrence that does not yet
              complete it makes the glyph <span className="text-foreground">spin and flash</span>{" "}
              its fill at the halfway point, then relax back to an outline; the occurrence that
              completes it fills the glyph for good. <Tok>--maxnbhard:3</Tok> makes that a hard
              cap: once complete, no further marks are accepted. Like moments, instants file at the
              next midnight unless you set <Tok>--close:manual</Tok>.
            </p>
          </div>
        </section>

        {/* Time grammar. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>Time</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            How a <Tok>&lt;time&gt;</Tok> is written.
          </h2>
          <p className="mb-8 max-w-prose text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            Any field that takes a time accepts these shapes. A bare <Tok>--start:2330-0630</Tok>{" "}
            is shorthand for a start–end span. Zero&apos;s day boundary is 5am, so an early-morning
            time still belongs to the day that just ended.
          </p>
          <RefTable cols={["Shape", "Means"]} rows={TIMES.map((t) => ({ k: t.shape, a: t.means }))} />
        </section>

        {/* Verb inference. */}
        <section className="mb-20 flex flex-col border-t border-border pt-10">
          <Kicker>Inference</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            No sigil? The verb decides.
          </h2>
          <div className="flex flex-col gap-6 text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            <p>
              If you skip <Tok>:kind</Tok>, Zero reads the first word. A{" "}
              <span className="text-foreground">transforming verb</span> — wrote, built, fixed,
              designed, cooked — makes a <span className="text-foreground">Task</span> (you changed
              something). An <span className="text-foreground">experiential verb</span> — slept,
              walked, watched, ate, met — makes a <span className="text-foreground">Moment</span>{" "}
              (you lived through it). Everything else defaults to a Task under the current context.
            </p>
          </div>
        </section>

        {/* Cheat-sheet. */}
        <section className="mb-8 flex flex-col border-t border-border pt-10">
          <Kicker>Cheat-sheet</Kicker>
          <h2 className="mb-8 text-pretty text-3xl font-semibold leading-tight md:text-4xl">
            The whole thing, in one scan.
          </h2>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  <th className="px-4 py-3 font-normal">Type this</th>
                  <th className="px-4 py-3 font-normal">Get this</th>
                </tr>
              </thead>
              <tbody>
                {CHEATS.map((c) => (
                  <tr key={c.line} className="border-b border-border/60 align-top last:border-0">
                    <td className="px-4 py-3 font-mono text-foreground">{c.line}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
