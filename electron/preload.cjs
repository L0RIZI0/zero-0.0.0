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

  // ── STEP 2 anchor: native resource host ──────────────────────────────────
  // These are the calls ResourceCanvas will use once the native view lands in
  // main. They are safe no-op-ish stubs today (main doesn't handle them yet), so
  // the web app can feature-detect and keep using the iframe until then.
  resource: {
    /** Ask main to mount a native web view for a resource task at a screen rect. */
    mount: (args) => ipcRenderer.invoke("zero:resource:mount", args),
    /** Stream the placeholder's new rect (on resize/scroll) so the view tracks it. */
    setBounds: (args) => ipcRenderer.send("zero:resource:set-bounds", args),
    /** Tear the native view down when the task closes/unmounts. */
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
  },
  /** Open a URL in the user's real external browser (graceful fallback). */
  openExternal: (url) => ipcRenderer.send("zero:open-external", url),

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
