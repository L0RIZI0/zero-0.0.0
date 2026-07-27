using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace Zero.ResourceHost;

// Win32 helpers for embedding a host-owned child window under Electron's (another process's) window.
// Parenting the WebView2 controller DIRECTLY into Electron's HWND renders it BEHIND Electron's opaque
// Chromium content HWND (v0.2.205 "blank" bug: the view loaded + was positioned at x:0 but was occluded).
// Instead each view gets its own borderless Form, SetParent'd under Electron's HWND and kept at the TOP of
// the sibling z-order so it paints above the page — the same own-window model that made the M1 demo render.
internal static class NativeMethods
{
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    // Cross-process focus: link our host UI thread's input queue to Electron's so keyboard routing works
    // for the embedded (SetParent'd) WebView2. Without this, keys only reach us while our process happens
    // to be foreground; once Electron reasserts, input dies.
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    // Validate an HWND is still a real window (parent-HWND churn can leave us pointing at a destroyed window).
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    // Hand keyboard focus to another window (used to release focus back to Electron when a Zero UI field is
    // clicked). Works cross-thread because our input queue is merged with Electron's while a webview is visible.
    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr hWnd);

    public const int GWL_STYLE = -16;
    public const int WS_CHILD = unchecked((int)0x40000000);
    public const int WS_VISIBLE = unchecked((int)0x10000000);
    public const int WS_CLIPSIBLINGS = unchecked((int)0x04000000);
    public const int WS_POPUP = unchecked((int)0x80000000);
    public const int WS_CAPTION = 0x00C00000;
    public const int WS_THICKFRAME = 0x00040000;

    public static readonly IntPtr HWND_TOP = IntPtr.Zero;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public const uint SWP_HIDEWINDOW = 0x0080;
    public const uint SWP_NOZORDER = 0x0004;

    public const int WM_SETFOCUS = 0x0007;
    public const int WM_MOUSEACTIVATE = 0x0021;
    public const int MA_ACTIVATE = 1;
}

// The container that hosts the WebView2. WebView2 is cross-process, so Win32 keyboard focus is unreliable:
// when the WebView2 relinquishes focus (mid-navigation, a page calling focus(), etc.) it hands focus back to
// THIS parent HWND — and with no handler the keyboard goes dead (symptom: "type a few seconds, then input
// stops"). We intercept WM_SETFOCUS + WM_MOUSEACTIVATE and PostMessage-defer (BeginInvoke) MoveFocus back
// INTO the WebView2 — a self-healing loop. The defer is REQUIRED: calling MoveFocus synchronously inside the
// focus message lets Windows overwrite it right after (per WebView2 hosting guidance).
internal sealed class ContainerForm : Form
{
    // Set by ResourceView once the controller exists; pushes focus into the WebView2.
    public Action? ReseedFocus;
    private bool _reseedQueued;

    private void QueueReseed()
    {
        if (_reseedQueued || ReseedFocus is null || IsDisposed) return;
        _reseedQueued = true;
        try { BeginInvoke(new Action(() => { _reseedQueued = false; ReseedFocus?.Invoke(); })); }
        catch { _reseedQueued = false; }
    }

    protected override void WndProc(ref Message m)
    {
        switch (m.Msg)
        {
            case NativeMethods.WM_MOUSEACTIVATE:
                base.WndProc(ref m);
                m.Result = (IntPtr)NativeMethods.MA_ACTIVATE; // a click activates us + seeds focus into the webview
                Program.Log("container WM_MOUSEACTIVATE -> reseed");
                QueueReseed();
                return;
            case NativeMethods.WM_SETFOCUS:
                base.WndProc(ref m);
                Program.Log("container WM_SETFOCUS -> reseed"); // if this NEVER logs, focus is taken above us
                QueueReseed(); // webview handed focus back to us -> push it straight back in
                return;
        }
        base.WndProc(ref m);
    }
}

// Owns the shared WebView2 environment and the live set of resource views. All methods run on the
// UI thread (commands are marshalled there by Program). Events are emitted via the `_emit` callback.
internal sealed class HostContext
{
    private readonly string _userDataFolder;
    private readonly Action<object> _emit;
    private readonly Dictionary<string, ResourceView> _views = new();
    // One CoreWebView2Environment (+ its own on-disk user-data folder) PER ENV KEY, reused across all
    // resources sharing that key. The key is the renderer-supplied `profile` = CONTEXT ENV KEY
    // (`env-<nearestSpaceAncestorId>`); resources under one Space share it (SSO within a Space), resources
    // under different Spaces get separate keys (isolation across Spaces). Falls back to the site host when
    // no profile is supplied. Separate environments never contend, which eliminates the intermittent
    // 0x8007139F (ERROR_INVALID_STATE) we saw when a new controller was created on a PROFILE a just-closed
    // controller had been using inside ONE shared environment — that structural guarantee is UNCHANGED here
    // (still one folder ⇒ one environment ⇒ one profile); only WHAT the key is has changed (Space, not host).
    private readonly Dictionary<string, CoreWebView2Environment> _envByKey = new();
    private readonly Dictionary<string, Task<CoreWebView2Environment>> _envPending = new();
    private IntPtr _parentHwnd;

    // MULTI-LIVE IS THE DEFAULT. Proven on Loris's runtime (150.0.4078.99): multiple CoreWebView2 controllers
    // sharing ONE profile coexist fine (host.log host-wh1rI: liveNow reached 4, two controllers on one env,
    // every create OK attempt=1, no 0x8007139F) — so web resources of a Space stay WARM simultaneously AND
    // share login. Eviction (one-live-per-profile, the RUN #18 fallback) is therefore OFF unless explicitly
    // re-enabled via an ESCAPE-HATCH flag file `zero-debug-evict` (in the host.log folder OR the user-data
    // folder — we check both). Keep it as a no-rebuild kill switch in case the concurrent-open-during-load
    // edge (two sibling sites opened within one env before the first finishes loading — the original
    // 0x8007139F trigger, not exercised in the passing log) ever regresses in the wild.
    private readonly bool _noEvict;

    public HostContext(string userDataFolder, Action<object> emit)
    {
        _userDataFolder = userDataFolder;
        _emit = emit;
        try
        {
            var candidates = new[]
            {
                Path.Combine(userDataFolder, "zero-debug-evict"),
                Path.Combine(Program.LogDir, "zero-debug-evict"),
            };
            var hit = candidates.FirstOrDefault(File.Exists);
            _noEvict = hit == null; // default (no flag) = multi-live; flag present = re-enable eviction
            Program.Log(_noEvict
                ? "multi-live ENABLED (default): multiple controllers per profile, warm siblings + shared login"
                : $"eviction RE-ENABLED (zero-debug-evict present at {hit}): one live controller per profile");
        }
        catch { _noEvict = true; }
    }

    public Task InitializeAsync(IntPtr parentHwnd)
    {
        _parentHwnd = parentHwnd;
        // Environments are now created lazily per env key (GetEnvForKeyAsync). Nothing to pre-create here.
        return Task.CompletedTask;
    }

    // The ENVIRONMENT KEY for a mount. The renderer's `profile` (`env-<nearestSpaceAncestorId>`) is
    // authoritative — that's the CONTEXT env-keying (SSO within a Space, isolation across Spaces). If no
    // profile is supplied (older renderer / prewarm without a key), fall back to the site host so behavior
    // degrades to the previous per-site isolation rather than dumping everything into one shared env.
    private static string EnvKey(string profile, string url)
        => string.IsNullOrEmpty(profile) ? SiteKey(url) : ResourceView.SanitizeProfile(profile);

    // Fallback keying: registrable-ish host (drop leading www.). Used only when no context env key is passed.
    private static string SiteKey(string url)
    {
        string host;
        try { host = new Uri(url).Host; } catch { host = "site"; }
        if (host.StartsWith("www.")) host = host.Substring(4);
        return ResourceView.SanitizeProfile(host);
    }

    // Lazily create (and cache) the environment for an env key. De-dupes concurrent creations of the same key
    // via _envPending so a rapid double-mount can't spin up two environments on the same folder (which would
    // itself throw INVALID_STATE — the folder can only back one environment at a time).
    private Task<CoreWebView2Environment> GetEnvForKeyAsync(string envKey)
    {
        if (_envByKey.TryGetValue(envKey, out var env))
        {
            // DIAGNOSTIC: prove the env is REUSED (same instance) for every controller of a key. If a shared
            // profile's 2nd controller fails while this logs the SAME env#, the folder isn't the problem — the
            // cause is runtime/profile-lock, not two environments on one folder.
            Program.Log($"env CACHED key={envKey} env#={System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(env)}");
            return Task.FromResult(env);
        }
        if (_envPending.TryGetValue(envKey, out var pending)) return pending;
        var folder = Path.Combine(_userDataFolder, "envs", envKey);
        var task = CreateEnvAsync(envKey, folder);
        _envPending[envKey] = task;
        return task;
    }

    private async Task<CoreWebView2Environment> CreateEnvAsync(string envKey, string folder)
    {
        try
        {
            Program.Log($"env create NEW key={envKey} folder={folder}");
            var env = await CoreWebView2Environment.CreateAsync(null, folder, null);
            _envByKey[envKey] = env;
            Program.Log($"env created key={envKey} env#={System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(env)}");
            return env;
        }
        finally { _envPending.Remove(envKey); }
    }

    // Parse one JSON command line and act on it.
    public void Dispatch(string line)
    {
        using var doc = JsonDocument.Parse(line);
        var root = doc.RootElement;
        string cmd = root.GetProperty("cmd").GetString() ?? "";
        string Id() => root.GetProperty("id").GetString() ?? "";

        switch (cmd)
        {
            case "mount": Mount(Id(), Str(root, "url"), Str(root, "profile"), Rect(root), Bool(root, "visible", true)); break;
            case "setBounds": if (_views.TryGetValue(Id(), out var vb)) vb.SetBounds(Rect(root)); break;
            case "show": if (_views.TryGetValue(Id(), out var vs)) vs.SetVisible(true); break;
            case "hide": if (_views.TryGetValue(Id(), out var vh)) vh.SetVisible(false); break;
            case "park": if (_views.TryGetValue(Id(), out var vp)) vp.SetVisible(false); break; // hide, keep alive
            case "close": Close(Id()); break;
            case "navigate": if (_views.TryGetValue(Id(), out var vn)) vn.Navigate(Str(root, "url")); break;
            case "back": if (_views.TryGetValue(Id(), out var vbk)) vbk.GoBack(); break;
            case "forward": if (_views.TryGetValue(Id(), out var vf)) vf.GoForward(); break;
            case "reload": if (_views.TryGetValue(Id(), out var vr)) vr.Reload(); break;
            case "setZoom": if (_views.TryGetValue(Id(), out var vz)) vz.SetZoom(Dbl(root, "zoom", 1.0)); break;
            case "setParent": Reparent(new IntPtr(root.GetProperty("parentHwnd").GetInt64())); break;
            case "releaseFocus": ReleaseFocusToParent(); break;
            case "shutdown": Shutdown(); break;
            default: _emit(new { evt = "error", message = $"unknown cmd: {cmd}" }); break;
        }
    }

    private void Mount(string id, string url, string profile, Rectangle rect, bool visible)
    {
        // Idempotent re-mount = REVEAL a warm/parked view (mirrors the WebContentsView path): re-apply
        // bounds + show and re-announce mounted, but DON'T reload if the url is unchanged.
        if (_views.TryGetValue(id, out var existing))
        {
            existing.SetBounds(rect);
            existing.SetVisible(visible);
            if (existing.HasController)
            {
                existing.NavigateIfChanged(url);
            }
            else
            {
                // The view was SHED (its controller closed to satisfy one-live-per-profile). Re-create it now
                // — this will evict whatever sibling is currently live on the profile, so the two web
                // resources in a Space take turns being live while both stay signed in.
                _ = MountControllerAsync(existing, id, url, profile);
            }
            _emit(new { evt = "mounted", id });
            return;
        }

        var view = new ResourceView(id, _emit);
        _views[id] = view;
        // Desired state is set now; the controller applies it once its async creation finishes.
        view.SetBounds(rect);
        view.SetVisible(visible);
        _ = MountControllerAsync(view, id, url, profile);
    }

    // FALLBACK: one live controller per profile. OFF by default now that multi-live is proven to work —
    // only runs when the `zero-debug-evict` escape-hatch flag re-enables it. When active, before a view goes
    // live on `profile` it sheds any OTHER live view sharing it (shared login survives — cookies are on disk;
    // the shed view reloads on next reveal), trading warm same-profile siblings for guaranteed no-0x8007139F.
    private void EvictLiveInProfile(string profile, string exceptId)
    {
        if (_noEvict)
        {
            return; // multi-live default: keep every controller warm
        }
        foreach (var kv in _views)
        {
            if (kv.Key == exceptId) continue;
            if (kv.Value.HasController && kv.Value.Profile == profile)
            {
                Program.Log($"evict-for-profile id={kv.Key} profile={profile} incoming={exceptId}");
                kv.Value.ShedController();
            }
        }
    }

    // Resolve the CONTEXT environment (keyed by the renderer's `profile` = env-<nearestSpaceAncestorId>),
    // then create the controller in it. Fire-and-forget from Mount. The env key is ALSO used as the WebView2
    // profile name, so all resources sharing a key share one login inside that key's own environment (SSO
    // within a Space). Login stays isolated ACROSS keys — each key is its own folder, which is the same
    // one-folder-one-environment structure that fixed the 0x8007139F bug.
    private async Task MountControllerAsync(ResourceView view, string id, string url, string profile)
    {
        try
        {
            var envKey = EnvKey(profile, url);
            var env = await GetEnvForKeyAsync(envKey);
            // The view may have been closed while its environment was being created.
            if (!_views.TryGetValue(id, out var still) || still != view) { return; }
            // One-live-per-profile: shed any sibling currently live on this profile BEFORE we create, so our
            // create doesn't hit 0x8007139F. CreateAsync's delay+retry loop rides out the brief profile
            // user-data-dir teardown window left by the shed (the original 0x8007139F trigger the retries
            // were designed for — now actually effective because the conflicting controller is really closed).
            EvictLiveInProfile(ResourceView.SanitizeProfile(envKey), id);
            await view.CreateAsync(env, _parentHwnd, envKey, url);
        }
        catch (Exception ex)
        {
            Program.Log($"mount failed id={id} err={ex.Message}");
            _emit(new { evt = "error", id, message = "create failed: " + ex.Message });
        }
    }

    private void Close(string id)
    {
        if (_views.Remove(id, out var v))
        {
            v.Dispose();
            _emit(new { evt = "closed", id });
        }
    }

    private void Reparent(IntPtr parent)
    {
        _parentHwnd = parent;
        foreach (var v in _views.Values) v.Reparent(parent);
    }

    // Hand keyboard focus back to Electron (Zero's own UI). Called when the user clicks a Zero input while a
    // webview is displayed. Cross-thread SetFocus works because the input queues are merged while visible.
    // Chromium restores focus to whatever DOM element the renderer focuses next.
    private void ReleaseFocusToParent()
    {
        if (_parentHwnd == IntPtr.Zero || !NativeMethods.IsWindow(_parentHwnd)) return;
        var prev = NativeMethods.SetFocus(_parentHwnd);
        Program.Log($"releaseFocus -> electron={_parentHwnd} prevFocus={prev}");
    }

    private void Shutdown()
    {
        foreach (var v in _views.Values) v.Dispose();
        _views.Clear();
        Application.Exit();
    }

    // ---- small JSON helpers ----
    private static string Str(JsonElement e, string k) => e.TryGetProperty(k, out var v) ? v.GetString() ?? "" : "";
    private static bool Bool(JsonElement e, string k, bool d) => e.TryGetProperty(k, out var v) ? v.GetBoolean() : d;
    private static double Dbl(JsonElement e, string k, double d) => e.TryGetProperty(k, out var v) ? v.GetDouble() : d;
    private static Rectangle Rect(JsonElement e)
    {
        if (!e.TryGetProperty("rect", out var r)) return Rectangle.Empty;
        int G(string k) => r.TryGetProperty(k, out var v) ? (int)Math.Round(v.GetDouble()) : 0;
        return new Rectangle(G("x"), G("y"), G("w"), G("h"));
    }
}

// One resource surface = one CoreWebView2Controller parented into the host window, floated at a rect.
// Uses a desired-state model so commands that arrive before the controller finishes creating are not lost.
internal sealed class ResourceView : IDisposable
{
    private readonly string _id;
    private readonly Action<object> _emit;
    private CoreWebView2Controller? _controller;
    private CoreWebView2Environment? _env;
    // Host-owned borderless child window that actually hosts the WebView2 (see NativeMethods for why).
    private ContainerForm? _host;
    private IntPtr _parentHwnd;
    // Last state pushed to SetWindowPos, so ApplyBounds can skip no-ops and only raise z-order on reveal.
    private Rectangle _appliedBounds = Rectangle.Empty;
    private bool _appliedShown;
    private bool _hasApplied;
    // Electron UI thread our (single, process-wide) input queue is attached to (0 = none). STATIC because all
    // views share one host UI thread; AttachThreadInput links a THREAD PAIR (not refcounted), so a per-view
    // attach/detach would let closing one view kill keyboard input for the others.
    private static uint _attachedThread;
    // How many resource views are currently VISIBLE (process-wide). We keep the input queues merged ONLY while
    // >=1 webview is visible; when it drops to 0 we DETACH so Electron regains independent keyboard focus for
    // Zero's own UI. A permanent (static) attach made any alive-but-hidden webview starve Zero's inputs.
    private static int _visibleCount;
    private bool _countedVisible; // does THIS view currently contribute to _visibleCount?

    // Serialize controller creation across ALL resources. Two CreateCoreWebView2ControllerAsync calls
    // overlapping on one environment throw ERROR_INVALID_STATE (0x8007139F) — the "second resource fails"
    // bug. This gate ensures only one creation runs at a time. _liveControllers is diagnostics only.
    private static readonly SemaphoreSlim _createGate = new(1, 1);
    private static int _liveControllers;

    // desired state (applied when controller becomes ready)
    private Rectangle _bounds;
    private bool _visible = true;
    private double _zoom = 1.0;
    private string? _pendingNavigate;
    private string _profile = "default";
    private bool _disposed;

    public ResourceView(string id, Action<object> emit) { _id = id; _emit = emit; }

    public async Task CreateAsync(CoreWebView2Environment env, IntPtr parentHwnd, string profile, string url)
    {
        _env = env;
        _pendingNavigate = url;
        _profile = SanitizeProfile(profile);
        _parentHwnd = parentHwnd;
        try
        {
            // 1) Host-owned borderless container window. We create + own its HWND (same process as the
            //    controller), so WebView2 renders into it exactly like the M1 demo's own Form did.
            _host = new ContainerForm
            {
                FormBorderStyle = FormBorderStyle.None,
                ShowInTaskbar = false,
                StartPosition = FormStartPosition.Manual,
                Bounds = _bounds.IsEmpty ? new Rectangle(0, 0, 800, 600) : _bounds,
            };
            var hostHandle = _host.Handle; // force creation
            EmbedUnderParent(parentHwnd);

            // 2) Parent the controller into OUR window (client-filling), not Electron's HWND directly.
            //    Environments are keyed per CONTEXT (nearest-Space) so several resources of a Space SHARE a
            //    profile (shared login). Because a profile allows only ONE live controller at a time, the
            //    caller (EvictLiveInProfile) sheds any sibling on this profile just before we create. That
            //    leaves a brief user-data-dir teardown window in which CreateCoreWebView2ControllerAsync can
            //    still throw 0x8007139F — so we serialize with _createGate AND retry with backoff long enough
            //    to outlast the teardown. Full diagnostics on every attempt.
            const int MaxAttempts = 6;
            const uint E_INVALID_STATE = 0x8007139F;
            CoreWebView2Controller? controller = null;

            await _createGate.WaitAsync();
            try
            {
                // DIAGNOSTIC: env# proves whether this create shares the SAME env instance as an already-live
                // controller (it should — one env per key); hostHwnd proves each controller gets its OWN host
                // window (two controllers must NOT share an hwnd). Combined with the runtime-version line at
                // startup + the full exception dump on failure, this pins whether 0x8007139F is a runtime-
                // version limit, a folder/env-duplication bug, or an hwnd collision.
                Program.Log($"create BEGIN id={_id} profile={_profile} live={_liveControllers} " +
                    $"env#={System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(env)} " +
                    $"hostHwnd={hostHandle} " +
                    $"parentOk={NativeMethods.IsWindow(parentHwnd)} hostOk={NativeMethods.IsWindow(hostHandle)} " +
                    $"tid={NativeMethods.GetCurrentThreadId()}");
                for (int attempt = 1; attempt <= MaxAttempts; attempt++)
                {
                    if (_disposed) break;
                    var opts = env.CreateCoreWebView2ControllerOptions();
                    opts.ProfileName = _profile;
                    opts.IsInPrivateModeEnabled = false;
                    try
                    {
                        controller = await env.CreateCoreWebView2ControllerAsync(hostHandle, opts);
                        Program.Log($"create OK id={_id} attempt={attempt} profile={_profile}");
                        break;
                    }
                    catch (COMException ce) when (attempt < MaxAttempts && !_disposed)
                    {
                        // Log the FULL hresult+message so a non-INVALID_STATE cause is visible too.
                        Program.Log($"create attempt {attempt} id={_id} profile={_profile} FAILED " +
                            $"hr=0x{(uint)ce.HResult:X8} isInvalidState={(uint)ce.HResult == E_INVALID_STATE} " +
                            $"msg=\"{ce.Message}\"; retrying");
                        await Task.Delay(150 * attempt); // back off: 150,300,450,600,750 (~2.25s total) to outlast profile teardown
                    }
                }
            }
            finally { _createGate.Release(); }

            if (_disposed) { controller?.Close(); return; }
            if (controller is null) throw new InvalidOperationException("controller creation returned null after retries");
            _controller = controller;
            _liveControllers++;
            Program.Log($"controller live id={_id} liveNow={_liveControllers}");

            var core = controller.CoreWebView2;
            // Relay context menus to Zero's own native menu instead of the browser default (which shows
            // dead edge:// items like "Import passwords"). M2 will render Zero's menu from these events.
            core.Settings.AreDefaultContextMenusEnabled = false;
            WireEvents(core);

            // Self-healing keyboard focus: whenever our container HWND is clicked or handed focus, push it
            // back into the WebView2 (see ContainerForm). Without this, keyboard input dies after focus
            // drifts back to the parent (the cross-process focus bug on the Google login / Figma fields).
            _host.ReseedFocus = () => { try { Program.Log($"reseed MoveFocus id={_id}"); _controller?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic); } catch (Exception ex) { Program.Log($"reseed FAILED id={_id}: {ex.Message}"); } };
            // Accept focus moves the webview requests (e.g. tabbing) instead of leaving it in limbo.
            controller.MoveFocusRequested += (_, e) => { e.Handled = true; try { _controller?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic); } catch { /* ignore */ } };

            // The controller fills the container; the CONTAINER is what we move/size (see SetBounds).
            controller.Bounds = new Rectangle(Point.Empty, _host.ClientSize);
            controller.IsVisible = true;
            controller.ZoomFactor = _zoom;
            ApplyBounds(); // position + z-order the container to the desired rect

            Program.Log($"controller created id={_id} parent={parentHwnd} bounds={_bounds} visible={_visible} profile={_profile}");
            _emit(new { evt = "mounted", id = _id });
            if (!string.IsNullOrEmpty(_pendingNavigate)) core.Navigate(_pendingNavigate);
        }
        catch (Exception ex)
        {
            Program.Log($"create failed id={_id}: {ex}");
            _emit(new { evt = "error", id = _id, message = "create failed: " + ex.Message });
        }
    }

    // Make the container a WS_CHILD of `parent` (Electron's window) without a frame/activation.
    private void EmbedUnderParent(IntPtr parent)
    {
        if (_host == null) return;
        var h = _host.Handle;
        NativeMethods.SetParent(h, parent);
        int style = NativeMethods.GetWindowLong(h, NativeMethods.GWL_STYLE);
        style &= ~(NativeMethods.WS_POPUP | NativeMethods.WS_CAPTION | NativeMethods.WS_THICKFRAME);
        style |= NativeMethods.WS_CHILD | NativeMethods.WS_CLIPSIBLINGS;
        NativeMethods.SetWindowLong(h, NativeMethods.GWL_STYLE, style);
        // NOTE: input-queue attach is NO LONGER done here. It is driven by VISIBILITY (UpdateInputAttach)
        // so a hidden/parked webview never holds keyboard focus away from Zero's own Electron UI.
    }

    // Merge our host UI thread's input queue with Electron's ONLY while a webview is visible; detach when
    // none are. AttachThreadInput links a thread PAIR into one shared focus, so while merged only ONE window
    // (across both processes) can own keyboard focus. A permanent merge meant an alive-but-hidden webview
    // could hold focus and starve Zero's own inputs (create-entity field) — the bug Loris reported. Driven
    // from ApplyBounds visibility transitions + _visibleCount.
    private void UpdateInputAttach()
    {
        try
        {
            bool want = _visibleCount > 0;
            uint self = NativeMethods.GetCurrentThreadId();
            uint electron = _parentHwnd == IntPtr.Zero ? 0 : NativeMethods.GetWindowThreadProcessId(_parentHwnd, out _);
            if (want && electron != 0 && electron != self && _attachedThread == 0)
            {
                bool ok = NativeMethods.AttachThreadInput(self, electron, true);
                if (ok) _attachedThread = electron;
                Program.Log($"AttachThreadInput ATTACH self={self} electron={electron} ok={ok} visible={_visibleCount}");
            }
            else if (!want && _attachedThread != 0)
            {
                bool ok = NativeMethods.AttachThreadInput(self, _attachedThread, false);
                Program.Log($"AttachThreadInput DETACH self={self} electron={_attachedThread} ok={ok} visible={_visibleCount}");
                _attachedThread = 0;
            }
        }
        catch (Exception ex) { Program.Log($"UpdateInputAttach failed: {ex.Message}"); }
    }

    // Position + size the container to _bounds. It's raised above Electron's Chromium content HWND ONCE
    // on reveal (hidden->shown); routine move/size keeps the current z-order (SWP_NOZORDER). CRITICAL:
    // re-raising to HWND_TOP on every update was stealing keyboard focus from the WebView2 mid-typing —
    // the renderer floods setBounds (per-second ticks + crumb animation), and each z-order raise let
    // Chromium reclaim focus (symptom: "type for a few seconds, then input stops"). Also dedupes no-ops.
    private void ApplyBounds()
    {
        if (_host == null) return;
        var h = _host.Handle;
        bool show = _visible && _bounds.X > -10000 && _bounds.Width > 0 && _bounds.Height > 0;

        // Skip if nothing changed since the last apply (kills the redundant per-tick SetWindowPos flood).
        if (_hasApplied && show == _appliedShown && _bounds == _appliedBounds) return;

        // Raise to the top of the sibling z-order ONLY on a genuine hidden->shown reveal. Otherwise keep
        // the current z-order so we never reorder the child window out from under keyboard focus.
        bool raise = show && (!_hasApplied || !_appliedShown);
        uint flags = NativeMethods.SWP_NOACTIVATE
            | (raise ? 0u : NativeMethods.SWP_NOZORDER)
            | (show ? NativeMethods.SWP_SHOWWINDOW : NativeMethods.SWP_HIDEWINDOW);
        NativeMethods.SetWindowPos(h, NativeMethods.HWND_TOP, _bounds.X, _bounds.Y, Math.Max(1, _bounds.Width), Math.Max(1, _bounds.Height), flags);
        if (_controller != null) _controller.Bounds = new Rectangle(0, 0, Math.Max(1, _bounds.Width), Math.Max(1, _bounds.Height));

        // Visibility transition → keep the shared input queue merged only while a webview is visible.
        if (show != _countedVisible)
        {
            _countedVisible = show;
            _visibleCount = Math.Max(0, _visibleCount + (show ? 1 : -1));
            UpdateInputAttach();
            if (show)
            {
                // Freshly visible: pull keyboard focus INTO this webview (deferred, so Windows doesn't overwrite it).
                var reseed = _host.ReseedFocus;
                if (reseed != null) { try { _host.BeginInvoke(reseed); } catch { /* ignore */ } }
            }
        }

        _appliedBounds = _bounds;
        _appliedShown = show;
        _hasApplied = true;
    }

    private void WireEvents(CoreWebView2 core)
    {
        core.DocumentTitleChanged += (_, _) => _emit(new { evt = "title", id = _id, title = core.DocumentTitle });
        core.SourceChanged += (_, _) => _emit(new { evt = "url", id = _id, url = core.Source });
        core.HistoryChanged += (_, _) => _emit(new { evt = "navState", id = _id, canGoBack = core.CanGoBack, canGoForward = core.CanGoForward });
        core.FaviconChanged += (_, _) => _emit(new { evt = "favicon", id = _id, url = core.FaviconUri });
        core.NavigationStarting += (_, e) => _emit(new { evt = "loading", id = _id, loading = true, url = e.Uri });
        core.NavigationCompleted += (_, e) => { Program.Log($"navDone id={_id} ok={e.IsSuccess} status={e.HttpStatusCode} err={e.WebErrorStatus}"); _emit(new { evt = "loading", id = _id, loading = false, ok = e.IsSuccess }); };
        core.DownloadStarting += (_, e) => _emit(new { evt = "download", id = _id, url = e.DownloadOperation.Uri, path = e.ResultFilePath });
        core.ContextMenuRequested += OnContextMenu;
        core.NewWindowRequested += OnNewWindow;
    }

    private void OnContextMenu(object? sender, CoreWebView2ContextMenuRequestedEventArgs e)
    {
        // Suppress the default menu and hand Zero the target info; M2 shows the native menu + sends the action back.
        e.Handled = true;
        var t = e.ContextMenuTarget;
        _emit(new
        {
            evt = "contextMenu",
            id = _id,
            x = e.Location.X,
            y = e.Location.Y,
            selectionText = t.SelectionText,
            linkUri = t.HasLinkUri ? t.LinkUri : null,
            srcUri = t.HasSourceUri ? t.SourceUri : null,
            kind = t.Kind.ToString()
        });
    }

    private void OnNewWindow(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        // OAuth popups (e.g. Figma "Continue with Google"): open a child window hosting a controller in
        // the SAME environment + profile so it shares the login session and postMessage reaches the opener.
        if (_env is null) return;
        var deferral = e.GetDeferral();
        _emit(new { evt = "newWindow", id = _id, url = e.Uri });
        _ = PopupWindow.OpenAsync(_env, _profile, e, deferral);
    }

    // ---- commands (safe before controller ready via desired-state) ----
    // Bounds/visibility drive the host CONTAINER window (positioned + z-ordered), not the controller
    // directly — the controller always fills the container.
    public void SetBounds(Rectangle r) { _bounds = r; if (_host != null) ApplyBounds(); }
    public void SetVisible(bool v) { _visible = v; if (_host != null) ApplyBounds(); }
    public void SetZoom(double z) { _zoom = z; if (_controller != null) _controller.ZoomFactor = z; }
    public void Navigate(string url) { _pendingNavigate = url; _controller?.CoreWebView2.Navigate(url); }
    // Re-mount reveal: only (re)navigate if the target actually changed, so revealing a warm tab does
    // not reload it. Compares against the last requested/loaded url.
    public void NavigateIfChanged(string url)
    {
        if (string.IsNullOrEmpty(url)) return;
        var current = _controller?.CoreWebView2?.Source;
        if (url == _pendingNavigate || url == current) return;
        Navigate(url);
    }
    public void GoBack() { if (_controller?.CoreWebView2.CanGoBack == true) _controller.CoreWebView2.GoBack(); }
    public void GoForward() { if (_controller?.CoreWebView2.CanGoForward == true) _controller.CoreWebView2.GoForward(); }
    public void Reload() => _controller?.CoreWebView2.Reload();
    // Reparent the CONTAINER under a new Electron window (the controller stays parented to the container).
    public void Reparent(IntPtr parent)
    {
        _parentHwnd = parent;
        if (_host != null) { EmbedUnderParent(parent); ApplyBounds(); }
    }

    // Does this view currently hold a live WebView2 controller? False after ShedController (until re-revealed).
    public bool HasController => _controller != null;
    // The (sanitized) profile/env this view is bound to — used to enforce one-live-controller-per-profile.
    public string Profile => _profile;

    // Close ONLY the WebView2 controller (+ its host window) while keeping this ResourceView REGISTERED so it
    // can be transparently re-created on the next reveal. This enforces one-live-controller-per-profile:
    // WebView2 locks a profile's user-data folder to a single live controller, so a second live controller on
    // the same profile throws 0x8007139F (the "blank page" bug). Login is PRESERVED — cookies live on disk in
    // the profile, so the eventual re-create is still signed in; only the in-memory page (scroll/form state)
    // is lost and reloads. Mirrors Dispose's controller teardown but leaves the view alive + re-createable.
    public void ShedController()
    {
        if (_countedVisible) { _countedVisible = false; _visibleCount = Math.Max(0, _visibleCount - 1); UpdateInputAttach(); }
        if (_controller != null) { _liveControllers = Math.Max(0, _liveControllers - 1); Program.Log($"controller shed id={_id} liveNow={_liveControllers}"); }
        try { _controller?.Close(); } catch { /* ignore */ }
        _controller = null;
        try { _host?.Dispose(); } catch { /* ignore */ }
        _host = null;
        // Reset applied-state bookkeeping so a fresh controller re-applies bounds/visibility/z-order cleanly.
        _hasApplied = false;
        _appliedShown = false;
        _appliedBounds = Rectangle.Empty;
        _pendingNavigate = null; // the reveal's url (passed to CreateAsync) drives the reload
    }

    public void Dispose()
    {
        _disposed = true;
        // If this view was visible, release its contribution to the shared input-queue merge so a closed
        // webview never leaves Electron starved of keyboard focus.
        if (_countedVisible) { _countedVisible = false; _visibleCount = Math.Max(0, _visibleCount - 1); UpdateInputAttach(); }
        if (_controller != null) { _liveControllers = Math.Max(0, _liveControllers - 1); Program.Log($"controller closed id={_id} liveNow={_liveControllers}"); }
        try { _controller?.Close(); } catch { /* ignore */ }
        _controller = null;
        try { _host?.Dispose(); } catch { /* ignore */ }
        _host = null;
    }

    internal static string SanitizeProfile(string profile)
    {
        if (string.IsNullOrWhiteSpace(profile)) return "default";
        // WebView2 ProfileName: ^[A-Za-z0-9][A-Za-z0-9 .\-_]*$ , max 64 chars.
        var cleaned = Regex.Replace(profile, @"[^A-Za-z0-9 .\-_]", "-");
        if (cleaned.Length == 0 || !char.IsLetterOrDigit(cleaned[0])) cleaned = "p" + cleaned;
        return cleaned.Length > 64 ? cleaned.Substring(0, 64) : cleaned;
    }
}
