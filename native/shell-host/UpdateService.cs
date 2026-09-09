using Velopack;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// Runtime auto-update for the WebView2 shell — the M4 replacement for electron-updater. Backed by
// Velopack (see Program.cs for the mandatory VelopackApp.Build().Run() startup hook), it reproduces the
// `window.zero.updates.*` contract (types/zero-desktop.d.ts) over the WebView2 bridge so the renderer's
// footer pill (components/zero0/zero0-update-indicator.tsx) works UNCHANGED.
//
// UX (Loris, Sep 2026): the old NSIS flow closed Zero, re-ran a full installer, and took ~a minute to
// reopen. Velopack stages the new version as a folder in the background; "applying" is a folder-swap +
// relaunch (seconds). So we DOWNLOAD + STAGE SILENTLY on a background poll and only surface the pill once
// the update is READY — already in the "restart for vX" state. One click ⇒ near-instant restart.
//
// Because we auto-download, we deliberately do NOT emit `updates.available` or `updates.progress` in the
// normal flow (nothing should flicker while it works quietly); the renderer just gets `updates.downloaded`
// when staged, or `updates.error` on failure. The shim keeps onAvailable/onProgress wired for future use.
//
// Threading: Velopack's async work runs off the UI thread, but the `emit` callback ultimately calls
// WebView2.PostWebMessageAsJson, which MUST run on the UI thread. MainForm passes an emit that marshals
// via BeginInvoke, so this class can fire events from any continuation safely.
// ---------------------------------------------------------------------------
sealed class UpdateService
{
    // SEPARATE feed prefix from the Electron app's (/updates). The two shells ship side by side until the
    // Electron cutover, so they must not share a feed — each release script prunes only its own prefix.
    private const string FeedUrl = "https://nxge4raka52ini1u.public.blob.vercel-storage.com/updates-shell";

    // Give the renderer time to mount + subscribe before the first check can fire an event, then poll.
    private static readonly TimeSpan InitialDelay = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(30);

    private readonly Action<string, object?> _emit; // → MainForm.PushEvent (marshalled to UI thread)
    private readonly Action<string> _log;
    private readonly UpdateManager _mgr;

    private UpdateInfo? _pending; // downloaded + staged, ready to apply
    private bool _busy;

    public UpdateService(Action<string, object?> emit, Action<string> log)
    {
        _emit = emit;
        _log = log;
        _mgr = new UpdateManager(FeedUrl);
    }

    /// <summary>Begin the background check/poll loop. No-op on an unpackaged dev build.</summary>
    public void Start()
    {
        if (!_mgr.IsInstalled)
        {
            _log("[updates] not an installed build — updater idle (dev/unpackaged)");
            return;
        }
        _ = LoopAsync();
    }

    private async Task LoopAsync()
    {
        await Task.Delay(InitialDelay).ConfigureAwait(false);
        while (true)
        {
            try { await CheckAndStageAsync().ConfigureAwait(false); }
            catch (Exception ex) { _log("[updates] check failed: " + ex.Message); }
            await Task.Delay(PollInterval).ConfigureAwait(false);
        }
    }

    // Check the feed and, if a newer build exists, download + stage it silently. Emits `updates.downloaded`
    // once staged. Guards against overlapping runs and against re-downloading an already-staged update.
    private async Task CheckAndStageAsync()
    {
        if (_busy || _pending is not null) return;
        _busy = true;
        try
        {
            var info = await _mgr.CheckForUpdatesAsync().ConfigureAwait(false);
            if (info is null) return; // already up to date
            var version = info.TargetFullRelease?.Version?.ToString();
            _log($"[updates] downloading {version} in background…");
            await _mgr.DownloadUpdatesAsync(info).ConfigureAwait(false);
            _pending = info;
            _log($"[updates] {version} staged — ready to apply");
            _emit("updates.downloaded", new { version });
        }
        finally { _busy = false; }
    }

    // window.zero.updates.startDownload(): with silent auto-download there's usually nothing to do. If a
    // build is already staged, re-announce it; otherwise force an immediate re-check (this is what the
    // pill's error-retry path calls) and surface any failure so the pill can show a retry affordance.
    public void StartDownload()
    {
        if (_pending is not null)
        {
            _emit("updates.downloaded", new { version = _pending.TargetFullRelease?.Version?.ToString() });
            return;
        }
        _ = ForceCheckAsync();
    }

    private async Task ForceCheckAsync()
    {
        try { await CheckAndStageAsync().ConfigureAwait(false); }
        catch (Exception ex)
        {
            _log("[updates] " + ex.Message);
            _emit("updates.error", new { message = ex.Message });
        }
    }

    // window.zero.updates.restartToApply(): swap in the staged version and relaunch. Near-instant because
    // the bits are already on disk. The process exits inside this call; data survives (same https origin,
    // versioned nowhere in storage). Called on the UI thread from OnWebMessage.
    public void RestartToApply()
    {
        if (_pending is null) return;
        try
        {
            // SILENT apply. ApplyUpdatesAndRestart spawns Velopack's Update.exe applier WITHOUT --silent,
            // which pops a Win32 "Installing Update" progress dialog and plays the Windows notification
            // chime (Loris: disliked the sound, not the feedback — the renderer now shows its OWN branded
            // "updating to vX" overlay instead, see zero0-update-indicator.tsx). WaitExitThenApplyUpdates
            // (silent:true) suppresses that window; Update.exe then waits for THIS process to exit before
            // it folder-swaps and relaunches.
            _mgr.WaitExitThenApplyUpdates(_pending, silent: true, restart: true);
            // Don't exit instantly: give the renderer a beat to paint its overlay first (the swap runs
            // AFTER we exit, with no window, so that overlay is the only feedback the user sees). Non-
            // blocking so the UI thread stays live to render it; Update.exe is already waiting on us.
            System.Threading.Tasks.Task.Delay(700).ContinueWith(_ => Environment.Exit(0));
        }
        catch (Exception ex)
        {
            _log("[updates] apply failed: " + ex.Message);
            _emit("updates.error", new { message = ex.Message });
        }
    }
}
