"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import { KIND_META, getState, canDeleteEntity, canCancelEntity, type EntityState } from "@/lib/zero/kinds"
import { formatState } from "@/lib/zero/face-model"
import type { IndividualEntity } from "@/lib/zero/types"

/**
 * THE INDIVIDUAL — the per-entity reference page (the first of a page-per-kind set, reached by
 * clicking a kind's glyph/name in the bible at /entities). It documents the Individual's structure:
 * its STATE machine, its STATUS (life-label) machine, its fields, and its capabilities.
 *
 * KEPT HONEST BY THE CODE: wherever possible this page READS FROM the runtime model instead of
 * re-describing it — the capability row comes straight from KIND_META.individual, and the "live
 * state" table runs real sample Individuals through the actual getState / formatState /
 * canDeleteEntity / canCancelEntity. If the model changes, this page changes with it.
 *
 * THE MODEL (individual):
 *   • Two dates drive the life axis — the generic planned `schedule.startAt` (a planned ARRIVAL)
 *     and the dedicated `bornAt` (the confirmed BIRTHDAY). `bornAt` in the past ⇒ the person is
 *     alive; a future birthday, or a future planned start when unborn, reads "expected".
 *   • STATE (what it IS): open → scheduled → alive → {dead | closed} , plus cancelled.
 *   • STATUS (what it's DOING here): a pure LIFE-LABEL projection of STATE — scheduled ⇒ "upcoming",
 *     alive ⇒ "live", everything else hides the row. It does NOT touch the ongoing/session axis.
 *   • Delete only while NOT alive (open / scheduled / cancelled) — never a living or ended person.
 *   • Cancel only while not-yet-lived (open / scheduled). Close anytime (a kill if alive ⇒ dead).
 */

const META = KIND_META.individual
const DAY = 86_400_000
const YEAR = 365 * DAY

/** A tiny date formatter for formatState (mirrors the app's short style). */
const fmtDate = (e?: number) => (e == null ? "" : new Date(e).toLocaleDateString())

/** The STATUS life-label projection — mirrors the individual branch of getFaceMetaRows in
 *  face-model.ts: scheduled ⇒ "upcoming", alive ⇒ "live", every other state hides the row. */
function lifeLabel(word: EntityState["word"]): string | null {
  if (word === "scheduled") return "upcoming"
  if (word === "alive") return "live"
  return null
}

// ── The nodes of the STATE machine ──────────────────────────────────────────
type StateNode = {
  word: string
  title: string
  blurb: string
  status: string
  terminal?: boolean
}
const STATE_NODES: StateNode[] = [
  {
    word: "open",
    title: "Open",
    blurb: "A not-yet-shaped person: no birthday, no future plan. The resting default — safe to delete.",
    status: "— (hidden)",
  },
  {
    word: "scheduled",
    title: "Scheduled",
    blurb:
      "A planned arrival: a future birthday, or a future planned start while still unborn. The §0 start row reads \u201Cexpected \u00b7 <date>\u201D.",
    status: "upcoming",
  },
  {
    word: "alive",
    title: "Alive",
    blurb: "The birthday (bornAt) has passed. A living person — the one state you can never delete.",
    status: "live",
  },
  {
    word: "dead",
    title: "Dead",
    blurb:
      "Closed WHILE alive — a kill. The person lived, so the lifespan (born \u2192 death) is stamped as their age. Terminal.",
    status: "— (hidden)",
    terminal: true,
  },
  {
    word: "closed",
    title: "Closed",
    blurb:
      "Closed while NOT alive — a plan shut before it ever began (no real life ended). Terminal.",
    status: "— (hidden)",
    terminal: true,
  },
  {
    word: "cancelled",
    title: "Cancelled",
    blurb:
      "Voided while not-yet-lived — a bar over the glyph, title struck. Still deletable (a voided plan can be cleared). Terminal.",
    status: "— (hidden)",
    terminal: true,
  },
]

// ── The transitions ──────────────────────────────────────────────────────────
type Transition = { from: string; to: string; trigger: string; guard: string }
const TRANSITIONS: Transition[] = [
  { from: "—", to: "open", trigger: "Create (no dates)", guard: "always" },
  { from: "open", to: "scheduled", trigger: "Set a future bornAt / planned start", guard: "date is in the future" },
  { from: "scheduled", to: "alive", trigger: "bornAt passes now", guard: "born ≤ now" },
  { from: "open", to: "alive", trigger: "Set a past bornAt", guard: "born ≤ now" },
  { from: "open · scheduled", to: "cancelled", trigger: "Cancel", guard: "canCancelEntity (not-yet-lived)" },
  { from: "alive", to: "dead", trigger: "Close (a kill)", guard: "was alive at close ⇒ age stamped" },
  { from: "open · scheduled", to: "closed", trigger: "Close", guard: "not alive ⇒ plain closed" },
  { from: "open · scheduled · cancelled", to: "(deleted)", trigger: "Delete", guard: "canDeleteEntity (never alive/dead/closed)" },
]

// ── Fields ────────────────────────────────────────────────────────────────────
type FieldRow = { name: string; type: string; note: string; own?: boolean }
const FIELDS: FieldRow[] = [
  {
    name: "bornAt",
    type: "Epoch?",
    own: true,
    note:
      "The confirmed BIRTHDAY — the source of truth for the alive state and the age row. Individual-only. A past value ⇒ alive; a future one ⇒ still expected. Set via setEntityBornAt.",
  },
  {
    name: "sex",
    type: "Sex?",
    own: true,
    note: "Biological sex (man / woman / …), an Individual's defining identity field. Set via the :sex: self-field setter. Always shown in §0 (— when unset).",
  },
  {
    name: "diedOn",
    type: "Epoch?",
    own: true,
    note: "Legacy terminal stamp. The live model derives death from a Close while alive (closed / closedOn); diedOn is retained on the type but not read by getState.",
  },
  {
    name: "schedule.startAt",
    type: "Epoch | \u201Cwhenever\u201D?",
    note: "The generic PLANNED arrival. Distinct from bornAt: a future startAt (while unborn) reads \u201Cexpected\u201D; bornAt is the confirmed birth that makes the person alive.",
  },
  {
    name: "closed · closedOn · closeAt",
    type: "boolean · Epoch · Epoch",
    note: "The close stamps. A Close while alive ⇒ dead (age = born → close); a Close while not-yet-lived ⇒ closed. Reversible via Reopen.",
  },
  {
    name: "cancelled · cancelledOn",
    type: "boolean · Epoch",
    note: "The cancel stamps (bar + strike). Only settable while open / scheduled. A cancelled individual is still deletable.",
  },
]

// ── Capabilities (LIVE from KIND_META.individual) ──────────────────────────────
const CAPABILITIES: { label: string; value: boolean | string; note: string }[] = [
  { label: "creatable", value: META.creatable, note: "A person can be created." },
  { label: "deletable", value: META.deletable, note: "Removable — but only while not alive (see Delete rule)." },
  { label: "closable", value: META.closable, note: "Can be closed anytime; a kill while alive ⇒ dead." },
  { label: "cancellable", value: META.cancellable, note: "Voidable while not-yet-lived only." },
  { label: "completable", value: META.completable, note: "A being does not \u201Ccomplete\u201D — it reaches a terminal (death)." },
  { label: "hasDoneFlag", value: META.hasDoneFlag, note: "No soft done checkmark (that is Task-only)." },
  { label: "plannable", value: META.plannable, note: "Carries a planned beginning (birth / arrival)." },
  { label: "fillsWhenClosed", value: META.fillsWhenClosed, note: "Terminal close only FADES the glyph; it never fills." },
  { label: "terminal", value: String(META.terminal), note: "Its terminal flavour — a death." },
]

// ── Live sample Individuals run through the REAL functions ─────────────────────
function sampleRows(now: number) {
  const base = { kind: "individual" as const, parentId: null, taggedContextIds: [] as string[] }
  const samples: { scenario: string; e: IndividualEntity }[] = [
    { scenario: "Empty (no dates)", e: { ...base, id: "s1", title: "—" } },
    { scenario: "Planned birth (future)", e: { ...base, id: "s2", title: "—", bornAt: now + 30 * DAY } },
    { scenario: "Born (past)", e: { ...base, id: "s3", title: "—", bornAt: now - 30 * YEAR } },
    {
      scenario: "Killed while alive",
      e: { ...base, id: "s4", title: "—", bornAt: now - 40 * YEAR, closed: true, closedOn: now - DAY },
    },
    {
      scenario: "Closed before birth",
      e: { ...base, id: "s5", title: "—", bornAt: now + 30 * DAY, closed: true, closedOn: now - DAY },
    },
    { scenario: "Cancelled plan", e: { ...base, id: "s6", title: "—", bornAt: now + 30 * DAY, cancelled: true } },
  ]
  return samples.map(({ scenario, e }) => {
    const state = getState(e, now)
    return {
      scenario,
      state: formatState(state, fmtDate, true, true),
      word: state.word,
      status: lifeLabel(state.word) ?? "—",
      canDelete: canDeleteEntity(e, undefined, now),
      canCancel: canCancelEntity(e, now),
    }
  })
}

function YesNo({ v }: { v: boolean }) {
  return (
    <span className={v ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
      {v ? "yes" : "no"}
    </span>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

export default function IndividualPage() {
  const now = Date.now()
  const rows = sampleRows(now)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link
          href="/entities"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to the bible
        </Link>

        <header className="mt-8 flex items-start gap-4">
          <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
            <Zero0Glyph kind="individual" className="h-6 w-6 text-foreground" />
          </span>
          <div className="min-w-0">
            <h1 className="text-pretty text-2xl font-semibold tracking-tight">The Individual</h1>
            <p className="mt-2 max-w-prose text-pretty leading-relaxed text-muted-foreground">
              {META.description} — a being on the life axis. Unlike the action kinds, an Individual is
              never &ldquo;completed&rdquo;; it is <em>born</em>, <em>lives</em>, and reaches a{" "}
              <strong className="font-medium text-foreground">terminal</strong> by death. Its lifecycle is
              driven by two dates: the planned arrival{" "}
              <code className="rounded bg-muted px-1 text-[11px]">schedule.startAt</code> and the confirmed
              birthday <code className="rounded bg-muted px-1 text-[11px]">bornAt</code>.
            </p>
          </div>
        </header>

        {/* Two axes */}
        <Section title="Two axes">
          <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">State</strong> is what the person IS
            (open → scheduled → alive → dead/closed, plus cancelled).{" "}
            <strong className="font-medium text-foreground">Status</strong> here is a pure{" "}
            <em>life-label</em> projected from State — <code className="rounded bg-muted px-1 text-[11px]">scheduled</code>{" "}
            shows <strong className="font-medium text-foreground">upcoming</strong>,{" "}
            <code className="rounded bg-muted px-1 text-[11px]">alive</code> shows{" "}
            <strong className="font-medium text-foreground">live</strong>, and every other state hides the
            row. It is deliberately separate from the ongoing/session axis.
          </p>
        </Section>

        {/* State machine — nodes */}
        <Section title="State machine">
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {STATE_NODES.map((n) => (
              <li key={n.word} className="rounded-lg border border-border bg-card p-3 text-card-foreground">
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                    {n.word}
                  </code>
                  {n.terminal && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                      terminal
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    status: <span className="text-foreground">{n.status}</span>
                  </span>
                </div>
                <p className="mt-1.5 text-pretty text-[11px] leading-relaxed text-muted-foreground">{n.blurb}</p>
              </li>
            ))}
          </ul>

          <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Transitions
          </h3>
          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground">
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">To</th>
                  <th className="px-3 py-2 font-medium">Trigger</th>
                  <th className="px-3 py-2 font-medium">Guard</th>
                </tr>
              </thead>
              <tbody>
                {TRANSITIONS.map((t, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground">{t.from}</td>
                    <td className="px-3 py-2">
                      <code className="rounded bg-muted px-1 text-[10px] text-foreground">{t.to}</code>
                    </td>
                    <td className="px-3 py-2 text-foreground">{t.trigger}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.guard}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Live state table — self-verifying */}
        <Section title="Live state · from the code">
          <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
            Each row is a real sample Individual run through the actual{" "}
            <code className="rounded bg-muted px-1 text-[11px]">getState</code>,{" "}
            <code className="rounded bg-muted px-1 text-[11px]">formatState</code>,{" "}
            <code className="rounded bg-muted px-1 text-[11px]">canDeleteEntity</code> and{" "}
            <code className="rounded bg-muted px-1 text-[11px]">canCancelEntity</code> — so this table cannot
            drift from the model.
          </p>
          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Scenario</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Delete?</th>
                  <th className="px-3 py-2 font-medium">Cancel?</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.scenario} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">{r.scenario}</td>
                    <td className="px-3 py-2">
                      <code className="rounded bg-muted px-1 text-[10px] text-foreground">{r.state}</code>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.status}</td>
                    <td className="px-3 py-2">
                      <YesNo v={r.canDelete} />
                    </td>
                    <td className="px-3 py-2">
                      <YesNo v={r.canCancel} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Fields */}
        <Section title="Fields">
          <ul className="mt-4 space-y-2">
            {FIELDS.map((f) => (
              <li
                key={f.name}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground"
              >
                <code className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                  {f.name}
                </code>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] italic text-muted-foreground/80">{f.type}</span>
                    {f.own && (
                      <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-secondary-foreground">
                        individual-only
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-pretty text-[11px] leading-relaxed text-muted-foreground">{f.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* Capabilities — live from KIND_META */}
        <Section title="Capabilities · from KIND_META">
          <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <li
                key={c.label}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground"
              >
                <code className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                  {c.label}
                </code>
                <div className="min-w-0">
                  <span className="text-xs font-medium">
                    {typeof c.value === "boolean" ? <YesNo v={c.value} /> : c.value}
                  </span>
                  <p className="mt-0.5 text-pretty text-[11px] leading-relaxed text-muted-foreground">{c.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* Lifecycle rules callout */}
        <Section title="Delete · Cancel · Close">
          <ul className="mt-4 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
            <li className="rounded-lg border border-border bg-card p-3">
              <strong className="font-medium text-foreground">Delete</strong> — only while{" "}
              <code className="rounded bg-muted px-1 text-[10px]">open</code>,{" "}
              <code className="rounded bg-muted px-1 text-[10px]">scheduled</code> or{" "}
              <code className="rounded bg-muted px-1 text-[10px]">cancelled</code>. NEVER a living person, and
              never once dead/closed. Deleting is &ldquo;undo a person who never really lived.&rdquo;
            </li>
            <li className="rounded-lg border border-border bg-card p-3">
              <strong className="font-medium text-foreground">Cancel</strong> — only while{" "}
              <code className="rounded bg-muted px-1 text-[10px]">open</code> or{" "}
              <code className="rounded bg-muted px-1 text-[10px]">scheduled</code> (not-yet-lived). Once alive,
              a person is ended by Close, never cancelled.
            </li>
            <li className="rounded-lg border border-border bg-card p-3">
              <strong className="font-medium text-foreground">Close</strong> — allowed anytime. A Close while{" "}
              <code className="rounded bg-muted px-1 text-[10px]">alive</code> is a kill ⇒{" "}
              <code className="rounded bg-muted px-1 text-[10px]">dead</code> (age stamped); a Close before
              birth ⇒ <code className="rounded bg-muted px-1 text-[10px]">closed</code>. The status row hides
              either way.
            </li>
          </ul>
        </Section>
      </div>
    </main>
  )
}
