using System.Text.Json;

namespace Zero.ResourceHost;

// Standalone dev harness for M1. Drives a real HostContext (the SAME code Electron will drive over IPC)
// via in-process JSON commands, so `dotnet run` exercises the controller-based multi-view model:
// three resources mounted into one window, switched by a tab bar, each with its own persistent profile,
// plus an address bar + back/forward/reload. Confirms mount/switch/park/navigate/persist before M2.
internal sealed class DemoForm : Form
{
    private readonly HostContext _host;
    private readonly Panel _chrome;
    private readonly TextBox _address;
    private readonly FlowLayoutPanel _tabs;
    private readonly Dictionary<string, (string url, string profile)> _resources = new()
    {
        ["akiflow"] = ("https://www.akiflow.com", "akiflow"),
        ["figma"] = ("https://www.figma.com", "figma"),
        ["gmail"] = ("https://mail.google.com", "gmail"),
    };
    private string _active = "akiflow";
    private const int ChromeH = 40;

    public DemoForm(string userDataFolder)
    {
        Text = "Zero Resource Host — M1 demo";
        Width = 1280;
        Height = 860;
        StartPosition = FormStartPosition.CenterScreen;

        _host = new HostContext(userDataFolder, OnEvent);

        _chrome = new Panel { Dock = DockStyle.Top, Height = ChromeH };
        _tabs = new FlowLayoutPanel { Dock = DockStyle.Left, Width = 260, WrapContents = false, Padding = new Padding(4) };
        _address = new TextBox { Dock = DockStyle.Fill, Margin = new Padding(4) };

        foreach (var key in _resources.Keys)
        {
            var b = new Button { Text = key, Width = 76, Height = 30, Tag = key };
            b.Click += (_, _) => Switch((string)b.Tag!);
            _tabs.Controls.Add(b);
        }

        var nav = new FlowLayoutPanel { Dock = DockStyle.Right, Width = 260, WrapContents = false };
        AddNavButton(nav, "◀", () => Send(new { cmd = "back", id = _active }));
        AddNavButton(nav, "▶", () => Send(new { cmd = "forward", id = _active }));
        AddNavButton(nav, "⟳", () => Send(new { cmd = "reload", id = _active }));
        AddNavButton(nav, "Go", () => Send(new { cmd = "navigate", id = _active, url = _address.Text }));

        _chrome.Controls.Add(_address);
        _chrome.Controls.Add(nav);
        _chrome.Controls.Add(_tabs);
        Controls.Add(_chrome);

        Load += async (_, _) =>
        {
            await _host.InitializeAsync(Handle);
            // Mount all three; show the active one, park the rest (kept warm, like Zero's LRU pool).
            foreach (var (key, val) in _resources)
                Send(new { cmd = "mount", id = key, url = val.url, profile = val.profile, rect = ViewRect(), visible = key == _active });
            _address.Text = _resources[_active].url;
        };
        Resize += (_, _) => Send(new { cmd = "setBounds", id = _active, rect = ViewRect() });
    }

    private void AddNavButton(Control parent, string text, Action onClick)
    {
        var b = new Button { Text = text, Width = 44, Height = 30 };
        b.Click += (_, _) => onClick();
        parent.Controls.Add(b);
    }

    private void Switch(string key)
    {
        if (key == _active) return;
        Send(new { cmd = "park", id = _active });
        _active = key;
        Send(new { cmd = "setBounds", id = _active, rect = ViewRect() });
        Send(new { cmd = "show", id = _active });
        _address.Text = _resources[_active].url;
    }

    // The view fills the client area below the chrome bar.
    private object ViewRect() => new { x = 0, y = ChromeH, w = ClientSize.Width, h = Math.Max(0, ClientSize.Height - ChromeH) };

    private void Send(object cmd) => _host.Dispatch(JsonSerializer.Serialize(cmd));

    // Reflect host events back into the demo chrome (title/url), so we can see nav state working.
    private void OnEvent(object evt)
    {
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (!root.TryGetProperty("evt", out var evEl)) return;
        string ev = evEl.GetString() ?? "";
        string id = root.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";

        if (ev == "url" && id == _active && root.TryGetProperty("url", out var u))
        {
            var url = u.GetString() ?? "";
            BeginInvoke(() => { if (!_address.Focused) _address.Text = url; });
        }
        else if (ev == "title" && id == _active && root.TryGetProperty("title", out var t))
        {
            var title = t.GetString() ?? "";
            BeginInvoke(() => Text = $"Zero Resource Host — {title}");
        }
    }
}
