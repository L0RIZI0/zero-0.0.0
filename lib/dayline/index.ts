/**
 * Zero-facing dayline view.
 *
 * Drop this folder in place of Zero's placeholder `lib/dayline/`.
 * `mountDayline({ surface, data, theme, callbacks, options })` matches the contract.
 * Point `./contract.ts` at `@zero/dayline-contract` if the sibling package isn't copied.
 */
export { mountDayline, DaylineEngine } from "./mount";
export type { DaylineSnapshot } from "./types";
