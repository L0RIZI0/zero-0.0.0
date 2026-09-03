# Zero WebView2 spike (Milestone 0 — throwaway)

A tiny standalone Windows WebView2 host to confirm the **ergonomics** before we touch Zero.
It is **not** part of Zero's build or release pipeline — it's a one-time probe you run, judge, and discard.

## What it proves
1. **Text selection** — click-drag to highlight text on a page.
2. **Right-click context menu** — the browser menu (Copy / Paste / Back / …) appears.
3. **Drag** — basic drag works.
4. **Persistent login** — your Google login **survives an app restart** (stored in a local profile folder).
5. **Popup OAuth** — Figma's "Continue with Google" popup completes **inside the app** (no fallback to your system browser).

## One-time setup: install the .NET 8 SDK
This is a single, free installer — **not** a C++ toolchain.

1. Go to <https://dotnet.microsoft.com/download/dotnet/8.0>
2. Download **SDK 8.0 → Windows → x64 Installer** and run it.
3. Open a **fresh** PowerShell and verify:
   ```powershell
   dotnet --version
   ```
   You should see `8.0.xxx`.

> WebView2 runtime itself ships with Windows 11 and modern Windows 10, so you almost certainly already have it.
> If the app complains it's missing, grab the "Evergreen Standalone Installer" from
> <https://developer.microsoft.com/microsoft-edge/webview2/> and run it once.

## Run it
```powershell
cd spike\webview2-host
dotnet run
```
First run restores the WebView2 NuGet package and compiles (a few seconds); later runs are instant.

## Test checklist (the gate)
Do all of these, on **both** akiflow and figma:

- [ ] **Select text**: click-drag over some page text — it highlights.
- [ ] **Right-click**: a context menu appears with Copy / Back / Reload etc.
- [ ] **akiflow → Sign in with Google**: completes to 2-Step Verification / logged in.
- [ ] **figma → Continue with Google**: the Google popup opens **inside this app** (a small child window),
      you pick your account, and it returns to Figma logged in — **without** opening your system browser.
- [ ] **Restart test**: close the app completely, run `dotnet run` again → you're **still logged in**
      (the `zero-spike-profile` folder next to the build output persisted the session).

## Buttons
- `akiflow` / `figma` / `gmail` — jump to those sites.
- Address bar — type a URL + Enter (or `Go`).

## Result → next step
- **All boxes check** → thumbs-up; we proceed to **M1** (harden this into Zero's long-lived resource host).
- **Something feels wrong** (menu misplaced, popup won't return, session didn't persist) → tell me exactly
  what, with a screenshot; we fix it here in the cheap throwaway before it ever touches Zero.

## Reset the profile (optional)
To test a cold login again, delete the profile folder:
```powershell
Remove-Item -Recurse -Force bin\Debug\net8.0-windows\zero-spike-profile
```
