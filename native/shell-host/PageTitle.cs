using System.Net;
using System.Text.RegularExpressions;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// Extract a human page title from raw HTML — a faithful port of main.cjs `extractPageTitle`:
// prefer og:title, else <title>, decode HTML entities, collapse whitespace. Used by webTitle so web
// Resources still show a real title/favicon offline (the /api/web-title stand-in the static export
// can't ship).
// ---------------------------------------------------------------------------
static class PageTitle
{
    private static readonly Regex OgA = new(
        "<meta[^>]+property=[\"']og:title[\"'][^>]*content=[\"']([^\"']+)[\"']",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex OgB = new(
        "<meta[^>]+content=[\"']([^\"']+)[\"'][^>]*property=[\"']og:title[\"']",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex TitleTag = new(
        "<title[^>]*>([\\s\\S]*?)</title>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex Ws = new("\\s+", RegexOptions.Compiled);

    public static string? Extract(string html)
    {
        var og = OgA.Match(html);
        if (!og.Success) og = OgB.Match(html);
        if (og.Success && og.Groups[1].Value.Length > 0)
            return Clean(WebUtility.HtmlDecode(og.Groups[1].Value));

        var t = TitleTag.Match(html);
        if (t.Success && t.Groups[1].Value.Length > 0)
            return Clean(WebUtility.HtmlDecode(Ws.Replace(t.Groups[1].Value, " ")));

        return null;
    }

    private static string? Clean(string s)
    {
        var trimmed = s.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }
}
