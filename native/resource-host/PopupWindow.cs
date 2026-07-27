using Microsoft.Web.WebView2.Core;

namespace Zero.ResourceHost;

// A top-level window that hosts a WebView2 controller for a popup (window.open / target=_blank),
// created in the SAME environment + profile as its opener so it shares cookies/login and the
// popup's postMessage can reach the opener window. This is what makes popup-flow OAuth
// (e.g. Figma "Continue with Google") complete IN-APP instead of bouncing to the system browser.
internal sealed class PopupWindow : Form
{
    private CoreWebView2Controller? _controller;

    private PopupWindow()
    {
        Text = "Zero";
        StartPosition = FormStartPosition.CenterScreen;
        Width = 520;
        Height = 640;
    }

    public static async Task OpenAsync(
        CoreWebView2Environment env,
        string profile,
        CoreWebView2NewWindowRequestedEventArgs e,
        CoreWebView2Deferral deferral,
        IntPtr ownerHwnd)
    {
        var uri = e.Uri;
        Program.Log($"popup open BEGIN profile={profile} owner={ownerHwnd} url={uri}");
        var win = new PopupWindow();
        try
        {
            win.Show();
            // Own the popup to the Electron top-level window BEFORE anything else: an owned window always
            // floats above its owner and can't be buried behind it, which is the reliable fix for the popup
            // opening invisibly. Handle exists now that Show() has been called.
            NativeMethods.SetOwner(win.Handle, ownerHwnd);
            NativeMethods.CopyOwnerIcon(win.Handle, ownerHwnd); // use the Zero app icon, not WinForms' default
            BringToFront(win); // + steal foreground so it also gets focus

            var opts = env.CreateCoreWebView2ControllerOptions();
            opts.ProfileName = profile;           // share the opener's persistent login profile
            opts.IsInPrivateModeEnabled = false;

            var controller = await env.CreateCoreWebView2ControllerAsync(win.Handle, opts);
            win._controller = controller;
            // Use the RAW-PIXEL client rect, not WinForms ClientSize (which is logical/DIP under PerMonitorV2).
            // On a >100% display the logical size under-covers the window and the popup renders BLACK.
            var pcr = NativeMethods.PhysicalClientRect(win.Handle, win.ClientSize);
            controller.Bounds = pcr;

            var core = controller.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            Program.Log($"popup controller OK profile={profile} clientLogical={win.ClientSize} boundsPhysical={pcr} url={uri}");

            // Hand the created window back to WebView2 so it wires opener/postMessage correctly. This MUST
            // happen for GIS/OAuth popups (response_mode=form_post) — the popup relays its result to the
            // opener via window.opener.postMessage, which only works when WebView2 owns the opener link.
            e.NewWindow = core;

            // Surface the popup's own navigation + close so a stuck/failed OAuth flow is visible in the log.
            core.NavigationCompleted += (_, ev) =>
                Program.Log($"popup navDone ok={ev.IsSuccess} status={ev.HttpStatusCode} err={ev.WebErrorStatus} url={core.Source}");
            core.DocumentTitleChanged += (_, _) => win.Text = string.IsNullOrEmpty(core.DocumentTitle) ? "Zero" : core.DocumentTitle;
            // Let the page close its own popup (OAuth calls window.close() when it's done).
            core.WindowCloseRequested += (_, _) => { Program.Log($"popup WindowCloseRequested url={core.Source}"); win.Close(); };

            // Keep the controller sized to the window (raw pixels, DPI-correct).
            win.Resize += (_, _) =>
            {
                if (win._controller != null)
                    win._controller.Bounds = NativeMethods.PhysicalClientRect(win.Handle, win.ClientSize);
            };
            win.FormClosed += (_, _) => { Program.Log("popup closed"); try { win._controller?.Close(); } catch { } win._controller = null; };

            // Now that the controller fills it, make sure the window is on top + focused so the user
            // actually sees the account picker (otherwise it opens behind the main app = "nothing happened").
            BringToFront(win);
        }
        catch (Exception ex)
        {
            // If we fail to create the popup controller, log it (was silently swallowed before) and let
            // WebView2 fall back to its default handling.
            Program.Log($"popup FAILED url={uri}: {ex.GetType().Name}: {ex.Message}");
            try { win.Close(); } catch { /* ignore */ }
        }
        finally
        {
            deferral.Complete();
        }
    }

    // Force a top-level window owned by this BACKGROUND helper process to the foreground. A plain
    // Form.Show() (and Form.Activate()) from a non-foreground process lands BEHIND the Electron window
    // because of the Windows foreground lock, which reads to the user as "the button did nothing".
    // v0.2.213 tried a TopMost true->false PULSE, but toggling it back to false in the same synchronous
    // block net-cancels to non-topmost, so the window stayed behind. Fix: keep it TopMost for the whole
    // life of the popup (it's a modal auth dialog — it SHOULD float above until dismissed), and steal the
    // real foreground via AttachThreadInput so it also gets keyboard focus.
    private static void BringToFront(PopupWindow win)
    {
        try
        {
            win.TopMost = true;   // persistent while open — removed implicitly when the window closes
            win.BringToFront();
            win.Activate();
            NativeMethods.ForceForeground(win.Handle); // defeat the foreground lock (background process)
            Program.Log($"popup front state visible={win.Visible} bounds={win.Bounds} " +
                        $"fg={NativeMethods.GetForegroundWindow()} self={win.Handle}");
        }
        catch (Exception ex) { Program.Log($"popup BringToFront failed: {ex.Message}"); }
    }
}
