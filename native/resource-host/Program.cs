using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Zero.ResourceHost;

// Zero's WebView2 resource host.
//
// Two run modes:
//   (default / --demo)  Standalone dev window with a tab bar. Lets Loris run `dotnet run` and confirm
//                       the controller-based multi-view model (mount / switch / park / navigate / persist)
//                       works BEFORE Electron drives it. This is the M1 sanity check.
//   (--ipc)             Long-lived process driven by the Electron shell over stdio (newline-delimited
//                       JSON). Controllers are parented into Electron's window HWND (--parent-hwnd) and
//                       floated at the rects the renderer streams. This is what M2 wires up.
//
// One CoreWebView2Environment (shared user-data root); each resource gets its own PROFILE
// (CoreWebView2ControllerOptions.ProfileName) so logins persist per resource, mirroring Zero's
// current per-resource persistent partitions.
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        // DPI: make THIS process Per-Monitor-V2 aware BEFORE any window/handle is created. Without this a
        // .NET WinForms process defaults to DPI-UNAWARE, so Windows VIRTUALIZES its coordinates and scales
        // its child windows UP by the monitor's scale factor. The bridge already converts the renderer's
        // DIP rect to PHYSICAL pixels (× scaleFactor), so an unaware host scaled them a SECOND time — the web
        // surface came out blown-up, pushed down (the "§0-height gap"), and clipped on the right/bottom, and
        // only on scaled (high-DPI) displays (looked "random"). Per-Monitor-V2 makes the host's coordinate
        // space == physical pixels (1:1 with the bridge) and lets WebView2 auto-pick the right RasterizationScale.
        bool dpiOk = Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var opts = ParseArgs(args);

        if (!opts.Ipc)
        {
            // Standalone demo: the DemoForm owns the message pump and a HostContext parented to itself.
            Application.Run(new DemoForm(opts.UserDataFolder));
            return 0;
        }

        // IPC mode. A hidden pump form owns the UI thread + sync context; a background thread reads
        // stdin and marshals each command onto the UI thread.
        using var pump = new PumpForm();
        pump.CreateControl(); // force handle creation so we have a SynchronizationContext to post to
        var sync = SynchronizationContext.Current
                   ?? throw new InvalidOperationException("no WinForms SynchronizationContext");

        // BUILD MARKER — bump this string on every native change so host.log unambiguously proves which
        // build is actually running (rules out `dotnet run` serving a stale incremental build).
        Log("=== BUILD popup-foreground-v13 (persistent-topmost + AttachThreadInput foreground-steal for OAuth popups; reanchor via powerMonitor) ===");
        Log($"dpi SetHighDpiMode(PerMonitorV2) ok={dpiOk} applied={Application.HighDpiMode}");
        Log($"start ipc parentHwnd={opts.ParentHwnd} userData={opts.UserDataFolder}");
        // Log the installed WebView2 Evergreen runtime version (confirmed 150.x supports multiple controllers
        // per profile — the basis for warm same-Space siblings + shared login). Kept as a useful diagnostic.
        try { Log($"webview2 runtime version = {CoreWebView2Environment.GetAvailableBrowserVersionString()}"); }
        catch (Exception ex) { Log($"webview2 runtime version LOOKUP FAILED: {ex.Message}"); }
        var host = new HostContext(opts.UserDataFolder, IpcEmit);
        var reader = new Thread(() => ReadStdinLoop(sync, host)) { IsBackground = true, Name = "stdin" };

        // POST-SLEEP / POST-UNLOCK INPUT RECOVERY — SECONDARY (S3-only) path. Across sleep/unlock the OS
        // silently tears down the AttachThreadInput merge that routes mouse+keyboard into the visible webview,
        // leaving it frozen until manually parked+revealed. These .NET SystemEvents fire on classic S3 sleep
        // but NOT on Windows Modern Standby (S0) — the Surface sleep mode — which is why v11 didn't recover.
        // The PRIMARY trigger is now the Electron `powerMonitor` → `reanchor` IPC command (see main.cjs and
        // the "reanchor" case in HostContext.Dispatch), which is reliable on S0. We keep these too as a
        // belt-and-suspenders fallback for non-Modern-Standby machines; the reanchor is cheap + idempotent so
        // firing from both paths is harmless. SystemEvents runs on its own thread, so marshal onto the UI
        // thread (AttachThreadInput must run there); fire immediately + after a delay to ride out wake lag.
        void ScheduleReanchor(string reason)
        {
            Program.Log($"schedule reanchor reason={reason}");
            sync.Post(_ => SafeReanchor(host, reason + ":now"), null);
            _ = Task.Delay(700).ContinueWith(_ => sync.Post(__ => SafeReanchor(host, reason + ":delayed"), null));
        }
        Microsoft.Win32.SystemEvents.PowerModeChanged += (_, e) =>
        {
            if (e.Mode == Microsoft.Win32.PowerModes.Resume) ScheduleReanchor("power-resume");
        };
        Microsoft.Win32.SystemEvents.SessionSwitch += (_, e) =>
        {
            if (e.Reason == Microsoft.Win32.SessionSwitchReason.SessionUnlock) ScheduleReanchor("session-unlock");
        };

        // CRITICAL: create the WebView2 environment FIRST, then emit "ready" and start reading commands.
        // Emitting ready before _env exists lets early mounts race in and fail with "env not ready"
        // (that was the v0.2.205 bug: first resource errored, later ones rendered blank). If env init
        // throws (e.g. the WebView2 Evergreen runtime is missing) we emit "fatal" so the Electron side
        // falls back to its WebContentsView path instead of showing a dead surface.
        sync.Post(async _ =>
        {
            try
            {
                await host.InitializeAsync(opts.ParentHwnd);
                Log("env ready");
                reader.Start();
                IpcEmit(new { evt = "ready" });
            }
            catch (Exception ex)
            {
                Log("FATAL env init: " + ex);
                IpcEmit(new { evt = "fatal", message = "WebView2 init failed: " + ex.Message });
                Application.Exit();
            }
        }, null);

        Application.Run(pump);
        return 0;
    }

    // Re-anchor the visible webview's input, never throwing (a recovery path must not crash the pump).
    private static void SafeReanchor(HostContext host, string reason)
    {
        try { host.ReanchorVisibleInput(reason); }
        catch (Exception ex) { Log($"reanchor error ({reason}): {ex.Message}"); }
    }

    // ---- file logging (packaged builds have no visible console) ----
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ZeroResourceHost", "host.log");
    // Folder that holds host.log — the intuitive place to drop the zero-debug-evict escape-hatch flag file.
    internal static string LogDir => Path.GetDirectoryName(LogPath)!;
    private static readonly object _logLock = new();
    internal static void Log(string msg)
    {
        try
        {
            lock (_logLock)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
                File.AppendAllText(LogPath, $"{DateTime.Now:HH:mm:ss.fff} {msg}{Environment.NewLine}");
            }
        }
        catch { /* logging must never throw */ }
    }

    // ---- stdin command loop (background thread) ----
    private static void ReadStdinLoop(SynchronizationContext sync, HostContext host)
    {
        using var stdin = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8);
        string? line;
        while ((line = stdin.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            string captured = line;
            Log("< " + captured);
            // Marshal onto the UI thread — all WebView2 controller work must happen there.
            sync.Post(_ =>
            {
                try { host.Dispatch(captured); }
                catch (Exception ex) { Log("dispatch error: " + ex); IpcEmit(new { evt = "error", message = ex.Message }); }
            }, null);
        }
        // stdin closed => Electron is gone. Exit the pump.
        sync.Post(_ => Application.Exit(), null);
    }

    // ---- stdout event writer (thread-safe, newline-delimited JSON) ----
    private static readonly object _outLock = new();
    internal static void IpcEmit(object evt)
    {
        string json = JsonSerializer.Serialize(evt);
        Log("> " + json);
        lock (_outLock)
        {
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }
    }

    private sealed record Options(bool Ipc, IntPtr ParentHwnd, string UserDataFolder);

    private static Options ParseArgs(string[] args)
    {
        bool ipc = false;
        IntPtr parent = IntPtr.Zero;
        string udf = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ZeroResourceHost", "profiles");

        foreach (var a in args)
        {
            if (a == "--ipc") ipc = true;
            else if (a == "--demo") ipc = false;
            else if (a.StartsWith("--parent-hwnd=", StringComparison.Ordinal))
            {
                var v = a.Substring("--parent-hwnd=".Length);
                if (long.TryParse(v, out var n)) parent = new IntPtr(n);
            }
            else if (a.StartsWith("--user-data=", StringComparison.Ordinal))
            {
                udf = a.Substring("--user-data=".Length);
            }
        }
        Directory.CreateDirectory(udf);
        return new Options(ipc, parent, udf);
    }

    // Hidden message-pump form for IPC mode.
    private sealed class PumpForm : Form
    {
        public PumpForm()
        {
            ShowInTaskbar = false;
            WindowState = FormWindowState.Minimized;
            FormBorderStyle = FormBorderStyle.None;
            Load += (_, _) => Visible = false;
        }
        protected override void SetVisibleCore(bool value) => base.SetVisibleCore(false);
    }
}
