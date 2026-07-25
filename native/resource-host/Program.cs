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

        var host = new HostContext(opts.UserDataFolder, IpcEmit);
        _ = host.InitializeAsync(opts.ParentHwnd);

        var reader = new Thread(() => ReadStdinLoop(sync, host)) { IsBackground = true, Name = "stdin" };
        reader.Start();

        IpcEmit(new { evt = "ready" });
        Application.Run(pump);
        return 0;
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
            // Marshal onto the UI thread — all WebView2 controller work must happen there.
            sync.Post(_ =>
            {
                try { host.Dispatch(captured); }
                catch (Exception ex) { IpcEmit(new { evt = "error", message = ex.Message }); }
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
