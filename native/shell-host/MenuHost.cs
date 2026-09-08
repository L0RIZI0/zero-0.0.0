using System;
using System.Drawing;
using System.Numerics;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Windows.UI.Composition;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// M3 — the branded context-menu overlay, composited ABOVE web content.
//
// Zero draws its menus in its own DOM (the shell layer). That works everywhere EXCEPT over a browsed
// Resource: content sits on a composition layer ABOVE the shell (content-on-top parity, M2.2), so a
// shell-DOM popup is painted UNDER it and gets clipped — the reported "menu crops over web content" bug.
//
// The fix mirrors ResourceHost: a dedicated WebView2 COMPOSITION controller on its OWN layer, kept as the
// FRONTMOST layer so it paints over both the shell AND any content view. It renders the SAME menu the DOM
// path renders — the shared Zero0MenuList, served at https://zero.local/menu — so the two look identical.
//
// The renderer opens it through window.zero.menu.open({ x, y, items }); the leaf pick comes back via
// window.zero.menu.onSelected(cb). Between the shell and this overlay the menu travels as the serialisable
// MenuItem[] (lib/zero/menu-model). Because the overlay is a SEPARATE document it can't share the shell's
// window.zero; MenuHost injects a tiny `window.zeroMenu` bridge on the overlay controller and relays:
//   shell  → MenuHost.Open(x,y,items)  → overlay `zeroMenu.onShow({items,x,y})`
//   overlay `zeroMenu.action(id)`       → MenuHost → shell `menu.onSelected` event
//   overlay `zeroMenu.dismiss()`        → MenuHost hides the layer (no selection)
//   overlay `zeroMenu.resize({w,h})`    → MenuHost sizes+positions the layer to fit the card at (x,y)
//
// Lifecycle: created lazily on the first open (a cold controller create is ~one frame; menus aren't the
// first interaction). The controller is kept warm and just shown/hidden thereafter.
//
// Touched only on the UI thread (the WinForms pump), same as ResourceHost.
// ---------------------------------------------------------------------------
internal sealed class MenuHost
{
    private readonly CompositionHost _comp;
    private readonly IntPtr _hwnd;
    private readonly CoreWebView2Environment _env;   // reuse the SHELL env: the overlay is Zero's own UI
    private readonly string _menuUrl;                // https://zero.local/menu
    private readonly Action<string> _log;
    private readonly Action<string> _onSelected;     // relay a picked action id to the renderer

    private ContainerVisual? _layer;
    private CoreWebView2CompositionController? _controller;
    private CoreWebView2? _core;
    private double _scale;
    private CoreWebView2PreferredColorScheme _scheme = CoreWebView2PreferredColorScheme.Auto;

    // Desired-state for the pending/next open, in physical px (window-relative).
    private Point _anchorPx;          // where the click happened; the card's top-left is clamped from here
    private Rectangle _boundsPx;      // current layer rect (position + measured size)
    private bool _visible;
    private bool _ready;              // overlay document loaded + bridge listening
    private JsonElement? _pendingItems; // items to show once the overlay signals ready

    public MenuHost(CompositionHost comp, IntPtr hwnd, CoreWebView2Environment env, string menuUrl,
        double scale, Action<string> log, Action<string> onSelected)
    {
        _comp = comp; _hwnd = hwnd; _env = env; _menuUrl = menuUrl; _scale = scale;
        _log = log; _onSelected = onSelected;
    }

    // Eligible to receive forwarded mouse input: created, visible, on-screen with real area. MainForm
    // hit-tests this BEFORE content so a menu opened over a Resource still gets the click.
    public bool IsHitVisible => _controller is not null && _visible
        && _boundsPx.Width > 1 && _boundsPx.Height > 1;
    public Rectangle BoundsPx => _boundsPx;
    public CoreWebView2CompositionController? Controller => _controller;
    public IntPtr CurrentCursor => _controller?.Cursor ?? IntPtr.Zero;

    public void SetScale(double scale)
    {
        _scale = scale;
        if (_controller is not null) { try { _controller.RasterizationScale = scale; } catch { } }
        ApplyBounds();
    }

    public void SetTheme(CoreWebView2PreferredColorScheme scheme)
    {
        _scheme = scheme;
        if (_core is not null) { try { _core.Profile.PreferredColorScheme = scheme; } catch { } }
    }

    // Open the menu at CSS (x,y) with a serialisable MenuItem[] (as the raw JsonElement from the message).
    // Creates the controller on first use, then shows + relays items to the overlay.
    public async Task OpenAsync(double xCss, double yCss, JsonElement items)
    {
        _anchorPx = new Point((int)Math.Round(xCss * _scale), (int)Math.Round(yCss * _scale));
        _pendingItems = items.Clone(); // detach from the transient message buffer

        if (_controller is null)
        {
            try { await CreateAsync(); }
            catch (Exception ex) { _log($"menu create failed: {ex.Message}"); return; }
        }

        // Raise to the very top (content layers were added after us on their own mounts) and show. The
        // card size isn't known until the overlay measures + calls Resize; until then keep it invisible to
        // avoid a flash at a stale size. If already ready, push items immediately; else PushPending on load.
        _comp.RaiseToTop(_layer!);
        if (_ready) PushItems();
    }

    private async Task CreateAsync()
    {
        _controller = await _env.CreateCoreWebView2CompositionControllerAsync(_hwnd);
        _core = _controller.CoreWebView2;

        _layer = _comp.AddLayer(); // frontmost at creation; re-raised on each open
        _controller.RootVisualTarget = _layer;
        _controller.RasterizationScale = _scale;
        _controller.ShouldDetectMonitorScaleChanges = false;
        _controller.IsVisible = false;

        var s = _core.Settings;
        s.AreDefaultContextMenusEnabled = false; // no Edge menu inside our own menu
        s.IsStatusBarEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        try { _core.Profile.PreferredColorScheme = _scheme; } catch { }

        // The overlay is a SEPARATE document, so it can't use the shell's window.zero. Inject a minimal
        // window.zeroMenu bridge that matches ZeroMenuBridge (types/zero-desktop.d.ts): onShow receives
        // items pushed from here (as a window event we dispatch via ExecuteScript); action/dismiss/resize
        // post back over this controller's own message channel.
        await _core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript);
        _core.WebMessageReceived += OnOverlayMessage;
        _core.NavigationCompleted += (_, e) =>
        {
            if (!e.IsSuccess) { _log($"menu overlay nav failed: {e.WebErrorStatus}"); return; }
            _ready = true;
            if (_pendingItems is not null) PushItems();
        };

        _core.Navigate(_menuUrl);
    }

    // Push the pending items into the overlay by dispatching a DOM event the bridge listens for. Passing
    // the JSON as an argument avoids string-escaping the payload into the script body.
    private void PushItems()
    {
        if (_core is null || _pendingItems is null) return;
        // { items, x:0, y:0 } — the overlay renders at its own origin; POSITION is applied here via the
        // layer Offset once it reports its measured size, so the overlay doesn't need the anchor.
        var payload = JsonSerializer.Serialize(new { items = _pendingItems, x = 0, y = 0 });
        // The bridge exposes __zeroMenuShow(payload); call it with the JSON parsed in-page.
        var js = $"window.__zeroMenuShow && window.__zeroMenuShow({payload});";
        try { _ = _core.ExecuteScriptAsync(js); } catch (Exception ex) { _log($"menu push failed: {ex.Message}"); }
    }

    private void OnOverlayMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        ZeroMenuMsg? m;
        try { m = JsonSerializer.Deserialize<ZeroMenuMsg>(e.WebMessageAsJson); }
        catch { return; }
        if (m is null) return;

        switch (m.kind)
        {
            case "resize":
                // Size the layer to the measured card and clamp it on-screen from the click anchor.
                SizeAndPlace((int)Math.Round(m.width * _scale), (int)Math.Round(m.height * _scale));
                break;
            case "action":
                if (!string.IsNullOrEmpty(m.id)) { try { _onSelected(m.id!); } catch { } }
                break;
            case "dismiss":
                Hide();
                break;
        }
    }

    // Position the card near the anchor, clamped to the window client area, then reveal.
    private void SizeAndPlace(int wPx, int hPx)
    {
        if (wPx <= 0 || hPx <= 0) return;
        // WinForms ClientSize is already PHYSICAL pixels for a PerMonitorV2 app (as is _anchorPx and the
        // layer rect), so compare directly — no scale conversion. The shell sizes its own controller with
        // ClientSize.Width/Height in exactly these units (see MainForm WM_SIZE), so this matches.
        var client = _comp.Size;
        int maxX = Math.Max(0, client.Width - wPx);
        int maxY = Math.Max(0, client.Height - hPx);
        int x = Math.Min(Math.Max(0, _anchorPx.X), maxX);
        int y = Math.Min(Math.Max(0, _anchorPx.Y), maxY);
        _boundsPx = new Rectangle(x, y, wPx, hPx);
        _visible = true;
        ApplyBounds();
    }

    private void ApplyBounds()
    {
        if (_controller is null || _layer is null) return;
        try
        {
            _controller.IsVisible = _visible && _boundsPx.Width > 0 && _boundsPx.Height > 0;
            if (_controller.IsVisible)
            {
                // Same composition coordinate model as ResourceView: position via the layer Offset, size
                // via the layer Size + controller Bounds at (0,0,w,h). Mouse input is forwarded in this
                // local space (MainForm subtracts BoundsPx.Location).
                _layer.Offset = new Vector3(_boundsPx.X, _boundsPx.Y, 0f);
                _layer.Size = new Vector2(_boundsPx.Width, _boundsPx.Height);
                _controller.Bounds = new Rectangle(0, 0, _boundsPx.Width, _boundsPx.Height);
            }
        }
        catch (Exception ex) { _log($"menu applyBounds failed: {ex.Message}"); }
    }

    public void Hide()
    {
        _visible = false;
        _pendingItems = null;
        if (_controller is not null) { try { _controller.IsVisible = false; } catch { } }
    }

    public void Dispose()
    {
        try { _controller?.Close(); } catch { }
        _controller = null; _core = null;
        try { if (_layer is not null) _comp.RemoveLayer(_layer); } catch { }
        _layer = null;
    }

    // Minimal in-page bridge exposing window.zeroMenu (matches ZeroMenuBridge). The overlay React code
    // (zero0-menu-overlay.tsx) subscribes via onShow and reports via action/dismiss/resize.
    private const string BridgeScript = @"
(function () {
  var wv = window.chrome && window.chrome.webview;
  if (!wv) return;
  var showCbs = new Set();
  // Host → page: the host calls window.__zeroMenuShow(payload) via ExecuteScript.
  window.__zeroMenuShow = function (payload) {
    showCbs.forEach(function (cb) { try { cb(payload); } catch (e) {} });
  };
  window.zeroMenu = {
    onShow: function (cb) { showCbs.add(cb); return function () { showCbs.delete(cb); }; },
    action: function (id) { wv.postMessage({ kind: 'action', id: id }); },
    dismiss: function () { wv.postMessage({ kind: 'dismiss' }); },
    resize: function (size) {
      wv.postMessage({ kind: 'resize', width: (size && size.width) || 0, height: (size && size.height) || 0 });
    }
  };
})();";

    // Overlay → host message shape.
    private sealed class ZeroMenuMsg
    {
        public string? kind { get; set; }
        public string? id { get; set; }
        public double width { get; set; }
        public double height { get; set; }
    }
}
