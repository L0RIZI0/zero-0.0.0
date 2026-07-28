// Types for the Electron preload bridge exposed at `window.zero` (see
// electron/preload.cjs). In the web build `window.zero` is undefined, so always
// feature-detect: `if (window.zero?.isDesktop) { …native path… }`.

export interface ZeroResourceMountArgs {
  id: string
  url: string
  resourceId?: string
  /** Environment key = identity of the isolated cookie jar / login this resource uses (the
   *  nearest Space ancestor's id, else root). Same key ⇒ shared login across a Space's
   *  resources; different key ⇒ isolated login. Keys the host's WebView2 env folder + profile. */
  envKey?: string
  rect: { x: number; y: number; width: number; height: number }
  }

export interface ZeroDesktopBridge {
  isDesktop: true
  platform: NodeJS.Platform
  /** OS date/time format locale (e.g. "en-FR"), or null. Passed to toLocale* calls
   *  so formatting honors the device region / 24h settings (Electron's V8 otherwise
   *  defaults Intl to en-US). */
  locale: string | null
  /** The REAL running build version (`app.getVersion()`, e.g. "0.2.196"), or null. The
   *  header prefers this over the web `ZERO_VERSION` constant so it can't drift. */
  appVersion: string | null
  resource: {
    mount: (args: ZeroResourceMountArgs) => Promise<void>
    setBounds: (args: { id: string; rect: ZeroResourceMountArgs["rect"] }) => void
    /** Drill away: park the view (hidden + throttled, kept warm for instant re-open). */
    park: (id: string) => void
    /** Explicit close (header ×): destroy the view for good, ignoring the warm cap. */
    close: (id: string) => void
    /** Legacy teardown alias; main now treats it as park. Prefer park()/close(). */
    unmount: (id: string) => void
    /** Pre-warm a resource's native view hidden (create + load off-screen) so a later drill-in reveals a
     *  warm view instead of paying the cold controller-create latency. No-op on web. */
    prewarm: (args: { id: string; url: string; resourceId?: string; envKey?: string; w?: number; h?: number }) => Promise<boolean>
    /** Discard a pre-warmed-but-never-opened view to bound memory. */
    discardPrewarm: (id: string) => void
    /** Hand keyboard focus back to Zero's own UI when a Zero input is focused while a webview is displayed
     *  above it (the webview is a separate process, so focus must be handed back explicitly). No-op on web. */
    releaseFocus: () => void
    /** Tell the native web host which color scheme Zero's in-app light/dark toggle is on, so web content's
     *  default right-click menu (and prefers-color-scheme) matches Zero instead of following the OS. Applies
     *  to all live views + any mounted later. No-op on web. */
    setTheme: (mode: "dark" | "light") => void
    onOutput: (cb: (payload: { id: string; name: string; dataUrl: string }) => void) => () => void
    onStatus: (cb: (payload: { id: string; ok: boolean; detail?: string }) => void) => () => void
    onNavigated: (cb: (payload: { id: string; url: string }) => void) => () => void
    onContextMenu: (cb: (payload: { id: string; x: number; y: number }) => void) => () => void
  }
  menu: {
    open: (payload: { x: number; y: number; items: import("@/lib/zero/menu-model").MenuItem[] }) => void
    onSelected: (cb: (actionId: string) => void) => () => void
  }
  openExternal: (url: string) => void
  /** Fetch a web page's real <title>/og:title from the MAIN process (no CORS, no server) —
   *  the desktop replacement for the /api/web-title route the static export can't ship.
   *  Resolves to { title } (null when it can't be read). External http(s) URLs only. */
  webTitle: (url: string) => Promise<{ title: string | null }>
  updates: {
    onAvailable: (cb: (payload: { version?: string }) => void) => () => void
    onProgress: (cb: (payload: { percent: number }) => void) => () => void
    onDownloaded: (cb: (payload: { version?: string }) => void) => () => void
    onError: (cb: (payload: { message?: string }) => void) => () => void
    startDownload: () => void
    restartToApply: () => void
  }
  win: {
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximizeChange: (cb: (maximized: boolean) => void) => () => void
  }
}

export interface ZeroMenuShowPayload {
  items: import("@/lib/zero/menu-model").MenuItem[]
  /** Click coords in CSS px relative to the window content area; the overlay renderer
   *  positions the menu card here (then clamps it on-screen). */
  x?: number
  y?: number
}

export interface ZeroMenuBridge {
  onShow: (cb: (payload: ZeroMenuShowPayload) => void) => () => void
  action: (actionId: string) => void
  dismiss: () => void
  resize: (size: { width: number; height: number; anchorOffsetX?: number; anchorOffsetY?: number }) => void
}

declare global {
  interface Window {
    /** Present only inside the Zero desktop (Electron) app. */
    zero?: ZeroDesktopBridge
    /** Present only inside the branded context-menu overlay window. */
    zeroMenu?: ZeroMenuBridge
  }
}

export {}
