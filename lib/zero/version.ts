// The WEB-BUILD FALLBACK version string shown in the UI (the zero header identity line).
// As of v0.2.197 the DESKTOP app no longer relies on this: the header prefers the REAL
// running version from the Electron bridge (`window.zero.appVersion` = app.getVersion(),
// which the CI stamps from the release tag), so the desktop build is now self-correcting
// and can't drift. This constant only shows in the browser build (no bridge) — still worth
// bumping alongside the tag so the web preview reads right, but a stale value here no longer
// makes an APPLIED desktop update look un-applied (the bug that hid 195 + 196).
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
export const ZERO_VERSION = "v0.2.346"
