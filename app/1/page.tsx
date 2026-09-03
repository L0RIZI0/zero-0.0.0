import { ZeroShell } from "@/components/zero-000/zero-shell"

// Frozen snapshot of Zero as of commit d241f5c — the state before any timeline
// "ribbon" code was introduced. This route renders an entirely independent,
// vendored copy of the app (components/zero-000 + lib/zero-000), so editing the
// live `/` version never affects `/1`.
export default function Page() {
  return <ZeroShell />
}
