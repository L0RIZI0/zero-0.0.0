using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Windows.UI.Composition;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// M2.2 — browsed content, in-process, composited.
//
// Each resource (a browsed web page shown in Zero's content area) is a WebView2 COMPOSITION controller
// rendered into its own composition layer that sits ABOVE the shell layer — i.e. content-on-top PARITY
// with the shipping Electron model (the native view paints over Zero's DOM placeholder; when the user
// scrolls it away the renderer parks it off-screen). This is deliberately NOT the §0-over-web blend yet;
// that unlock (transparent shell + DOM hole) is the later overlay-redesign milestone.
//
// Going in-process DELETES the whole cross-process apparatus the standalone resource-host needed:
// SetParent/WS_CHILD reparenting, AttachThreadInput queue merging, the ContainerForm + ReseedFocus
// focus pump, ReanchorInput/RaiseToTop sleep recovery, and cross-process DPI double-conversion. Same
// process + same UI thread ⇒ focus is a plain MoveFocus and coordinates share one DPI space.
//
// Input: composition controllers receive NO spatial mouse/wheel automatically (same as the shell), so
// MainForm.ForwardMouse hit-tests the pointer against visible content rects and forwards to the right
// controller; keyboard follows a MoveFocus on click. Events emitted back to the renderer use the
// window.zero.resource.* contract channels: resource.status (drives the reveal), resource.navigated,
// resource.activity. Downloads→outputs, context-menu relay, zoom, force-dark and full theme emulation
// are M2.3.
// ---------------------------------------------------------------------------
internal sealed class ResourceHost
{
    private readonly CompositionHost _comp;
    private readonly IntPtr _hwnd;
    private readonly Action<string, object?> _emit; // (channel, payload) → renderer event
    private readonly Action<string> _log;
    private readonly Dictionary<string, ResourceView> _views = new();

    private CoreWebView2Environment? _env;
    private double _scale;
    private CoreWebView2PreferredColorScheme _scheme = CoreWebView2PreferredColorScheme.Auto;

    public ResourceHost(CompositionHost comp, IntPtr hwnd, double scale, Action<string, object?> emit, Action<string> log)
    {
        _comp = comp;
        _hwnd = hwnd;
        _scale = scale;
        _emit = emit;
        _log = log;
    }

    public IReadOnlyCollection<ResourceView> Views => _views.Values;

    // Content lives in its OWN WebView2 user-data folder, kept separate from the shell profile so browsed
    // sites can never touch Zero's own storage. Per-resource cookie-jar isolation is then a named Profile.
    private async Task<CoreWebView2Environment> EnvAsync()
    {
        if (_env is not null) return _env;
        string userData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Zero", "content-webview2");
        _env = await CoreWebView2Environment.CreateAsync(browserExecutableFolder: null, userDataFolder: userData);
        return _env;
    }

    // Convert a renderer rect (CSS px, client-relative; x=-100000 sentinel = parked off-screen) into a
    // physical-pixel, window-relative rect for the controller, plus a visibility flag. CSS px → physical
    // px is a straight *scale because the shell renders its CSS at RasterizationScale = DeviceDpi/96, so a
    // DOM element at CSS (x,y) sits at physical (x*scale, y*scale) in the window.
    public (Rectangle px, bool visible) ToPx(double x, double y, double w, double h)
    {
        var px = new Rectangle(
            (int)Math.Round(x * _scale), (int)Math.Round(y * _scale),
            (int)Math.Round(w * _scale), (int)Math.Round(h * _scale));
        bool visible = w > 2 && h > 2 && x > -50000;
        return (px, visible);
    }

    public async Task MountAsync(string id, string url, string? envKey, Rectangle boundsPx, bool visible)
    {
        if (_views.TryGetValue(id, out var existing))
        {
            // Warm re-mount (parked tab re-opened): update geometry, (re)navigate only if changed, and
            // RE-EMIT status ok now — NavigationCompleted won't fire again for an already-loaded page, and
            // the renderer subscribed to onStatus before calling mount and waits for that signal to reveal.
            existing.SetBounds(boundsPx, visible);
            existing.NavigateIfChanged(url);
            existing.ReannounceReady();
            return;
        }

        var view = new ResourceView(id, _comp, _hwnd, _scale, _emit, _log);
        _views[id] = view;
        view.SetBounds(boundsPx, visible);     // desired-state; applied when the controller is ready
        view.SetColorScheme(_scheme);
        try
        {
            var env = await EnvAsync();
            await view.CreateAsync(env, ProfileNameFor(envKey), url);
        }
        catch (Exception ex)
        {
            _log($"resource mount failed id={id}: {ex.Message}");
            _emit("resource.status", new { id, ok = false, detail = "mount failed: " + ex.Message });
            _views.Remove(id);
            view.Dispose();
        }
    }

    public void SetBounds(string id, Rectangle boundsPx, bool visible)
    {
        if (_views.TryGetValue(id, out var v)) v.SetBounds(boundsPx, visible);
    }

    // Park = keep the controller warm but hidden (instant re-open). Unmount is a legacy alias for park.
    public void Park(string id)
    {
        if (_views.TryGetValue(id, out var v)) v.Park();
    }

    public void Close(string id)
    {
        if (_views.TryGetValue(id, out var v))
        {
            _views.Remove(id);
            v.Dispose();
        }
    }

    public void SetScale(double scale)
    {
        _scale = scale;
        foreach (var v in _views.Values) v.SetScale(scale);
    }

    public void SetTheme(CoreWebView2PreferredColorScheme scheme)
    {
        _scheme = scheme;
        foreach (var v in _views.Values) v.SetColorScheme(scheme);
    }

    // Topmost VISIBLE content view whose physical-px rect contains the window-client point, else null
    // (⇒ the caller forwards to the shell). One resource is visible at a time in practice, but if several
    // overlap we prefer the last-inserted (drawn frontmost).
    public ResourceView? HitTest(Point clientPx)
    {
        ResourceView? hit = null;
        foreach (var v in _views.Values)
            if (v.IsHitVisible && v.BoundsPx.Contains(clientPx)) hit = v;
        return hit;
    }

    public void DisposeAll()
    {
        foreach (var v in _views.Values) v.Dispose();
        _views.Clear();
    }

    // A WebView2 ProfileName must be 1–64 chars of [A-Za-z0-9._-] starting alphanumeric. The envKey is an
    // entity id (nearest-Space identity); sanitize it into a stable, valid profile so a Space's resources
    // share one cookie jar and different Spaces stay isolated.
    private static string ProfileNameFor(string? envKey)
    {
        if (string.IsNullOrWhiteSpace(envKey)) return "default";
        var sb = new StringBuilder(envKey.Length + 2);
        foreach (var c in envKey)
            sb.Append((char.IsLetterOrDigit(c) || c is '.' or '_' or '-') ? c : '-');
        var s = sb.ToString();
        if (s.Length == 0 || !char.IsLetterOrDigit(s[0])) s = "s" + s;
        if (s.Length > 64) s = s.Substring(0, 64);
        return s;
    }
}

// ---------------------------------------------------------------------------
// A single browsed page: one composition controller on its own frontmost layer. Commands are safe before
// the controller is ready (desired-state buffered, applied on create). Emits the renderer resource.*
// contract events. All members are touched only on the UI thread (the WinForms message pump).
// ---------------------------------------------------------------------------
internal sealed class ResourceView : IDisposable
{
    private readonly string _id;
    private readonly CompositionHost _comp;
    private readonly IntPtr _hwnd;
    private readonly Action<string, object?> _emit;
    private readonly Action<string> _log;

    private ContainerVisual? _layer;
    private CoreWebView2CompositionController? _controller;
    private CoreWebView2? _core;

    private double _scale;
    private Rectangle _boundsPx;
    private bool _visible;
    private string? _pendingNavigate;
    private bool _ready;         // NavigationCompleted succeeded at least once
    private bool _disposed;
    private CoreWebView2PreferredColorScheme _scheme = CoreWebView2PreferredColorScheme.Auto;

    // Serialize controller creation across ALL views: two CreateCoreWebView2*ControllerAsync calls
    // overlapping on one environment throw ERROR_INVALID_STATE (0x8007139F). Kept from the resource-host.
    private static readonly SemaphoreSlim _createGate = new(1, 1);

    public ResourceView(string id, CompositionHost comp, IntPtr hwnd, double scale,
        Action<string, object?> emit, Action<string> log)
    {
        _id = id; _comp = comp; _hwnd = hwnd; _scale = scale; _emit = emit; _log = log;
    }

    public Rectangle BoundsPx => _boundsPx;
    // Eligible to receive forwarded mouse input: mounted, visible, on-screen, with real area.
    public bool IsHitVisible => _controller is not null && _visible
        && _boundsPx.Width > 1 && _boundsPx.Height > 1 && _boundsPx.X > -50000;
    public CoreWebView2CompositionController? Controller => _controller;

    public async Task CreateAsync(CoreWebView2Environment env, string profile, string url)
    {
        _pendingNavigate = url;
        const uint E_INVALID_STATE = 0x8007139F;
        const int MaxAttempts = 4;

        await _createGate.WaitAsync();
        try
        {
            for (int attempt = 1; attempt <= MaxAttempts && !_disposed; attempt++)
            {
                try
                {
                    var opts = env.CreateCoreWebView2ControllerOptions();
                    opts.ProfileName = profile;
                    opts.IsInPrivateModeEnabled = false;
                    _controller = await env.CreateCoreWebView2CompositionControllerAsync(_hwnd, opts);
                    break;
                }
                catch (COMException ce) when (attempt < MaxAttempts && !_disposed)
                {
                    _log($"resource create attempt {attempt} id={_id} hr=0x{(uint)ce.HResult:X8} " +
                        $"invalidState={(uint)ce.HResult == E_INVALID_STATE} msg=\"{ce.Message}\"; retrying");
                    await Task.Delay(150 * attempt);
                }
            }
        }
        finally { _createGate.Release(); }

        if (_disposed) { _controller?.Close(); _controller = null; return; }
        if (_controller is null) throw new InvalidOperationException("controller creation returned null after retries");

        // Frontmost layer ⇒ content paints OVER the shell (content-on-top parity).
        _layer = _comp.AddLayer();
        _controller.RootVisualTarget = _layer;
        _controller.RasterizationScale = _scale;
        _controller.ShouldDetectMonitorScaleChanges = false; // DPI driven from the shell's WM_DPICHANGED

        _core = _controller.CoreWebView2;
        var s = _core.Settings;
        s.AreDefaultContextMenusEnabled = true; // browsed sites keep Edge's Back/Forward/Reload/Copy menu
        s.IsStatusBarEnabled = false;
        s.AreDevToolsEnabled = true;

        // Apply Zero's light/dark choice to scrollbars + default menu (CDP media emulation is M2.3).
        try { _core.Profile.PreferredColorScheme = _scheme; } catch { }

        WireEvents(_core);

        _controller.MoveFocusRequested += (_, e) =>
        {
            e.Handled = true;
            try { _controller?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic); } catch { }
        };

        ApplyBounds();
        if (!string.IsNullOrEmpty(_pendingNavigate)) _core.Navigate(_pendingNavigate);
        _log($"resource controller ready id={_id} profile={profile} bounds={_boundsPx} visible={_visible}");
    }

    private void WireEvents(CoreWebView2 core)
    {
        // status drives the renderer reveal: ok=true once the top document loads, ok=false on failure.
        core.NavigationCompleted += (_, e) =>
        {
            if (e.IsSuccess) { _ready = true; _emit("resource.status", new { id = _id, ok = true }); }
            else _emit("resource.status", new { id = _id, ok = false, detail = e.WebErrorStatus.ToString() });
        };
        // last-visited URL persistence (renderer skips app:// internal routes itself).
        core.SourceChanged += (_, _) => _emit("resource.navigated", new { id = _id, url = core.Source });

        // ACTIVITY (v0.2.307): the Zero DOM sits behind this page, so interaction inside it never reaches
        // Zero's DOM away-resume. A throttled capture-phase listener posts "zero:activity"; relay it up so
        // the renderer can mark the resource's session alive after an away-gap.
        core.WebMessageReceived += (_, e) =>
        {
            try { if (e.TryGetWebMessageAsString() == "zero:activity") _emit("resource.activity", new { id = _id }); }
            catch { }
        };
        try
        {
            _ = core.AddScriptToExecuteOnDocumentCreatedAsync(
                "(function(){var t=0;function p(){var n=Date.now();if(n-t<1000)return;t=n;" +
                "try{window.chrome.webview.postMessage('zero:activity');}catch(e){}}" +
                "window.addEventListener('pointerdown',p,true);" +
                "window.addEventListener('keydown',p,true);" +
                "window.addEventListener('wheel',p,{capture:true,passive:true});})();");
        }
        catch { }
    }

    // ── commands (desired-state safe before the controller exists) ──
    public void SetBounds(Rectangle px, bool visible)
    {
        _boundsPx = px;
        _visible = visible;
        ApplyBounds();
    }

    public void Park()
    {
        _visible = false;
        ApplyBounds();
    }

    public void SetScale(double scale)
    {
        _scale = scale;
        if (_controller is not null)
        {
            try { _controller.RasterizationScale = scale; } catch { }
            ApplyBounds();
        }
    }

    public void SetColorScheme(CoreWebView2PreferredColorScheme scheme)
    {
        _scheme = scheme;
        if (_core is not null) { try { _core.Profile.PreferredColorScheme = scheme; } catch { } }
    }

    public void NavigateIfChanged(string url)
    {
        if (string.IsNullOrEmpty(url)) return;
        if (url == _pendingNavigate || url == _core?.Source) return;
        _pendingNavigate = url;
        _core?.Navigate(url);
    }

    // Re-send status ok for a warm re-mount (already-loaded page won't fire NavigationCompleted again).
    public void ReannounceReady()
    {
        if (_ready) _emit("resource.status", new { id = _id, ok = true });
    }

    private void ApplyBounds()
    {
        if (_controller is null) return;
        try
        {
            bool show = _visible && _boundsPx.Width > 0 && _boundsPx.Height > 0 && _boundsPx.X > -50000;
            _controller.IsVisible = show;
            // Bounds positions AND sizes the content within its full-window layer visual (physical px).
            if (show) _controller.Bounds = _boundsPx;
        }
        catch (Exception ex) { _log($"resource applyBounds failed id={_id}: {ex.Message}"); }
    }

    public void Dispose()
    {
        _disposed = true;
        try { _controller?.Close(); } catch { }
        _controller = null;
        _core = null;
        // Remove our layer from the composition tree.
        try { if (_layer is not null) _comp.RemoveLayer(_layer); } catch { }
        _layer = null;
    }
}
