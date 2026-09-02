using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// The Zero shell window: a custom-chrome WinForms form that renders Zero's own UI (the Next static
// export from https://zero.local/) via a WebView2 COMPOSITION controller layered in a Windows.UI
// composition tree bound to this HWND. All renderer↔host traffic goes through the `window.zero` shim
// injected at document-created time; messages arrive via WebMessageReceived and are dispatched below.
// The window keeps native frame styles (Sizable) for resize/snap/animations but hides the title bar and
// top border via WM_NCCALCSIZE, so it LOOKS frameless while the OS handles move/resize/min-max-close.
//
// M2.1: the shell moved off the windowed WebView2 control onto a composition controller. This is the
// FOUNDATION for blending — a composited layer can be transparent, so from M2.2 browsed content sits on
// a lower layer and shows through the shell's transparent regions (§0 can finally paint over live web).
// The cost is that spatial input is no longer delivered automatically: we forward mouse/wheel to the
// controller from WndProc (see ForwardMouse) and drive keyboard focus via MoveFocus.
// ---------------------------------------------------------------------------
sealed class MainForm : Form
{
    private CompositionHost? _comp;
    private CoreWebView2CompositionController? _shell; // the shell's composition controller
    private CoreWebView2? _shellCore;                  // == _shell.CoreWebView2 (cached)
    private bool _mouseTracking;                        // WM_MOUSELEAVE arming
    private const string VirtualHost = "zero.local";

    // M2.2: browsed content views (composited layers above the shell). Input routing state:
    //   _prevMouseTarget   = last controller the cursor was over (null = shell) — for Leave transitions
    //   _mouseCaptureTarget = view (or shell=null) that received a button-down, held until button-up so a
    //                         drag keeps going to it even if the cursor leaves its rect
    private ResourceHost? _resources;
    private ResourceView? _prevMouseTarget;
    private ResourceView? _mouseCaptureTarget;
    private bool _mouseCaptured;

    // Fullscreen (whole-screen, taskbar hidden) is distinct from maximize (work-area). We manage it
    // ourselves because the form is frameless; these remember how to restore.
    private bool _fullscreen;
    private FormWindowState _preFullscreenState = FormWindowState.Normal;
    private Rectangle _preFullscreenBounds;
    private bool _lastMaximized;

    private static readonly HttpClient Http = CreateHttpClient();

    public MainForm()
    {
        Text = "Zero";
        // Sizable (NOT None): keeps the native window frame styles (WS_THICKFRAME + WS_CAPTION +
        // min/max box) so we get native edge/corner resize, Aero snap, and real min/max/close
        // ANIMATIONS. The visible title bar is then removed in WndProc via WM_NCCALCSIZE, which
        // reclaims only the caption strip and leaves the sizing borders — so it still LOOKS frameless.
        // (FormBorderStyle.None = WS_POPUP, which has none of those and can't resize with a full-bleed
        // WebView2 child swallowing mouse at the edges — the cause of the M1 "can't resize / no
        // animation" report.)
        FormBorderStyle = FormBorderStyle.Sizable;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = ColorTranslator.FromHtml("#0b0b0c"); // matches Electron backgroundColor (no white flash)
        Size = new Size(1440, 900);
        MinimumSize = new Size(880, 600);
        // Zero's own "z" mark for the taskbar; harmless if the file is absent in dev.
        TryLoadIcon();

        // The composition tree paints the client area; there is no child control. We let WinForms clear
        // the window to BackColor (#0b0b0c) as an opaque backdrop — composition composites ON TOP of it,
        // and it shows through any (future) transparent shell regions with no white flash. Double-buffer
        // to avoid flicker on that clear during resizes.
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);

        Load += async (_, _) => await InitAsync();
    }

    private async Task InitAsync()
    {
        try
        {
            // 1) Composition stack bound to this HWND (Compositor + DesktopWindowTarget + root visual).
            _comp = new CompositionHost(Handle, ClientSize);

            // 2) Shell WebView2 environment. Keep the shell profile SEPARATE from the (M2.2+) content
            //    profiles: this is Zero's own UI, not browsed sites. %LOCALAPPDATA%\Zero\shell-webview2.
            string userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Zero", "shell-webview2");
            var env = await CoreWebView2Environment.CreateAsync(browserExecutableFolder: null, userDataFolder: userData);

            // 3) Composition controller (NOT the windowed control): renders into a visual we own.
            _shell = await env.CreateCoreWebView2CompositionControllerAsync(Handle);
            var core = _shell.CoreWebView2;
            _shellCore = core;

            // Attach the controller to the FRONTMOST composition layer and size it to the client.
            var layer = _comp.AddLayer();
            _shell.RootVisualTarget = layer;
            _shell.RasterizationScale = DeviceDpi / 96.0;
            _shell.ShouldDetectMonitorScaleChanges = false; // we drive scale from WM_DPICHANGED
            _shell.Bounds = new Rectangle(0, 0, ClientSize.Width, ClientSize.Height);
            _shell.IsVisible = true;

            var s = core.Settings;
            s.AreDefaultContextMenusEnabled = false; // Zero draws its own in-DOM menus over shell UI
            s.IsStatusBarEnabled = false;
            s.AreDevToolsEnabled = true; // keep F12 during the migration
            s.IsSwipeNavigationEnabled = false;
            s.AreBrowserAcceleratorKeysEnabled = false; // no Ctrl+P/Ctrl+F etc. leaking into shell UI

            // Serve the static export as a real https origin (localStorage/IndexedDB get a stable origin).
            string? outDir = ResolveOutDir();
            if (outDir is null)
            {
                core.NavigateToString(MissingExportHtml());
                return;
            }
            core.SetVirtualHostNameToFolderMapping(VirtualHost, outDir, CoreWebView2HostResourceAccessKind.Allow);

            // Inject the window.zero shim BEFORE any page script runs (baked constants resolved now).
            await core.AddScriptToExecuteOnDocumentCreatedAsync(ZeroShim.Build(BakedConstants()));

            core.WebMessageReceived += OnWebMessage;
            core.DocumentTitleChanged += (_, _) =>
            {
                var t = core.DocumentTitle;
                Text = string.IsNullOrWhiteSpace(t) ? "Zero" : t;
            };

            // Accept focus moves the webview requests (tabbing) instead of leaving keyboard in limbo.
            _shell.MoveFocusRequested += (_, e) =>
            {
                e.Handled = true;
                try { _shell?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic); } catch { }
            };

            // Browsed content lives on composition layers above this shell layer (content-on-top parity).
            _resources = new ResourceHost(_comp, Handle, DeviceDpi / 96.0, PushEvent, LogLine);

            core.Navigate($"https://{VirtualHost}/index.html");

            // Give the freshly-created controller keyboard focus (the form already has OS focus on load).
            try { _shell.MoveFocus(CoreWebView2MoveFocusReason.Programmatic); } catch { }
        }
        catch (Exception ex)
        {
            // Surface composition/controller failures visibly rather than a blank window.
            File.AppendAllText(DebugLogPath(), $"{DateTime.Now:HH:mm:ss} [init-fail] {ex}{Environment.NewLine}");
            try { BackColor = ColorTranslator.FromHtml("#3a0b0b"); } catch { }
        }
    }

    // ── window.zero message dispatch ─────────────────────────────────────────
    // Protocol (see zero-shim.js): JS posts { kind:"invoke"|"send", id?, channel, args }.
    // For "invoke" we reply with { kind:"reply", id, ok, result?/error? }. Events pushed the other way
    // are { kind:"event", channel, payload }.
    private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        ZeroMessage? msg;
        try { msg = JsonSerializer.Deserialize<ZeroMessage>(e.WebMessageAsJson); }
        catch { return; }
        if (msg is null || string.IsNullOrEmpty(msg.channel)) return;

        try
        {
            switch (msg.channel)
            {
                // ── fire-and-forget (send) ──────────────────────────────────
                case "win.minimize": WindowState = FormWindowState.Minimized; break;
                case "win.toggle-maximize": ToggleMaximize(); break;
                case "win.close": Close(); break;
                case "win.toggle-fullscreen": ToggleFullscreen(); break;
                case "win.drag-start": BeginNativeDrag(); break;
                case "open-external": OpenExternal(msg.args); break;
                case "debug-log": DebugLog(msg.args); break;

                // ── M2.2 browsed content (send) ─────────────────────────────
                case "resource.set-bounds": ResourceSetBounds(msg.args); break;
                case "resource.park": ResourceIdArg(msg.args, id => _resources?.Park(id)); break;
                case "resource.close": ResourceIdArg(msg.args, id => _resources?.Close(id)); break;
                case "resource.unmount": ResourceIdArg(msg.args, id => _resources?.Park(id)); break; // legacy alias → park
                case "resource.discard-prewarm": ResourceIdArg(msg.args, id => _resources?.Close(id)); break;
                case "resource.release-focus": GiveWebFocus(); break; // keyboard back to Zero's own UI
                case "resource.set-theme": ResourceSetTheme(msg.args); break;

                // ── request/response (invoke) ───────────────────────────────
                case "win.is-maximized": Reply(msg.id, WindowState == FormWindowState.Maximized); break;
                case "win.is-fullscreen": Reply(msg.id, _fullscreen); break;
                case "system-idle": Reply(msg.id, IdleSeconds()); break;
                case "web-title": Reply(msg.id, await WebTitle(msg.args)); break;
                case "resource.mount": await ResourceMount(msg.args); Reply(msg.id, null); break;
                // Warm pre-warm is M2.3; returning false makes the renderer take the normal cold mount path
                // (a re-opened PARKED view is already warm because park() keeps its controller alive).
                case "resource.prewarm": Reply(msg.id, false); break;

                default:
                    // Unknown channel: if it expected a reply, resolve it so the JS promise never hangs.
                    if (msg.id is not null) Reply(msg.id, null);
                    break;
            }
        }
        catch (Exception ex)
        {
            if (msg.id is not null) ReplyError(msg.id, ex.Message);
        }
    }

    private void Reply(long? id, object? result)
    {
        if (id is null) return;
        PostJson(new { kind = "reply", id, ok = true, result });
    }

    private void ReplyError(long? id, string error)
    {
        if (id is null) return;
        PostJson(new { kind = "reply", id, ok = false, error });
    }

    private void PushEvent(string channel, object? payload)
        => PostJson(new { kind = "event", channel, payload });

    private void PostJson(object o)
    {
        if (_shellCore is null) return;
        try { _shellCore.PostWebMessageAsJson(JsonSerializer.Serialize(o)); } catch { /* view gone */ }
    }

    // ── window operations ────────────────────────────────────────────────────
    private void ToggleMaximize()
        => WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;

    private void ToggleFullscreen()
    {
        if (!_fullscreen)
        {
            _preFullscreenState = WindowState;
            _preFullscreenBounds = Bounds;
            _fullscreen = true;
            // Normal first so setting Bounds isn't ignored while maximized, then cover the whole screen.
            WindowState = FormWindowState.Normal;
            Bounds = Screen.FromControl(this).Bounds;
        }
        else
        {
            _fullscreen = false;
            if (_preFullscreenState == FormWindowState.Maximized) WindowState = FormWindowState.Maximized;
            else { WindowState = FormWindowState.Normal; Bounds = _preFullscreenBounds; }
        }
        PushEvent("win.fullscreen", _fullscreen);
    }

    private void BeginNativeDrag()
    {
        // Standard frameless move: drop capture the web view has, then tell Windows a caption drag began.
        // Gives real Aero snap / multi-monitor behavior for free.
        NativeMethods.ReleaseCapture();
        NativeMethods.SendMessage(Handle, NativeMethods.WM_NCLBUTTONDOWN, NativeMethods.HTCAPTION, 0);
    }

    private void OpenExternal(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.String) return;
        var url = args.GetString();
        if (string.IsNullOrEmpty(url) || !(url.StartsWith("http://") || url.StartsWith("https://"))) return;
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true }); }
        catch { /* best-effort */ }
    }

    // ── custom frame (borderless look, native resize/animations) via WndProc ──
    protected override void WndProc(ref Message m)
    {
        // WM_NCCALCSIZE (wParam=TRUE) decides how much of the window is client vs. non-client frame.
        // We keep the native sizing borders on the sides/bottom (so the OS handles resize + Aero snap)
        // but reclaim the ENTIRE top inset into the client, so no title bar AND no top border line show.
        if (m.Msg == NativeMethods.WM_NCCALCSIZE && m.WParam != nint.Zero)
        {
            if (_fullscreen)
            {
                // True fullscreen: no frame at all — the whole window rect is client (edge-to-edge).
                // Leaving rgrc[0] untouched and returning 0 means "client == proposed window rect".
                m.Result = nint.Zero;
                return;
            }

            // The proposed WINDOW rect top, captured BEFORE the default proc turns rgrc[0] into a client
            // rect. We restore the client top to exactly this, so the client spans to the window's top
            // edge — reclaiming both the caption AND the top sizing-border. That top border is what DWM
            // was painting as the thin white line; removing the inset removes the line. (Subtracting only
            // SM_CYCAPTION left that ~1px top frame behind, hence the artifact.)
            int windowTop =
                System.Runtime.InteropServices.Marshal.PtrToStructure<NativeMethods.RECT>(m.LParam).top;

            // Let the default proc reserve the standard frame (sizing borders + caption)…
            base.WndProc(ref m);

            // …then hand the whole top inset back to the client. Left/right/bottom insets are left as the
            // default proc set them, so those edges + all corners stay natively resizable. The top edge's
            // resize grip is restored separately via the synthesized WM_NCHITTEST band below.
            var rc = System.Runtime.InteropServices.Marshal.PtrToStructure<NativeMethods.RECT>(m.LParam);
            rc.top = windowTop;
            System.Runtime.InteropServices.Marshal.StructureToPtr(rc, m.LParam, false);
            m.Result = nint.Zero;
            return;
        }

        // Top-edge resize: WM_NCCALCSIZE reclaimed the top inset as client, so the OS hit-test returns
        // HTCLIENT there and never HTTOP — leaving the top edge non-resizable (the left/right/bottom
        // borders are still real non-client frame, so the OS handles those itself). Synthesize HTTOP /
        // HTTOPLEFT / HTTOPRIGHT for a thin DPI-scaled band along the top so top + top-corner sizing work
        // again, without reintroducing a visible frame. Only in the Normal state (not maximized/fullscreen).
        if (m.Msg == NativeMethods.WM_NCHITTEST && !_fullscreen && WindowState == FormWindowState.Normal)
        {
            var p = PointToClient(new Point(NativeMethods.LoWord(m.LParam), NativeMethods.HiWord(m.LParam)));
            int grip = (int)Math.Round(6 * DeviceDpi / 96.0);
            if (p.Y >= 0 && p.Y < grip)
            {
                if (p.X < grip) { m.Result = NativeMethods.HTTOPLEFT; return; }
                if (p.X >= ClientSize.Width - grip) { m.Result = NativeMethods.HTTOPRIGHT; return; }
                m.Result = NativeMethods.HTTOP;
                return;
            }
        }

        // Spatial input: visual hosting delivers NO mouse/wheel to the controller automatically, so we
        // forward it here. Done BEFORE base so the webview sees the event even if base would swallow it.
        ForwardMouse(ref m);

        base.WndProc(ref m);

        switch (m.Msg)
        {
            case NativeMethods.WM_SIZE:
                // Keep the shell controller filling the client area.
                if (_shell is not null)
                {
                    try { _shell.Bounds = new Rectangle(0, 0, ClientSize.Width, ClientSize.Height); } catch { }
                }
                _comp?.Resize(ClientSize);
                // Mirror maximize-state transitions to the renderer. (Native maximize with WS_CAPTION
                // already respects the monitor work area, so no manual WM_GETMINMAXINFO clamp is needed.)
                bool max = WindowState == FormWindowState.Maximized;
                if (max != _lastMaximized) { _lastMaximized = max; PushEvent("win.maximized", max); }
                break;

            case NativeMethods.WM_DPICHANGED:
                // Per-monitor DPI change: re-scale the controller's rasterization to match.
                if (_shell is not null)
                {
                    try
                    {
                        _shell.RasterizationScale = DeviceDpi / 96.0;
                        _shell.Bounds = new Rectangle(0, 0, ClientSize.Width, ClientSize.Height);
                    }
                    catch { }
                }
                _resources?.SetScale(DeviceDpi / 96.0); // rescale content controllers to the new DPI
                break;

            case NativeMethods.WM_SETFOCUS:
                // The window got keyboard focus → hand it to the webview so typing reaches Zero's UI.
                try { _shell?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic); } catch { }
                break;
        }
    }

    // Translate a Win32 mouse message into a CoreWebView2 SendMouseInput call on the correct composition
    // layer. Composition controllers receive NO spatial input automatically, so we hit-test the client
    // point against the visible content rects: a hit routes to that content controller (translated into
    // its local space); a miss routes to the shell (which fills the client at origin). A button-down
    // captures its target until button-up so a drag that leaves the rect still reaches the same view.
    private void ForwardMouse(ref Message m)
    {
        if (_shell is null) return;

        CoreWebView2MouseEventKind kind;
        uint mouseData = 0;
        Point pt;
        bool isDown = false, isUp = false;

        switch (m.Msg)
        {
            case NativeMethods.WM_MOUSEMOVE:
                kind = CoreWebView2MouseEventKind.Move;
                // Arm WM_MOUSELEAVE so we can tell the webview when the cursor exits.
                if (!_mouseTracking)
                {
                    var tme = new NativeMethods.TRACKMOUSEEVENT
                    {
                        cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<NativeMethods.TRACKMOUSEEVENT>(),
                        dwFlags = NativeMethods.TME_LEAVE,
                        hwndTrack = Handle,
                        dwHoverTime = 0,
                    };
                    NativeMethods.TrackMouseEvent(ref tme);
                    _mouseTracking = true;
                }
                pt = LParamPoint(m.LParam);
                break;
            case NativeMethods.WM_MOUSELEAVE:
                _mouseTracking = false;
                SendLeaveTo(_prevMouseTarget); // clear hover on whichever layer the cursor was last over
                _prevMouseTarget = null;
                return;
            case NativeMethods.WM_LBUTTONDOWN: kind = CoreWebView2MouseEventKind.LeftButtonDown; pt = LParamPoint(m.LParam); isDown = true; break;
            case NativeMethods.WM_LBUTTONUP: kind = CoreWebView2MouseEventKind.LeftButtonUp; pt = LParamPoint(m.LParam); isUp = true; break;
            case NativeMethods.WM_LBUTTONDBLCLK: kind = CoreWebView2MouseEventKind.LeftButtonDoubleClick; pt = LParamPoint(m.LParam); isDown = true; break;
            case NativeMethods.WM_RBUTTONDOWN: kind = CoreWebView2MouseEventKind.RightButtonDown; pt = LParamPoint(m.LParam); isDown = true; break;
            case NativeMethods.WM_RBUTTONUP: kind = CoreWebView2MouseEventKind.RightButtonUp; pt = LParamPoint(m.LParam); isUp = true; break;
            case NativeMethods.WM_RBUTTONDBLCLK: kind = CoreWebView2MouseEventKind.RightButtonDoubleClick; pt = LParamPoint(m.LParam); isDown = true; break;
            case NativeMethods.WM_MBUTTONDOWN: kind = CoreWebView2MouseEventKind.MiddleButtonDown; pt = LParamPoint(m.LParam); isDown = true; break;
            case NativeMethods.WM_MBUTTONUP: kind = CoreWebView2MouseEventKind.MiddleButtonUp; pt = LParamPoint(m.LParam); isUp = true; break;
            case NativeMethods.WM_MBUTTONDBLCLK: kind = CoreWebView2MouseEventKind.MiddleButtonDoubleClick; pt = LParamPoint(m.LParam); isDown = true; break;
            case NativeMethods.WM_MOUSEWHEEL:
                kind = CoreWebView2MouseEventKind.Wheel;
                mouseData = unchecked((uint)(int)NativeMethods.HiWord(m.WParam)); // signed wheel delta
                pt = ScreenLParamToClient(m.LParam);
                break;
            case NativeMethods.WM_MOUSEHWHEEL:
                kind = CoreWebView2MouseEventKind.HorizontalWheel;
                mouseData = unchecked((uint)(int)NativeMethods.HiWord(m.WParam));
                pt = ScreenLParamToClient(m.LParam);
                break;
            default:
                return;
        }

        // Pick the target layer: an active button-drag stays on its captured target; otherwise hit-test.
        ResourceView? target = _mouseCaptured ? _mouseCaptureTarget : _resources?.HitTest(pt);

        // Leave-transition: if the hovered layer changed, clear hover on the one we left.
        if (!ReferenceEquals(target, _prevMouseTarget))
        {
            SendLeaveTo(_prevMouseTarget);
            _prevMouseTarget = target;
        }

        // A press captures the target and takes keyboard focus for that layer.
        if (isDown)
        {
            _mouseCaptured = true;
            _mouseCaptureTarget = target;
            if (target is null) { try { _shell.MoveFocus(CoreWebView2MoveFocusReason.Programmatic); } catch { } }
            else { try { target.Controller?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic); } catch { } }
        }

        // Route to the chosen controller, translating into its local (physical-px) space.
        if (target is null)
        {
            try { _shell.SendMouseInput(kind, MouseKeys(m.WParam), mouseData, pt); } catch { }
        }
        else
        {
            var origin = target.BoundsPx.Location;
            var local = new Point(pt.X - origin.X, pt.Y - origin.Y);
            try { target.Controller?.SendMouseInput(kind, MouseKeys(m.WParam), mouseData, local); } catch { }
        }

        if (isUp) { _mouseCaptured = false; _mouseCaptureTarget = null; }
    }

    // Send a Leave to a layer (null = shell) so its hover/cursor state clears when the pointer moves away.
    private void SendLeaveTo(ResourceView? target)
    {
        try
        {
            if (target is null) _shell?.SendMouseInput(CoreWebView2MouseEventKind.Leave, 0, 0, Point.Empty);
            else target.Controller?.SendMouseInput(CoreWebView2MouseEventKind.Leave, 0, 0, Point.Empty);
        }
        catch { }
    }

    private static Point LParamPoint(nint lParam)
        => new(NativeMethods.LoWord(lParam), NativeMethods.HiWord(lParam));

    // Wheel messages carry SCREEN coords in lParam; map to this form's client space.
    private Point ScreenLParamToClient(nint lParam)
        => PointToClient(new Point(NativeMethods.LoWord(lParam), NativeMethods.HiWord(lParam)));

    // MK_* modifier/button flags live in the low word of wParam for button/move messages.
    private static CoreWebView2MouseEventVirtualKeys MouseKeys(nint wParam)
        => (CoreWebView2MouseEventVirtualKeys)(NativeMethods.LoWord(wParam) & 0xFFFF);

    private void GiveWebFocus()
    {
        try { _shell?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic); } catch { }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        // Tear down content views, then the shell controller, then the composition target, in that order.
        try { _resources?.DisposeAll(); } catch { }
        _resources = null;
        try { _shell?.Close(); } catch { }
        _shell = null;
        _shellCore = null;
        try { _comp?.Dispose(); } catch { }
        _comp = null;
        base.OnFormClosed(e);
    }

    // ── helpers ───────────────────────────────────────────────────────────────
    private static double IdleSeconds()
    {
        var s = NativeMethods.GetIdleSeconds();
        return s < 0 ? 0 : s;
    }

    private void DebugLog(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.String) return;
        try
        {
            File.AppendAllText(DebugLogPath(), $"{DateTime.Now:HH:mm:ss} {args.GetString()}{Environment.NewLine}");
        }
        catch { /* best-effort */ }
    }

    // Diagnostic line to the desktop debug log (same file as init-fail / debug-log). Best-effort.
    private void LogLine(string s)
    {
        try { File.AppendAllText(DebugLogPath(), $"{DateTime.Now:HH:mm:ss} {s}{Environment.NewLine}"); }
        catch { }
    }

    // ── M2.2 resource.* argument handling ──────────────────────────────────────
    private async Task ResourceMount(JsonElement a)
    {
        if (_resources is null || a.ValueKind != JsonValueKind.Object) return;
        string? id = GetStr(a, "id");
        string? url = GetStr(a, "url");
        string? envKey = GetStr(a, "envKey");
        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(url)) return;
        var (px, visible) = RectArg(a);
        await _resources.MountAsync(id, url, envKey, px, visible);
    }

    private void ResourceSetBounds(JsonElement a)
    {
        if (_resources is null || a.ValueKind != JsonValueKind.Object) return;
        string? id = GetStr(a, "id");
        if (string.IsNullOrEmpty(id)) return;
        var (px, visible) = RectArg(a);
        _resources.SetBounds(id, px, visible);
    }

    private void ResourceSetTheme(JsonElement a)
    {
        if (_resources is null) return;
        var mode = a.ValueKind == JsonValueKind.String ? a.GetString() : null;
        var scheme = mode == "light" ? CoreWebView2PreferredColorScheme.Light
                   : mode == "dark" ? CoreWebView2PreferredColorScheme.Dark
                   : CoreWebView2PreferredColorScheme.Auto;
        _resources.SetTheme(scheme);
    }

    // park/close/unmount/discard-prewarm carry the resource id as a bare JSON string arg.
    private static void ResourceIdArg(JsonElement a, Action<string> fn)
    {
        if (a.ValueKind == JsonValueKind.String)
        {
            var id = a.GetString();
            if (!string.IsNullOrEmpty(id)) fn(id);
        }
    }

    // Read the { rect:{x,y,width,height} } (CSS px) off a resource message → physical-px rect + visibility.
    private (Rectangle px, bool visible) RectArg(JsonElement a)
    {
        if (_resources is null || !a.TryGetProperty("rect", out var r) || r.ValueKind != JsonValueKind.Object)
            return (Rectangle.Empty, false);
        return _resources.ToPx(GetNum(r, "x"), GetNum(r, "y"), GetNum(r, "width"), GetNum(r, "height"));
    }

    private static string? GetStr(JsonElement o, string name)
        => o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static double GetNum(JsonElement o, string name)
        => o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;

    private async Task<object> WebTitle(JsonElement args)
    {
        // Desktop stand-in for /api/web-title: fetch a page and extract <title>/og:title. Never throws
        // (returns { title: null }); external http(s) only. Mirrors main.cjs zero:web-title.
        string? url = args.ValueKind == JsonValueKind.String ? args.GetString() : null;
        if (string.IsNullOrEmpty(url) || !(url.StartsWith("http://") || url.StartsWith("https://")))
            return new { title = (string?)null };
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
            using var res = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            if (!res.IsSuccessStatusCode) return new { title = (string?)null };
            var buf = new byte[200_000];
            await using var stream = await res.Content.ReadAsStreamAsync(cts.Token);
            int read = await stream.ReadAtLeastAsync(buf, buf.Length, throwOnEndOfStream: false, cts.Token);
            var html = Encoding.UTF8.GetString(buf, 0, read);
            return new { title = PageTitle.Extract(html) };
        }
        catch { return new { title = (string?)null }; }
    }

    // ── baked constants for the shim (synchronous reads in the renderer) ──────
    private object BakedConstants() => new
    {
        isDesktop = true,
        platform = "win32",
        locale = OsFormatLocale(),
        appVersion = AppVersion(),
        debugLogPath = DebugLogPath(),
    };

    private static string DebugLogPath()
        => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "Zero", "zero-debug.log");

    /// <summary>OS date/time FORMAT locale as "lang-COUNTRY" (e.g. "en-FR"), mirroring main.cjs
    /// osFormatLocale: region drives date order + 24h, not UI language.</summary>
    private static string? OsFormatLocale()
    {
        try
        {
            var ci = System.Globalization.CultureInfo.CurrentUICulture;
            var lang = ci.TwoLetterISOLanguageName; // e.g. "en"
            var region = new System.Globalization.RegionInfo(
                System.Globalization.CultureInfo.CurrentCulture.Name).TwoLetterISORegionName; // e.g. "FR"
            if (!string.IsNullOrEmpty(lang) && region.Length == 2) return $"{lang}-{region.ToUpperInvariant()}";
            return ci.Name;
        }
        catch { return null; }
    }

    private static string AppVersion()
    {
        // The real shipped build version. In M4 this becomes the Velopack package version; for now use the
        // assembly informational version, falling back to the file version.
        var asm = System.Reflection.Assembly.GetExecutingAssembly();
        var info = asm.GetCustomAttribute<System.Reflection.AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        return (info ?? asm.GetName().Version?.ToString() ?? "0.0.0").Split('+')[0];
    }

    // ── static-export + environment plumbing ─────────────────────────���───────
    private static string? ResolveOutDir()
    {
        // 1) explicit override (used by the dev launcher / packaging).
        var env = Environment.GetEnvironmentVariable("ZERO_OUT_DIR");
        if (!string.IsNullOrEmpty(env) && File.Exists(Path.Combine(env, "index.html"))) return env;

        // 2) packaged layout: an `out/` folder next to the exe.
        var beside = Path.Combine(AppContext.BaseDirectory, "out");
        if (File.Exists(Path.Combine(beside, "index.html"))) return beside;

        // 3) dev: walk up from bin/… to the repo root and use its `out/`.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (int i = 0; i < 8 && dir is not null; i++, dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "out", "index.html");
            if (File.Exists(candidate)) return Path.Combine(dir.FullName, "out");
        }
        return null;
    }

    private void TryLoadIcon()
    {
        try
        {
            var ico = Path.Combine(AppContext.BaseDirectory, "icon.ico");
            if (File.Exists(ico)) Icon = new Icon(ico);
        }
        catch { /* dev without an icon is fine */ }
    }

    private static HttpClient CreateHttpClient()
    {
        var h = new HttpClient(new HttpClientHandler { AllowAutoRedirect = true });
        h.DefaultRequestHeaders.TryAddWithoutValidation("user-agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");
        h.DefaultRequestHeaders.TryAddWithoutValidation("accept", "text/html,application/xhtml+xml");
        return h;
    }

    private static string MissingExportHtml() =>
        "<html><body style='background:#0b0b0c;color:#e5e5e5;font:14px system-ui;padding:40px'>" +
        "<h2>Zero shell-host</h2><p>Static export not found. Build the web app first:</p>" +
        "<pre style='color:#8ab4f8'>pnpm build</pre>" +
        "<p>Then run the host again, or set <code>ZERO_OUT_DIR</code> to the export folder.</p></body></html>";

    // Message shape posted by the shim.
    private sealed class ZeroMessage
    {
        public string kind { get; set; } = "";
        public long? id { get; set; }
        public string channel { get; set; } = "";
        public JsonElement args { get; set; }
    }
}
