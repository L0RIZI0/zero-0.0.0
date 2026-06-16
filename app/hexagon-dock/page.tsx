import type { Metadata } from "next"
import { HexagonDock } from "./hexagon-dock"

export const metadata: Metadata = {
  title: "Hexagon Dock — Prototype",
  description: "Spaces as hexagonal dock cards that morph into hexagon windows.",
}

export default function HexagonDockPage() {
  return <HexagonDock />
}
