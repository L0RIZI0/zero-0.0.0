using System;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// OAuth / window.open() popup host.
//
// The browsed content view is a COMPOSITION controller — it has no real child HWND, so when a page
// calls window.open() (every OAuth "Sign in with …" flow does), WebView2's default new-window handler
// spawns a top-level window with no owner relationship to the shell. From a composition parent that
// window opens BEHIND the shell and never takes focus — the dogfood bug.
//
// Fix: intercept NewWindowRequested (ResourceView) and host the popup HERE instead — an owned, normal
// top-level Form containing a WINDOWED WebView2 controller. Windowed (not composition) means it gets a
// real HWND, so native input, focus and z-order all work for free. The controller is created from the
// SAME environment + profile as the opener, so the OAuth cookies/session AND the window.opener ⇄ opener
// relationship are shared (a popup on a different profile would log the user out mid-flow). Owned by the
// shell window + SetForegroundWindow ⇒ it always sits above Zero and takes focus; window.close() (which
// OAuth providers call on success) closes it.
//
// Windowed controllers manage their own DPI, so unlike the composition content views this needs no
// manual scale plumbing. All work is on the UI thread (NewWindowRequested + WinForms sync context).
// ---------------------------------------------------------------------------
internal sealed class PopupWindow : Form
{
    private CoreWebView2Controller? _controller;

    private PopupWindow()
    {
        StartPosition = FormStartPosition.Manual;
        FormBorderStyle = FormBorderStyle.Sizable; // a real, resizable browser popup with normal chrome
        ShowInTaskbar = false;
        Text = "Zero";
        BackColor = ColorTranslator.FromHtml("#0b0b0c"); // match the shell bg (no white flash pre-nav)
        Width = 520;
        Height = 640;
    }

    // Build the popup, create its windowed controller (shared env+profile), and hand the fresh
    // CoreWebView2 back to the caller so it can assign e.NewWindow. WebView2 then navigates that core to
    // the requested URL itself (so we deliberately do NOT navigate here). Shown owned by + above the
    // shell. profile == null ⇒ the opener fell back to the default profile (older runtime), so create the
    // popup without options too, matching the opener's cookie jar.
    public static async Task<CoreWebView2> CreateAsync(
        CoreWebView2Environment env, string? profile, IntPtr ownerHwnd,
        CoreWebView2NewWindowRequestedEventArgs e, Action<string> log)
    {
        var form = new PopupWindow();
        ApplyFeatures(form, e.WindowFeatures, ownerHwnd);
        var parent = form.Handle; // realize the HWND before creating the controller into it

        CoreWebView2Controller controller;
        if (profile is null)
        {
            controller = await env.CreateCoreWebView2ControllerAsync(parent);
        }
        else
        {
            var opts = env.CreateCoreWebView2ControllerOptions();
            opts.ProfileName = profile;
            opts.IsInPrivateModeEnabled = false;
            controller = await env.CreateCoreWebView2ControllerAsync(parent, opts);
        }

        form._controller = controller;
        controller.Bounds = new Rectangle(Point.Empty, form.ClientSize);

        var core = controller.CoreWebView2;

        // OAuth providers close the popup via window.close() once the redirect completes.
        core.WindowCloseRequested += (_, _) => { try { form.Close(); } catch { } };

        form.Resize += (_, _) =>
        {
            try { if (form._controller is not null) form._controller.Bounds = new Rectangle(Point.Empty, form.ClientSize); }
            catch { }
        };
        form.FormClosed += (_, _) =>
        {
            try { form._controller?.Close(); } catch { }
            form._controller = null;
        };

        form.Show(new HwndOwner(ownerHwnd)); // owned ⇒ always z-orders above the shell
        try { NativeMethods.SetForegroundWindow(form.Handle); } catch { }
        form.Activate();

        log($"oauth popup opened profile={profile ?? "(default)"} uri={e.Uri}");
        return core;
    }

    // Size/position from the window.open() feature string when the site supplied one, else a sensible
    // default centered on the shell's monitor work area. Clamped so a hostile/typo'd feature string can't
    // produce an unusably tiny or off-screen popup.
    private static void ApplyFeatures(PopupWindow form, CoreWebView2WindowFeatures? f, IntPtr ownerHwnd)
    {
        int w = 520, h = 640;
        if (f is not null && f.HasSize)
        {
            w = Math.Max(360, (int)f.Width);
            h = Math.Max(420, (int)f.Height);
        }
        form.Width = w;
        form.Height = h;

        if (f is not null && f.HasPosition)
        {
            form.Left = (int)f.Left;
            form.Top = (int)f.Top;
        }
        else
        {
            var wa = Screen.FromHandle(ownerHwnd).WorkingArea;
            form.Left = wa.Left + (wa.Width - w) / 2;
            form.Top = wa.Top + (wa.Height - h) / 2;
        }
    }

    // Minimal IWin32Window so Form.Show(owner) can establish the owned relationship from a bare HWND
    // (the shell is addressed by handle inside ResourceView, not as a Form reference).
    private sealed class HwndOwner : IWin32Window
    {
        public HwndOwner(IntPtr h) => Handle = h;
        public IntPtr Handle { get; }
    }
}
