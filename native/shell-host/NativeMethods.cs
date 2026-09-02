using System.Runtime.InteropServices;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// Win32 interop for the frameless shell window and OS presence.
//   • Window dragging   — ReleaseCapture + WM_NCLBUTTONDOWN/HTCAPTION (native move, gives Aero snap).
//   • Frameless resize   — WM_NCHITTEST returns edge codes so a borderless form still resizes.
//   • Maximize work-area — WM_GETMINMAXINFO clamps a borderless maximize to the monitor work area so
//                          it doesn't cover the taskbar (the classic frameless "full-bleed" bug).
//   • Idle seconds       — GetLastInputInfo, the exact OS signal Electron's powerMonitor wrapped.
// ---------------------------------------------------------------------------
static class NativeMethods
{
    // ── Window messages ──────────────────────────────────────────────────────
    public const int WM_NCHITTEST = 0x0084;
    public const int WM_NCLBUTTONDOWN = 0x00A1;
    public const int WM_GETMINMAXINFO = 0x0024;

    // ── Hit-test result codes (subset used for frameless move/resize) ─────────
    public const int HTCAPTION = 2;
    public const int HTLEFT = 10;
    public const int HTRIGHT = 11;
    public const int HTTOP = 12;
    public const int HTTOPLEFT = 13;
    public const int HTTOPRIGHT = 14;
    public const int HTBOTTOM = 15;
    public const int HTBOTTOMLEFT = 16;
    public const int HTBOTTOMRIGHT = 17;

    [DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern nint SendMessage(nint hWnd, int msg, nint wParam, nint lParam);

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

    // ── WM_GETMINMAXINFO payload ─────────────────────────────────────────────
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }
}
