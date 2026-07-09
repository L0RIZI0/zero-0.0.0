"use client"

import { VersionSwitcher } from "@/components/version-switcher"
import { Zero0ThemeToggle } from "./zero0-theme-toggle"

/**
 * Root `/` canvas — the stripped, "seemingly blank" slate for the next iteration
 * of Zero. Its visual language is deliberately the one from the `§3`/`§4` dev
 * inspectors: monospace, tiny muted `tabular-nums` type, hairline rules, and no
 * chrome (no cards, radii, shadows, or motion) — it should read as raw DATA.
 *
 * All styling here is scoped to this route: colors come from the shared design
 * TOKENS (so dark/light still flips globally), and the monospace family is a
 * page-local font variable (`--font-zero0-mono`, set by `app/page.tsx`), so
 * `layout.tsx`/`globals.css` stay untouched and `/1` + `/2` keep Geist.
 *
 * A single row of controls (version switcher + minimal theme toggle) is kept so
 * the frozen `/1` and `/2` builds remain one click away and night work stays
 * comfortable.
 */
export function Zero0Canvas() {
  return (
    <main
      className="relative flex min-h-screen flex-col bg-background text-foreground"
      style={{ fontFamily: "var(--font-zero0-mono), ui-monospace, monospace" }}
    >
      {/* Faint corner readout — an inspector-style key/value block, the only
          mark on an otherwise empty surface. */}
      <header className="p-4 text-[10px] leading-relaxed text-muted-foreground tabular-nums">
        <div className="flex gap-2">
          <span className="text-foreground">zero</span>
          <span aria-hidden>·</span>
          <span>root canvas</span>
        </div>
        <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-4">
          <dt className="uppercase tracking-widest">route</dt>
          <dd className="text-foreground">/</dd>
          <dt className="uppercase tracking-widest">version</dt>
          <dd className="text-foreground">0</dd>
          <dt className="uppercase tracking-widest">status</dt>
          <dd className="text-foreground">blank</dd>
        </dl>
      </header>

      {/* Intentionally empty body — the slate to grow the next iteration on. */}
      <div className="flex-1" aria-hidden />

      {/* Controls: hairline-topped footer, mono + muted, no chrome. */}
      <footer className="flex items-center gap-3 border-t border-border p-4 text-[10px] leading-none text-muted-foreground">
        <VersionSwitcher />
        <span className="text-border" aria-hidden>
          |
        </span>
        <Zero0ThemeToggle />
      </footer>
    </main>
  )
}
