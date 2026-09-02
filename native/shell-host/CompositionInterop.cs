using System;
using System.Runtime.InteropServices;
using Windows.UI.Composition;
using Windows.UI.Composition.Desktop;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// Win32 ↔ Windows.UI.Composition glue needed to composite WebView2 layers into a plain WinForms HWND.
// Two things the desktop composition stack requires that WinForms doesn't give us for free:
//
//   1. A DispatcherQueue on the UI thread BEFORE a Compositor can be constructed. WinForms pumps a
//      classic Win32 message loop, not a DispatcherQueue, so we create one explicitly via
//      CreateDispatcherQueueController (CoreMessaging.dll).
//
//   2. A DesktopWindowTarget that binds a composition visual tree to our HWND. That is obtained through
//      the ICompositorDesktopInterop COM interface on the Compositor, then its Root is set via
//      ICompositionTarget. Both are declared here as raw COM interfaces (the widely-used Win32-Samples
//      pattern) rather than relying on CsWinRT ABI helpers, which are fussy to get right blind.
//
// This whole file exists ONLY because we need real alpha blending between the shell layer and browsed
// content (M2.2+). WebView2 supports transparency exclusively in visual/composition hosting — a plain
// windowed control (M1) cannot be transparent, so the shell had to move onto composition to ever let
// §0 paint over live web. See zero-webview2-migration.md.
// ---------------------------------------------------------------------------
internal static class CompositionInterop
{
    // ── DispatcherQueue (required before `new Compositor()`) ──────────────────
    [StructLayout(LayoutKind.Sequential)]
    private struct DispatcherQueueOptions
    {
        public int dwSize;
        public int threadType;   // DQTYPE_THREAD_CURRENT = 2
        public int apartmentType; // DQTAT_COM_STA = 2
    }

    [DllImport("CoreMessaging.dll")]
    private static extern int CreateDispatcherQueueController(
        DispatcherQueueOptions options,
        [MarshalAs(UnmanagedType.IUnknown)] out object dispatcherQueueController);

    // Keep a strong ref so the controller (and thus the thread's DispatcherQueue) isn't GC'd.
    private static object? _dispatcherQueueController;

    /// Ensure the current (UI) thread has a DispatcherQueue. Idempotent.
    public static void EnsureDispatcherQueue()
    {
        if (_dispatcherQueueController is not null) return;
        if (Windows.System.DispatcherQueue.GetForCurrentThread() is not null) return;

        var options = new DispatcherQueueOptions
        {
            dwSize = Marshal.SizeOf<DispatcherQueueOptions>(),
            threadType = 2,    // DQTYPE_THREAD_CURRENT
            apartmentType = 2, // DQTAT_COM_STA (WinForms UI thread is STA)
        };
        int hr = CreateDispatcherQueueController(options, out _dispatcherQueueController);
        if (hr != 0) throw new InvalidOperationException($"CreateDispatcherQueueController failed hr=0x{hr:X8}");
    }

    // ── Compositor → DesktopWindowTarget interop ──────────────────────────────
    [ComImport]
    [Guid("29E691FA-4567-4DCA-B319-D0F207EB6807")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ICompositorDesktopInterop
    {
        void CreateDesktopWindowTarget(IntPtr hwndTarget, bool isTopmost, out IntPtr result);
    }

    /// Create a DesktopWindowTarget that hosts `compositor`'s visual tree in `hwnd`.
    public static DesktopWindowTarget CreateDesktopWindowTarget(Compositor compositor, IntPtr hwnd, bool isTopmost)
    {
        var interop = (ICompositorDesktopInterop)(object)compositor;
        interop.CreateDesktopWindowTarget(hwnd, isTopmost, out IntPtr raw);
        try
        {
            // Marshal the raw IInspectable into the CsWinRT-projected DesktopWindowTarget. FromAbi does
            // NOT take ownership of the ref, so we Release our copy in the finally.
            return WinRT.MarshalInspectable<DesktopWindowTarget>.FromAbi(raw);
        }
        finally
        {
            if (raw != IntPtr.Zero) Marshal.Release(raw);
        }
    }
}
