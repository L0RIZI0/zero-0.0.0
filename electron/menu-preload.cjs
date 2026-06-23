// Preload for the branded context-menu overlay window. Exposes a tiny, locked-down
// bridge the menu route uses to receive its context and report back actions/size.
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("zeroMenu", {
  /** Receive the context for a right-click: { resourceId, url, pageTitle, selectionText, linkURL, srcURL, mediaType, isEditable }. */
  onShow: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on("zero:menu:show", handler)
    return () => ipcRenderer.removeListener("zero:menu:show", handler)
  },
  /** Fire a chosen menu action (mocked for now) and let main dismiss the overlay. */
  action: (actionId) => ipcRenderer.send("zero:menu:action", actionId),
  /** Dismiss without acting (Escape / backdrop). */
  dismiss: () => ipcRenderer.send("zero:menu:dismiss"),
  /** Report the rendered menu's size so main can size+place the overlay window. */
  resize: (size) => ipcRenderer.send("zero:menu:resize", size),
})
