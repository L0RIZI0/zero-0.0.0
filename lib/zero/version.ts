// Single source of truth for the Zero build version shown in the UI (the zero
// header identity line) and useful when reasoning about which Surface build a user
// is on. Bumped by hand alongside the release git tag (package.json stays at its
// scaffold version), so keep this in step with the tag you push.
//
// VERSIONING SCHEME (since Jul 2026): a FLAT running counter under a 0.2 minor —
// v0.2.NNN, incremented by ONE each release (v0.2.146, v0.2.147, …). The whole v0.1–v0.6
// lineage (145 tags) was rewritten into v0.2.001..v0.2.145 (same commits, messages preserved)
// on this date, which FREED the entire v0.3+ range — so nothing collides anymore.
//
// The one rule: don't AUTO-bump the minor as a side effect of routine work (that quiet
// inflation is what pushed us toward v1 before). A DELIBERATE milestone bump is welcome —
// e.g. Loris plans v0.3.0 once dayline ticks + entity-state display land. When that happens,
// continue flat from there (v0.3.1, v0.3.2, …).
export const ZERO_VERSION = "v0.2.154"
