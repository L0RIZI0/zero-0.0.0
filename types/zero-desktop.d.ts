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
}

declare global {
  interface Window {
    /** Present only inside the Zero desktop (Electron) app. */
    zero?: ZeroDesktopBridge
  }
}

export {}
