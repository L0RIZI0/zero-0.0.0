"use client"

import type { ComponentPropsWithoutRef, ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { INTERACTION_MATRIX_MD } from "@/lib/zero/interaction-matrix-doc"

/**
 * MATRIX INTERACTIONS — a WEB-PREVIEW viewer for the living "what-triggers-what"
 * tracking doc (`v0_memories/user/zero-interaction-matrix.md`). That doc lives outside
 * the app bundle, so its markdown is embedded in `interaction-matrix-doc.ts` and rendered
 * here with react-markdown + remark-gfm (for the GFM tables). This is a reference route,
 * reachable directly in the preview; the desktop shell only mounts `/`, so it stays
 * web-only without any explicit gating.
 *
 * Status tags in the doc ([CUR]/[PART]/[TODO]) are highlighted into colored chips so the
 * table scans quickly.
 */

/** Wrap the [CUR]/[PART]/[TODO] status tokens in colored chips wherever they appear as
 *  plain text inside a rendered node. Applied to table cells + list text. */
function withStatusChips(children: ReactNode): ReactNode {
  if (typeof children === "string") return splitStatus(children)
  if (Array.isArray(children)) return children.map((c, i) => <span key={i}>{withStatusChips(c)}</span>)
  return children
}

const STATUS_STYLE: Record<string, string> = {
  "[CUR]": "bg-secondary text-secondary-foreground",
  "[PART]": "border border-border text-foreground",
  "[TODO]": "border border-border text-muted-foreground",
}

function splitStatus(text: string): ReactNode {
  const parts = text.split(/(\[CUR\]|\[PART\]|\[TODO\])/g)
  if (parts.length === 1) return text
  return parts.map((p, i) =>
    STATUS_STYLE[p] ? (
      <span
        key={i}
        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${STATUS_STYLE[p]}`}
      >
        {p.slice(1, -1)}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

export default function MatrixInteractionsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Zero
        </Link>

        <div className="mt-8">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: (props) => (
                <h1 className="text-pretty text-2xl font-semibold tracking-tight" {...props} />
              ),
              h2: (props) => (
                <h2
                  className="mt-10 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  {...props}
                />
              ),
              h3: (props) => (
                <h3 className="mt-6 text-sm font-medium text-foreground" {...props} />
              ),
              p: (props) => (
                <p
                  className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground"
                  {...props}
                />
              ),
              ul: (props) => <ul className="mt-3 space-y-1.5" {...props} />,
              li: ({ children }) => (
                <li className="flex gap-2 text-[13px] leading-relaxed text-muted-foreground">
                  <span aria-hidden className="text-muted-foreground/50">
                    &middot;
                  </span>
                  <span className="text-pretty">{withStatusChips(children)}</span>
                </li>
              ),
              strong: (props) => <strong className="font-medium text-foreground" {...props} />,
              code: (props) => (
                <code
                  className="rounded bg-muted px-1 py-0.5 text-[11px] tabular-nums text-foreground"
                  {...props}
                />
              ),
              a: (props) => <span className="text-foreground">{props.children}</span>,
              table: (props) => (
                <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                  <table className="w-full border-collapse text-left text-[12px]" {...props} />
                </div>
              ),
              thead: (props) => <thead className="bg-muted/50" {...props} />,
              th: (props) => (
                <th
                  className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  {...props}
                />
              ),
              td: ({ children, ...rest }: ComponentPropsWithoutRef<"td">) => (
                <td
                  className="border-b border-border/60 px-3 py-2 align-top leading-relaxed text-muted-foreground"
                  {...rest}
                >
                  {withStatusChips(children)}
                </td>
              ),
            }}
          >
            {INTERACTION_MATRIX_MD}
          </ReactMarkdown>
        </div>
      </div>
    </main>
  )
}
