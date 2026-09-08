// Transparent shell for the context-menu overlay: the native layer composites over web content, so the
// document itself must have NO background (the card supplies its own). A `bg-transparent` wrapper with a
// full-viewport reset overrides the root `bg-background` for this route only.
export default function MenuOverlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 overflow-hidden bg-transparent"
      // Belt-and-braces: also clear any inherited body paint at the element level so a stray root class
      // can't tint the composited layer.
      style={{ background: "transparent" }}
    >
      {children}
    </div>
  )
}
