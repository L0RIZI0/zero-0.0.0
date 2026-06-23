// Zero — Electron main process (CommonJS so it runs directly, no build step).
//
// STEP 1 of the desktop plan: wrap the EXISTING Zero web app in a native window.
//   • dev  → loads the running `next dev` server at http://localhost:3000
//   • prod → loads the static export from `out/` via a custom `app://` protocol
//
// The native resource host (WebContentsView replacing the <iframe> in
// ResourceCanvas) is STEP 2 and is intentionally not here yet — see the IPC stub
// in preload.cjs and the comments at the bottom of this file for where it slots in.

const { app, BrowserWindow, WebContentsView, protocol, net, shell, session, ipcMain } = require("electron")
const path = require("node:path")
const { pathToFileURL } = require("node:url")

const isDev = !app.isPackaged
const DEV_URL = process.env.ELECTRON_RENDERER_URL || "http://localhost:3000"

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
    // Frameless-ish, modern feel; the app draws its own chrome (timeline, etc.).
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0b0b0c",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Avoid a white flash: reveal only once the first paint is ready.
  mainWindow.once("ready-to-show", () => mainWindow?.show())

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
    },
  })
  view.setBackgroundColor("#ffffff")
  view.setBounds(toBounds(rect))
  mainWindow.contentView.addChildView(view)
  resourceViews.set(id, view)

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
