using System.Windows.Forms;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// Zero SHELL host — entry point (M1 of the "delete Electron, WebView2 everywhere" plan).
//
// A single native (WinForms) process that hosts Zero's own UI in WebView2. In M1 it only renders
// Zero's static export; M2 will add browsed content as composition visuals in the SAME window, and
// M4 deletes the Electron shell entirely. Until then this runs BESIDE Electron as a parallel build.
// ---------------------------------------------------------------------------
static class Program
{
    [STAThread]
    static void Main()
    {
        // High-DPI mode (PerMonitorV2) is configured via <ApplicationHighDpiMode> in the csproj, which
        // ApplicationConfiguration.Initialize() applies; the app.manifest declares the matching process
        // DPI awareness that actually governs WebView2 scaling. Nothing to set imperatively here.
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
