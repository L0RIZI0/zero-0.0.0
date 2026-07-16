// Single source of truth for the Zero build version shown in the UI (the zero
// header identity line) and useful when reasoning about which Surface build a user
// is on. Bumped by hand alongside the release git tag (package.json stays at its
// scaffold version), so keep this in step with the tag you push (e.g. `v0.3.9`).
export const ZERO_VERSION = "v0.4.6"
