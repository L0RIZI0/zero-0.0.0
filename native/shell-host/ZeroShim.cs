using System.Text.Json;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// Builds the `window.zero` shim injected at document-created time. The shim body lives in the sibling
// `zero-shim.js` (real file → syntax highlighting + iterate without a C# rebuild); this bakes the
// synchronous constants (locale, appVersion, debugLogPath, platform) into it by replacing the
// `__ZERO_BAKED__` token with a JSON object literal, matching the preload's sendSync semantics.
// ---------------------------------------------------------------------------
static class ZeroShim
{
    public static string Build(object baked)
    {
        var json = JsonSerializer.Serialize(baked);
        var path = Path.Combine(AppContext.BaseDirectory, "zero-shim.js");
        string body;
        try { body = File.ReadAllText(path); }
        catch
        {
            // Missing shim: degrade to plain web mode (no window.zero) rather than crash. Leaves a
            // breadcrumb in the console for the migration.
            return "console.warn('[zero] shell shim missing — desktop bridge unavailable');";
        }
        return body.Replace("__ZERO_BAKED__", json);
    }
}
