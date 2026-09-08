using System;
using System.Drawing;
using Windows.UI.Composition;
using Windows.UI.Composition.Desktop;

namespace Zero.ShellHost;

// ---------------------------------------------------------------------------
// Owns the per-window composition stack: one Compositor, one DesktopWindowTarget bound to the MainForm
// HWND, and a root ContainerVisual whose children are the stacked layers. Layer order within
// Root.Children is back→front, so the browsed-content visuals (added first, M2.2+) sit UNDER the shell
// visual (added last), and the shell's transparent regions let content show through.
//
// M2.1 uses exactly one layer: the shell. The API here (AddLayer / container sizing) is already shaped
// for the multi-layer content model so M2.2 only has to add lower layers — no rework of this file.
// ---------------------------------------------------------------------------
internal sealed class CompositionHost : IDisposable
{
    public Compositor Compositor { get; }
    private readonly DesktopWindowTarget _target;
    private readonly ContainerVisual _root;
    private Size _size;

    public CompositionHost(IntPtr hwnd, Size initialSize)
    {
        // A DispatcherQueue must exist on this thread before the Compositor is constructed.
        CompositionInterop.EnsureDispatcherQueue();
        Compositor = new Compositor();

        // isTopmost:false — the target composes as the window's own content, beneath any child HWNDs we
        // might add later (e.g. an OAuth popup owned window in M2.4). Root fills the client area.
        _target = CompositionInterop.CreateDesktopWindowTarget(Compositor, hwnd, false);
        _root = Compositor.CreateContainerVisual();
        _root.RelativeSizeAdjustment = System.Numerics.Vector2.One; // always fill the target
        _target.Root = _root;
        _size = initialSize;
    }

    // Create a child visual for a WebView2 composition controller and add it as the FRONTMOST layer.
    // The caller assigns this visual to controller.RootVisualTarget. Returned so the caller can size it.
    public ContainerVisual AddLayer()
    {
        var layer = Compositor.CreateContainerVisual();
        layer.RelativeSizeAdjustment = System.Numerics.Vector2.One; // fill the window; controllers clip via Bounds
        _root.Children.InsertAtTop(layer);
        return layer;
    }

    // Insert a layer at the BACK (used for content added under the shell in M2.2).
    public ContainerVisual AddLayerAtBottom()
    {
        var layer = Compositor.CreateContainerVisual();
        layer.RelativeSizeAdjustment = System.Numerics.Vector2.One;
        _root.Children.InsertAtBottom(layer);
        return layer;
    }

    // Detach a content layer when its view is closed (M2.2). Best-effort: the visual may already be gone.
    public void RemoveLayer(ContainerVisual layer)
    {
        try { _root.Children.Remove(layer); } catch { }
    }

    // Re-raise an existing layer to the FRONT (M3 menu overlay). Content views add their layers frontmost
    // on mount, so a long-lived overlay layer created earlier would fall behind them; calling this on each
    // open puts the menu above both the shell and any content view. Best-effort: remove then re-insert at
    // top (InsertAtTop on an already-child visual is not guaranteed to reorder).
    public void RaiseToTop(ContainerVisual layer)
    {
        try { _root.Children.Remove(layer); _root.Children.InsertAtTop(layer); } catch { }
    }

    public Size Size => _size;

    public void Resize(Size size) => _size = size;

    public void Dispose()
    {
        // Tearing down the target detaches the visual tree from the HWND. Both steps are best-effort:
        // during app close the HWND may already be gone.
        try { _root.Children.RemoveAll(); } catch { }
        try { _target.Dispose(); } catch { }
    }
}
