using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// The Zero shell window: a custom-chrome WinForms form hosting a single full-bleed WebView2 that renders
// Zero's own UI (the Next static export) from the virtual host https://zero.local/. All renderer↔host
// traffic goes through the `window.zero` shim injected at document-created time; messages arrive here
// via WebMessageReceived and are dispatched below. The window keeps native frame styles (Sizable) for
// resize/snap/animations but hides the title bar via WM_NCCALCSIZE (see WndProc), so it LOOKS frameless
// while the OS still handles move (HTCAPTION drag), resize (all edges), and min/max/close animations.
// ---------------------------------------------------------------------------
sealed class MainForm : Form
{
    private readonly WebView2 _web = new();
    private const string VirtualHost = "zero.local";

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

        _web.Dock = DockStyle.Fill;
        Controls.Add(_web);

        Load += async (_, _) => await InitAsync();
    }

    private async Task InitAsync()
    {
        // Keep the shell's WebView2 profile SEPARATE from the (M2) content profiles: this is Zero's own
        // UI, not browsed sites. %LOCALAPPDATA%\Zero\shell-webview2.
        string userData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Zero", "shell-webview2");
        var env = await CoreWebView2Environment.CreateAsync(browserExecutableFolder: null, userDataFolder: userData);
        await _web.EnsureCoreWebView2Async(env);

        var core = _web.CoreWebView2;
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

        core.Navigate($"https://{VirtualHost}/index.html");
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

                // ── request/response (invoke) ───────────────────────────────
                case "win.is-maximized": Reply(msg.id, WindowState == FormWindowState.Maximized); break;
                case "win.is-fullscreen": Reply(msg.id, _fullscreen); break;
                case "system-idle": Reply(msg.id, IdleSeconds()); break;
                case "web-title": Reply(msg.id, await WebTitle(msg.args)); break;

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
        if (_web.CoreWebView2 is null) return;
        try { _web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(o)); } catch { /* view gone */ }
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
        // We keep the native sizing borders (so the OS handles resize on every edge + Aero snap) but
        // reclaim the CAPTION strip into the client, so no title bar is drawn → frameless look.
        if (m.Msg == NativeMethods.WM_NCCALCSIZE && m.WParam != nint.Zero)
        {
            if (_fullscreen)
            {
                // True fullscreen: no frame at all — the whole window rect is client (edge-to-edge).
                // Leaving rgrc[0] untouched and returning 0 means "client == proposed window rect".
                m.Result = nint.Zero;
                return;
            }

            // Let the default proc reserve the standard frame (sizing borders + caption)…
            base.WndProc(ref m);
            // …then give the caption height back to the client. The sizing borders stay non-client,
            // so all four edges/corners remain natively resizable; only the title bar is gone.
            var rc = System.Runtime.InteropServices.Marshal.PtrToStructure<NativeMethods.RECT>(m.LParam);
            rc.top -= NativeMethods.GetSystemMetrics(NativeMethods.SM_CYCAPTION);
            System.Runtime.InteropServices.Marshal.StructureToPtr(rc, m.LParam, false);
            m.Result = nint.Zero;
            return;
        }

        base.WndProc(ref m);

        // Detect maximize-state transitions off the resulting state and mirror them to the renderer.
        // (Native maximize with WS_CAPTION already respects the monitor work area, so the old manual
        // WM_GETMINMAXINFO clamp is no longer needed.)
        if (m.Msg == 0x0005 /* WM_SIZE */)
        {
            bool max = WindowState == FormWindowState.Maximized;
            if (max != _lastMaximized) { _lastMaximized = max; PushEvent("win.maximized", max); }
        }
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

    // ── static-export + environment plumbing ─────────────────────────────────
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
