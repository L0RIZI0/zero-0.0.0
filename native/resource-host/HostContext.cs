using System.Drawing;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;

namespace Zero.ResourceHost;

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
        if (_views.ContainsKey(id)) { _views[id].Navigate(url); return; }

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
        try
        {
            var opts = env.CreateCoreWebView2ControllerOptions();
            opts.ProfileName = _profile;
            opts.IsInPrivateModeEnabled = false;

            var controller = await env.CreateCoreWebView2ControllerAsync(parentHwnd, opts);
            if (_disposed) { controller.Close(); return; }
            _controller = controller;

            var core = controller.CoreWebView2;
            // Relay context menus to Zero's own native menu instead of the browser default (which shows
            // dead edge:// items like "Import passwords"). M2 will render Zero's menu from these events.
            core.Settings.AreDefaultContextMenusEnabled = false;
            WireEvents(core);

            // Apply whatever desired state accumulated during the await.
            controller.Bounds = _bounds;
            controller.IsVisible = _visible;
            controller.ZoomFactor = _zoom;

            _emit(new { evt = "mounted", id = _id });
            if (!string.IsNullOrEmpty(_pendingNavigate)) core.Navigate(_pendingNavigate);
        }
        catch (Exception ex)
        {
            _emit(new { evt = "error", id = _id, message = "create failed: " + ex.Message });
        }
    }

    private void WireEvents(CoreWebView2 core)
    {
        core.DocumentTitleChanged += (_, _) => _emit(new { evt = "title", id = _id, title = core.DocumentTitle });
        core.SourceChanged += (_, _) => _emit(new { evt = "url", id = _id, url = core.Source });
        core.HistoryChanged += (_, _) => _emit(new { evt = "navState", id = _id, canGoBack = core.CanGoBack, canGoForward = core.CanGoForward });
        core.FaviconChanged += (_, _) => _emit(new { evt = "favicon", id = _id, url = core.FaviconUri });
        core.NavigationStarting += (_, e) => _emit(new { evt = "loading", id = _id, loading = true, url = e.Uri });
        core.NavigationCompleted += (_, e) => _emit(new { evt = "loading", id = _id, loading = false, ok = e.IsSuccess });
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
    public void SetBounds(Rectangle r) { _bounds = r; if (_controller != null) _controller.Bounds = r; }
    public void SetVisible(bool v) { _visible = v; if (_controller != null) _controller.IsVisible = v; }
    public void SetZoom(double z) { _zoom = z; if (_controller != null) _controller.ZoomFactor = z; }
    public void Navigate(string url) { _pendingNavigate = url; _controller?.CoreWebView2.Navigate(url); }
    public void GoBack() { if (_controller?.CoreWebView2.CanGoBack == true) _controller.CoreWebView2.GoBack(); }
    public void GoForward() { if (_controller?.CoreWebView2.CanGoForward == true) _controller.CoreWebView2.GoForward(); }
    public void Reload() => _controller?.CoreWebView2.Reload();
    public void Reparent(IntPtr parent) { if (_controller != null) _controller.ParentWindow = parent; } // WebView2 supports live reparent

    public void Dispose()
    {
        _disposed = true;
        try { _controller?.Close(); } catch { /* ignore */ }
        _controller = null;
    }

    private static string SanitizeProfile(string profile)
    {
        if (string.IsNullOrWhiteSpace(profile)) return "default";
        // WebView2 ProfileName: ^[A-Za-z0-9][A-Za-z0-9 .\-_]*$ , max 64 chars.
        var cleaned = Regex.Replace(profile, @"[^A-Za-z0-9 .\-_]", "-");
        if (cleaned.Length == 0 || !char.IsLetterOrDigit(cleaned[0])) cleaned = "p" + cleaned;
        return cleaned.Length > 64 ? cleaned.Substring(0, 64) : cleaned;
    }
}
