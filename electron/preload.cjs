// Zero — Electron preload (CommonJS). The ONLY bridge between the sandboxed
// renderer (the Next.js app) and the main process. Runs with contextIsolation,
// so it exposes a tiny, explicit API on `window.zero` via contextBridge — never
// the raw ipcRenderer or Node built-ins.

const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("zero", {
  /** True inside the desktop app — lets the web code branch (e.g. ResourceCanvas
   *  swaps its <iframe> for a native WebContentsView when this is set). */
  isDesktop: true,
  platform: process.platform,

  /** The OS date/time FORMAT locale (e.g. "en-FR"), resolved in main from the
   *  system language + region country code. Electron's V8 defaults Intl to en-US
   *  regardless of OS, so the renderer passes THIS to every toLocale* call to honor
   *  the device's region / 24h settings. Null if it couldn't be resolved. */
  locale: (() => {
    try {
      return ipcRenderer.sendSync("zero:locale")
    } catch {
      return null
    }
  })(),

  // ── STEP 2 anchor: native resource host ──────────────────────────────────
  // These are the calls ResourceCanvas will use once the native view lands in
  // main. They are safe no-op-ish stubs today (main doesn't handle them yet), so
  // the web app can feature-detect and keep using the iframe until then.
  resource: {
    /** Ask main to mount a native web view for a resource task at a screen rect. */
    mount: (args) => ipcRenderer.invoke("zero:resource:mount", args),
    /** Stream the placeholder's new rect (on resize/scroll) so the view tracks it. */
    setBounds: (args) => ipcRenderer.send("zero:resource:set-bounds", args),
    /** Drill AWAY: park the view (hidden + throttled, kept warm for instant re-open). */
    park: (id) => ipcRenderer.send("zero:resource:park", id),
    /** Explicit CLOSE (header × button): destroy the view for good, ignoring the cap. */
    close: (id) => ipcRenderer.send("zero:resource:close", id),
    /** Legacy teardown alias; main now treats it as PARK. Prefer park()/close(). */
    unmount: (id) => ipcRenderer.send("zero:resource:unmount", id),
    /** Subscribe to outputs the resource produces (exports/downloads) → Outputs. */
    onOutput: (cb) => {
      const handler = (_e, payload) => cb(payload)
      ipcRenderer.on("zero:resource:output", handler)
      return () => ipcRenderer.removeListener("zero:resource:output", handler)
    },
    /** Load status per task: { id, ok, detail } — drives snap-in vs error overlay. */
    onStatus: (cb) => {
      const handler = (_e, payload) => cb(payload)
      ipcRenderer.on("zero:resource:status", handler)
      return () => ipcRenderer.removeListener("zero:resource:status", handler)
    },
    /** Main-frame URL changes per task: { id, url } — lets the renderer persist the
     *  last-visited page so reopening a closed resource resumes where you left off. */
    onNavigated: (cb) => {
      const handler = (_e, payload) => cb(payload)
      ipcRenderer.on("zero:resource:navigated", handler)
      return () => ipcRenderer.removeListener("zero:resource:navigated", handler)
    },
    /** A right-click landed INSIDE the native web view (the DOM never sees it). Main
     *  reports { id, x, y } in main-window CLIENT coords so the renderer can build the
     *  entity menu for that resource and draw it via the overlay. */
    onContextMenu: (cb) => {
      const handler = (_e, payload) => cb(payload)
      ipcRenderer.on("zero:resource:contextmenu", handler)
      return () => ipcRenderer.removeListener("zero:resource:contextmenu", handler)
    },
  },

  /** Context menu over an open website → a NATIVE OS menu (`Menu.popup()` in main). You
   *  cannot float custom HTML over a native WebContentsView, so over a site we hand main a
   *  generic MenuItem tree + a client-space anchor and it pops a native menu, echoing the
   *  chosen action id back via `onSelected`. Used only when a web Resource is open;
   *  otherwise the renderer draws its own styled in-DOM menu. */
  menu: {
    /** Pop a native menu at { x, y } (client coords) from { items }. */
    open: (payload) => ipcRenderer.send("zero:menu:open", payload),
    /** The chosen action id (or a "sibling:<id>" / "crumb:<id>" nav id). */
    onSelected: (cb) => {
      const handler = (_e, actionId) => cb(actionId)
      ipcRenderer.on("zero:menu:selected", handler)
      return () => ipcRenderer.removeListener("zero:menu:selected", handler)
    },
  },
  /** Open a URL in the user's real external browser (graceful fallback). */
  openExternal: (url) => ipcRenderer.send("zero:open-external", url),

  /** MANUAL background-update lifecycle (see setupAutoUpdate in main.cjs). A newer build
   *  is ANNOUNCED (onAvailable) but NOT fetched until you call startDownload(); progress
   *  streams via onProgress, completion via onDownloaded, then restartToApply() applies it. */
  updates: {
    /** A newer version is available to download (not yet fetched). cb({ version }). */
    onAvailable: (cb) => {
      const handler = (_e, payload) => cb(payload)
      ipcRenderer.on("zero:update:available", handler)
      return () => ipcRenderer.removeListener("zero:update:available", handler)
    },
    /** Download progress. cb({ percent }). */
    onProgress: (cb) => {
      const handler = (_e, payload) => cb(payload)
      ipcRenderer.on("zero:update:progress", handler)
      return () => ipcRenderer.removeListener("zero:update:progress", handler)
    },
    /** Update downloaded and staged; installs on next restart. cb({ version }). */
    onDownloaded: (cb) => {
      const handler = (_e, payload) => cb(payload)
      ipcRenderer.on("zero:update:downloaded", handler)
      return () => ipcRenderer.removeListener("zero:update:downloaded", handler)
    },
    /** A check/download error occurred (best-effort; lets the UI drop back). cb({ message }). */
    onError: (cb) => {
      const handler = (_e, payload) => cb(payload)
      ipcRenderer.on("zero:update:error", handler)
      return () => ipcRenderer.removeListener("zero:update:error", handler)
    },
    /** Begin downloading the available update. No-op if none available or already downloading. */
    startDownload: () => ipcRenderer.send("zero:update:download"),
    /** Quit + install the staged update now, then relaunch. No-op if none staged. */
    restartToApply: () => ipcRenderer.send("zero:update:install"),
  },

  /** Frameless window controls, rendered inside Zero's own header. */
  win: {
    minimize: () => ipcRenderer.send("zero:win:minimize"),
    toggleMaximize: () => ipcRenderer.send("zero:win:toggle-maximize"),
    close: () => ipcRenderer.send("zero:win:close"),
    isMaximized: () => ipcRenderer.invoke("zero:win:is-maximized"),
    /** Subscribe to real maximize-state changes so the icon stays in sync. */
    onMaximizeChange: (cb) => {
      const handler = (_e, value) => cb(!!value)
      ipcRenderer.on("zero:win:maximized", handler)
      return () => ipcRenderer.removeListener("zero:win:maximized", handler)
    },
  },
})
