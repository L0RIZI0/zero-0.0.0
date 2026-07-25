using System.Drawing;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Zero.WebView2.Spike;

// ---------------------------------------------------------------------------
// Zero WebView2 ergonomics spike (Milestone 0 of the WebView2 migration plan).
//
// Purpose: prove the INTEGRATION wires the things the bare pywebview probe
// lacked, on real WebView2 (Edge's Chromium):
//   1. text selection (click-drag highlight)      -> engine-native
//   2. right-click context menu (Copy/Paste/Back) -> AreDefaultContextMenusEnabled
//   3. drag                                        -> engine-native
//   4. PERSISTENT login profile across restarts    -> custom UserDataFolder
//   5. POPUP OAuth (figma "Continue with Google")   -> NewWindowRequested handled
//      with a child WebView2 in the SAME environment/profile so the popup shares
//      auth cookies and its postMessage reaches window.opener (the piece the bare
//      probe missed -> figma showed "Unable to get profile information from Google"
//      and fell back to the system browser).
//
// This is throwaway. It is NOT part of Zero's build or release pipeline.
// ---------------------------------------------------------------------------

static class Program
{
    // Persistent profile dir NEXT TO the exe, so Google logins survive an app
    // restart. This is the spike's stand-in for Zero's per-resource persistent
    // login partitions.
    public static readonly string UserDataFolder =
        Path.Combine(AppContext.BaseDirectory, "zero-spike-profile");

    // One shared WebView2 environment => the main view and every OAuth popup
    // share the same cookie/session store (essential for popup-flow OAuth).
    public static CoreWebView2Environment? SharedEnv;

    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }

    public static async Task<CoreWebView2Environment> GetEnvAsync()
    {
        return SharedEnv ??= await CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,   // use the installed Evergreen runtime
            userDataFolder: UserDataFolder);
    }
}

// ---------------------------------------------------------------------------
// Main window: a minimal address bar + shortcut buttons + a full-bleed WebView2.
// ---------------------------------------------------------------------------
sealed class MainForm : Form
{
    private readonly WebView2 _web = new();
    private readonly TextBox _url = new();

    public MainForm()
    {
        Text = "Zero WebView2 Spike";
        Width = 1280;
        Height = 900;
        StartPosition = FormStartPosition.CenterScreen;

        var bar = new Panel { Dock = DockStyle.Top, Height = 40, Padding = new Padding(4) };
        var btnAki = new Button { Text = "akiflow", Dock = DockStyle.Left, Width = 90 };
        var btnFig = new Button { Text = "figma", Dock = DockStyle.Left, Width = 80 };
        var btnGmail = new Button { Text = "gmail", Dock = DockStyle.Left, Width = 80 };
        var btnGo = new Button { Text = "Go", Dock = DockStyle.Right, Width = 60 };

        _url.Dock = DockStyle.Fill;
        _url.Font = new Font("Segoe UI", 11f);

        btnAki.Click += (_, _) => Navigate("https://www.akiflow.com");
        btnFig.Click += (_, _) => Navigate("https://www.figma.com");
        btnGmail.Click += (_, _) => Navigate("https://accounts.google.com");
        btnGo.Click += (_, _) => Navigate(_url.Text);
        _url.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Enter)
            {
                Navigate(_url.Text);
                e.SuppressKeyPress = true;
            }
        };

        // Docked controls are added in reverse visual order (Fill last-ish).
        bar.Controls.Add(_url);
        bar.Controls.Add(btnGo);
        bar.Controls.Add(btnGmail);
        bar.Controls.Add(btnFig);
        bar.Controls.Add(btnAki);

        _web.Dock = DockStyle.Fill;

        Controls.Add(_web); // Fill first so it sits under the top bar
        Controls.Add(bar);

        Load += async (_, _) => await InitAsync();
    }

    private async Task InitAsync()
    {
        var env = await Program.GetEnvAsync();
        await _web.EnsureCoreWebView2Async(env);

        var s = _web.CoreWebView2.Settings;
        s.AreDefaultContextMenusEnabled = true; // (2) right-click menu
        s.AreDevToolsEnabled = true;
        s.IsStatusBarEnabled = true;

        _web.CoreWebView2.NewWindowRequested += OnNewWindowRequested; // (5) popup OAuth
        _web.CoreWebView2.SourceChanged += (_, _) =>
            _url.Text = _web.Source?.ToString() ?? "";
        _web.CoreWebView2.DocumentTitleChanged += (_, _) =>
            Text = $"Zero WebView2 Spike  —  {_web.CoreWebView2.DocumentTitle}";

        Navigate("https://www.akiflow.com");
    }

    private void Navigate(string input)
    {
        if (string.IsNullOrWhiteSpace(input) || _web.CoreWebView2 is null) return;
        if (!input.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            input = "https://" + input;
        _web.CoreWebView2.Navigate(input);
    }

    // Popup OAuth: create the child window as a WebView2 in the SAME shared
    // environment (same profile => shared auth). We hand WebView2 the new
    // CoreWebView2 via e.NewWindow; WebView2 then drives it to the requested URI
    // itself, and its postMessage can reach the opener. This is exactly the
    // plumbing the bare pywebview probe lacked.
    private async void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        var deferral = e.GetDeferral();
        try
        {
            var popup = new PopupForm();
            popup.Show(this);
            await popup.EnsureReadyAsync(await Program.GetEnvAsync());
            e.NewWindow = popup.Core;
            e.Handled = true;
        }
        finally
        {
            deferral.Complete();
        }
    }
}

// ---------------------------------------------------------------------------
// OAuth popup window: a WebView2 sharing the main environment/profile.
// ---------------------------------------------------------------------------
sealed class PopupForm : Form
{
    private readonly WebView2 _web = new();

    public CoreWebView2 Core => _web.CoreWebView2;

    public PopupForm()
    {
        Text = "Sign in";
        Width = 520;
        Height = 660;
        StartPosition = FormStartPosition.CenterParent;
        _web.Dock = DockStyle.Fill;
        Controls.Add(_web);
    }

    public async Task EnsureReadyAsync(CoreWebView2Environment env)
    {
        await _web.EnsureCoreWebView2Async(env);
        _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
        // Let the site close its own popup (OAuth calls window.close() when done).
        _web.CoreWebView2.WindowCloseRequested += (_, _) => Close();
        _web.CoreWebView2.DocumentTitleChanged += (_, _) =>
            Text = _web.CoreWebView2.DocumentTitle;
    }
}
