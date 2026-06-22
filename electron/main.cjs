// Zero — Electron main process (CommonJS so it runs directly, no build step).
//
// STEP 1 of the desktop plan: wrap the EXISTING Zero web app in a native window.
//   • dev  → loads the running `next dev` server at http://localhost:3000
//   • prod → loads the static export from `out/` via a custom `app://` protocol
//
// The native resource host (WebContentsView replacing the <iframe> in
// ResourceCanvas) is STEP 2 and is intentionally not here yet — see the IPC stub
// in preload.cjs and the comments at the bottom of this file for where it slots in.

const { app, BrowserWindow, protocol, net, shell } = require("electron")
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

// ── STEP 2 anchor ───────────────────────────────────────────────────────────
// The native resource host will live here: ipcMain.handle("zero:resource:mount",
// …) creating a WebContentsView per resource task, positioned to match the DOM
// placeholder rect streamed from ResourceCanvas, with a per-resource partitioned
// session (persist:<resourceId>) so logins stick. Tearing down on unmount/close.
// Left as a stub until the shell (this file) is verified running locally.
