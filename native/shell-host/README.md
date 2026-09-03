# Zero shell-host (WebView2)

The eventual replacement for the Electron shell — a single native (.NET 8 / WinForms) process that
renders Zero's own UI in **WebView2 (Edge)**. This is **Milestone 1** of the "delete Electron,
WebView2 everywhere" plan (`v0_plans/efficient-approach.md`): it grows **beside** Electron until M4
deletes `electron/`.

- **M1 (this):** frameless shell window renders Zero's static export; the cheap half of the
  `window.zero` contract (`win.*`, `openExternal`, `locale`, `appVersion`, `system.getIdleSeconds`,
  `webTitle`, `debugLog`).
- **M2:** browsed content moves in-process as composition visuals (the seam dissolves).
- **M3:** menu overlay, multi-window, sleep/DPI reanchor, theme sync.
- **M4:** Velopack updates + delete Electron.

## Prerequisites

- **.NET 8 SDK** (`dotnet --version` → 8.x).
- **WebView2 Evergreen Runtime** — already present on Win11 and any machine with modern Edge. If
  missing: https://developer.microsoft.com/microsoft-edge/webview2/.

## Build & run (dev)

From the repo root:

```powershell
# 1) Produce the static export the shell serves (out/index.html …).
#    NOTE: plain `pnpm build` does NOT emit out/ — the static export only happens under
#    BUILD_TARGET=electron, which also stashes the server-only app/api routes. Use this script:
pnpm shell:export     # → out/

# 2) Run the shell-host. It auto-finds ../../out by walking up from bin/.
cd native/shell-host
dotnet run
```

The host serves `out/` from the virtual origin **`https://zero.local/`** (a real https origin, so
localStorage/IndexedDB are stable). If it can't find the export it shows a short "build first" page
instead of a blank window. To point at an export elsewhere:

```powershell
$env:ZERO_OUT_DIR = "C:\path\to\out"; dotnet run
```

> **Fresh data store (expected).** This origin (`https://zero.local`) is different from Electron's
> `app://local`, so your existing Electron entity data does **not** carry over. The native build
> starts empty by design (decided in the plan). Both apps can run side by side with independent data.

## What to verify for M1

1. **Launches** to Zero's UI, interactive, no white flash (dark `#0b0b0c` background).
2. **Window drag** — click-drag the top clock band moves the window; Aero snap works.
3. **Double-click** the clock band toggles maximize (and maximize respects the taskbar).
4. **Window controls** (top-right) — minimize / maximize-restore / close all work; the maximize icon
   flips to "restore" when maximized.
5. **Fullscreen** — the fullscreen button, **F11**, and **Escape** toggle whole-screen (taskbar
   hidden); the button icon reflects state.
6. **Resize** — dragging any window edge/corner resizes; min size ~880×600 is enforced.
7. **Version** — the header shows the app version (`window.zero.appVersion`).
8. **Locale** — dates/times format to your OS region (e.g. Swiss 24h), not en-US.
9. **Idle** — ongoing-session liveness keeps working (driven by `system.getIdleSeconds`).

Report anything off and we iterate before M2.

## Files

- `Program.cs` — entry point + high-DPI mode.
- `MainForm.cs` — frameless window, WebView2, virtual-host serving, `window.zero` dispatch, native
  move/resize/fullscreen, `webTitle`, idle, locale/version.
- `ZeroShim.cs` + `zero-shim.js` — the injected `window.zero` bridge (baked constants + message
  transport + drag detection). Edit `zero-shim.js` and rerun; no C# rebuild needed.
- `NativeMethods.cs` — Win32 interop (drag, frameless resize, maximize clamp, idle).
- `PageTitle.cs` — HTML `<title>`/`og:title` extraction for `webTitle`.
- `app.manifest` — Per-Monitor-V2 DPI awareness.

## Notes

- The renderer is **unchanged** except two additive `data-zero-drag` markers (title bar =
  `"drag"`, window controls = `"no-drag"`) — WebView2 doesn't honor `-webkit-app-region`, so the
  shell reads these instead. Electron keeps using the existing `WebkitAppRegion` styles.
- Dev keeps DevTools (F12) on and Chromium accelerator keys off, so shell UI behaves like the app.
