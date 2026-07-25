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
- **Default context menu disabled** + `ContextMenuRequested` relayed as a `contextMenu` event, so M2 can
  show Zero's own single native menu (no dead `edge://` items).
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
- [ ] Right-click shows **nothing** (default menu suppressed — that's expected; Zero's menu arrives in M2).
- [ ] Resize keeps the active view filling the area below the tab bar.
- [ ] Close and reopen the app — logins persist.

### 2. IPC mode (what M2 will launch)

```powershell
dotnet run -- --ipc --parent-hwnd=<hwnd> --user-data=<path>
```

Reads newline-delimited JSON commands on **stdin**, emits newline-delimited JSON events on **stdout**.

**Commands:** `mount {id,url,profile,rect,visible}`, `setBounds {id,rect}`, `show/hide/park {id}`,
`close {id}`, `navigate {id,url}`, `back/forward/reload {id}`, `setZoom {id,zoom}`,
`setParent {parentHwnd}`, `shutdown`.

**Events:** `ready`, `mounted {id}`, `closed {id}`, `title {id,title}`, `url {id,url}`,
`navState {id,canGoBack,canGoForward}`, `favicon {id,url}`, `loading {id,loading,ok}`,
`download {id,url,path}`, `contextMenu {id,x,y,selectionText,linkUri,srcUri,kind}`,
`newWindow {id,url}`, `error {message}`.

## Notes

- Requires the .NET 8 SDK to build and the WebView2 Evergreen runtime to run (present on Win10/11).
- Build artifacts (`bin/`, `obj/`) and the local `profiles/` user-data folder are gitignored.
