# Zero Resource Host (M1)

The long-lived WebView2 process that will replace Electron's `WebContentsView` as Zero's contextual-browser
surface (Windows only). Unlike the throwaway `spike/`, this is **real repo code** — it gets bundled into
Zero's packaged app in M3.

## What it is

- **One** `CoreWebView2Environment` (shared user-data root), and **one `CoreWebView2Controller` per
  resource**, parented into a host window and floated at a rect. This is the native primitive M2 needs:
  in Electron mode the parent is Electron's window HWND and the rects come from the renderer's
  `NativeSurface` rect stream.
- **Per-resource profiles** (`CoreWebView2ControllerOptions.ProfileName`) so each resource's login
  persists independently — mirrors Zero's current per-resource persistent partitions.
- **Default context menu enabled** (v0.2.221) so web content has Edge's own right-click actions
  (Back/Forward/Reload/Save/Print/Copy/inspect). Zero never built a bespoke web-content menu, so the earlier
  `ContextMenuRequested` relay left right-click doing nothing — the relay + `contextMenu` event were removed.
- **Web content follows Zero's in-app light/dark toggle** (v0.2.222, made reliable + cross-engine in
  v0.2.225) — not the OS. The renderer relays the theme via a `setTheme` command
  (`window.zero.resource.setTheme` → `zero:resource:set-theme`). It drives BOTH resource engines:
  - **WebView2 host:** stored as `HostContext.PreferColorScheme`, applied to every controller (+ each new
    one at creation). `Profile.PreferredColorScheme` themes the scrollbars/menu, but on its own it does NOT
    reliably re-fire a live page's `prefers-color-scheme` media query — so `ApplyColorScheme` ALSO forces it
    via CDP `Emulation.setEmulatedMedia` (`prefers-color-scheme: dark|light`, `Auto` clears it), stored
    per-view (`_scheme`) and **re-asserted on every `NavigationCompleted`** (CDP overrides drop on cross-doc
    nav).
  - **Electron `WebContentsView` fallback:** the `zero:resource:set-theme` IPC handler sets
    `nativeTheme.themeSource`, which drives `prefers-color-scheme` for all Electron-rendered pages. Safe for
    Zero's own UI, which is class-based with `enableSystem={false}`, so it only affects resource webviews.
  - Caveat: this only flips sites that *implement* their own dark theme. Sites that pin a theme in their own
    settings (e.g. GitHub unless "Sync with system") won't move — use the **Force dark** menu item for those.
- **"Force dark" web-content menu item** (v0.2.223) — a checkable item appended to Edge's own right-click
  menu (via `Environment.CreateContextMenuItem` + `ContextMenuRequested`, additive — defaults untouched).
  Toggling it algorithmically darkens *any* site (even those with no dark theme) live per view, with no
  reload/env rebuild, via CDP `Emulation.setAutoDarkModeOverride` (`CallDevToolsProtocolMethodAsync`). Per-
  view state (`_forceDark`), off by default, re-asserted after navigations. Heuristic — may look off on some
  sites; it's opt-in per view precisely for that reason.
- **Popup OAuth** handled in-app: `NewWindowRequested` opens a `PopupWindow` hosting a controller in the
  same env+profile, so flows like Figma "Continue with Google" complete without bouncing to the system
  browser.

## Two run modes

### 1. Standalone demo (M1 sanity check) — run this now

```powershell
cd native\resource-host
dotnet run
```

Opens a window with a **tab bar** (akiflow / figma / gmail), an **address bar**, and back/forward/reload.
This drives the *same* `HostContext` code Electron will drive, just via in-process commands.

**M1 checklist — confirm:**
- [ ] All three tabs mount; switching tabs shows the right resource (others parked, not destroyed).
- [ ] Each resource keeps its own login (sign into Gmail, switch away and back — still signed in).
- [ ] Address bar + back / forward / reload work; the address bar tracks navigation.
- [ ] Right-click shows **Edge's own menu** (Back/Forward/Reload/Save/Print/Copy/inspect), matching Zero's theme.
- [ ] Resize keeps the active view filling the area below the tab bar.
- [ ] Close and reopen the app — logins persist.

### 2. IPC mode (what M2 will launch)

```powershell
dotnet run -- --ipc --parent-hwnd=<hwnd> --user-data=<path>
```

Reads newline-delimited JSON commands on **stdin**, emits newline-delimited JSON events on **stdout**.

**Commands:** `mount {id,url,profile,rect,visible}`, `setBounds {id,rect}`, `show/hide/park {id}`,
`close {id}`, `navigate {id,url}`, `back/forward/reload {id}`, `setZoom {id,zoom}`,
`setParent {parentHwnd}`, `reanchor {reason}`, `setTheme {mode}`, `shutdown`.

**Events:** `ready`, `mounted {id}`, `closed {id}`, `title {id,title}`, `url {id,url}`,
`navState {id,canGoBack,canGoForward}`, `favicon {id,url}`, `loading {id,loading,ok}`,
`download {id,url,path}`, `contextMenu {id,x,y,selectionText,linkUri,srcUri,kind}`,
`newWindow {id,url}`, `error {message}`.

## Notes

- Requires the .NET 8 SDK to build and the WebView2 Evergreen runtime to run (present on Win10/11).
- Build artifacts (`bin/`, `obj/`) and the local `profiles/` user-data folder are gitignored.
