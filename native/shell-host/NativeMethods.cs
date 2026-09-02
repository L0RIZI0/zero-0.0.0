using System.Runtime.InteropServices;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// Win32 interop for the custom-chrome shell window and OS presence.
//   • Window dragging   — ReleaseCapture + WM_NCLBUTTONDOWN/HTCAPTION (native move, gives Aero snap).
//   • Custom frame       — WM_NCCALCSIZE reclaims ONLY the caption strip so the title bar disappears
//                          while the native sizing borders remain. That is what gives the window native
//                          resize on all four edges, min/max/close ANIMATIONS, and Aero snap — none of
//                          which a WS_POPUP (FormBorderStyle.None) window has. GetSystemMetrics(SM_CYCAPTION)
//                          is the exact height to reclaim.
//   • Idle seconds       — GetLastInputInfo, the exact OS signal Electron's powerMonitor wrapped.
// ---------------------------------------------------------------------------
static class NativeMethods
{
    // ── Window messages ──────────────────────────────────────────────────────
    public const int WM_NCCALCSIZE = 0x0083;
    public const int WM_NCLBUTTONDOWN = 0x00A1;

    // ── Hit-test result codes ────────────────────────────────────────────────
    public const int HTCAPTION = 2; // used only for the native drag (WM_NCLBUTTONDOWN)

    // ── System metrics ─────────────────────────────────────────────────────────
    public const int SM_CYCAPTION = 4; // title-bar height (the strip we reclaim in WM_NCCALCSIZE)

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern nint SendMessage(nint hWnd, int msg, nint wParam, nint lParam);

    // ── NCCALCSIZE payload (only the first RECT of NCCALCSIZE_PARAMS is needed when wParam=TRUE) ──
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int left; public int top; public int right; public int bottom; }

    // ── Idle time (GetLastInputInfo) ─────────────────────────────────────────
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    /// <summary>Seconds since the last OS-wide input across ALL apps (the reading Electron's
    /// powerMonitor.getSystemIdleTime returned). Returns -1 if unreadable.</summary>
    public static double GetIdleSeconds()
    {
        var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        if (!GetLastInputInfo(ref info)) return -1;
        // Environment.TickCount wraps ~24.9 days; unchecked subtraction stays correct across the wrap.
        uint idleMs = unchecked((uint)Environment.TickCount - info.dwTime);
        return idleMs / 1000.0;
    }
}
