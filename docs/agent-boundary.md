# Zero — Agent Boundary & Native Seam Contract

> **Purpose.** Zero is developed by two agents working in one repo. This document is the **single
> interface** between them. If a change stays inside one domain, that domain's agent owns it outright.
> If a change crosses the line drawn here, it is a **contract change** and must follow the rules in
> §4 before either side ships.
>
> Read this first before touching anything near the native ↔ web boundary.

---

## 1. The two domains

The agent boundary is placed at the **loosest, most stable** coupling in the system — the line between
the native desktop shell and the web renderer. It is deliberately NOT placed at the engine↔module or
data↔display seams, which are tight and high-churn and therefore live wholly inside one domain.

### Domain A — Native shell (owned here / v0)
Everything that is C#, CI, packaging, or a near-native host widget:
- `native/shell-host/**` — the WebView2 host (.NET 8 WinForms): window/chrome/frame, drag, resize,
  fullscreen, DPI, composition layers, in-process content hosting, OAuth popups.
- `scripts/build-shell.mjs`, `scripts/static-export.mjs`, `scripts/upload-shell-release.mjs`.
- `.github/workflows/release.yml`, Velopack auto-updater, the Blob `/updates-shell` feed.
- The **native-adjacent chrome widgets** that read host APIs and do NOT read entity rules:
  window controls, the update bubble/indicator, the battery indicator, the theme toggle's
  native-scheme handoff.

### Domain B — Web renderer + engine + modules (owned by the module agent / Grok)
Everything that renders *from* entity rules, plus the engine that produces them:
- The **entity-rules engine** (`lib/zero/**` — ontology, recurrence, sessions, data model, glyph
  behavior: what "ongoing" means, cancel/auto states, schedule projection, etc.).
- The **display modules** that consume it: dayline, entity-content / markdown projection, §0, §1,
  calendar, agenda, create field, resources panel — `components/zero0/**` and their libs.

> **The engine travels WITH its consumers.** The engine and the modules that render it are the SAME
> domain on purpose: their coupling is the tightest in the app (glyph spin depends on "ongoing",
> faded blocks depend on cancel/auto state — the rule and the pixel live in one component). Splitting
> the engine from its display would re-import the exact seam this boundary exists to remove. Do not.

### Explicitly frozen — nobody edits
`lib/zero-000/**`, `lib/zero-002/**`, `components/zero-000/**`, `components/zero-002/**` and the other
version snapshots. They are historical and must keep building unchanged. This is also why the legacy
`BUILD_TARGET=electron` / `NEXT_PUBLIC_ZERO_ELECTRON` token name is KEPT despite Electron being gone —
renaming it would ripple into these snapshots.

---

## 2. The ONE inter-agent interface: `window.zero`

The renderer and the shell communicate through exactly one surface: the `window.zero` bridge. Its
**canonical declaration is [`types/zero-desktop.d.ts`](../types/zero-desktop.d.ts)** — that file is the
contract, this section is the explanation.

- On the **web** (v0 preview, browser dev, deployed site), `window.zero` is `undefined`.
- On the **desktop shell**, it is injected at document-created time by `native/shell-host/ZeroShim.cs`
  (which serves `zero-shim.js`), reproducing the contract over WebView2's `chrome.webview` channel.

**Golden rule for Domain B:** every use MUST feature-detect. The renderer ships unchanged whether or
not the shell is present.

```ts
if (window.zero?.isDesktop) {
  // native path
} else {
  // web fallback (must always exist)
}
```

The surface today (see the `.d.ts` for exact signatures):
`isDesktop`, `platform`, `locale`, `appVersion`, `debugLog`/`debugLogPath`, `openExternal`,
`webTitle`, `system.getIdleSeconds`, `resource.*` (mount/setBounds/park/close/prewarm/releaseFocus/
setTheme + onOutput/onStatus/onNavigated/onContextMenu/onActivity), `menu.*` (stub until M3),
`updates.*`, `win.*` (minimize/maximize/fullscreen + change events).

### The other two seam mechanisms (small but real)
1. **Drag markers.** The renderer marks its title bar with `data-zero-drag="drag"` and opt-out islands
   (window controls) with `data-zero-drag="no-drag"`. The shim resolves the nearest marked ancestor to
   run a native caption drag (WebView2 ignores `-webkit-app-region`). These two attributes are part of
   the contract — Domain B must keep them on the title bar / controls.
2. **Origin & store.** The shell serves the static bundle from a stable origin (`https://zero.local`,
   migrated from `app://local`). Local data/store lives against that origin. Domain B must not assume a
   Node server or server-only API routes at runtime in the packaged app — `app/api/*` is stripped from
   the static export (see `scripts/static-export.mjs`); the desktop replacements are `window.zero`
   methods (e.g. `webTitle`). Feature-detect and fall back on web.

---

## 3. Dogfood cadence — you do NOT tag per iteration

Zero is a Next.js web app, so Domain B's work renders in the **browser preview** with instant feedback.

| Change is… | Verify in… | Native tag needed? |
|---|---|---|
| Pure module / engine / rendering (dayline, entity-content, §0/§1, glyph rules, recurrence) | Browser preview (v0 / local dev) | **No** — per checkpoint only |
| A native seam (composition content positioning, OAuth popup, battery, update bubble, drag/resize, DPI) | The Surface, after a native tag | **Yes** |

- **Per Grok iteration:** verify in the browser. No CI, no tag.
- **At a checkpoint (a solid batch):** one native release tag here → the Surface auto-updates (~3 min
  CI, silent background swap). Tag per *checkpoint*, not per *change*.

The trap: a change can *look* like pure Domain B but touch a seam (the blank-OAuth-popup bug looked
like a renderer issue but was pure shell). When a browser-verified module change misbehaves only on the
Surface, suspect the seam and route it to Domain A.

---

## 4. Rules for changing the contract

A change is a **contract change** if it edits `types/zero-desktop.d.ts`, the `data-zero-drag` markers,
the origin/store assumptions, or the shape of any `window.zero` payload. For those:

1. **Both sides move together.** A new/changed `window.zero` method needs the renderer call site
   (Domain B) *and* the shim + C# host handler (Domain A). Neither ships alone.
2. **Additive first.** Prefer adding a new method/field over changing an existing one. The renderer
   must tolerate an older shell that lacks a new method (feature-detect returns undefined → web
   fallback). The shell must tolerate an older renderer that never calls a new method.
3. **The `.d.ts` is the source of truth.** Update it in the same change; describe the payload and the
   web-fallback behavior in a doc comment, as the existing entries do.
4. **Version skew is normal.** An installed Surface build runs an older bundled renderer than the repo
   HEAD until its next auto-update. Never assume renderer and shell are the same version at runtime.
5. **When in doubt, it's a contract change.** Flag it across the boundary rather than assume.

---

## 5. Quick ownership lookup

| If you're editing… | Domain | Agent |
|---|---|---|
| `native/shell-host/**`, `release.yml`, `scripts/*shell*`, `static-export.mjs` | A | v0 |
| Window controls, update indicator, battery indicator, native theme handoff | A | v0 |
| `lib/zero/**` engine (ontology, recurrence, sessions, data, glyph rules) | B | Grok |
| dayline, entity-content, §0/§1, calendar, agenda, create field, resources panel | B | Grok |
| `types/zero-desktop.d.ts`, `data-zero-drag`, origin/store | **Contract** | both (§4) |
| `lib/zero-000/**`, `lib/zero-002/**`, `components/zero-00x/**` | Frozen | nobody |

---

_Keep this current: when a `window.zero` method is added or a milestone lands, update §2 and the
`.d.ts` together. Detailed native history/rationale lives in the v0 memory topic files
(`zero-webview2-migration.md` et al.); this doc is the shared, in-repo interface both agents rely on._
