// ─────────────────────────────────────────────────────────────────────────────
// Hide the Windows 11 window border on our FRAMELESS window.
//
// A `frame: false` BrowserWindow on Windows 11 still gets a 1px border drawn by the
// Desktop Window Manager (DWM). Its color follows the OS "accent color on title bars
// and window borders" setting, so with a light theme it reads as a white/gray hairline
// framing our near-black canvas (the thing the user noticed).
//
// Windows 11 (build 22000+) lets an app override that border via the DWM attribute
// DWMWA_BORDER_COLOR. Setting it to the special value DWMWA_COLOR_NONE removes the
// border entirely. Electron has no JS API for this, so we make the native call through
// koffi (a prebuilt FFI — no node-gyp / compiler needed; the win32 binary is pulled in
// as an optional dep and bundled by electron-builder).
//
// EVERYTHING here is best-effort and wrapped so a failure NEVER crashes the app: on
// older Windows, a koffi load failure, or any non-win32 platform we simply no-op and
// leave the OS default border in place.
// ─────────────────────────────────────────────────────────────────────────────

// DWM window attribute + sentinel color (dwmapi.h).
const DWMWA_BORDER_COLOR = 34
const DWMWA_COLOR_NONE = 0xfffffffe // "no border" sentinel

/** Cached FFI binding: undefined = not yet tried, null = unavailable. */
let dwmSetWindowAttribute

function loadBinding() {
  if (dwmSetWindowAttribute !== undefined) return dwmSetWindowAttribute
  try {
    // Lazy require so non-Windows builds never touch koffi at all.
    const koffi = require("koffi")
    const dwmapi = koffi.load("dwmapi.dll")
    // HRESULT DwmSetWindowAttribute(HWND, DWORD attr, LPCVOID pvAttribute, DWORD cb)
    dwmSetWindowAttribute = dwmapi.func("__stdcall", "DwmSetWindowAttribute", "int", [
      "void *", // HWND
      "uint", // dwAttribute
      "void *", // pvAttribute
      "uint", // cbAttribute
    ])
  } catch (err) {
    console.log("[v0] win-border: koffi/dwmapi unavailable, leaving default border:", err?.message)
    dwmSetWindowAttribute = null
  }
  return dwmSetWindowAttribute
}

/**
 * Read the native HWND out of the buffer Electron hands us as a raw address
 * (BigInt), which koffi accepts directly for a `void *` parameter. 8 bytes on x64,
 * 4 bytes on ia32.
 */
function hwndAddress(win) {
  const buf = win.getNativeWindowHandle()
  return buf.length === 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))
}

/**
 * Remove the DWM border on `win` (Windows 11 only). Safe to call on any platform /
 * OS version — it no-ops if the attribute isn't supported.
 */
function hideWindowsBorder(win) {
  if (process.platform !== "win32" || !win || win.isDestroyed()) return
  const fn = loadBinding()
  if (!fn) return
  try {
    // DWORD (4 bytes, little-endian) holding the COLOR_NONE sentinel.
    const color = Buffer.alloc(4)
    color.writeUInt32LE(DWMWA_COLOR_NONE, 0)
    fn(hwndAddress(win), DWMWA_BORDER_COLOR, color, 4)
  } catch (err) {
    console.log("[v0] win-border: DwmSetWindowAttribute failed:", err?.message)
  }
}

module.exports = { hideWindowsBorder }
