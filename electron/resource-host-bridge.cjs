// Zero — WebView2 resource-host bridge (CommonJS, main process only).
//
// Drives the out-of-process WebView2 host (native/resource-host) that renders Zero's third-party
// resource web-views. Electron cannot host a WebView2 control in-process (it's locked to its own
// Chromium), so the resource surface lives in a separate native process whose WebView2 controllers
// are parented INTO Electron's window HWND and floated at the rects the renderer already streams.
//
// This module owns:
//   • spawning/reusing the host (dotnet run in dev, packaged self-contained exe in prod)
//   • the newline-delimited JSON protocol over stdin/stdout
//   • the parent-HWND handshake + DPI scaling (Electron streams DIP rects; WebView2 wants raw px)
//   • per-view bound tracking so host-space context-menu coords map back to main-window client coords
//   • a normalized EventEmitter surface main.cjs forwards onto the existing zero:resource:* channels
//
// It deliberately mirrors the WebContentsView manager's behaviour 1:1 so the renderer contract is
// unchanged. If the host can't start, main.cjs falls back to the WebContentsView path.

const { EventEmitter } = require("events")
const { spawn } = require("child_process")
const readline = require("readline")
const path = require("path")
const fs = require("fs")

/** Read a Win32 HWND out of Electron's getNativeWindowHandle() buffer as a decimal string. */
function hwndToString(buf) {
  // Win64: HWND is a 64-bit pointer, little-endian. Win32 would be 32-bit, but we only target x64.
  try {
    return buf.readBigInt64LE(0).toString()
  } catch {
    // 32-bit fallback
    return String(buf.readInt32LE(0))
  }
}

class ResourceHostBridge extends EventEmitter {
  /**
   * @param {object} opts
   * @param {boolean} opts.isDev
   * @param {string}  opts.appRoot        repo root (dev) — used to locate the csproj
   * @param {string}  opts.resourcesPath  process.resourcesPath (prod) — used to locate the exe
   * @param {string}  opts.userDataFolder where WebView2 profiles persist (per-resource logins)
   */
  constructor(opts) {
    super()
    this.isDev = opts.isDev
    this.appRoot = opts.appRoot
    this.resourcesPath = opts.resourcesPath
    this.userDataFolder = opts.userDataFolder
    /** @type {import('child_process').ChildProcess | null} */
    this.proc = null
    this.ready = false
    this.starting = null
    this.scaleFactor = 1
    /** last DIP bounds per view id, for context-menu coord mapping: {x,y,w,h} */
    this.boundsDip = new Map()
    this._queue = [] // commands buffered until "ready"
    // Packaged builds have no visible console; mirror the host conversation to a file next to the
    // WebView2 profiles so we can diagnose issues from a shipped build.
    try {
      this._logPath = path.join(opts.userDataFolder, "..", "resource-host-bridge.log")
    } catch {
      this._logPath = null
    }
  }

  _log(line) {
    const stamped = `${new Date().toISOString()} ${line}\n`
    if (this._logPath) {
      try {
        fs.appendFileSync(this._logPath, stamped)
      } catch {
        /* logging must never throw */
      }
    }
  }

  /** Resolve how to launch the host. Prod: packaged exe. Dev: `dotnet run` against the csproj. */
  _resolveLaunch() {
    if (!this.isDev) {
      // AssemblyName in ResourceHost.csproj → ZeroResourceHost.exe (self-contained single-file).
      const exe = path.join(this.resourcesPath, "resource-host", "ZeroResourceHost.exe")
      if (!fs.existsSync(exe)) throw new Error(`resource host exe not found at ${exe}`)
      return { cmd: exe, baseArgs: [] }
    }
    const proj = path.join(this.appRoot, "native", "resource-host")
    return {
      cmd: "dotnet",
      // -c Release keeps dev parity with the shipped build; --no-launch-profile avoids console noise.
      baseArgs: ["run", "-c", "Release", "--project", proj, "--"],
    }
  }

  /**
   * Start the host and complete the parent-HWND handshake.
   * @param {Buffer} parentHwndBuffer  mainWindow.getNativeWindowHandle()
   * @param {number} scaleFactor       display scale (DIP → px)
   * @returns {Promise<void>} resolves once the host emits "ready"
   */
  start(parentHwndBuffer, scaleFactor) {
    if (this.starting) return this.starting
    this.scaleFactor = scaleFactor || 1
    const parentHwnd = hwndToString(parentHwndBuffer)

    this.starting = new Promise((resolve, reject) => {
      let launch
      try {
        launch = this._resolveLaunch()
      } catch (err) {
        reject(err)
        return
      }
      const args = [
        ...launch.baseArgs,
        "--ipc",
        `--parent-hwnd=${parentHwnd}`,
        `--user-data=${this.userDataFolder}`,
      ]
      console.log(`[v0] resource-host: spawn ${launch.cmd} ${args.join(" ")}`)

      let proc
      try {
        proc = spawn(launch.cmd, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
      } catch (err) {
        reject(err)
        return
      }
      this.proc = proc

      // Dev launches via `dotnet run`, which may cold-compile on first run — be generous. Prod runs a
      // prebuilt exe and should be quick; if it isn't, fail over to WebContentsView rather than hang.
      const settleMs = this.isDev ? 120000 : 20000
      const settleTimer = setTimeout(() => {
        this._log(`timeout: no ready within ${settleMs}ms`)
        reject(new Error(`resource host did not report ready within ${settleMs}ms`))
      }, settleMs)

      proc.on("error", (err) => {
        clearTimeout(settleTimer)
        console.log(`[v0] resource-host: spawn error ${err?.message || err}`)
        this.ready = false
        reject(err)
      })
      proc.on("exit", (code, signal) => {
        console.log(`[v0] resource-host: exited code=${code} signal=${signal}`)
        this.ready = false
        this.proc = null
        this.emit("host-exit", { code, signal })
      })

      // stderr → log (dotnet build output, host exceptions)
      readline.createInterface({ input: proc.stderr }).on("line", (line) => {
        if (line.trim()) {
          console.log(`[v0] resource-host[err]: ${line}`)
          this._log(`[err] ${line}`)
        }
      })

      // stdout → newline JSON events
      readline.createInterface({ input: proc.stdout }).on("line", (line) => {
        if (!line.trim()) return
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          // dotnet run prints non-JSON build lines before the app starts; ignore them.
          console.log(`[v0] resource-host[out]: ${line}`)
          this._log(`[out] ${line}`)
          return
        }
        this._log(`< ${line}`)
        if (msg.evt === "ready") {
          clearTimeout(settleTimer)
          this.ready = true
          this._flushQueue()
          resolve()
          return
        }
        if (msg.evt === "fatal") {
          // Env init failed (e.g. missing WebView2 runtime). Reject so main.cjs falls back
          // to the WebContentsView path instead of leaving a dead surface.
          clearTimeout(settleTimer)
          console.log(`[v0] resource-host: fatal — ${msg.message}`)
          this._log(`fatal: ${msg.message}`)
          reject(new Error(msg.message || "resource host fatal"))
          return
        }
        this._onEvent(msg)
      })
    })
    return this.starting
  }

  _flushQueue() {
    for (const line of this._queue) this._writeRaw(line)
    this._queue = []
  }

  _writeRaw(line) {
    if (this.proc && this.proc.stdin.writable) {
      this._log(`> ${line}`)
      this.proc.stdin.write(line + "\n")
    }
  }

  _send(obj) {
    const line = JSON.stringify(obj)
    if (this.ready) this._writeRaw(line)
    else this._queue.push(line) // buffered until ready
  }

  /** DIP rect → raw-pixel rect for WebView2 controller Bounds. */
  _toPx(rect) {
    const s = this.scaleFactor || 1
    return {
      x: Math.round((rect.x || 0) * s),
      y: Math.round((rect.y || 0) * s),
      w: Math.round((rect.width != null ? rect.width : rect.w || 0) * s),
      h: Math.round((rect.height != null ? rect.height : rect.h || 0) * s),
    }
  }

  // ---- normalized event fan-out (main.cjs forwards these to the renderer) ----
  _onEvent(msg) {
    const id = msg.id
    switch (msg.evt) {
      case "mounted":
        this.emit("status", { id, ok: true })
        break
      case "loading":
        if (msg.loading === false) this.emit("status", { id, ok: msg.ok !== false })
        break
      case "url":
        this.emit("navigated", { id, url: msg.url })
        break
      case "download":
        this.emit("output", { id, name: msg.path ? path.basename(msg.path) : "download", path: msg.path, url: msg.url })
        break
      case "contextMenu": {
        // host x/y are raw px in the controller's space; map to main-window client DIP.
        const b = this.boundsDip.get(id) || { x: 0, y: 0 }
        const s = this.scaleFactor || 1
        this.emit("contextmenu", {
          id,
          x: Math.round(b.x + (msg.x || 0) / s),
          y: Math.round(b.y + (msg.y || 0) / s),
          selectionText: msg.selectionText || "",
          linkUri: msg.linkUri || null,
          srcUri: msg.srcUri || null,
          kind: msg.kind || null,
        })
        break
      }
      case "error":
        console.log(`[v0] resource-host: error id=${id || "-"} ${msg.message}`)
        if (id) this.emit("status", { id, ok: false, detail: msg.message })
        break
      case "closed":
        this.boundsDip.delete(id)
        break
      // title/favicon/navState/newWindow: no renderer channel today — ignore.
      default:
        break
    }
  }

  // ---- command API (mirrors the WebContentsView manager) ----
  mount({ id, url, profile, rect, visible = true }) {
    this.boundsDip.set(id, { x: rect.x, y: rect.y, w: rect.width, h: rect.height })
    this._send({ cmd: "mount", id, url, profile, rect: this._toPx(rect), visible })
  }
  setBounds({ id, rect }) {
    this.boundsDip.set(id, { x: rect.x, y: rect.y, w: rect.width, h: rect.height })
    this._send({ cmd: "setBounds", id, rect: this._toPx(rect) })
  }
  park(id) {
    this._send({ cmd: "park", id })
  }
  close(id) {
    this.boundsDip.delete(id)
    this._send({ cmd: "close", id })
  }
  navigate(id, url) {
    this._send({ cmd: "navigate", id, url })
  }
  setScaleFactor(s) {
    this.scaleFactor = s || 1
  }
  setParent(parentHwndBuffer) {
    this._send({ cmd: "setParent", parentHwnd: Number(hwndToString(parentHwndBuffer)) })
  }
  shutdown() {
    try {
      this._send({ cmd: "shutdown" })
    } catch {
      /* ignore */
    }
    // Give it a moment, then hard-kill if still around.
    const proc = this.proc
    setTimeout(() => {
      if (proc && !proc.killed) {
        try {
          proc.kill()
        } catch {
          /* ignore */
        }
      }
    }, 1000)
  }
}

module.exports = { ResourceHostBridge }
