using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace Zero.ResourceHost;

// Win32 helpers for embedding a host-owned child window under Electron's (another process's) window.
// Parenting the WebView2 controller DIRECTLY into Electron's HWND renders it BEHIND Electron's opaque
// Chromium content HWND (v0.2.205 "blank" bug: the view loaded + was positioned at x:0 but was occluded).
// Instead each view gets its own borderless Form, SetParent'd under Electron's HWND and kept at the TOP of
// the sibling z-order so it paints above the page — the same own-window model that made the M1 demo render.
internal static class NativeMethods
{
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    public const int GWL_STYLE = -16;
    public const int WS_CHILD = unchecked((int)0x40000000);
    public const int WS_VISIBLE = unchecked((int)0x10000000);
    public const int WS_CLIPSIBLINGS = unchecked((int)0x04000000);
    public const int WS_POPUP = unchecked((int)0x80000000);
    public const int WS_CAPTION = 0x00C00000;
    public const int WS_THICKFRAME = 0x00040000;

    public static readonly IntPtr HWND_TOP = IntPtr.Zero;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public const uint SWP_HIDEWINDOW = 0x0080;
    public const uint SWP_NOZORDER = 0x0004;

    public const int WM_SETFOCUS = 0x0007;
    public const int WM_MOUSEACTIVATE = 0x0021;
    public const int MA_ACTIVATE = 1;
}

// The container that hosts the WebView2. WebView2 is cross-process, so Win32 keyboard focus is unreliable:
// when the WebView2 relinquishes focus (mid-navigation, a page calling focus(), etc.) it hands focus back to
// THIS parent HWND — and with no handler the keyboard goes dead (symptom: "type a few seconds, then input
// stops"). We intercept WM_SETFOCUS + WM_MOUSEACTIVATE and PostMessage-defer (BeginInvoke) MoveFocus back
// INTO the WebView2 — a self-healing loop. The defer is REQUIRED: calling MoveFocus synchronously inside the
// focus message lets Windows overwrite it right after (per WebView2 hosting guidance).
internal sealed class ContainerForm : Form
{
    // Set by ResourceView once the controller exists; pushes focus into the WebView2.
    public Action? ReseedFocus;
    private bool _reseedQueued;

    private void QueueReseed()
    {
        if (_reseedQueued || ReseedFocus is null || IsDisposed) return;
        _reseedQueued = true;
        try { BeginInvoke(new Action(() => { _reseedQueued = false; ReseedFocus?.Invoke(); })); }
        catch { _reseedQueued = false; }
    }

    protected override void WndProc(ref Message m)
    {
        switch (m.Msg)
        {
            case NativeMethods.WM_MOUSEACTIVATE:
                base.WndProc(ref m);
                m.Result = (IntPtr)NativeMethods.MA_ACTIVATE; // a click activates us + seeds focus into the webview
                Program.Log("container WM_MOUSEACTIVATE -> reseed");
                QueueReseed();
                return;
            case NativeMethods.WM_SETFOCUS:
                base.WndProc(ref m);
                Program.Log("container WM_SETFOCUS -> reseed"); // if this NEVER logs, focus is taken above us
                QueueReseed(); // webview handed focus back to us -> push it straight back in
                return;
        }
        base.WndProc(ref m);
    }
}

// Owns the shared WebView2 environment and the live set of resource views. All methods run on the
// UI thread (commands are marshalled there by Program). Events are emitted via the `_emit` callback.
internal sealed class HostContext
{
    private readonly string _userDataFolder;
    private readonly Action<object> _emit;
    private readonly Dictionary<string, ResourceView> _views = new();
    private CoreWebView2Environment? _env;
    private IntPtr _parentHwnd;

    public HostContext(string userDataFolder, Action<object> emit)
    {
        _userDataFolder = userDataFolder;
        _emit = emit;
    }

    public async Task InitializeAsync(IntPtr parentHwnd)
    {
        _parentHwnd = parentHwnd;
        // One environment, one user-data root. Per-resource isolation is done with PROFILES below.
        _env = await CoreWebView2Environment.CreateAsync(null, _userDataFolder, null);
    }

    // Parse one JSON command line and act on it.
    public void Dispatch(string line)
    {
        using var doc = JsonDocument.Parse(line);
        var root = doc.RootElement;
        string cmd = root.GetProperty("cmd").GetString() ?? "";
        string Id() => root.GetProperty("id").GetString() ?? "";

        switch (cmd)
        {
            case "mount": Mount(Id(), Str(root, "url"), Str(root, "profile"), Rect(root), Bool(root, "visible", true)); break;
            case "setBounds": if (_views.TryGetValue(Id(), out var vb)) vb.SetBounds(Rect(root)); break;
            case "show": if (_views.TryGetValue(Id(), out var vs)) vs.SetVisible(true); break;
            case "hide": if (_views.TryGetValue(Id(), out var vh)) vh.SetVisible(false); break;
            case "park": if (_views.TryGetValue(Id(), out var vp)) vp.SetVisible(false); break; // hide, keep alive
            case "close": Close(Id()); break;
            case "navigate": if (_views.TryGetValue(Id(), out var vn)) vn.Navigate(Str(root, "url")); break;
            case "back": if (_views.TryGetValue(Id(), out var vbk)) vbk.GoBack(); break;
            case "forward": if (_views.TryGetValue(Id(), out var vf)) vf.GoForward(); break;
            case "reload": if (_views.TryGetValue(Id(), out var vr)) vr.Reload(); break;
            case "setZoom": if (_views.TryGetValue(Id(), out var vz)) vz.SetZoom(Dbl(root, "zoom", 1.0)); break;
            case "setParent": Reparent(new IntPtr(root.GetProperty("parentHwnd").GetInt64())); break;
            case "shutdown": Shutdown(); break;
            default: _emit(new { evt = "error", message = $"unknown cmd: {cmd}" }); break;
        }
    }

    private void Mount(string id, string url, string profile, Rectangle rect, bool visible)
    {
        if (_env is null) { _emit(new { evt = "error", message = "env not ready" }); return; }
        // Idempotent re-mount = REVEAL a warm/parked view (mirrors the WebContentsView path): re-apply
        // bounds + show and re-announce mounted, but DON'T reload if the url is unchanged.
        if (_views.TryGetValue(id, out var existing))
        {
            existing.SetBounds(rect);
            existing.SetVisible(visible);
            existing.NavigateIfChanged(url);
            _emit(new { evt = "mounted", id });
            return;
        }

        var view = new ResourceView(id, _emit);
        _views[id] = view;
        // Desired state is set now; the controller applies it once its async creation finishes.
        view.SetBounds(rect);
        view.SetVisible(visible);
        _ = view.CreateAsync(_env, _parentHwnd, profile, url);
    }

    private void Close(string id)
    {
        if (_views.Remove(id, out var v))
        {
            v.Dispose();
            _emit(new { evt = "closed", id });
        }
    }

    private void Reparent(IntPtr parent)
    {
        _parentHwnd = parent;
        foreach (var v in _views.Values) v.Reparent(parent);
    }

    private void Shutdown()
    {
        foreach (var v in _views.Values) v.Dispose();
        _views.Clear();
        Application.Exit();
    }

    // ---- small JSON helpers ----
    private static string Str(JsonElement e, string k) => e.TryGetProperty(k, out var v) ? v.GetString() ?? "" : "";
    private static bool Bool(JsonElement e, string k, bool d) => e.TryGetProperty(k, out var v) ? v.GetBoolean() : d;
    private static double Dbl(JsonElement e, string k, double d) => e.TryGetProperty(k, out var v) ? v.GetDouble() : d;
    private static Rectangle Rect(JsonElement e)
    {
        if (!e.TryGetProperty("rect", out var r)) return Rectangle.Empty;
        int G(string k) => r.TryGetProperty(k, out var v) ? (int)Math.Round(v.GetDouble()) : 0;
        return new Rectangle(G("x"), G("y"), G("w"), G("h"));
    }
}

// One resource surface = one CoreWebView2Controller parented into the host window, floated at a rect.
// Uses a desired-state model so commands that arrive before the controller finishes creating are not lost.
internal sealed class ResourceView : IDisposable
{
    private readonly string _id;
    private readonly Action<object> _emit;
    private CoreWebView2Controller? _controller;
    private CoreWebView2Environment? _env;
    // Host-owned borderless child window that actually hosts the WebView2 (see NativeMethods for why).
    private ContainerForm? _host;
    private IntPtr _parentHwnd;
    // Last state pushed to SetWindowPos, so ApplyBounds can skip no-ops and only raise z-order on reveal.
    private Rectangle _appliedBounds = Rectangle.Empty;
    private bool _appliedShown;
    private bool _hasApplied;

    // desired state (applied when controller becomes ready)
    private Rectangle _bounds;
    private bool _visible = true;
    private double _zoom = 1.0;
    private string? _pendingNavigate;
    private string _profile = "default";
    private bool _disposed;

    public ResourceView(string id, Action<object> emit) { _id = id; _emit = emit; }

    public async Task CreateAsync(CoreWebView2Environment env, IntPtr parentHwnd, string profile, string url)
    {
        _env = env;
        _pendingNavigate = url;
        _profile = SanitizeProfile(profile);
        _parentHwnd = parentHwnd;
        try
        {
            // 1) Host-owned borderless container window. We create + own its HWND (same process as the
            //    controller), so WebView2 renders into it exactly like the M1 demo's own Form did.
            _host = new ContainerForm
            {
                FormBorderStyle = FormBorderStyle.None,
                ShowInTaskbar = false,
                StartPosition = FormStartPosition.Manual,
                Bounds = _bounds.IsEmpty ? new Rectangle(0, 0, 800, 600) : _bounds,
            };
            var hostHandle = _host.Handle; // force creation
            EmbedUnderParent(parentHwnd);

            // 2) Parent the controller into OUR window (client-filling), not Electron's HWND directly.
            //    Creating a SECOND controller on the shared profile can transiently throw ERROR_INVALID_STATE
            //    (0x8007139F) while the profile finishes wiring up (the first resource rendered, the second
            //    failed — see host.log). Microsoft's guidance for this race is a short delay + retry, so we
            //    retry a few times before giving up. We KEEP one shared "resource-web" profile so a single
            //    Google login is shared across all resources (per-site profiles would fragment that).
            const int MaxAttempts = 6;
            const int SharedAttempts = 4; // first N attempts keep the shared profile (race hypothesis)
            const uint E_INVALID_STATE = 0x8007139F;
            CoreWebView2Controller? controller = null;
            for (int attempt = 1; attempt <= MaxAttempts; attempt++)
            {
                // If the shared-profile retries all fail, it's likely a HARD "one live controller per
                // profile" limit rather than a race, so fall back to a per-SITE profile (stable across
                // restarts → login still persists, just isolated to that site) so the resource still renders.
                if (attempt > SharedAttempts) _profile = PerSiteProfile(url);
                var opts = env.CreateCoreWebView2ControllerOptions();
                opts.ProfileName = _profile;
                opts.IsInPrivateModeEnabled = false;
                try
                {
                    controller = await env.CreateCoreWebView2ControllerAsync(hostHandle, opts);
                    break;
                }
                catch (COMException ce) when ((uint)ce.HResult == E_INVALID_STATE && attempt < MaxAttempts && !_disposed)
                {
                    Program.Log($"create attempt {attempt} id={_id} profile={_profile} hit 0x8007139F; retrying after delay");
                    await Task.Delay(120 * attempt); // back off: 120,240,360…
                }
            }
            if (_disposed) { controller?.Close(); return; }
            if (controller is null) throw new InvalidOperationException("controller creation returned null after retries");
            _controller = controller;

            var core = controller.CoreWebView2;
            // Relay context menus to Zero's own native menu instead of the browser default (which shows
            // dead edge:// items like "Import passwords"). M2 will render Zero's menu from these events.
            core.Settings.AreDefaultContextMenusEnabled = false;
            WireEvents(core);

            // Self-healing keyboard focus: whenever our container HWND is clicked or handed focus, push it
            // back into the WebView2 (see ContainerForm). Without this, keyboard input dies after focus
            // drifts back to the parent (the cross-process focus bug on the Google login / Figma fields).
            _host.ReseedFocus = () => { try { Program.Log($"reseed MoveFocus id={_id}"); _controller?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic); } catch (Exception ex) { Program.Log($"reseed FAILED id={_id}: {ex.Message}"); } };
            // Accept focus moves the webview requests (e.g. tabbing) instead of leaving it in limbo.
            controller.MoveFocusRequested += (_, e) => { e.Handled = true; try { _controller?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic); } catch { /* ignore */ } };

            // The controller fills the container; the CONTAINER is what we move/size (see SetBounds).
            controller.Bounds = new Rectangle(Point.Empty, _host.ClientSize);
            controller.IsVisible = true;
            controller.ZoomFactor = _zoom;
            ApplyBounds(); // position + z-order the container to the desired rect

            Program.Log($"controller created id={_id} parent={parentHwnd} bounds={_bounds} visible={_visible} profile={_profile}");
            _emit(new { evt = "mounted", id = _id });
            if (!string.IsNullOrEmpty(_pendingNavigate)) core.Navigate(_pendingNavigate);
        }
        catch (Exception ex)
        {
            Program.Log($"create failed id={_id}: {ex}");
            _emit(new { evt = "error", id = _id, message = "create failed: " + ex.Message });
        }
    }

    // Make the container a WS_CHILD of `parent` (Electron's window) without a frame/activation.
    private void EmbedUnderParent(IntPtr parent)
    {
        if (_host == null) return;
        var h = _host.Handle;
        NativeMethods.SetParent(h, parent);
        int style = NativeMethods.GetWindowLong(h, NativeMethods.GWL_STYLE);
        style &= ~(NativeMethods.WS_POPUP | NativeMethods.WS_CAPTION | NativeMethods.WS_THICKFRAME);
        style |= NativeMethods.WS_CHILD | NativeMethods.WS_CLIPSIBLINGS;
        NativeMethods.SetWindowLong(h, NativeMethods.GWL_STYLE, style);
    }

    // Position + size the container to _bounds. It's raised above Electron's Chromium content HWND ONCE
    // on reveal (hidden->shown); routine move/size keeps the current z-order (SWP_NOZORDER). CRITICAL:
    // re-raising to HWND_TOP on every update was stealing keyboard focus from the WebView2 mid-typing —
    // the renderer floods setBounds (per-second ticks + crumb animation), and each z-order raise let
    // Chromium reclaim focus (symptom: "type for a few seconds, then input stops"). Also dedupes no-ops.
    private void ApplyBounds()
    {
        if (_host == null) return;
        var h = _host.Handle;
        bool show = _visible && _bounds.X > -10000 && _bounds.Width > 0 && _bounds.Height > 0;

        // Skip if nothing changed since the last apply (kills the redundant per-tick SetWindowPos flood).
        if (_hasApplied && show == _appliedShown && _bounds == _appliedBounds) return;

        // Raise to the top of the sibling z-order ONLY on a genuine hidden->shown reveal. Otherwise keep
        // the current z-order so we never reorder the child window out from under keyboard focus.
        bool raise = show && (!_hasApplied || !_appliedShown);
        uint flags = NativeMethods.SWP_NOACTIVATE
            | (raise ? 0u : NativeMethods.SWP_NOZORDER)
            | (show ? NativeMethods.SWP_SHOWWINDOW : NativeMethods.SWP_HIDEWINDOW);
        NativeMethods.SetWindowPos(h, NativeMethods.HWND_TOP, _bounds.X, _bounds.Y, Math.Max(1, _bounds.Width), Math.Max(1, _bounds.Height), flags);
        if (_controller != null) _controller.Bounds = new Rectangle(0, 0, Math.Max(1, _bounds.Width), Math.Max(1, _bounds.Height));

        _appliedBounds = _bounds;
        _appliedShown = show;
        _hasApplied = true;
    }

    private void WireEvents(CoreWebView2 core)
    {
        core.DocumentTitleChanged += (_, _) => _emit(new { evt = "title", id = _id, title = core.DocumentTitle });
        core.SourceChanged += (_, _) => _emit(new { evt = "url", id = _id, url = core.Source });
        core.HistoryChanged += (_, _) => _emit(new { evt = "navState", id = _id, canGoBack = core.CanGoBack, canGoForward = core.CanGoForward });
        core.FaviconChanged += (_, _) => _emit(new { evt = "favicon", id = _id, url = core.FaviconUri });
        core.NavigationStarting += (_, e) => _emit(new { evt = "loading", id = _id, loading = true, url = e.Uri });
        core.NavigationCompleted += (_, e) => { Program.Log($"navDone id={_id} ok={e.IsSuccess} status={e.HttpStatusCode} err={e.WebErrorStatus}"); _emit(new { evt = "loading", id = _id, loading = false, ok = e.IsSuccess }); };
        core.DownloadStarting += (_, e) => _emit(new { evt = "download", id = _id, url = e.DownloadOperation.Uri, path = e.ResultFilePath });
        core.ContextMenuRequested += OnContextMenu;
        core.NewWindowRequested += OnNewWindow;
    }

    private void OnContextMenu(object? sender, CoreWebView2ContextMenuRequestedEventArgs e)
    {
        // Suppress the default menu and hand Zero the target info; M2 shows the native menu + sends the action back.
        e.Handled = true;
        var t = e.ContextMenuTarget;
        _emit(new
        {
            evt = "contextMenu",
            id = _id,
            x = e.Location.X,
            y = e.Location.Y,
            selectionText = t.SelectionText,
            linkUri = t.HasLinkUri ? t.LinkUri : null,
            srcUri = t.HasSourceUri ? t.SourceUri : null,
            kind = t.Kind.ToString()
        });
    }

    private void OnNewWindow(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        // OAuth popups (e.g. Figma "Continue with Google"): open a child window hosting a controller in
        // the SAME environment + profile so it shares the login session and postMessage reaches the opener.
        if (_env is null) return;
        var deferral = e.GetDeferral();
        _emit(new { evt = "newWindow", id = _id, url = e.Uri });
        _ = PopupWindow.OpenAsync(_env, _profile, e, deferral);
    }

    // ---- commands (safe before controller ready via desired-state) ----
    // Bounds/visibility drive the host CONTAINER window (positioned + z-ordered), not the controller
    // directly — the controller always fills the container.
    public void SetBounds(Rectangle r) { _bounds = r; if (_host != null) ApplyBounds(); }
    public void SetVisible(bool v) { _visible = v; if (_host != null) ApplyBounds(); }
    public void SetZoom(double z) { _zoom = z; if (_controller != null) _controller.ZoomFactor = z; }
    public void Navigate(string url) { _pendingNavigate = url; _controller?.CoreWebView2.Navigate(url); }
    // Re-mount reveal: only (re)navigate if the target actually changed, so revealing a warm tab does
    // not reload it. Compares against the last requested/loaded url.
    public void NavigateIfChanged(string url)
    {
        if (string.IsNullOrEmpty(url)) return;
        var current = _controller?.CoreWebView2?.Source;
        if (url == _pendingNavigate || url == current) return;
        Navigate(url);
    }
    public void GoBack() { if (_controller?.CoreWebView2.CanGoBack == true) _controller.CoreWebView2.GoBack(); }
    public void GoForward() { if (_controller?.CoreWebView2.CanGoForward == true) _controller.CoreWebView2.GoForward(); }
    public void Reload() => _controller?.CoreWebView2.Reload();
    // Reparent the CONTAINER under a new Electron window (the controller stays parented to the container).
    public void Reparent(IntPtr parent)
    {
        _parentHwnd = parent;
        if (_host != null) { EmbedUnderParent(parent); ApplyBounds(); }
    }

    public void Dispose()
    {
        _disposed = true;
        try { _controller?.Close(); } catch { /* ignore */ }
        _controller = null;
        try { _host?.Dispose(); } catch { /* ignore */ }
        _host = null;
    }

    private static string SanitizeProfile(string profile)
    {
        if (string.IsNullOrWhiteSpace(profile)) return "default";
        // WebView2 ProfileName: ^[A-Za-z0-9][A-Za-z0-9 .\-_]*$ , max 64 chars.
        var cleaned = Regex.Replace(profile, @"[^A-Za-z0-9 .\-_]", "-");
        if (cleaned.Length == 0 || !char.IsLetterOrDigit(cleaned[0])) cleaned = "p" + cleaned;
        return cleaned.Length > 64 ? cleaned.Substring(0, 64) : cleaned;
    }

    // Stable-per-site profile name (fallback when the shared profile can't host a 2nd live controller).
    // Derived from the host so it persists across restarts and is unique per site.
    private static string PerSiteProfile(string url)
    {
        string host;
        try { host = new Uri(url).Host; } catch { host = "site"; }
        if (host.StartsWith("www.")) host = host.Substring(4);
        return SanitizeProfile("site-" + host);
    }
}
