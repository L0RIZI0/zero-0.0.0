// ---------------------------------------------------------------------------
// Zero shell-host `window.zero` shim (injected at document-created time by ZeroShim.cs).
//
// This is the WebView2 stand-in for the Electron preload (electron/preload.cjs). It reproduces the
// SAME `window.zero` contract (types/zero-desktop.d.ts) so the Next renderer ships UNCHANGED. Transport
// is WebView2's chrome.webview message channel instead of Electron ipcRenderer:
//   • request/response  → postMessage {kind:'invoke', id, channel, args}; host replies {kind:'reply', id}
//   • fire-and-forget   → postMessage {kind:'send', channel, args}
//   • host→renderer evt → {kind:'event', channel, payload}  (maximize/fullscreen; resource/* from M2)
//
// M1 implements the CHEAP, no-content half: win.*, openExternal, locale, appVersion,
// system.getIdleSeconds, webTitle, debugLog(+Path). M2.2 wires resource.* to the in-process composition
// content host (mount/setBounds/park/close/theme + status/navigated/activity events). M4 wires updates.*
// to the Velopack auto-updater (UpdateService.cs). menu.* remains a SAFE stub until M3 so the renderer
// feature-detects it.
// ---------------------------------------------------------------------------
;(() => {
  // Synchronous constants baked in by the host (matches the preload's sendSync reads).
  const BAKED = __ZERO_BAKED__
  const wv = window.chrome && window.chrome.webview
  if (!wv) {
    console.warn("[zero] chrome.webview unavailable — desktop bridge disabled")
    return
  }

  // ── transport ──────────────────────────────────────────────────────────────
  let seq = 0
  const pending = new Map() // id → {resolve, reject}
  const listeners = new Map() // channel → Set<cb>

  function invoke(channel, args) {
    const id = ++seq
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      wv.postMessage({ kind: "invoke", id, channel, args: args ?? null })
    })
  }
  function send(channel, args) {
    wv.postMessage({ kind: "send", channel, args: args ?? null })
  }
  function on(channel, cb) {
    let set = listeners.get(channel)
    if (!set) listeners.set(channel, (set = new Set()))
    set.add(cb)
    return () => set.delete(cb)
  }

  wv.addEventListener("message", (e) => {
    const m = e.data
    if (!m || typeof m !== "object") return
    if (m.kind === "reply") {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.ok) p.resolve(m.result)
      else p.reject(new Error(m.error || "zero bridge error"))
    } else if (m.kind === "event") {
      const set = listeners.get(m.channel)
      if (set) for (const cb of set) { try { cb(m.payload) } catch {} }
    }
  })

  // Track fullscreen locally so Escape only exits when actually fullscreen.
  let isFullscreen = false
  on("win.fullscreen", (v) => { isFullscreen = !!v })

  // ── window.zero (contract-faithful) ─────────────────────────────────────────
  const zero = {
    isDesktop: BAKED.isDesktop,
    platform: BAKED.platform,
    locale: BAKED.locale,
    appVersion: BAKED.appVersion,
    debugLogPath: BAKED.debugLogPath,

    openExternal: (url) => send("open-external", url),
    debugLog: (line) => send("debug-log", line),
    webTitle: (url) => invoke("web-title", url),

    system: {
      getIdleSeconds: () => invoke("system-idle"),
    },

    win: {
      minimize: () => send("win.minimize"),
      toggleMaximize: () => send("win.toggle-maximize"),
      close: () => send("win.close"),
      isMaximized: () => invoke("win.is-maximized"),
      onMaximizeChange: (cb) => on("win.maximized", (v) => cb(!!v)),
      toggleFullScreen: () => send("win.toggle-fullscreen"),
      isFullScreen: () => invoke("win.is-fullscreen"),
      onFullScreenChange: (cb) => on("win.fullscreen", (v) => cb(!!v)),
    },

    // ── M2.2: browsed content, in-process on composition layers (see ResourceHost.cs). ──
    resource: {
      mount: (args) => invoke("resource.mount", args),
      setBounds: (args) => send("resource.set-bounds", args),
      park: (id) => send("resource.park", id),
      close: (id) => send("resource.close", id),
      unmount: (id) => send("resource.unmount", id),
      // Warm pre-warm is M2.3; the host resolves false so the renderer takes the normal cold mount path.
      prewarm: (args) => invoke("resource.prewarm", args),
      discardPrewarm: (id) => send("resource.discard-prewarm", id),
      releaseFocus: () => send("resource.release-focus"),
      setTheme: (mode) => send("resource.set-theme", mode),
      // Downloads→outputs and the context-menu relay are M2.3 (the host doesn't emit these yet).
      onOutput: (cb) => on("resource.output", cb),
      onStatus: (cb) => on("resource.status", cb),
      onNavigated: (cb) => on("resource.navigated", cb),
      onContextMenu: (cb) => on("resource.contextmenu", cb),
      onActivity: (cb) => on("resource.activity", cb),
    },

    // ── M3 anchor: native menu over web content. Stub until content + overlay land. ──
    menu: {
      open: () => {},
      onSelected: () => () => {},
    },

    // ── M4: Velopack auto-update (see UpdateService.cs). The shell downloads + stages silently in the
    //    background and fires `updates.downloaded` when a build is READY (the pill then shows "restart
    //    for vX"); `restartToApply` does a near-instant folder-swap relaunch. onAvailable/onProgress are
    //    wired but unused by the silent flow — kept for feature-detection + future modes. ──
    updates: {
      onAvailable: (cb) => on("updates.available", cb),
      onProgress: (cb) => on("updates.progress", cb),
      onDownloaded: (cb) => on("updates.downloaded", cb),
      onError: (cb) => on("updates.error", cb),
      startDownload: () => send("updates.start-download"),
      restartToApply: () => send("updates.restart-to-apply"),
    },
  }

  Object.defineProperty(window, "zero", { value: zero, writable: false, configurable: false })

  // ── frameless window drag (WebView2 does NOT honor -webkit-app-region) ───────
  // The renderer marks its title bar with data-zero-drag="drag" and opt-out islands (window controls)
  // with data-zero-drag="no-drag" — additive to the existing WebkitAppRegion styles Electron uses.
  // We resolve the nearest marked ancestor (first explicit marker wins; default = no-drag) and, on a
  // primary press over a drag region, ask the host to run a native caption drag. A quick second press
  // toggles maximize (the caption double-click gesture).
  function dragRegionAt(node) {
    for (let el = node; el && el !== document.documentElement; el = el.parentElement) {
      const v = el.dataset ? el.dataset.zeroDrag : null
      if (v === "no-drag") return "no-drag"
      if (v === "drag") return "drag"
    }
    return "no-drag"
  }

  let lastDragDown = 0
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return
      if (dragRegionAt(e.target) !== "drag") return
      const now = Date.now()
      if (now - lastDragDown < 300) {
        lastDragDown = 0
        send("win.toggle-maximize")
        e.preventDefault()
        return
      }
      lastDragDown = now
      send("win.drag-start")
    },
    true,
  )

  // Keyboard fullscreen parity with the old shell: F11 toggles, Escape exits.
  document.addEventListener("keydown", (e) => {
    if (e.key === "F11") {
      e.preventDefault()
      send("win.toggle-fullscreen")
    } else if (e.key === "Escape" && isFullscreen) {
      send("win.toggle-fullscreen")
    }
  })
})()
