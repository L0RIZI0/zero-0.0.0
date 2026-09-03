// Resolve the locale to pass to `toLocaleString` / `toLocaleDateString` /
// `toLocaleTimeString` so date + time formatting matches the DEVICE's region and
// 24h/12h settings — instead of V8's default.
//
// WHY THIS EXISTS: calling `date.toLocaleString()` with NO locale uses the JS
// engine's default. In a real browser that default follows the OS (correct), but
// the v0 web PREVIEW runs en-US, and — more importantly — Electron's bundled V8
// hardcodes the default to en-US regardless of the OS, so the desktop app printed
// American AM/PM + MM/DD/YYYY even on a European / 24h device. To fix that we pass
// an EXPLICIT locale here:
//   • Desktop (Electron): the OS format locale resolved in the main process
//     (`window.zero.locale`, e.g. "en-FR" = English language, France region → EU
//     date order + 24h). See electron/main.cjs `osFormatLocale`.
//   • Web: the browser's preferred language (`navigator.languages[0]`), which in a
//     real browser is the user's OS locale. (In the en-US v0 preview this is en-US,
//     which is expected — the preview browser genuinely is en-US.)
//   • SSR / static export: undefined, so the build-time default is used. Every
//     caller is already behind a `mounted` gate, so this only runs client-side.
export function formatLocale(): string | undefined {
  if (typeof window === "undefined") return undefined
  const desktop = window.zero?.locale
  if (desktop) return desktop
  return navigator.languages?.[0] ?? navigator.language ?? undefined
}
