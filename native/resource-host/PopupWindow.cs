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
        CoreWebView2Deferral deferral)
    {
        var win = new PopupWindow();
        try
        {
            win.Show();

            var opts = env.CreateCoreWebView2ControllerOptions();
            opts.ProfileName = profile;           // share the opener's persistent login profile
            opts.IsInPrivateModeEnabled = false;

            var controller = await env.CreateCoreWebView2ControllerAsync(win.Handle, opts);
            win._controller = controller;
            controller.Bounds = new System.Drawing.Rectangle(0, 0, win.ClientSize.Width, win.ClientSize.Height);

            var core = controller.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;

            // Hand the created window back to WebView2 so it wires opener/postMessage correctly.
            e.NewWindow = core;

            // Mirror the real title; let the page close its own popup (OAuth calls window.close()).
            core.DocumentTitleChanged += (_, _) => win.Text = string.IsNullOrEmpty(core.DocumentTitle) ? "Zero" : core.DocumentTitle;
            core.WindowCloseRequested += (_, _) => win.Close();

            // Keep the controller sized to the window.
            win.Resize += (_, _) =>
            {
                if (win._controller != null)
                    win._controller.Bounds = new System.Drawing.Rectangle(0, 0, win.ClientSize.Width, win.ClientSize.Height);
            };
            win.FormClosed += (_, _) => { try { win._controller?.Close(); } catch { } win._controller = null; };
        }
        catch
        {
            // If we fail to create the popup controller, fall back to letting WebView2 handle it.
            try { win.Close(); } catch { }
        }
        finally
        {
            deferral.Complete();
        }
    }
}
