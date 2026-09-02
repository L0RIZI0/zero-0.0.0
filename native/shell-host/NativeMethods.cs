using System.Runtime.InteropServices;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// Win32 interop for the custom-chrome shell window and OS presence.
//   • Window dragging   — ReleaseCapture + WM_NCLBUTTONDOWN/HTCAPTION (native move, gives Aero snap).
//   • Custom frame       — WM_NCCALCSIZE reclaims the ENTIRE top inset (caption + top sizing-border) so
//                          both the title bar AND the thin DWM top-border line disappear, while the
//                          left/right/bottom sizing borders remain. That is what gives the window native
//                          resize on the sides + bottom + corners, min/max/close ANIMATIONS, and Aero
//                          snap — none of which a WS_POPUP (FormBorderStyle.None) window has.
//   • Idle seconds       — GetLastInputInfo, the exact OS signal Electron's powerMonitor wrapped.
// ---------------------------------------------------------------------------
static class NativeMethods
{
    // ── Window messages ──────────────────────────────────────────────────────
    public const int WM_NCCALCSIZE = 0x0083;
    public const int WM_NCLBUTTONDOWN = 0x00A1;
    public const int WM_SIZE = 0x0005;
    public const int WM_SETFOCUS = 0x0007;
    public const int WM_DPICHANGED = 0x02E0;

    // Mouse messages we forward to the composition controller (visual hosting delivers no spatial input
    // automatically). Client coords are in lParam (loword=x, hiword=y) EXCEPT the wheel messages, whose
    // lParam is in SCREEN coords and must be mapped with PointToClient.
    public const int WM_MOUSEMOVE = 0x0200;
    public const int WM_LBUTTONDOWN = 0x0201;
    public const int WM_LBUTTONUP = 0x0202;
    public const int WM_LBUTTONDBLCLK = 0x0203;
    public const int WM_RBUTTONDOWN = 0x0204;
    public const int WM_RBUTTONUP = 0x0205;
    public const int WM_RBUTTONDBLCLK = 0x0206;
    public const int WM_MBUTTONDOWN = 0x0207;
    public const int WM_MBUTTONUP = 0x0208;
    public const int WM_MBUTTONDBLCLK = 0x0209;
    public const int WM_MOUSEWHEEL = 0x020A;
    public const int WM_MOUSEHWHEEL = 0x020E;
    public const int WM_MOUSELEAVE = 0x02A3;

    // ── Hit-test result codes ────────────────────────────────────────────────
    public const int HTCAPTION = 2; // used only for the native drag (WM_NCLBUTTONDOWN)

    [DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern nint SendMessage(nint hWnd, int msg, nint wParam, nint lParam);

    // TrackMouseEvent so the form receives WM_MOUSELEAVE (needed to forward a Leave to the webview).
    [StructLayout(LayoutKind.Sequential)]
    public struct TRACKMOUSEEVENT
    {
        public uint cbSize;
        public uint dwFlags;
        public nint hwndTrack;
        public uint dwHoverTime;
    }

    public const uint TME_LEAVE = 0x00000002;

    [DllImport("user32.dll")]
    public static extern bool TrackMouseEvent(ref TRACKMOUSEEVENT lpEventTrack);

    // ── lParam / wParam field extraction (signed short, so off-screen coords stay negative) ──
    public static short LoWord(nint v) => unchecked((short)((long)v & 0xFFFF));
    public static short HiWord(nint v) => unchecked((short)(((long)v >> 16) & 0xFFFF));

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
