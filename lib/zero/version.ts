// Single source of truth for the Zero build version shown in the UI (the zero
// header identity line) and useful when reasoning about which Surface build a user
// is on. Bumped by hand alongside the release git tag (package.json stays at its
// scaffold version), so keep this in step with the tag you push.
//
// VERSIONING SCHEME (since Jul 2026): a FLAT running counter under a frozen 0.2 minor —
// v0.2.NNN, incremented by ONE each release (v0.2.146, v0.2.147, …). Do NOT bump the
// minor (no 0.3.0 / 0.4.0): that's what previously inflated us toward v1 and would now
// collide with the compressed tag history. The whole v0.1–v0.6 lineage (145 tags) was
// rewritten into v0.2.001..v0.2.145 (same commits, messages preserved) on this date.
export const ZERO_VERSION = "v0.2.146"
