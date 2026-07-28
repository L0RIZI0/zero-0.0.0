// Zero — Electron main process (CommonJS so it runs directly, no build step).
//
// STEP 1 of the desktop plan: wrap the EXISTING Zero web app in a native window.
//   • dev  → loads the running `next dev` server at http://localhost:3000
//   • prod → loads the static export from `out/` via a custom `app://` protocol
//
// The native resource host (WebContentsView replacing the <iframe> in
// ResourceCanvas) is STEP 2 and is intentionally not here yet — see the IPC stub
// in preload.cjs and the comments at the bottom of this file for where it slots in.

  const { app, BrowserWindow, WebContentsView, protocol, net, shell, session, ipcMain, Menu, screen, powerMonitor, nativeTheme } = require("electron")
const path = require("node:path")
const fs = require("node:fs")
const { pathToFileURL } = require("node:url")
const { autoUpdater } = require("electron-updater")
const { hideWindowsBorder } = require("./win-border.cjs")
const { ResourceHostBridge } = require("./resource-host-bridge.cjs")

const isDev = !app.isPackaged
const DEV_URL = process.env.ELECTRON_RENDERER_URL || "http://localhost:3000"

// ── Single instance, multiple windows ────────────────────────────────────────
// Launching Zero again must NOT start a second PROCESS. Two processes share one
// userData dir, but Chromium's localStorage (where Zero persists everything) is a
// single-writer LevelDB: the FIRST process holds the lock and the SECOND can't open
// it, so it silently loads an EMPTY store — that's the "second window has no data"
// bug, and a write from it could clobber the real data. Instead we keep ONE process
// and open additional WINDOWS in it. Same-process windows share the same session →
// the SAME localStorage on disk (no lock fight) AND Chromium dispatches the
// cross-window `storage` event between them, which is exactly what the renderer's
// Tier-2 sync hook listens to — so two Zero windows stay live in sync.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // We're the second launch; the primary will get a `second-instance` event and
  // open a window for us. Quit this redundant process before it touches storage.
  app.quit()
}

// ── OS date/time format locale ───────────────────────────────────────────────
// Electron's bundled V8 defaults the ICU/Intl locale to en-US regardless of the
// OS, so `toLocaleString()` with no explicit locale prints American AM/PM +
// MM/DD/YYYY even on a device set to a European region / 24h clock. We can't
// change V8's default, so instead we resolve the REAL OS format locale here (main
// is the only place with `app` locale APIs) and hand it to the renderer, which
// passes it explicitly to every toLocale* call.
//
// Region matters more than UI language for date/time FORMAT: a device whose
// display language is English (US) but whose REGION is European should format
// dates the European way. So we splice the OS country code (getLocaleCountryCode,
// e.g. "FR") onto the primary language subtag → e.g. "en-FR", which Intl formats
// with European date order + 24h. Best-effort; falls back to the plain locale.
function osFormatLocale() {
  try {
    const base = app.getLocale() || app.getPreferredSystemLanguages?.()?.[0] || "en"
    const lang = String(base).split("-")[0]
    const country =
      typeof app.getLocaleCountryCode === "function" ? app.getLocaleCountryCode() : ""
    if (country && /^[A-Za-z]{2}$/.test(country)) return `${lang}-${country.toUpperCase()}`
    return base || null
  } catch {
    return null
  }
}

// ── Hardware acceleration ────────────────────────────────────────────────────
// We never call app.disableHardwareAcceleration(), so in theory the GPU is on. BUT
// Electron's bundled Chromium ships a conservative GPU BLOCKLIST that, on a lot of
// real-world drivers (especially Windows/Linux, VMs, and some integrated GPUs),
// silently DISABLES GPU compositing and falls back to SOFTWARE rendering. That's the
// classic "the native app animates worse than the same page in Chrome" symptom —
// the user's real browser has that GPU allow-listed while Electron does not, so our
// compositor-bound timeline transforms end up on the CPU here.
//
// Forcing these on pushes compositing + raster back onto the GPU. Must be set BEFORE
// app `ready`. `chrome://gpu` isn't reachable inside the app window, so instead we
// print the GPU feature status straight into the RENDERER devtools console after load
// (see `logGpuStatus` below) — look for the "[v0] GPU feature status" line.
app.commandLine.appendSwitch("ignore-gpu-blocklist")
app.commandLine.appendSwitch("enable-gpu-rasterization")
app.commandLine.appendSwitch("enable-zero-copy")
// FINGERPRINT PARITY: Blink otherwise sets `navigator.webdriver = true` and tags the
// engine as automation-controlled, a tell Google's "secure browser" check reads to block
// embedded sign-in. Disabling it is part of looking like a plain Chrome (see
// buildFingerprintPatch + applyFingerprintPatch, which finish the JS-side disguise).
app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled")

/**
 * Print Chromium's GPU feature status into BOTH the main-process terminal and the
 * renderer's devtools console (the one the user can actually see — `chrome://gpu` is
 * blocked in-app). The key line is `gpu_compositing`: "enabled" means the compositor
 * is on the GPU; "software"/"disabled" means Chromium fell back to the CPU (the lag).
 */
function logGpuStatus(win) {
  try {
    const status = app.getGPUFeatureStatus() // sync, available after `ready`
    console.log("[v0] GPU feature status:", status)
    if (win && !win.isDestroyed()) {
      win.webContents
        .executeJavaScript(
          `console.log("%c[v0] GPU feature status","color:#0a0",${JSON.stringify(status)});` +
            `console.log("[v0] gpu_compositing =", ${JSON.stringify(status.gpu_compositing || "unknown")});`,
        )
        .catch(() => {})
    }
  } catch (err) {
    console.log("[v0] getGPUFeatureStatus failed:", err?.message || err)
  }
}

// ── Background auto-update (Surface dogfooding, tag-triggered releases) ───────
// The app stays a self-contained bundled build (data lives under the app://local
// origin and is NEVER touched by updates). electron-updater pulls a small delta from
// a public "generic" feed (Vercel Blob) that CI populates on every `v*` git tag:
//   • checks once on launch, downloads in the BACKGROUND
//   • installs on the NEXT quit/restart (autoInstallOnAppQuit) — no forced restart
// The feed URL is baked into app-update.yml at build time from the electron-builder
// `publish` config (driven by ZERO_UPDATE_FEED_URL in CI). If no feed is configured
// (e.g. a local `electron:build`), the check simply fails and is swallowed.
//
// Update lifecycle is surfaced to the renderer as `zero:update:*` IPC events so a
// future in-app "Update ready — restart to apply" affordance can hook in; for now
// they're also logged. Nothing here reads or writes user data.
function setupAutoUpdate() {
  // Only meaningful for a packaged app: app-update.yml only exists in the build, and
  // an unpackaged/dev run has no installer to replace.
  if (!app.isPackaged) return

  autoUpdater.logger = console
  // MANUAL download (v0.4.7): do NOT auto-pull the delta. The old auto-download had a
  // trap — if a build downloaded but you never restarted, the pill was PINNED to that
  // staged version ("restart for v0.4.2") and polling STOPPED, so a newer v0.4.5 sitting
  // in the feed was never picked up and you were effectively forced to install the stale
  // one to move on. Now the pill shows "download <latest>" and YOU trigger the download,
  // so a stalled build is never fetched behind your back.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true // an update you DID download still applies on quit

  const notify = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload)
    }
  }

  // Track the latest version the feed is offering and what's actually been downloaded, so
  // repeated checks can re-surface a NEWER-than-downloaded build as a fresh "download".
  let downloadingVersion = null
  let downloadedVersion = null

  autoUpdater.on("checking-for-update", () => console.log("[v0] update: checking"))
  autoUpdater.on("update-available", (info) => {
    const version = info?.version
    console.log("[v0] update: available", version)
    // If the newest available build is the one we've already downloaded, keep the
    // "restart" state; otherwise offer it for download (covers a newer build superseding
    // a previously-downloaded one). Never interrupt an in-flight download.
    if (version && version === downloadedVersion) return
    if (downloadingVersion) return
    notify("zero:update:available", { version })
  })
  autoUpdater.on("update-not-available", () => console.log("[v0] update: up to date"))
  autoUpdater.on("download-progress", (p) => {
    notify("zero:update:progress", { percent: Math.round(p?.percent || 0) })
  })
  autoUpdater.on("update-downloaded", (info) => {
    console.log("[v0] update: downloaded", info?.version, "— restart to apply")
    // Do NOT quitAndInstall() here: restarting to apply is fine and we never want to
    // interrupt a dogfooding session. It installs on the next quit or on explicit restart.
    downloadedVersion = info?.version ?? null
    downloadingVersion = null
    notify("zero:update:downloaded", { version: info?.version })
  })
  autoUpdater.on("error", (err) => {
    // A missing/unreachable feed (offline, feed not yet provisioned) must never crash
    // or nag — auto-update is best-effort. Just log it, and clear any download-in-flight
    // flag so a failed download can be retried.
    downloadingVersion = null
    console.log("[v0] update: error", err?.message || err)
    notify("zero:update:error", { message: err?.message || String(err) })
  })

  // Triggered by the in-app "download <version>" pill. Kicks off the actual delta
  // download; progress + completion flow back via the events above. Guarded so a
  // double-click doesn't start two downloads.
  ipcMain.on("zero:update:download", () => {
    if (!app.isPackaged || downloadingVersion) return
    downloadingVersion = "pending"
    console.log("[v0] update: download requested")
    // RE-CHECK the feed FIRST, then download. The pill's version comes from whichever
    // `update-available` last fired, which can be STALE: our release pipeline prunes every
    // version except the newest from the feed to stay under the Blob quota, so a build
    // published after the last check has already DELETED the older installer the cached
    // updateInfo points at. Downloading that cached target 404s instantly ("download vX" →
    // flashes "downloading…" → reverts) — the bug Loris hit. `checkForUpdates()` refreshes
    // updateInfo to the CURRENT feed entry (which always exists), so the following
    // `downloadUpdate()` fetches a live artifact. The re-fired `update-available` is
    // harmless here — its handler bails while `downloadingVersion` is set — and the correct
    // version is reported on `update-downloaded`.
    autoUpdater
      .checkForUpdates()
      .then(() => autoUpdater.downloadUpdate())
      .catch((err) => {
        downloadingVersion = null
        console.log("[v0] update: download failed", err?.message || err)
        notify("zero:update:error", { message: err?.message || String(err) })
      })
  })

  // Single reusable checker. Guarded so overlapping triggers (interval + focus) don't
  // stack, and a no-op once a build is already staged for the next quit.
  let checking = false
  let lastCheck = 0
  const runUpdateCheck = (reason) => {
    // Keep checking even AFTER a build is downloaded — that's how a newer build (published
    // while you sat on a staged one) gets discovered and re-offered. With autoDownload off
    // a check just re-fires `update-available`; it won't fetch anything on its own.
    if (checking) return
    checking = true
    lastCheck = Date.now()
    console.log(`[v0] update: check (${reason})`)
    autoUpdater
      .checkForUpdates()
      .catch((err) => console.log("[v0] update: check failed", err?.message || err))
      .finally(() => {
        checking = false
      })
  }

  // The app used to check only ONCE ~4s after launch, so a long-running dogfooding
  // session never noticed builds published after it started — you had to fully quit
  // and relaunch. Now we ALSO re-check on a timer and whenever the window regains
  // focus (throttled), so a fresh build gets picked up within the session.
  setTimeout(() => runUpdateCheck("startup"), 4000)

  const CHECK_INTERVAL_MS = 30 * 60 * 1000 // every 30 min
  const checkTimer = setInterval(() => runUpdateCheck("interval"), CHECK_INTERVAL_MS)

  const FOCUS_THROTTLE_MS = 10 * 60 * 1000 // at most one focus-triggered check / 10 min
  app.on("browser-window-focus", () => {
    if (Date.now() - lastCheck >= FOCUS_THROTTLE_MS) runUpdateCheck("focus")
  })

  app.on("before-quit", () => clearInterval(checkTimer))
}

// Directory of the Next.js static export (`next build` with output:'export').
const OUT_DIR = path.join(__dirname, "..", "out")

/**
 * Serve the static export for the privileged `app://local/<path>` scheme.
 * `app://local/<path>` → `<OUT_DIR>/<path>`, with candidate resolution for
 * extensionless routes and an index.html SPA fallback so client-side routing
 * resolves. Shared by the DEFAULT session (main window) AND every resource
 * partition session — otherwise a partition with no `app:` handler treats an
 * internal URL like `app://local/zero-laws` as an unknown external protocol and
 * hands it to the OS shell ("Get an app to open this 'app' link").
 */
async function serveAppProtocol(request) {
  const { pathname } = new URL(request.url)
  let rel = decodeURIComponent(pathname).replace(/^\/+/, "")
  if (rel === "" || rel.endsWith("/")) rel += "index.html"

  // Candidate files to try in order. An extensionless route like "zero-laws"
  // (an internal Zero page opened as a resource) is emitted by the Next static
  // export — with trailingSlash:true — as "zero-laws/index.html"; we also try
  // "zero-laws.html" so either export style resolves without a 404-to-shell.
  const candidates = [rel]
  if (!path.extname(rel)) candidates.push(path.join(rel, "index.html"), `${rel}.html`)

  for (const cand of candidates) {
    const filePath = path.join(OUT_DIR, cand)
    // Guard against path traversal escaping the export dir.
    if (!filePath.startsWith(OUT_DIR)) continue
    try {
      const res = await net.fetch(pathToFileURL(filePath).toString())
      if (res.ok) return res
    } catch {
      /* missing file — try the next candidate */
    }
  }

  // SPA fallback so client-side routing still resolves.
  return net.fetch(pathToFileURL(path.join(OUT_DIR, "index.html")).toString())
}

/** @type {BrowserWindow | null} */
let mainWindow = null

// Register the privileged `app://` scheme BEFORE app is ready. In production the
// renderer is served from app://local/… so that Next's absolute asset paths
// (/_next/…) resolve correctly — file:// would break them.
if (!isDev) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

// Keep the WebView2 host's DIP→px scale in sync with the display the window is currently on. The scale is
// captured once at host start(); if the window is later dragged to a monitor with a different DPI, the web
// rect is converted with the stale factor and ends up mis-sized + off-screen (until reopen). Recompute from
// the window's nearest display and, if it changed, re-push all view bounds. Cheap + idempotent.
function syncHostScaleToDisplay(reason) {
  try {
    if (!(useWebView2() && hostBridge && hostBridge.ready && mainWindow && !mainWindow.isDestroyed())) return
    const disp = screen.getDisplayNearestPoint(mainWindow.getBounds())
    const changed = hostBridge.refreshScaleAndBounds(disp.scaleFactor)
    if (changed) console.log(`[v0] resource-host scale → ${disp.scaleFactor} (${reason})`)
  } catch (err) {
    console.log(`[v0] scale sync failed (${reason}): ${err && err.message}`)
  }
}

function createWindow() {
  // Bind every per-window handler to THIS window via a local `win`, not the shared
  // `mainWindow` global — otherwise, once a second window is opened, the global is
  // reassigned and the first window's handlers would fire against the wrong window.
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 880,
    minHeight: 600,
    // Zero draws its OWN chrome (timeline + in-app window controls), so there's no
    // native title bar or menu. On macOS we keep the OS traffic-lights (users
    // expect them top-left) via hiddenInset; on Windows/Linux we go fully
    // frameless and render custom min/max/close in the header.
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : { frame: false }),
    // Zero "z" mark for the live window / taskbar / dock (bundled via files:
    // electron/**). macOS ignores this at runtime and uses the packaged .icns
    // instead, so it's mainly for Windows/Linux; harmless on mac.
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#0b0b0c",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // `mainWindow` tracks the most-recently-opened window; it's the target for
  // auto-update notifications and the native resource host (both single-window
  // features). All windows share one session, so entity data + Tier-2 sync work
  // across every window regardless of which one this points at.
  mainWindow = win

  // Report maximize/unmaximize so the in-app control can swap its restore/maximize
  // icon to match the real window state.
  const sendMaxState = () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send("zero:win:maximized", win.isMaximized())
    }
  }
  win.on("maximize", sendMaxState)
  win.on("unmaximize", sendMaxState)

  // Re-sync the resource-host DPI scale when this window moves/resizes — dragging to a monitor with a
  // different scale factor fires `move` (not `display-metrics-changed`), so this is the trigger that catches
  // the cross-monitor case. Debounced so a drag doesn't spam the host; only acts for the active host window.
  let dpiSyncTimer = null
  const scheduleDpiSync = () => {
    if (dpiSyncTimer) clearTimeout(dpiSyncTimer)
    dpiSyncTimer = setTimeout(() => {
      dpiSyncTimer = null
      if (win === mainWindow) syncHostScaleToDisplay("window-move")
    }, 150)
  }
  win.on("move", scheduleDpiSync)
  win.on("resize", scheduleDpiSync)

  // Avoid a white flash: reveal only once the first paint is ready. At the same time
  // strip the Windows 11 DWM border (no-op elsewhere) so our frameless near-black
  // canvas isn't framed by the OS accent hairline. We apply it BEFORE show and AGAIN
  // right after (some Win11 builds paint the default border on first show, which would
  // otherwise linger until the next attribute change), and surface the result into the
  // renderer console so an on-device run can confirm whether the FFI actually engaged.
  const applyBorder = (phase) => {
    if (!win || win.isDestroyed()) return
    const applied = hideWindowsBorder(win)
    win.webContents
      .executeJavaScript(
        `console.log("[v0] win-border(${phase}):", ${JSON.stringify({
          platform: process.platform,
          applied: !!applied,
        })})`,
      )
      .catch(() => {})
  }
  win.once("ready-to-show", () => {
    applyBorder("ready-to-show")
    win.show()
    // One more pass on the next tick, after the window is actually on screen.
    setTimeout(() => applyBorder("post-show"), 0)
  })

  // Once the app's DOM is up, report the GPU status into its devtools console so the
  // user can confirm whether the acceleration flags above actually engaged.
  win.webContents.once("did-finish-load", () => logGpuStatus(win))

  if (isDev) {
    win.loadURL(DEV_URL)
    // DevTools is now OPT-IN (set ZERO_DEVTOOLS=1), NOT auto-opened. Having DevTools
    // attached is a massive perf tax on this app specifically: the timeline mutates the
    // DOM and emits console output EVERY frame during a drag/zoom, and an attached
    // inspector must re-serialize the DOM for the Elements panel + ship every console
    // call over the devtools protocol + keep the profiler live — all on the main thread,
    // per frame. That throttled continuous animation 3–10× and was the real reason the
    // Electron window felt laggy while the SAME page in a browser (DevTools closed) was
    // smooth. Open it deliberately with the env var, or via the menu / Cmd-Opt-I, only
    // when you actually need it — and expect animation to get heavy while it's open.
    if (process.env.ZERO_DEVTOOLS === "1") {
      win.webContents.openDevTools({ mode: "detach" })
    }
  } else {
    win.loadURL("app://local/index.html")
  }

  // External links (and, later, anything that asks to open a new window) go to the
  // user's real browser rather than spawning rogue Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url)
      return { action: "deny" }
    }
    return { action: "deny" }
  })

  win.on("closed", () => {
    // Only tear down the shared native resource-host state when the LAST window
    // closes — otherwise a surviving window would lose its resource views. Keep the
    // `mainWindow` pointer valid by repointing it at a surviving window.
    const survivors = BrowserWindow.getAllWindows().filter((w) => w !== win && !w.isDestroyed())
    if (survivors.length === 0) {
      resourceViews.clear()
      // Tear down the out-of-process WebView2 host too (if it was in use).
      if (hostBridge) {
        try {
          hostBridge.shutdown()
        } catch {
          /* ignore */
        }
        hostBridge = null
      }
      mainWindow = null
    } else if (mainWindow === win || mainWindow?.isDestroyed()) {
      mainWindow = survivors[0]
    }
  })
}

// Synchronous so the renderer's preload can expose `window.zero.locale` at load
// time (one tiny call; the value is needed for the very first formatted render).
ipcMain.on("zero:locale", (event) => {
  event.returnValue = osFormatLocale()
})

// The REAL running build version (`app.getVersion()` = the packaged package.json
// version the CI stamped from the release tag). Synchronous so the header can show
// the TRUE version at first paint. This is the self-correcting source of truth —
// the web `ZERO_VERSION` constant is only a fallback for the browser build, and can
// no longer drift out of step with what the desktop app actually shipped.
ipcMain.on("zero:app-version", (event) => {
  event.returnValue = app.getVersion()
})

// A second launch of the exe lands here in the PRIMARY process instead of starting
// a new one. Open another window in this process — it shares storage with the
// existing window(s) and live-syncs via the storage event. Best-effort: only once
// the app is ready (Chromium/protocol are up).
app.on("second-instance", () => {
  if (app.isReady()) createWindow()
})

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    // Drop the default application menu (File/Edit/View/Window) on Windows/Linux —
    // Zero is chromeless there. macOS keeps a menu so ⌘Q / ⌘H etc. still work.
    if (process.platform !== "darwin") Menu.setApplicationMenu(null)

    if (!isDev) {
      // Serve the static export on the DEFAULT session (the main window). Resource
      // views run in their OWN partitioned sessions and get the same handler wired up
      // in prepareResourceSession() — see the note there.
      protocol.handle("app", serveAppProtocol)
    }

    createWindow()

    // WEBVIEW INPUT RECOVERY. The OS silently tears down the AttachThreadInput merge that routes
    // mouse+keyboard into the visible webview, leaving it rendered-but-frozen until manually parked+reopened.
    // The host's re-anchor (detach→re-attach→reseed) fixes it, but it needs a TRIGGER. We used to trigger
    // only on sleep/unlock — but Loris hit the freeze after merely being AWAY A COUPLE MINUTES with NO sleep
    // (host.log showed a healthy ATTACH then silence then dead input). The real culprit is any idle low-power
    // transition — most likely DISPLAY POWER-OFF (screen timeout), which on Modern Standby is a genuine power
    // event that breaks the merge but does NOT raise powerMonitor 'resume'. So we trigger on THREE signals:
    //   1. powerMonitor resume / unlock-screen  — full sleep + session unlock.
    //   2. browser-window-focus                 — alt-tab back / app refocus.
    //   3. idle-return poll (below)             — user returns after the screen/system went idle, even when
    //      focus never changed. Uses powerMonitor.getSystemIdleTime() (OS-level GetLastInputInfo), which keeps
    //      working even while our own input merge is broken.
    // Re-anchor is cheap + idempotent and only reseeds focus into the ALREADY-visible webview, so firing from
    // several triggers is harmless (a parked/hidden view no-ops in the host).
    const reanchorResourceInput = (reason) => {
      try {
        if (!(useWebView2() && hostBridge && hostBridge.ready)) return
        console.log(`[v0] reanchor resource input: ${reason}`)
        hostBridge.reanchor(reason)
        setTimeout(() => {
          if (useWebView2() && hostBridge && hostBridge.ready) hostBridge.reanchor(`${reason}:delayed`)
        }, 800)
      } catch (err) {
        console.log(`[v0] reanchor failed (${reason}): ${err && err.message}`)
      }
    }
    powerMonitor.on("resume", () => reanchorResourceInput("power-resume"))
    powerMonitor.on("unlock-screen", () => reanchorResourceInput("session-unlock"))
    app.on("browser-window-focus", () => reanchorResourceInput("window-focus"))

    // A monitor's DPI changed in place (e.g. display settings / plugging a screen). Catches the scale change
    // when the window ISN'T moved; the drag-between-monitors case is handled by the per-window move listener.
    screen.on("display-metrics-changed", () => syncHostScaleToDisplay("display-metrics"))

    // Idle-return watcher. Poll the OS idle timer every second; once the user has been idle past the
    // threshold (screen likely off), the NEXT tick where they're active again re-anchors the webview input so
    // their first real interaction lands. Worst case the very first click after returning is swallowed and it
    // recovers within ~1s — vastly better than a permanent freeze needing a manual park+reveal.
    const IDLE_AWAY_THRESHOLD_S = 30
    let wasIdleAway = false
    setInterval(() => {
      try {
        const idle = powerMonitor.getSystemIdleTime() // seconds since last OS-level input
        if (idle >= IDLE_AWAY_THRESHOLD_S) {
          wasIdleAway = true
        } else if (wasIdleAway) {
          wasIdleAway = false
          reanchorResourceInput("idle-return")
        }
      } catch {
        /* getSystemIdleTime can throw very early in startup; ignore */
      }
    }, 1000)

    // Best-effort background update check (production/packaged only).
    setupAutoUpdate()

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

// ── STEP 2: native resource host ─────────────────────────────────────────────
// Each open RESOURCE TASK gets a real Chromium WebContentsView, loaded as
// top-level content (so X-Frame-Options / frame-ancestors do NOT apply ��� Figma,
// Notion, Linear, anything loads live). The view is a native layer that floats
// ABOVE the DOM; ResourceCanvas renders a transparent placeholder and streams its
// screen rect here, so the native view tracks the placeholder through scrolls,
// window resizes and the open/close morph.

// The warm-tab pool. Keyed by entity id; the Map's insertion order doubles as an
// LRU list (front = least-recently-used). A drilled-into resource is REVEALED and
// touched to the back (MRU); drilling away PARKS it (hidden + throttled) but keeps
// it resident so re-opening is an instant tab-switch, not a reload. We keep at most
// WARM_LIMIT views alive — parking a new one evicts the oldest parked view. An
// explicit close (the header × button) destroys immediately regardless of the cap.
/** @type {Map<string, import('electron').WebContentsView>} */
const resourceViews = new Map()
const WARM_LIMIT = 4

/** Bump a view to MRU (back of the Map's iteration order). */
function touchWarm(id) {
  const view = resourceViews.get(id)
  if (!view) return
  resourceViews.delete(id)
  resourceViews.set(id, view)
}

/** Destroy the least-recently-used views until at most WARM_LIMIT remain. The
 *  currently-visible view is always MRU (touched on mount), so it's never evicted. */
function enforceWarmLimit() {
  while (resourceViews.size > WARM_LIMIT) {
    const oldest = resourceViews.keys().next().value
    if (oldest === undefined) break
    console.log(`[v0] resource:evict (warm cap ${WARM_LIMIT}) id=${oldest}`)
    destroyResourceView(oldest)
  }
}

/** Park a view: hide it and let Chromium throttle it to near-zero cost, but KEEP it
 *  resident so reopening is instant. Parking counts as recent use (the tab you just
 *  left is the most likely to be reopened), so it's bumped to MRU, then the cap is
 *  enforced to retire older parked tabs. */
function parkResourceView(id) {
  const view = resourceViews.get(id)
  if (!view) return
  try {
    view.setVisible(false)
    // setVisible(false) stops compositing/painting; also flip background throttling
    // back ON (the view was created with it OFF for a fast first load) so hidden
    // timers/rAF are throttled while parked. Best-effort across Electron versions.
    view.webContents?.setBackgroundThrottling?.(true)
  } catch {
    /* view already gone */
  }
  touchWarm(id)
  enforceWarmLimit()
}

/** Partitions whose session has already had its embedding guards stripped. */
const preparedPartitions = new Set()

// A modern Chrome UA. Electron's default UA contains "Electron/…" and the app
// name, which some sites (Google included) treat as an unsupported browser. The
// Chrome version is kept roughly aligned with the bundled Chromium.
// v0.2.201: version MUST match the bundled Chromium major. The 200 diagnostic showed the
// page's NATIVE userAgentData reports Chromium 148 (fullVersionList 148.0.7778.265) — but we
// were claiming Chrome/136 in the UA string. A UA(136) vs UA-CH(148) mismatch is itself a bot
// tell, and if the JS override fails the native 148 leaks anyway. So we align everything to the
// real Chromium major so header, UA string, and (if it lands) the JS patch all agree.
const RESOURCE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
const RESOURCE_UA_CH_VERSION = "148"

// v0.2.203: DISABLE the CDP main-world fingerprint patch + per-page probe. The 195–202
// investigation proved this is Google's *policy* block on OAuth inside embedded webviews
// (Electron WebContentsView), NOT a beatable fingerprint: on 202 the injected script ran
// cleanly in-page (`fp:{ran:true,errors:[]}`) with a clean UA + webdriver:false, and Google
// STILL showed "Couldn't sign you in" — the same wall every Electron browser (Min, etc.) hits.
// Meanwhile `Page.enable` was timing out ~1.5s×retries per view, taxing ALL browsing. So we
// keep the cheap header/UA spoof (setUserAgent, zero cost) but gate off the CDP machinery.
// Flip to `true` only if we ever revisit a runtime approach. The helper fns are kept intact.
const FINGERPRINT_PATCH_ENABLED = false

// User-Agent CLIENT HINTS to match RESOURCE_UA. Spoofing only navigator.userAgent /
// the UA header is NOT enough for Google's OAuth "secure browser" check: modern
// Chromium ALSO sends `Sec-CH-UA…` client-hint headers, and Electron's still list
// `"Electron"` as a brand AND report the real OS in `Sec-CH-UA-Platform` — which
// contradicts our Windows/Chrome UA and flags us as an embedded/untrusted browser
// ("Couldn't sign you in"). We overwrite the low-entropy hints to a clean Chrome
// identity and DROP the high-entropy ones (full-version-list etc.) so no Electron
// brand can leak through. Kept consistent with the Windows UA above.
const RESOURCE_CLIENT_HINTS = {
  "sec-ch-ua": `"Chromium";v="${RESOURCE_UA_CH_VERSION}", "Google Chrome";v="${RESOURCE_UA_CH_VERSION}", "Not.A/Brand";v="99"`,
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
}
// High-entropy client hints that would otherwise re-expose Electron / the real OS.
const RESOURCE_CLIENT_HINTS_DROP = [
  "sec-ch-ua-full-version",
  "sec-ch-ua-full-version-list",
  "sec-ch-ua-platform-version",
  "sec-ch-ua-arch",
  "sec-ch-ua-bitness",
  "sec-ch-ua-model",
  "sec-ch-ua-wow64",
]

/**
 * Make a partitioned session embeddable. Sites defend against being embedded with
 * `X-Frame-Options`, CSP `frame-ancestors`, and cross-origin isolation headers —
 * which is exactly what produces the blank view / ERR_BLOCKED_BY_RESPONSE. Since a
 * resource view is top-level content the user explicitly opened (not a tracking
 * frame), we strip those response headers, the same approach Electron-based
 * browsers use to host arbitrary sites. Registered once per partition.
 */
function prepareResourceSession(partition) {
  if (preparedPartitions.has(partition)) return
  preparedPartitions.add(partition)
  const ses = session.fromPartition(partition)
  ses.setUserAgent(RESOURCE_UA)

  // Teach this partition how to serve `app://local/…` too. protocol.handle() only
  // registers on the DEFAULT session, so without this an internal resource (e.g.
  // Zero's own "/zero-laws" → app://local/zero-laws) has no handler in the
  // partition and Chromium punts `app:` to the OS shell ("Get an app to open this
  // 'app' link"). Only meaningful in the packaged build (dev uses http://localhost).
  if (!isDev) {
    try {
      ses.protocol.handle("app", serveAppProtocol)
    } catch (err) {
      console.log(`[v0] resource: app:// handler already set for ${partition}`, err?.message || err)
    }
  }

  const STRIP = new Set([
    "x-frame-options",
    "content-security-policy",
    "content-security-policy-report-only",
    "cross-origin-opener-policy",
    "cross-origin-embedder-policy",
    "cross-origin-resource-policy",
  ])

  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {}
    for (const key of Object.keys(headers)) {
      if (STRIP.has(key.toLowerCase())) delete headers[key]
    }
    callback({ responseHeaders: headers })
  })

  // Send a Chrome-like UA + matching client hints on the request side too. Sites
  // (Google's OAuth especially) sniff BOTH the UA header and the `Sec-CH-UA…` client
  // hints, so we rewrite the UA, overwrite the low-entropy hints to a clean Chrome
  // identity, and drop the high-entropy ones that would re-leak Electron / the real OS.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders
    h["User-Agent"] = RESOURCE_UA
    // Overwrite/normalize case-insensitively: delete any existing sec-ch-ua* first so a
    // differently-cased Electron-supplied header can't survive alongside ours.
    for (const key of Object.keys(h)) {
      if (key.toLowerCase().startsWith("sec-ch-ua")) delete h[key]
    }
    for (const [k, v] of Object.entries(RESOURCE_CLIENT_HINTS)) h[k] = v
    // (DROP list is implicitly satisfied — we removed all sec-ch-ua* and only re-added
    // the three low-entropy hints — but keep the constant as the explicit contract.)
    void RESOURCE_CLIENT_HINTS_DROP
    callback({ requestHeaders: h })
  })
}

/**
 * The JS-world half of the Chrome disguise. `prepareResourceSession` fixes the HTTP layer
 * (UA + Sec-CH-UA headers), but that is INVISIBLE to JavaScript: Google's OAuth page calls
 * the live API `navigator.userAgentData.getHighEntropyValues(...)`, which reads Chromium's
 * INTERNAL brand list — still `"Electron"` — no matter what headers we rewrote. So a header
 * spoof alone still trips "Couldn't sign you in". This source patches the JS tells to the
 * SAME clean Chrome identity as the headers: brands / high-entropy values / platform, plus
 * `navigator.webdriver`. Kept in sync with RESOURCE_UA + RESOURCE_CLIENT_HINTS above.
 */
function buildFingerprintPatch(chVersion) {
  const V = String(chVersion || "148")
  return `(() => {
  // v0.2.201 DIAGNOSTIC: record on window.__zeroFp whether this script ran (and in which
  // world — the probe reads it via executeJavaScript in the MAIN world, so if __zeroFp is
  // undefined there, the CDP script ran in a DIFFERENT world = the real bug) and exactly
  // which override threw. The 200 log showed native Chromium-148 values surviving despite a
  // "patch ARMED", so an override is silently failing OR we're patching the wrong world.
  var diag = { ran: true, world: "main?", errors: [] };
  try { window.__zeroFp = diag; } catch (e) {}
  var rec = function (label, fn) { try { fn(); } catch (e) { diag.errors.push(label + ": " + (e && e.message || e)); } };
  try {
    var V = ${JSON.stringify(V)};
    var brands = [
      { brand: "Chromium", version: V },
      { brand: "Google Chrome", version: V },
      { brand: "Not.A/Brand", version: "99" },
    ];
    var full = V + ".0.0.0";
    var fullList = [
      { brand: "Chromium", version: full },
      { brand: "Google Chrome", version: full },
      { brand: "Not.A/Brand", version: "99.0.0.0" },
    ];
    var clone = function (a) { return a.map(function (b) { return { brand: b.brand, version: b.version }; }); };
    var ua = navigator.userAgentData;
    diag.hadUAData = !!ua;
    if (ua) {
      // Try shadowing on the instance; if that fails, try the PROTOTYPE (the getter lives on
      // NavigatorUAData.prototype, and some builds make the instance prop non-configurable).
      rec("brands", function () {
        try { Object.defineProperty(ua, "brands", { get: function () { return clone(brands); }, configurable: true }); }
        catch (e) { Object.defineProperty(Object.getPrototypeOf(ua), "brands", { get: function () { return clone(brands); }, configurable: true }); }
      });
      rec("mobile", function () { Object.defineProperty(ua, "mobile", { get: function () { return false; }, configurable: true }); });
      rec("platform", function () { Object.defineProperty(ua, "platform", { get: function () { return "Windows"; }, configurable: true }); });
      var high = {
        architecture: "x86", bitness: "64",
        brands: clone(brands), fullVersionList: clone(fullList),
        mobile: false, model: "", platform: "Windows",
        platformVersion: "15.0.0", uaFullVersion: full, wow64: false,
      };
      rec("getHighEntropyValues", function () {
        var impl = function (hints) {
          var out = { brands: clone(brands), mobile: false, platform: "Windows" };
          if (Array.isArray(hints)) for (var i = 0; i < hints.length; i++) { var k = hints[i]; if (k in high) out[k] = high[k]; }
          return Promise.resolve(out);
        };
        try { ua.getHighEntropyValues = impl; }
        catch (e) { Object.defineProperty(Object.getPrototypeOf(ua), "getHighEntropyValues", { value: impl, configurable: true, writable: true }); }
      });
    }
    // Keep the deprecated navigator.platform consistent with the Windows UA (a Mac platform
    // under a Windows UA is itself an embedded/spoof tell).
    rec("navigator.platform", function () { Object.defineProperty(navigator, "platform", { get: function () { return "Win32"; }, configurable: true }); });
    rec("webdriver", function () { if (navigator.webdriver) Object.defineProperty(navigator, "webdriver", { get: function () { return false; }, configurable: true }); });
  } catch (e) { try { diag.errors.push("outer: " + (e && e.message || e)); } catch (e2) {} }
})();`
}

/**
 * Append a line to a small diagnostic log in userData (`zero-fingerprint.log`) so we can
 * VERIFY, from a packaged build with no console, whether the disguise actually armed and
 * what the page ends up seeing. The user can open this file and read it back.
 */
function fpLog(msg) {
  try {
    const line = `${new Date().toISOString()}  ${msg}\n`
    fs.appendFileSync(path.join(app.getPath("userData"), "zero-fingerprint.log"), line)
  } catch {
    /* diagnostics are best-effort */
  }
  console.log(`[v0] fp: ${msg}`)
}

/**
 * Inject {@link buildFingerprintPatch} into a resource webContents' MAIN world BEFORE any page
 * script runs, on every navigation, via CDP `Page.addScriptToEvaluateOnNewDocument`. This is
 * how we reach the page's real world while keeping `contextIsolation: true` (a preload would
 * only patch its own isolated world, which the page can't see).
 *
 * ASYNC + AWAITED (v0.2.198): the earlier version fired `sendCommand` without awaiting, so the
 * "inject on every new document" registration almost never completed before `loadURL` started
 * the FIRST navigation — meaning Google's login page (the first document) loaded WITHOUT the
 * patch, defeating the whole thing. The caller now awaits this before loadURL.
 *
 * v0.2.199: DO NOT call `Page.enable` — awaiting it wedged forever in the packaged build, so
 * `loadURL` never fired and every resource hung on the loading spinner. `addScriptToEvaluate-
 * OnNewDocument` works without it (as it did in 195/197, which loaded fine). We just attach +
 * addScript and await that one command. The caller additionally races this with a timeout so a
 * slow/failed arm can never again block navigation.
 *
 * v0.2.200: the 198 diagnostic log showed EVERY arm FAILED with "target closed while handling
 * command" — i.e. the CDP script was never actually injected in ANY build (195/197/198), so the
 * disguise was only ever header/UA-deep. Root cause: we attached + sent the command at view
 * CREATION time, before the WebContentsView's renderer target was stably alive (and before it
 * was added to the window), so the initial target closed mid-command. FIX: (1) the caller now
 * arms AFTER `addChildView`; (2) we RETRY with reattach + backoff so a transient "target closed"
 * during target setup is ridden out; (3) log each attempt so the outcome is unambiguous.
 *
 * v0.2.202: the 201 log showed the arm "succeeding" but `window.__zeroFp` was NULL in the page
 * and the native Chromium userAgentData survived — i.e. `addScriptToEvaluateOnNewDocument`
 * RESOLVED but its script NEVER RAN. That's the signature of the Page domain not being enabled:
 * the command is accepted but no document-creation hook fires without `Page.enable`. We removed
 * `Page.enable` in 199 because it HUNG — but that hang was caused by arming at CREATION time
 * (target not alive), which 200 fixed by arming after addChildView. So we now `Page.enable`
 * again, but each CDP call is wrapped in `sendWithTimeout` so a stuck call can never hang the
 * arm (and the caller still races the whole arm against a timeout before loadURL). Belt +
 * braces: navigation can never be blocked again, and the injection finally actually runs.
 */
function sendWithTimeout(dbg, method, params, ms) {
  return Promise.race([
    dbg.sendCommand(method, params || {}),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`${method} timed out after ${ms}ms`)), ms)),
  ])
}

async function applyFingerprintPatch(webContents, tag = "resource") {
  // v0.2.203: gated off — proven a policy wall, not a fingerprint (see FINGERPRINT_PATCH_ENABLED).
  // Early-return keeps browsing fast: no debugger attach, no Page.enable timeouts.
  if (!FINGERPRINT_PATCH_ENABLED) return
  const source = buildFingerprintPatch(RESOURCE_UA_CH_VERSION)
  const MAX_ATTEMPTS = 5
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (webContents.isDestroyed()) {
      fpLog(`patch ABORTED (${tag}): webContents destroyed before arm`)
      return
    }
    try {
      const dbg = webContents.debugger
      if (!dbg.isAttached()) dbg.attach("1.3")
      // Page.enable is REQUIRED for addScriptToEvaluateOnNewDocument to actually run its script
      // (201 proved that: without it the command resolves but the script never executes).
      // Timeout-guarded so a stuck enable can't hang the arm (the 198 spinner-forever bug).
      await sendWithTimeout(dbg, "Page.enable", {}, 1500)
      await sendWithTimeout(dbg, "Page.addScriptToEvaluateOnNewDocument", { source }, 1500)
      fpLog(`patch ARMED (${tag}) attempt=${attempt}`)
      return
    } catch (err) {
      const msg = err?.message || String(err)
      fpLog(`patch attempt ${attempt}/${MAX_ATTEMPTS} failed (${tag}): ${msg}`)
      // Detach so the next attempt gets a clean attach against the (hopefully now stable) target.
      try {
        if (webContents.debugger.isAttached()) webContents.debugger.detach()
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 200 * attempt))
    }
  }
  fpLog(`patch GAVE UP (${tag}) after ${MAX_ATTEMPTS} attempts`)
}

/**
 * After a resource page has loaded, read what its MAIN world ACTUALLY exposes (UA, the JS
 * userAgentData brands + high-entropy list, webdriver) and log it. This is the conclusive
 * check: if these read clean Chrome with no "Electron", the disguise is live and any remaining
 * block is a DIFFERENT Google signal; if they still say Electron, the injection didn't take.
 */
async function logFingerprintState(webContents, tag = "resource") {
  // v0.2.203: gated off with the patch — no per-dom-ready executeJavaScript probe when disabled.
  if (!FINGERPRINT_PATCH_ENABLED) return
  try {
    const probe = `(async () => {
      let high = null;
      try { high = await navigator.userAgentData?.getHighEntropyValues(["fullVersionList","platform","platformVersion"]); } catch (e) {}
      return JSON.stringify({
        ua: navigator.userAgent,
        brands: navigator.userAgentData?.brands,
        high: high,
        platform: navigator.platform,
        webdriver: navigator.webdriver,
        // v0.2.201: the patch's self-report. If this is null the CDP script ran in a DIFFERENT
        // world than this probe (a world/injection problem); if it's present with errors[],
        // those name the exact overrides that threw.
        fp: (typeof window !== "undefined" ? window.__zeroFp : null) || null,
      });
    })()`
    const result = await webContents.executeJavaScript(probe, true)
    fpLog(`page sees (${tag}): ${result}`)
  } catch (err) {
    fpLog(`probe FAILED (${tag}): ${err?.message || err}`)
  }
}

/** Snap a CSS-pixel rect from the renderer to integer device-independent bounds. */
function toBounds(rect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  }
}

function destroyResourceView(id) {
  const view = resourceViews.get(id)
  if (!view) return
  try {
    mainWindow?.contentView.removeChildView(view)
    view.webContents.close()
  } catch {
    /* already gone */
  }
  resourceViews.delete(id)
}

// ── RESOURCE ENGINE SELECTION (WebView2 host vs Electron WebContentsView) ────
// M2 of the WebView2 migration. The resource surface can render through either:
//   • "webview2" — an out-of-process WebView2 host (native/resource-host). Edge's
//     Chromium, which Google TRUSTS for OAuth (the whole reason for the migration).
//   • "electron" — the original in-process WebContentsView path below (kept intact).
// Default is webview2 on Windows (the dogfooding target); everything else stays on
// Electron. If the host fails to spawn we set hostBridgeFailed and FALL BACK to the
// WebContentsView path, so the app can never end up with a dead resource surface.
// Force either path with ZERO_RESOURCE_ENGINE=webview2|electron.
const RESOURCE_ENGINE = (
  process.env.ZERO_RESOURCE_ENGINE || (process.platform === "win32" ? "webview2" : "electron")
).toLowerCase()
/** @type {ResourceHostBridge | null} */
let hostBridge = null
let hostBridgeFailed = false

function useWebView2() {
  return RESOURCE_ENGINE === "webview2" && process.platform === "win32" && !hostBridgeFailed
}

/** Forward the bridge's normalized events onto the SAME zero:resource:* channels the
 *  WebContentsView path uses, so the renderer contract is identical either way. */
function wireBridgeEvents(bridge) {
  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
  }
  bridge.on("status", (p) => send("zero:resource:status", p))
  bridge.on("navigated", (p) => send("zero:resource:navigated", p))
  bridge.on("contextmenu", (p) => send("zero:resource:contextmenu", { id: p.id, x: p.x, y: p.y }))
  bridge.on("output", (p) => {
    // NOTE (M2 refinement): the host emits this at DownloadStarting, so the file at
    // p.path may still be in flight. Good enough to register the Output; revisit to
    // fire on completion if a half-written file becomes a problem.
    send("zero:resource:output", {
      id: p.id,
      name: p.name,
      dataUrl: p.path ? pathToFileURL(p.path).toString() : undefined,
    })
  })
  bridge.on("host-exit", () => {
    // Host died. Mark not-ready; the next mount will attempt a fresh start (and, if
    // that also fails, fall back to WebContentsView).
    hostBridge = null
  })
}

/** Lazily spawn + hand-shake the WebView2 host. Resolves the live bridge, or null on
 *  failure (caller then falls back to the WebContentsView path). */
async function ensureHostBridge() {
  if (hostBridge && hostBridge.ready) return hostBridge
  if (hostBridgeFailed || !mainWindow) return null
  if (!hostBridge) {
    hostBridge = new ResourceHostBridge({
      isDev,
      appRoot: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      userDataFolder: path.join(app.getPath("userData"), "resource-host-profiles"),
    })
    wireBridgeEvents(hostBridge)
  }
  try {
    const disp = screen.getDisplayNearestPoint(mainWindow.getBounds())
    await hostBridge.start(mainWindow.getNativeWindowHandle(), disp.scaleFactor)
    return hostBridge
  } catch (err) {
    console.log(`[v0] resource-host: start failed — falling back to WebContentsView (${err?.message || err})`)
    hostBridgeFailed = true
    hostBridge = null
    return null
  }
}

/** WebView2 mount. Returns true if handled, false to fall back to WebContentsView. */
async function webview2Mount(args) {
  const { id, url, resourceId, envKey, rect } = args
  const bridge = await ensureHostBridge()
  if (!bridge) return false
  // CONTEXT ENV-KEYING: the WebView2 profile (and, host-side, its environment folder) is keyed
  // by `envKey` = the resource's nearest-Space-ancestor identity. So every resource filed under
  // the same Space shares ONE profile/login (SSO within a Space), while resources under different
  // Spaces get separate profiles (isolation across Spaces). Falls back to a per-resource profile
  // when no envKey is supplied (e.g. an older renderer), preserving prior behavior.
  const profile = envKey ? `env-${envKey}` : `resource-${resourceId || "web"}`
  bridge.mount({ id, url, profile, rect })
  return true
}

ipcMain.handle("zero:resource:mount", async (_e, args) => {
  if (!mainWindow) return
  const { id, url, resourceId, envKey, rect } = args
  console.log(`[v0] resource:mount id=${id} resourceId=${resourceId || "-"} url=${url} engine=${useWebView2() ? "webview2" : "electron"}`)
  // WebView2 path (Windows dogfooding). Falls through to WebContentsView if the host
  // couldn't start, so a failed migration never leaves the surface dead.
  if (useWebView2()) {
    const handled = await webview2Mount(args)
    if (handled) return
  }
  // Already resident (a warm/parked tab being re-opened): REVEAL it instead of
  // reloading — this is the instant tab-switch. Un-throttle, show, reposition, bump
  // to MRU. If it already finished loading once, re-announce ok so the renderer drops
  // its "settling" cover immediately (its onStatus won't fire again for a cached view).
  const existing = resourceViews.get(id)
  if (existing) {
    try {
      existing.webContents?.setBackgroundThrottling?.(false)
      existing.setVisible(true)
    } catch {
      /* fall through to reposition */
    }
    existing.setBounds(toBounds(rect))
    touchWarm(id)
    if (existing.__zeroLoaded && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("zero:resource:status", { id, ok: true })
    }
    return
  }

  // CONTEXT ENV-KEYING (Electron fallback path): partition by `envKey` (nearest-Space-ancestor)
  // so logins are shared within a Space and isolated across Spaces — mirroring the WebView2
  // profile keying above. Falls back to a per-resource partition when no envKey is supplied.
  const partition = envKey ? `persist:env:${envKey}` : `persist:resource:${resourceId || "web"}`
  prepareResourceSession(partition)
  const view = new WebContentsView({
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      // Keep loading/painting at full speed while parked offscreen during the morph.
      backgroundThrottling: false,
    },
  })
  view.setBackgroundColor("#ffffff")
  view.setBounds(toBounds(rect))
  mainWindow.contentView.addChildView(view)
  // Finish the Chrome disguise in the page's main world (headers alone don't fool Google's
  // JS `userAgentData` check). MUST be fully armed before the first navigation — we await
  // this promise right before loadURL below, otherwise the first document (e.g. Google's
  // login page) loads before the CDP script registers. Armed AFTER addChildView (v0.2.200) so
  // the renderer target is stably alive — arming at creation raced target setup and every
  // command failed with "target closed" (the disguise never actually applied in 195–198).
  const fpReady = applyFingerprintPatch(view.webContents)
  view.__zeroLoaded = false
  resourceViews.set(id, view) // newest ⇒ MRU (back of the LRU order)
  // A freshly opened tab may push us over the warm cap; retire the oldest parked one.
  enforceWarmLimit()

  // Right-click anywhere in the resource → notify the renderer, which owns the live
  // entity data and builds the menu spec, then draws it via the transparent menu
  // WebContentsView stacked ABOVE this native view (a DOM menu can't paint over a native
  // WebContentsView). Translate the click (relative to the view's web contents) into
  // main-window CLIENT coords the renderer can pass straight back to `zero:menu:open`.
  view.webContents.on("context-menu", (_e2, params) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const vb = view.getBounds()
    mainWindow.webContents.send("zero:resource:contextmenu", {
      id,
      x: Math.round(vb.x + params.x),
      y: Math.round(vb.y + params.y),
    })
  })

  // ZOOM — let the user scale the rendered site. A trackpad pinch and a ctrl/⌘+scroll are
  // both routed by Chromium to `zoom-changed`; we step the view's own zoom factor and clamp
  // it. ⌘/Ctrl + = / - / 0 (keyboard) do the same, with 0 resetting to 100%. Zoom is
  // per-WebContentsView, so each resource tab keeps its own scale.
  const ZOOM_MIN = 0.3
  const ZOOM_MAX = 5
  const ZOOM_STEP = 0.1
  const applyZoom = (next) => {
    view.webContents.setZoomFactor(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next)))
  }
  view.webContents.on("zoom-changed", (_ez, zoomDirection) => {
    const cur = view.webContents.getZoomFactor()
    applyZoom(zoomDirection === "in" ? cur + ZOOM_STEP : cur - ZOOM_STEP)
  })
  view.webContents.on("before-input-event", (_ek, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta)) return
    const cur = view.webContents.getZoomFactor()
    if (input.key === "0") applyZoom(1)
    else if (input.key === "=" || input.key === "+") applyZoom(cur + ZOOM_STEP)
    else if (input.key === "-") applyZoom(cur - ZOOM_STEP)
  })

  // Links that try to open a new window (e.g. OAuth popups) open a real child
  // browser window rather than being denied, so sign-in flows work.
  view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    if (/^https?:\/\//.test(openUrl)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 520, height: 680 },
      }
    }
    return { action: "deny" }
  })
  // A popup child (a common OAuth pattern) inherits the session's header spoof but NOT the
  // main-world JS patch — apply it so Google's check passes inside the popup too.
  view.webContents.on("did-create-window", (childWin) => {
    if (childWin && !childWin.isDestroyed()) applyFingerprintPatch(childWin.webContents)
  })

  // OUTPUTS BRIDGE: when the resource produces a file (export/download), notify the
  // renderer so it can later wire into the Task's Outputs. Capture the saved path.
  view.webContents.session.on("will-download", (_evt, item) => {
    const name = item.getFilename()
    item.once("done", (_d, state) => {
      if (state === "completed" && mainWindow) {
        mainWindow.webContents.send("zero:resource:output", {
          id,
          name,
          dataUrl: pathToFileURL(item.getSavePath()).toString(),
        })
      }
    })
  })

  // Tell the renderer when a load finishes or fails, so it can reveal the view
  // (snap-in) or show a graceful error/open-externally affordance.
  const report = (ok, detail) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("zero:resource:status", { id, ok, detail })
    }
  }
  // dom-ready fires once the main-frame DOM is parsed — first paint is imminent.
  // Reveal here (not on did-finish-load, which waits for every subresource) so
  // heavy sites like Figma snap in seconds earlier.
  view.webContents.once("dom-ready", () => {
    console.log(`[v0] resource:dom-ready id=${id}`)
    // PINCH ZOOM: a macOS trackpad pinch is delivered to Chromium as a VISUAL (pinch)
    // zoom gesture, which Electron disables by default — so pinching over a resource did
    // nothing (only ⌘/ctrl+scroll, handled via "zoom-changed", worked). Enabling visual
    // zoom limits lets the pinch gesture scale the page. Kept in sync with the ⌘-scroll
    // ZOOM_MIN/ZOOM_MAX range so both paths feel consistent.
    view.webContents.setVisualZoomLevelLimits?.(1, ZOOM_MAX).catch?.(() => {})
    view.__zeroLoaded = true // mark resident-and-ready so a later re-open reveals instantly
    report(true)
  })
  // DIAGNOSTIC: on every document (incl. the akiflow→Google redirect), record what the page's
  // main world actually sees, so we can confirm from the log file whether the disguise is live.
  view.webContents.on("dom-ready", () => {
    void logFingerprintState(view.webContents, `id=${id} ${view.webContents.getURL()}`)
  })
  view.webContents.on("did-finish-load", () => {
    console.log(`[v0] resource:loaded id=${id}`)
    view.__zeroLoaded = true
    report(true)
  })
  view.webContents.on("did-fail-load", (_e2, code, desc, validatedURL, isMainFrame) => {
    // -3 == ERR_ABORTED, fired for benign client-side redirects; ignore it.
    if (!isMainFrame || code === -3) return
    console.log(`[v0] resource:failed id=${id} code=${code} desc=${desc} url=${validatedURL}`)
    report(false, desc || `error ${code}`)
  })

  // NAVIGATION BRIDGE: report the main-frame URL whenever it changes so the renderer
  // can remember "where I left off" per resource (persisted, so reopening resumes the
  // last page instead of the original webUrl). Covers full navigations, history moves,
  // and in-page (SPA / pushState) changes — the latter matters for apps like v0.app.
  const reportNav = (navUrl) => {
    if (mainWindow && !mainWindow.isDestroyed() && typeof navUrl === "string" && navUrl) {
      mainWindow.webContents.send("zero:resource:navigated", { id, url: navUrl })
    }
  }
  view.webContents.on("did-navigate", (_e3, navUrl) => reportNav(navUrl))
  view.webContents.on("did-navigate-in-page", (_e4, navUrl, isMainFrame) => {
    if (isMainFrame) reportNav(navUrl)
  })

  try {
    // Ensure the fingerprint disguise is armed BEFORE the first navigation, so the very
    // first document (often the Google login page itself) is patched, not just later ones.
    // SAFETY: race the arm against a timeout so a slow/hung CDP call can NEVER again block
    // navigation (the 198 spinner-forever regression). 3s comfortably covers the first few
    // retry attempts (0/200/600/1200ms backoff); if the arm still hasn't landed we load anyway
    // (worst case: the very first document is unpatched, but the retry keeps arming in the
    // background so subsequent documents in the same view get the disguise).
    await Promise.race([fpReady, new Promise((r) => setTimeout(r, 3000))])
    await view.webContents.loadURL(url)
  } catch (err) {
    console.log(`[v0] resource:loadURL threw id=${id} ${err?.message || err}`)
  }
})

ipcMain.on("zero:resource:set-bounds", (_e, { id, rect }) => {
  if (useWebView2() && hostBridge) {
    hostBridge.setBounds({ id, rect })
    return
  }
  const view = resourceViews.get(id)
  if (view) view.setBounds(toBounds(rect))
})

// Drilling AWAY (breadcrumb / dayline tick / sibling / anywhere) parks the view —
// hidden + throttled, but kept warm for an instant re-open.
ipcMain.on("zero:resource:park", (_e, id) => {
  if (useWebView2() && hostBridge) {
    hostBridge.park(id)
    return
  }
  parkResourceView(id)
})
// The header × button explicitly closes the tab for good — destroy now, ignore the cap.
ipcMain.on("zero:resource:close", (_e, id) => {
  if (useWebView2() && hostBridge) {
    hostBridge.close(id)
    return
  }
  destroyResourceView(id)
})
// Back-compat alias (older renderers called unmount on teardown). Treat as PARK so a
// stale build still keeps tabs warm rather than tearing them down.
ipcMain.on("zero:resource:unmount", (_e, id) => {
  if (useWebView2() && hostBridge) {
    hostBridge.park(id)
    return
  }
  parkResourceView(id)
})

// A Zero UI field (create-entity, etc.) was focused while a webview is displayed above it. Ask the host to
// hand keyboard focus back to Electron so the click actually lands in Zero's input instead of the website.
ipcMain.on("zero:resource:release-focus", () => {
  if (useWebView2() && hostBridge) hostBridge.releaseFocus()
})

// Zero's in-app light/dark toggle changed. Make web content follow Zero (not the OS) on BOTH engines:
//  • Electron WebContentsView fallback: nativeTheme.themeSource drives prefers-color-scheme for all
//    Electron-rendered pages. Safe for Zero's own UI, which is class-based (enableSystem={false}), so this
//    only affects the resource webviews.
//  • WebView2 host: relayed to the host process (separate Chromium, unaffected by nativeTheme), which sets
//    PreferredColorScheme + forces prefers-color-scheme via CDP.
ipcMain.on("zero:resource:set-theme", (_e, mode) => {
  const m = mode === "light" ? "light" : "dark"
  try { nativeTheme.themeSource = m } catch {}
  if (useWebView2() && hostBridge) hostBridge.setTheme(m)
})

// PRE-WARM a resource's native view HIDDEN so a later drill-in is an instant reveal (WebView2 only). This is
// just a mount with visible:false at a 1×1 off-screen rect — the host creates the controller + navigates but
// never shows it. The eventual real mount() reveals it via the host's idempotent path.
ipcMain.handle("zero:resource:prewarm", async (_e, args) => {
  if (!useWebView2()) return false
  const { id, url, resourceId, envKey, w, h } = args || {}
  if (!id || !url) return false
  // Defense-in-depth: the host's WebView2 Navigate() throws ArgumentException on a RELATIVE uri,
  // which crashes the pre-warmed controller and poisons the session. The renderer now normalizes
  // via toDesktopUrl, but guard here too so a stale renderer can't crash the host: skip pre-warming
  // anything that isn't an absolute scheme:// url (it'll still load fine on the real, normalized mount).
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return false
  const bridge = await ensureHostBridge()
  if (!bridge) return false
  // MUST match the profile the real mount() will use (webview2Mount) so the warm view is reused
  // instead of re-created: env-keyed by nearest-Space-ancestor, same fallback.
  const profile = envKey ? `env-${envKey}` : `resource-${resourceId || "web"}`
  // Load hidden but at the FULL target size: the host sets the controller's viewport (the page's
  // layout size) from these bounds even while hidden (ApplyBounds assigns _controller.Bounds
  // regardless of visibility), so a full-size prewarm lays the page out at the REAL width during the
  // background load → the eventual reveal is a pure show with NO reflow / responsive-breakpoint
  // re-trigger. (A 1×1 prewarm would lay out at 1px wide and only reflow to full on reveal.)
  const width = Math.max(1, Math.round(w || 1280))
  const height = Math.max(1, Math.round(h || 800))
  bridge.mount({ id, url, profile, rect: { x: 0, y: 0, width, height }, visible: false })
  return true
})

// Discard a pre-warmed-but-never-opened view (frees the browser process). Same as close.
ipcMain.on("zero:resource:discard-prewarm", (_e, id) => {
  if (useWebView2() && hostBridge && id) hostBridge.close(id)
})

ipcMain.on("zero:open-external", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) shell.openExternal(url)
})

// ── Web title fetch (desktop replacement for /api/web-title) ─────────────────
// The static export ships no server, so the renderer can't hit the Next route. Main fetches
// the page's real <title>/og:title via net.fetch (Chromium network stack — no CORS, follows
// redirects) and returns { title } so web Resources still get a human label offline. Mirrors
// the route's extraction; best-effort, always resolves (never rejects).
function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ")
}
function extractPageTitle(html) {
  const og =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i)
  if (og && og[1]) return decodeHtmlEntities(og[1]).trim() || null
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (t && t[1]) return decodeHtmlEntities(t[1].replace(/\s+/g, " ")).trim() || null
  return null
}
ipcMain.handle("zero:web-title", async (_e, url) => {
  // External http(s) only — internal Zero routes have no live server page in the desktop
  // shell (their names come from the curated seed titles instead).
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return { title: null }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await net.fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    })
    if (!res.ok) return { title: null }
    // Cap the body — <title> lives near the top of <head>.
    const text = await res.text()
    return { title: extractPageTitle(text.slice(0, 200_000)) }
  } catch {
    return { title: null }
  } finally {
    clearTimeout(timer)
  }
})

// ── In-app window controls (frameless Windows/Linux) ─────────────────────────
// Act on the window that SENT the event (via its webContents), not the global
// `mainWindow` — with multiple windows open, the min/max/close buttons must control
// their OWN window, not whichever happened to open last.
const senderWindow = (e) => BrowserWindow.fromWebContents(e.sender)
ipcMain.on("zero:win:minimize", (e) => senderWindow(e)?.minimize())
ipcMain.on("zero:win:toggle-maximize", (e) => {
  const win = senderWindow(e)
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.on("zero:win:close", (e) => senderWindow(e)?.close())
ipcMain.handle("zero:win:is-maximized", (e) => !!senderWindow(e)?.isMaximized())

// ── Apply a downloaded update on demand ────────────���─────────────────────────
// Triggered by the in-app "Restart to update" affordance. Only meaningful once an
// update has actually been downloaded (autoUpdater guards this internally); if
// nothing is staged it's a harmless no-op.
//
// Feels near-instant (Figma-like) rather than a frozen 2-minute wait:
//   1. Hide every window IMMEDIATELY so Zero visually vanishes the moment you click
//      (the old flow left the unresponsive window on screen while NSIS churned).
//   2. quitAndInstall(isSilent=TRUE, isForceRunAfter=TRUE): isSilent runs the NSIS
//      installer with NO visible "Installing, please wait…" progress dialog — much
//      faster and unattended; isForceRunAfter relaunches Zero right after so you
//      land back where you were.
let installingUpdate = false
ipcMain.on("zero:update:install", () => {
  if (!app.isPackaged || installingUpdate) return
  installingUpdate = true
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.hide()
    }
    autoUpdater.quitAndInstall(true, true)
  } catch (err) {
    installingUpdate = false
    console.log("[v0] update: quitAndInstall failed", err?.message || err)
  }
})

// ── Context menu over an open website: NATIVE OS menu ─────────────────────────
// Hard-won lesson (v0.3.76→.78): you CANNOT float custom HTML over a native
// `WebContentsView`. The site lives in Chromium's native view tree above the host
// window's DOM; a separate transparent child `BrowserWindow` won't composite over it
// on Windows 11 (v0.3.77), and a sibling overlay `WebContentsView` captures ALL input
// and can lock the window if dismissal misfires (v0.3.78). The ONE mechanism that
// reliably renders above a web view AND manages its own dismissal is the native OS menu
// (`Menu.popup()`), so that's what we use whenever a menu is requested over a site. The
// renderer still uses its OWN styled DOM menu when NO site is open (that path can't be
// occluded), so the only place we trade Zero's look for native chrome is over a website.
//
// The renderer sends the SAME serialisable `MenuItem[]` it feeds the DOM menu; we convert
// it to an Electron template here. Swatches/colour-input/glyphs degrade to plain labels
// (native menus can't draw them); `current` becomes a checkbox; submenus + dividers map
// 1:1. A click sends the chosen action id back via `zero:menu:selected` — the exact same
// contract the DOM menu uses — so the main renderer runs it through `applyEntityMenuAction`
// (or intercepts the view/curation ids) with no other change.

/** Convert a serialised MenuItem[] (from lib/zero/menu-model) into an Electron menu
 *  template. `onPick(id)` is invoked with the chosen leaf action id. */
function toMenuTemplate(items, onPick) {
  const out = []
  for (const it of items || []) {
    if (!it || typeof it !== "object") continue
    if (it.type === "divider") {
      out.push({ type: "separator" })
    } else if (it.type === "submenu") {
      out.push({ label: it.label || "", submenu: toMenuTemplate(it.items, onPick) })
    } else if (it.type === "item") {
      const entry = {
        label: it.label || "",
        click: () => onPick(it.id),
      }
      // `current` → a ticked checkbox (Size/Make/color selection, current sibling, etc.).
      if (it.current) {
        entry.type = "checkbox"
        entry.checked = true
      }
      out.push(entry)
    }
    // `colorInput` (free-text hex/name row) has no native equivalent — omitted over a site;
    // the swatch rows still cover the common colours, and the DOM menu keeps the input.
  }
  return out
}

// Show a native OS context menu built from the renderer's MenuItem[] tree. `x`/`y` are
// CLIENT coords relative to the main window's content area (native popup coords are in the
// same space). Electron renders + dismisses it itself, so there is no overlay window/view
// to leak or lock.
function showMenu({ x, y, items }) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const template = toMenuTemplate(items, (id) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("zero:menu:selected", id)
    }
  })
  if (template.length === 0) return
  const menu = Menu.buildFromTemplate(template)
  const opts = { window: mainWindow }
  if (Number.isFinite(x) && Number.isFinite(y)) {
    opts.x = Math.round(x)
    opts.y = Math.round(y)
  }
  menu.popup(opts)
}

ipcMain.on("zero:menu:open", (_e, payload) => showMenu(payload || {}))

// Legacy overlay IPCs — the old transparent-overlay renderer sent these. The native menu
// needs none of them; kept as no-ops so any older preload/route in flight can't throw.
ipcMain.on("zero:menu:resize", () => {})
ipcMain.on("zero:menu:action", (_e, actionId) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("zero:menu:selected", actionId)
  }
})
ipcMain.on("zero:menu:dismiss", () => {})
