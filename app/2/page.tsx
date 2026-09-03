import { ZeroShell } from "@/components/zero-002/zero-shell"

// Frozen snapshot of Zero as of the log-model release (v0.3.2) — the state with
// the entity lifecycle log, the § 5 audit chord, and uniform title color. This
// route renders an entirely independent, vendored copy of the app (components/
// zero-002 + lib/zero-002), so redesigning the live root `/` never affects `/2`.
export default function Page() {
  return <ZeroShell />
}
