// Zero — Electron main process (CommonJS so it runs directly, no build step).
//
// STEP 1 of the desktop plan: wrap the EXISTING Zero web app in a native window.
//   • dev  → loads the running `next dev` server at http://localhost:3000
//   • prod → loads the static export from `out/` via a custom `app://` protocol
//
// The native resource host (WebContentsView replacing the <iframe> in
// ResourceCanvas) is STEP 2 and is intentionally not here yet — see the IPC stub
// in preload.cjs and the comments at the bottom of this file for where it slots in.

const { app, BrowserWindow, WebContentsView, protocol, net, shell, session, ipcMain, screen, Menu } = require("electron")
const path = require("node:path")
const { pathToFileURL } = require("node:url")

const isDev = !app.isPackaged
const DEV_URL = process.env.ELECTRON_RENDERER_URL || "http://localhost:3000"

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

// Directory of the Next.js static export (`next build` with output:'export').
const OUT_DIR = path.join(__dirname, "..", "out")

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 880,
    minHeight: 600,
    // Zero draws its OWN chrome (timeline + in-app window controls), so there's no
    // native title bar or menu. On macOS we keep the OS traffic-lights (users
    // expect them top-left) via hiddenInset; on Windows/Linux we go fully
    // frameless and render custom min/max/close in the header.
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : { frame: false }),
    backgroundColor: "#0b0b0c",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Report maximize/unmaximize so the in-app control can swap its restore/maximize
  // icon to match the real window state.
  const sendMaxState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("zero:win:maximized", mainWindow.isMaximized())
    }
  }
  mainWindow.on("maximize", sendMaxState)
  mainWindow.on("unmaximize", sendMaxState)

  // Avoid a white flash: reveal only once the first paint is ready.
  mainWindow.once("ready-to-show", () => mainWindow?.show())

  // Once the app's DOM is up, report the GPU status into its devtools console so the
  // user can confirm whether the acceleration flags above actually engaged.
  mainWindow.webContents.once("did-finish-load", () => logGpuStatus(mainWindow))

  if (isDev) {
    mainWindow.loadURL(DEV_URL)
    mainWindow.webContents.openDevTools({ mode: "detach" })
  } else {
    mainWindow.loadURL("app://local/index.html")
  }

  // External links (and, later, anything that asks to open a new window) go to the
  // user's real browser rather than spawning rogue Electron windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url)
      return { action: "deny" }
    }
    return { action: "deny" }
  })

  mainWindow.on("closed", () => {
    resourceViews.clear()
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // Drop the default application menu (File/Edit/View/Window) on Windows/Linux —
  // Zero is chromeless there. macOS keeps a menu so ⌘Q / ⌘H etc. still work.
  if (process.platform !== "darwin") Menu.setApplicationMenu(null)

  if (!isDev) {
    // Serve the static export. `app://local/<path>` → `<OUT_DIR>/<path>`, with a
    // sane fallback to index.html so client-side routing still resolves.
    protocol.handle("app", (request) => {
      const { pathname } = new URL(request.url)
      let rel = decodeURIComponent(pathname).replace(/^\/+/, "")
      if (rel === "" || rel.endsWith("/")) rel += "index.html"
      let filePath = path.join(OUT_DIR, rel)
      // Guard against path traversal escaping the export dir.
      if (!filePath.startsWith(OUT_DIR)) filePath = path.join(OUT_DIR, "index.html")
      return net.fetch(pathToFileURL(filePath).toString()).catch(() =>
        net.fetch(pathToFileURL(path.join(OUT_DIR, "index.html")).toString()),
      )
    })
  }

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

// ── STEP 2: native resource host ─────────────────────────────────────────────
// Each open RESOURCE TASK gets a real Chromium WebContentsView, loaded as
// top-level content (so X-Frame-Options / frame-ancestors do NOT apply — Figma,
// Notion, Linear, anything loads live). The view is a native layer that floats
// ABOVE the DOM; ResourceCanvas renders a transparent placeholder and streams its
// screen rect here, so the native view tracks the placeholder through scrolls,
// window resizes and the open/close morph.

/** @type {Map<string, import('electron').WebContentsView>} */
const resourceViews = new Map()

/** Partitions whose session has already had its embedding guards stripped. */
const preparedPartitions = new Set()

// A modern Chrome UA. Electron's default UA contains "Electron/…" and the app
// name, which some sites (Google included) treat as an unsupported browser. The
// Chrome version is kept roughly aligned with the bundled Chromium.
const RESOURCE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"

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

  // Send a Chrome-like UA on the request side too (some sites sniff the header,
  // not just navigator.userAgent).
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders["User-Agent"] = RESOURCE_UA
    callback({ requestHeaders: details.requestHeaders })
  })
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

ipcMain.handle("zero:resource:mount", async (_e, args) => {
  if (!mainWindow) return
  const { id, url, resourceId, rect } = args
  console.log(`[v0] resource:mount id=${id} resourceId=${resourceId || "-"} url=${url}`)
  // Already mounted (e.g. re-open): just reposition so work-in-progress survives.
  const existing = resourceViews.get(id)
  if (existing) {
    existing.setBounds(toBounds(rect))
    return
  }

  // Per-resource persistent partition → independent, sticky logins ("subscriptions").
  const partition = `persist:resource:${resourceId || "web"}`
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
  resourceViews.set(id, view)

  // Right-click anywhere in the resource → Zero's own branded context menu, drawn
  // in a transparent overlay window stacked ABOVE this native view (a DOM menu
  // can't paint over a native WebContentsView, so the menu is itself native).
  view.webContents.on("context-menu", (_e2, params) => {
    showResourceMenu({ id, resourceId, url, params })
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
    report(true)
  })
  view.webContents.on("did-finish-load", () => {
    console.log(`[v0] resource:loaded id=${id}`)
    report(true)
  })
  view.webContents.on("did-fail-load", (_e2, code, desc, validatedURL, isMainFrame) => {
    // -3 == ERR_ABORTED, fired for benign client-side redirects; ignore it.
    if (!isMainFrame || code === -3) return
    console.log(`[v0] resource:failed id=${id} code=${code} desc=${desc} url=${validatedURL}`)
    report(false, desc || `error ${code}`)
  })

  try {
    await view.webContents.loadURL(url)
  } catch (err) {
    console.log(`[v0] resource:loadURL threw id=${id} ${err?.message || err}`)
  }
})

ipcMain.on("zero:resource:set-bounds", (_e, { id, rect }) => {
  const view = resourceViews.get(id)
  if (view) view.setBounds(toBounds(rect))
})

ipcMain.on("zero:resource:unmount", (_e, id) => destroyResourceView(id))

ipcMain.on("zero:open-external", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) shell.openExternal(url)
})

// ── In-app window controls (frameless Windows/Linux) ─────────────────────────
ipcMain.on("zero:win:minimize", () => mainWindow?.minimize())
ipcMain.on("zero:win:toggle-maximize", () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.on("zero:win:close", () => mainWindow?.close())
ipcMain.handle("zero:win:is-maximized", () => !!mainWindow?.isMaximized())

// ── Branded context-menu overlay ─────────────────────────────────────────────
// The menu is a transparent, frameless child window (so it floats above the native
// resource views and can show Zero's own themed UI with real rounded corners +
// shadow). It loads the /desktop/context-menu route, receives the right-click
// context, reports its measured size, and dismisses on blur / action / Escape.

/** @type {BrowserWindow | null} */
let menuWin = null
let menuReady = false
// Where the click happened, in screen px; the menu's top-left anchors here.
let menuAnchor = { x: 0, y: 0 }

function menuURL() {
  return isDev ? `${DEV_URL}/desktop/context-menu` : "app://local/desktop/context-menu/"
}

function ensureMenuWin() {
  if (menuWin && !menuWin.isDestroyed()) return menuWin
  menuReady = false
  menuWin = new BrowserWindow({
    parent: mainWindow ?? undefined,
    width: 280,
    height: 380,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false, // we draw our own shadow in CSS so rounded corners read right
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "menu-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  menuWin.setMenuBarVisibility(false)
  menuWin.loadURL(menuURL())
  menuWin.webContents.once("did-finish-load", () => {
    menuReady = true
  })
  // Click outside → lose focus → dismiss.
  menuWin.on("blur", () => hideMenu())
  menuWin.on("closed", () => {
    menuWin = null
    menuReady = false
  })
  return menuWin
}

function hideMenu() {
  if (menuWin && !menuWin.isDestroyed() && menuWin.isVisible()) menuWin.hide()
}

function showResourceMenu({ id, resourceId, url, params }) {
  if (!mainWindow) return
  const view = resourceViews.get(id)
  const win = ensureMenuWin()

  // Translate the click (relative to the resource view's web contents) into screen
  // coordinates: window content origin + the view's offset + the local click point.
  const content = mainWindow.getContentBounds()
  const vb = view ? view.getBounds() : { x: 0, y: 0 }
  menuAnchor = {
    x: Math.round(content.x + vb.x + params.x),
    y: Math.round(content.y + vb.y + params.y),
  }
  win.setPosition(menuAnchor.x, menuAnchor.y)

  const payload = {
    id,
    resourceId: resourceId || "",
    url: url || "",
    pageTitle: params.titleText || "",
    selectionText: params.selectionText || "",
    linkURL: params.linkURL || "",
    srcURL: params.srcURL || "",
    mediaType: params.mediaType || "none",
    isEditable: !!params.isEditable,
  }

  const send = () => win.webContents.send("zero:menu:show", payload)
  if (menuReady) send()
  else win.webContents.once("did-finish-load", send)

  win.showInactive()
  win.focus()
}

// The menu route reports its rendered size (including a transparent margin for the
// shadow); place + size the overlay, clamped to the current display's work area.
ipcMain.on("zero:menu:resize", (_e, { width, height, anchorOffsetX = 0, anchorOffsetY = 0 }) => {
  if (!menuWin || menuWin.isDestroyed()) return
  const w = Math.max(1, Math.ceil(width))
  const h = Math.max(1, Math.ceil(height))
  const disp = screen.getDisplayNearestPoint(menuAnchor)
  const wa = disp.workArea
  let x = menuAnchor.x - Math.round(anchorOffsetX)
  let y = menuAnchor.y - Math.round(anchorOffsetY)
  // Keep fully on-screen; if it would overflow, shift back (and flip up if needed).
  if (x + w > wa.x + wa.width) x = wa.x + wa.width - w
  if (y + h > wa.y + wa.height) y = Math.max(wa.y, menuAnchor.y - h + Math.round(anchorOffsetY))
  x = Math.max(wa.x, x)
  y = Math.max(wa.y, y)
  menuWin.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h })
})

ipcMain.on("zero:menu:action", (_e, actionId) => {
  console.log(`[v0] menu:action ${actionId}`)
  hideMenu()
})

ipcMain.on("zero:menu:dismiss", () => hideMenu())
