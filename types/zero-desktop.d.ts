// Types for the Electron preload bridge exposed at `window.zero` (see
// electron/preload.cjs). In the web build `window.zero` is undefined, so always
// feature-detect: `if (window.zero?.isDesktop) { …native path… }`.

export interface ZeroResourceMountArgs {
  id: string
  url: string
  resourceId?: string
  rect: { x: number; y: number; width: number; height: number }
}

export interface ZeroDesktopBridge {
  isDesktop: true
  platform: NodeJS.Platform
  resource: {
    mount: (args: ZeroResourceMountArgs) => Promise<void>
    setBounds: (args: { id: string; rect: ZeroResourceMountArgs["rect"] }) => void
    unmount: (id: string) => void
    onOutput: (cb: (payload: { id: string; name: string; dataUrl: string }) => void) => () => void
    onStatus: (cb: (payload: { id: string; ok: boolean; detail?: string }) => void) => () => void
  }
  openExternal: (url: string) => void
  updates: {
    onAvailable: (cb: (payload: { version?: string }) => void) => () => void
    onProgress: (cb: (payload: { percent: number }) => void) => () => void
    onDownloaded: (cb: (payload: { version?: string }) => void) => () => void
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

export interface ZeroMenuContext {
  id: string
  resourceId: string
  url: string
  pageTitle: string
  selectionText: string
  linkURL: string
  srcURL: string
  mediaType: string
  isEditable: boolean
}

export interface ZeroMenuBridge {
  onShow: (cb: (ctx: ZeroMenuContext) => void) => () => void
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
