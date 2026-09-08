import { Zero0MenuOverlay } from "@/components/zero0/zero0-menu-overlay"

// The branded context-menu overlay route. Loaded into the native menu WebView2 layer (M3) that the
// shell composites above web content. Standalone: no app chrome, transparent background (see the
// route-group layout) so only the menu card paints.
export default function MenuOverlayPage() {
  return <Zero0MenuOverlay />
}
