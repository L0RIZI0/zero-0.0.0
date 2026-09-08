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
    private readonly string _virtualHost;            // "zero.local" — mapped per-controller (see CreateAsync)
    private readonly string _outDir;                 // static-export folder backing the virtual host
    private readonly string _menuUrl;                // https://zero.local/menu/
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
    // Per-open pick + dismiss handlers. The default (renderer relay) is used by window.zero.menu.open;
    // the CONTENT context-menu path swaps in handlers that drive the WebView2 deferral instead. Reset to
    // the default whenever a menu closes so a stale content deferral can't leak into the next open.
    private Action<string>? _pick;    // called with the chosen action id (null ⇒ renderer relay)
    private Action? _onDismiss;       // called when the menu is dismissed without a pick

    public MenuHost(CompositionHost comp, IntPtr hwnd, CoreWebView2Environment env, string virtualHost,
        string outDir, double scale, Action<string> log, Action<string> onSelected)
    {
        _comp = comp; _hwnd = hwnd; _env = env; _virtualHost = virtualHost; _outDir = outDir;
        _menuUrl = $"https://{virtualHost}/menu/"; _scale = scale;
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
    public Task OpenAsync(double xCss, double yCss, JsonElement items)
    {
        // window.zero.menu.open path: CSS coords, picks relay to the renderer (default handlers).
        var anchor = new Point((int)Math.Round(xCss * _scale), (int)Math.Round(yCss * _scale));
        return ShowAsync(anchor, items, pick: null, onDismiss: null);
    }

    // Content context-menu path: anchor is already in SHELL PHYSICAL px (the last right-click point), and
    // the pick/dismiss drive the WebView2 deferral rather than the renderer. Items are the pre-flattened
    // JSON built from CoreWebView2ContextMenuItem (see ResourceView).
    public Task OpenNativeAsync(Point anchorPx, JsonElement items, Action<string> pick, Action onDismiss)
    {
        return ShowAsync(anchorPx, items, pick, onDismiss);
    }

    private async Task ShowAsync(Point anchorPx, JsonElement items, Action<string>? pick, Action? onDismiss)
    {
        _anchorPx = anchorPx;
        _pendingItems = items.Clone(); // detach from the transient message buffer
        _pick = pick;
        _onDismiss = onDismiss;

        if (_controller is null)
        {
            try { await CreateAsync(); }
            catch (Exception ex) { _log($"menu create failed: {ex.Message}"); return; }
        }

        // Start each open from the measuring state: full-client viewport, parked off-screen, not yet
        // logically visible. This also guarantees room to measure a larger menu than the previous one.
        _visible = false;
        ParkForMeasuring();

        // Raise to the very top (content layers add their layers frontmost on mount) so the overlay paints
        // above the shell AND any content view. The card size isn't known until the overlay measures +
        // reports Resize; until then it's parked off-screen so there's no flash at a stale position.
        _comp.RaiseToTop(_layer!);
        _log($"menu open: ready={_ready} anchor={_anchorPx.X},{_anchorPx.Y}");
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

        // The overlay MEASURES itself (getBoundingClientRect in a layout effect) and reports its card size
        // so we can shrink the layer to fit. A composition controller with IsVisible=false SUSPENDS layout
        // + rendering, so that measure reads 0×0 and the menu would NEVER reveal — this is the "nothing
        // shows over web content" bug on v0.2.366. So we keep the controller VISIBLE at all times and
        // "hide" it by PARKING the layer off-screen with a full-client viewport: the page always lays out,
        // but is not seen until SizeAndPlace moves it on-screen shrunk to the fitted card.
        ParkForMeasuring();
        _log("menu controller created");

        var s = _core.Settings;
        s.AreDefaultContextMenusEnabled = false; // no Edge menu inside our own menu
        s.IsStatusBarEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        try { _core.Profile.PreferredColorScheme = _scheme; } catch { }

        // CRITICAL: SetVirtualHostNameToFolderMapping is PER-CoreWebView2, not per-environment. The shell
        // sets it on its own core; this controller is a separate WebView2, so without its OWN mapping
        // https://zero.local/menu/ resolves to nothing, navigation fails, _ready never flips, and the menu
        // never appears anywhere. (This was the "no right-click menu works" bug in v0.2.364.)
        try { _core.SetVirtualHostNameToFolderMapping(_virtualHost, _outDir, CoreWebView2HostResourceAccessKind.Allow); }
        catch (Exception ex) { _log($"menu vhost map failed: {ex.Message}"); }

        // The overlay is a SEPARATE document, so it can't use the shell's window.zero. Inject a minimal
        // window.zeroMenu bridge that matches ZeroMenuBridge (types/zero-desktop.d.ts): onShow receives
        // items pushed from here (as a window event we dispatch via ExecuteScript); action/dismiss/resize
        // post back over this controller's own message channel.
        await _core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript);
        _core.WebMessageReceived += OnOverlayMessage;
        _core.NavigationCompleted += (_, e) =>
        {
            if (!e.IsSuccess) { _log($"menu overlay nav FAILED: {e.WebErrorStatus}"); return; }
            _ready = true;
            _log("menu overlay ready");
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
        try { _ = _core.ExecuteScriptAsync(js); _log("menu items pushed"); }
        catch (Exception ex) { _log($"menu push failed: {ex.Message}"); }
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
                _log($"menu resize msg: {m.width}x{m.height} css");
                SizeAndPlace((int)Math.Round(m.width * _scale), (int)Math.Round(m.height * _scale));
                break;
            case "action":
                if (!string.IsNullOrEmpty(m.id))
                {
                    // A pick both fulfils the open AND closes the menu. Snapshot the per-open handler,
                    // clear state via Hide (which won't re-fire dismiss because we null _onDismiss first),
                    // then invoke. Default handler = renderer relay.
                    var pick = _pick;
                    _onDismiss = null; // picking is not a dismissal
                    Hide();
                    try { (pick ?? _onSelected)(m.id!); } catch { }
                }
                break;
            case "dismiss":
                Hide();
                break;
        }
    }

    // Position the card near the anchor, clamped to the window client area, then reveal.
    private void SizeAndPlace(int wPx, int hPx)
    {
        if (wPx <= 0 || hPx <= 0) { _log($"menu sizeAndPlace SKIPPED (zero size): {wPx}x{hPx}"); return; }
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
        _log($"menu shown at {x},{y} size {wPx}x{hPx}");
        ApplyBounds();
    }

    private void ApplyBounds()
    {
        if (_controller is null || _layer is null) return;
        try
        {
            if (_visible && _boundsPx.Width > 0 && _boundsPx.Height > 0)
            {
                // Same composition coordinate model as ResourceView: position via the layer Offset, size
                // via the layer Size + controller Bounds at (0,0,w,h). Mouse input is forwarded in this
                // local space (MainForm subtracts BoundsPx.Location).
                _controller.IsVisible = true;
                _layer.Offset = new Vector3(_boundsPx.X, _boundsPx.Y, 0f);
                _layer.Size = new Vector2(_boundsPx.Width, _boundsPx.Height);
                _controller.Bounds = new Rectangle(0, 0, _boundsPx.Width, _boundsPx.Height);
            }
            else
            {
                // Not logically visible → keep the controller alive + laid out, parked off-screen so the
                // next open can measure. (Never IsVisible=false: that suspends layout — see CreateAsync.)
                ParkForMeasuring();
            }
        }
        catch (Exception ex) { _log($"menu applyBounds failed: {ex.Message}"); }
    }

    // "Hidden" state that still LAYS OUT: full-client viewport, controller VISIBLE, layer parked off the
    // right edge of the window so nothing is seen. Keeping the controller visible is what lets the overlay
    // measure itself (a hidden WebView2 suspends layout/rendering). SizeAndPlace later shrinks + moves it
    // on-screen to reveal.
    private void ParkForMeasuring()
    {
        if (_controller is null || _layer is null) return;
        var c = _comp.Size;
        try
        {
            _controller.IsVisible = true;
            _layer.Size = new Vector2(c.Width, c.Height);
            _layer.Offset = new Vector3(c.Width + 100f, 0f, 0f); // off the right edge = invisible
            _controller.Bounds = new Rectangle(0, 0, c.Width, c.Height);
        }
        catch (Exception ex) { _log($"menu park failed: {ex.Message}"); }
    }

    public void Hide()
    {
        _visible = false;
        _pendingItems = null;
        // Don't set IsVisible=false (that suspends layout and breaks the next measure) — park off-screen.
        ParkForMeasuring();
        // Fire (and consume) the per-open dismiss handler — for a content menu this completes the
        // WebView2 deferral with no selection so Chromium doesn't hang waiting. Reset both handlers so
        // the next open starts from the default (renderer relay).
        var d = _onDismiss;
        _onDismiss = null;
        _pick = null;
        if (d is not null) { try { d(); } catch { } }
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
  var lastPayload = null; // buffer: a push can arrive BEFORE React subscribes (see onShow)
  // Host → page: the host calls window.__zeroMenuShow(payload) via ExecuteScript.
  window.__zeroMenuShow = function (payload) {
    lastPayload = payload;
    showCbs.forEach(function (cb) { try { cb(payload); } catch (e) {} });
  };
  window.zeroMenu = {
    // Replay the buffered payload immediately on subscribe. NavigationCompleted (which triggers the
    // host push) can fire before the React overlay mounts and registers here; without this replay the
    // very first open — and every open before the page is warm — would be silently dropped.
    onShow: function (cb) {
      showCbs.add(cb);
      if (lastPayload !== null) { try { cb(lastPayload); } catch (e) {} }
      return function () { showCbs.delete(cb); };
    },
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
